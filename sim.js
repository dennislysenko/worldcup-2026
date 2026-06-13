/* Monte Carlo tournament simulator for the 2026 World Cup.
 *
 * Runs the whole tournament many times from Elo ratings and tallies, for every
 * knockout match + side, how often each nation lands there. Result → WC.proj.
 *
 *   WC.proj[matchNumber] = { home: [{team, p}, ...], away: [...] }   (p sorted desc)
 *
 * Model
 *  - Group games: independent Poisson goals, scoring rate tilted by Elo gap, so
 *    realistic W/D/L + goal difference for standings/tiebreakers.
 *  - Knockout games: single match, winner ~ Elo win expectancy (ET/pens implicit).
 *  - 8 best third-placed teams advance; allocated to the R32 third-place slots with
 *    a same-group-avoidance rule (FIFA uses a fixed lookup table — this is a faithful
 *    approximation, disclosed in the Projections explainer).
 */
(function () {
  "use strict";
  const elo = WC.elo;

  // ---- structure derived from the schedule ----
  const groups = {};            // "A" -> [team, team, team, team]
  const groupMatches = {};      // "A" -> [match, ...]
  WC.matches.filter(m => m.stage === "Group").forEach(m => {
    const g = (groups[m.group] = groups[m.group] || []);
    if (!g.includes(m.home)) g.push(m.home);
    if (!g.includes(m.away)) g.push(m.away);
    (groupMatches[m.group] = groupMatches[m.group] || []).push(m);
  });
  const GROUP_LETTERS = Object.keys(groups).sort();
  const koMatches = WC.matches.filter(m => m.stage !== "Group")
    .sort((a, b) => a.matchNumber - b.matchNumber);
  const koByNum = {};
  koMatches.forEach(m => { koByNum[m.matchNumber] = m; });
  const thirdSlots = koMatches.filter(m => m.away === "Third-place qualifier").map(m => m.matchNumber);

  // ---- model ----
  const BASE = 1.35, K = 0.5;
  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  function goals(a, b) {
    const d = (elo[a] - elo[b]) / 400;
    return [poisson(BASE * Math.exp(K * d)), poisson(BASE * Math.exp(-K * d))];
  }
  function winProb(a, b) { return 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400)); }
  function koWinner(a, b) { return Math.random() < winProb(a, b) ? a : b; }

  function simGroup(letter) {
    const teams = groups[letter];
    const st = {};
    teams.forEach(t => { st[t] = { pts: 0, gd: 0, gf: 0, r: Math.random() }; });
    groupMatches[letter].forEach(m => {
      const [ga, gb] = goals(m.home, m.away);
      st[m.home].gf += ga; st[m.away].gf += gb;
      st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
      if (ga > gb) st[m.home].pts += 3;
      else if (gb > ga) st[m.away].pts += 3;
      else { st[m.home].pts++; st[m.away].pts++; }
    });
    const ranked = teams.slice().sort((x, y) =>
      st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf || st[x].r - st[y].r);
    return { ranked, st };
  }

  function allocateThirds(qual, used) {
    // qual: [{team, group}], assign to each third-slot avoiding the slot winner's group
    const assign = {};
    for (const s of thirdSlots) {
      const wgroup = koByNum[s].home.replace("Winner Group ", "");
      let pick = qual.find(t => !used.has(t.team) && t.group !== wgroup) || qual.find(t => !used.has(t.team));
      used.add(pick.team);
      assign[s] = pick.team;
    }
    return assign;
  }

  const FUNNEL_STAGES = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"];

  function simTournament(tally, paths) {
    const gw = {}, ru = {}, thirds = [];
    for (const L of GROUP_LETTERS) {
      const r = simGroup(L);
      gw[L] = r.ranked[0]; ru[L] = r.ranked[1];
      const t3 = r.ranked[2];
      thirds.push({ team: t3, group: L, pts: r.st[t3].pts, gd: r.st[t3].gd, gf: r.st[t3].gf, r: Math.random() });
    }
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
    const slotAssign = allocateThirds(thirds.slice(0, 8), new Set());

    const winnerOf = {}, loserOf = {}, seen = {};
    function resolve(str, matchNum) {
      if (str.startsWith("Winner Group ")) return gw[str.slice(13)];
      if (str.startsWith("Runner-up Group ")) return ru[str.slice(16)];
      if (str === "Third-place qualifier") return slotAssign[matchNum];
      if (str.startsWith("Winner Match ")) return winnerOf[+str.slice(13)];
      if (str.startsWith("Loser Match ")) return loserOf[+str.slice(12)];
      return str;
    }
    for (const m of koMatches) {
      const home = resolve(m.home, m.matchNumber);
      const away = resolve(m.away, m.matchNumber);
      const tm = tally[m.matchNumber];
      tm.home[home] = (tm.home[home] || 0) + 1;
      tm.away[away] = (tm.away[away] || 0) + 1;
      (seen[m.stage] = seen[m.stage] || new Set()).add(home).add(away);
      const w = koWinner(home, away);
      winnerOf[m.matchNumber] = w;
      loserOf[m.matchNumber] = w === home ? away : home;
    }
    // per-team round-reach + group finish, for the drill-down funnel
    FUNNEL_STAGES.forEach(stage => { const s = seen[stage]; if (s) s.forEach(t => { paths[t][stage]++; }); });
    paths[winnerOf[104]].champion++;
    for (const L of GROUP_LETTERS) { paths[gw[L]].groupWin++; paths[ru[L]].groupRunner++; }
  }

  // ---- live group odds, conditioned on actual results ----
  // results: { [matchNumber]: { homeScore, awayScore, state } } — only `post`
  // (final) games are locked in; the rest are simulated from Elo. Returns
  // { [team]: { win, runnerUp, advance } } as probabilities. Group-stage only,
  // so it's cheap enough to re-run whenever a new result lands.
  WC.runGroupOdds = function (results, Nopt) {
    results = results || {};
    const N = Nopt || 4000;
    const NQ = thirdSlots.length; // 8 best third-placed teams advance
    const tally = {};
    WC.teams.forEach(t => { tally[t.name] = { win: 0, ru: 0, adv: 0 }; });
    for (let i = 0; i < N; i++) {
      const thirds = [];
      for (const L of GROUP_LETTERS) {
        const teams = groups[L];
        const st = {};
        teams.forEach(t => { st[t] = { pts: 0, gd: 0, gf: 0, r: Math.random() }; });
        for (const m of groupMatches[L]) {
          const res = results[m.matchNumber];
          let ga, gb;
          if (res && res.state === "post" && res.homeScore != null) { ga = res.homeScore; gb = res.awayScore; }
          else { [ga, gb] = goals(m.home, m.away); }
          st[m.home].gf += ga; st[m.away].gf += gb;
          st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
          if (ga > gb) st[m.home].pts += 3;
          else if (gb > ga) st[m.away].pts += 3;
          else { st[m.home].pts++; st[m.away].pts++; }
        }
        const ranked = teams.slice().sort((x, y) =>
          st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf || st[x].r - st[y].r);
        tally[ranked[0]].win++; tally[ranked[0]].adv++;
        tally[ranked[1]].ru++; tally[ranked[1]].adv++;
        const t3 = ranked[2];
        thirds.push({ team: t3, pts: st[t3].pts, gd: st[t3].gd, gf: st[t3].gf, r: Math.random() });
      }
      thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
      for (let k = 0; k < NQ; k++) tally[thirds[k].team].adv++;
    }
    const out = {};
    WC.teams.forEach(t => { const c = tally[t.name]; out[t.name] = { win: c.win / N, runnerUp: c.ru / N, advance: c.adv / N }; });
    return out;
  };

  // ---- run ----
  const N = 12000;
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const tally = {};
  koMatches.forEach(m => { tally[m.matchNumber] = { home: {}, away: {} }; });
  const TEAM_NAMES = WC.teams.map(t => t.name);
  const paths = {};
  TEAM_NAMES.forEach(t => {
    paths[t] = { "Round of 32": 0, "Round of 16": 0, "Quarter-final": 0, "Semi-final": 0, "Final": 0, champion: 0, groupWin: 0, groupRunner: 0 };
  });
  for (let i = 0; i < N; i++) simTournament(tally, paths);

  const toSorted = counts => Object.keys(counts)
    .map(team => ({ team, p: counts[team] / N }))
    .sort((a, b) => b.p - a.p);

  WC.proj = {};
  koMatches.forEach(m => {
    WC.proj[m.matchNumber] = { home: toSorted(tally[m.matchNumber].home), away: toSorted(tally[m.matchNumber].away) };
  });
  // per-team survival funnel (probabilities), for drill-down
  WC.teamPath = {};
  TEAM_NAMES.forEach(t => {
    const p = paths[t];
    WC.teamPath[t] = {
      groupWin: p.groupWin / N, groupRunner: p.groupRunner / N,
      r32: p["Round of 32"] / N, r16: p["Round of 16"] / N,
      qf: p["Quarter-final"] / N, sf: p["Semi-final"] / N,
      final: p["Final"] / N, champion: p.champion / N
    };
  });
  WC.projMeta = { sims: N, ms: t0 ? Math.round(performance.now() - t0) : null };
})();
