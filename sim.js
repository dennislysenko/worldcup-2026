/* Monte Carlo tournament simulator for the 2026 World Cup.
 *
 * Runs the whole tournament many times and tallies, for every knockout match +
 * side, how often each nation lands there → WC.proj. Re-runnable via
 * WC.runProjections(results): played group games are locked to their real
 * scores; team strength comes from elo.js (refreshed daily from eloratings.net's
 * current ratings, which already reflect results). Call when a new final lands.
 *
 *   WC.proj[matchNumber] = { home: [{team, p}, ...], away: [...] }   (p sorted desc)
 *
 * Model
 *  - Group games: independent Poisson goals, scoring rate tilted by Elo gap.
 *  - Knockout games: single match, winner ~ Elo win expectancy (ET/pens implicit).
 *  - 8 best third-placed teams advance; allocated to the R32 third-place slots
 *    with a same-group-avoidance rule (FIFA's fixed table is approximated here).
 */
(function () {
  "use strict";

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
  const koMatches = WC.matches.filter(m => m.stage !== "Group").sort((a, b) => a.matchNumber - b.matchNumber);
  const koByNum = {};
  koMatches.forEach(m => { koByNum[m.matchNumber] = m; });
  const thirdSlots = koMatches.filter(m => m.away === "Third-place qualifier").map(m => m.matchNumber);

  // ---- ratings ----
  // elo.js is refreshed daily from eloratings.net's CURRENT ratings, which already
  // reflect results to date — so the model uses them directly (no self-replay; that
  // would double-count the same games). Results still condition the group sim below
  // for standings/bracket slots.
  const activeElo = WC.elo;

  // ---- model (reads activeElo) ----
  const BASE = 1.35, K = 0.5;
  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  function goals(a, b) {
    const d = (activeElo[a] - activeElo[b]) / 400;
    return [poisson(BASE * Math.exp(K * d)), poisson(BASE * Math.exp(-K * d))];
  }
  function winProb(a, b) { return 1 / (1 + Math.pow(10, (activeElo[b] - activeElo[a]) / 400)); }
  function koWinner(a, b) { return Math.random() < winProb(a, b) ? a : b; }

  // simulate a group, locking any played game to its real score
  function simGroup(letter, results) {
    const teams = groups[letter];
    const st = {}, played = [];
    teams.forEach(t => { st[t] = { team: t, pts: 0, gd: 0, gf: 0, r: Math.random() }; });
    groupMatches[letter].forEach(m => {
      const res = results[m.matchNumber];
      let ga, gb;
      if (res && res.state === "post" && res.homeScore != null) { ga = res.homeScore; gb = res.awayScore; }
      else { [ga, gb] = goals(m.home, m.away); }
      played.push({ home: m.home, away: m.away, ga, gb });
      st[m.home].gf += ga; st[m.away].gf += gb;
      st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
      if (ga > gb) st[m.home].pts += 3;
      else if (gb > ga) st[m.away].pts += 3;
      else { st[m.home].pts++; st[m.away].pts++; }
    });
    // 2026 tiebreak order: level on points → head-to-head (pts, GD, GF) before overall GD/GF
    const arr = teams.map(t => st[t]).sort((a, b) => b.pts - a.pts);
    const ranked = [];
    for (let i = 0; i < arr.length;) {
      let j = i + 1; while (j < arr.length && arr[j].pts === arr[i].pts) j++;
      let block = arr.slice(i, j);
      if (block.length > 1) {
        const set = new Set(block.map(b => b.team)), sub = {};
        block.forEach(b => sub[b.team] = { pts: 0, gd: 0, gf: 0 });
        for (const g of played) {
          if (!set.has(g.home) || !set.has(g.away)) continue;
          const a = sub[g.home], b = sub[g.away];
          a.gf += g.ga; b.gf += g.gb; a.gd += g.ga - g.gb; b.gd += g.gb - g.ga;
          if (g.ga > g.gb) a.pts += 3; else if (g.gb > g.ga) b.pts += 3; else { a.pts++; b.pts++; }
        }
        block = block.sort((x, y) => sub[y.team].pts - sub[x.team].pts || sub[y.team].gd - sub[x.team].gd || sub[y.team].gf - sub[x.team].gf || y.gd - x.gd || y.gf - x.gf || x.r - y.r);
      }
      block.forEach(b => ranked.push(b.team)); i = j;
    }
    return { ranked, st };
  }

  function allocateThirds(qual, used) {
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

  function simTournament(tally, paths, results) {
    const gw = {}, ru = {}, thirds = [];
    for (const L of GROUP_LETTERS) {
      const r = simGroup(L, results);
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
    FUNNEL_STAGES.forEach(stage => { const s = seen[stage]; if (s) s.forEach(t => { paths[t][stage]++; }); });
    paths[winnerOf[104]].champion++;
    for (const L of GROUP_LETTERS) { paths[gw[L]].groupWin++; paths[ru[L]].groupRunner++; }
  }

  // ---- live group odds, conditioned on actual results (uses activeElo) ----
  // { [team]: { win, runnerUp, advance } }. Cheap; re-run whenever a result lands.
  WC.runGroupOdds = function (results, Nopt) {
    results = results || {};
    const N = Nopt || 4000;
    const NQ = thirdSlots.length;
    const tally = {};
    WC.teams.forEach(t => { tally[t.name] = { win: 0, ru: 0, adv: 0 }; });
    for (let i = 0; i < N; i++) {
      const thirds = [];
      for (const L of GROUP_LETTERS) {
        const r = simGroup(L, results);
        tally[r.ranked[0]].win++; tally[r.ranked[0]].adv++;
        tally[r.ranked[1]].ru++; tally[r.ranked[1]].adv++;
        const t3 = r.ranked[2];
        thirds.push({ team: t3, pts: r.st[t3].pts, gd: r.st[t3].gd, gf: r.st[t3].gf, r: Math.random() });
      }
      thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
      for (let k = 0; k < NQ; k++) tally[thirds[k].team].adv++;
    }
    const out = {};
    WC.teams.forEach(t => { const c = tally[t.name]; out[t.name] = { win: c.win / N, runnerUp: c.ru / N, advance: c.adv / N }; });
    return out;
  };

  // ---- full projections (WC.proj + WC.teamPath), conditioned + Elo-refreshed ----
  const N = 12000;
  const TEAM_NAMES = WC.teams.map(t => t.name);
  WC.runProjections = function (results) {
    results = results || {};
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const tally = {};
    koMatches.forEach(m => { tally[m.matchNumber] = { home: {}, away: {} }; });
    const paths = {};
    TEAM_NAMES.forEach(t => {
      paths[t] = { "Round of 32": 0, "Round of 16": 0, "Quarter-final": 0, "Semi-final": 0, "Final": 0, champion: 0, groupWin: 0, groupRunner: 0 };
    });
    for (let i = 0; i < N; i++) simTournament(tally, paths, results);

    const toSorted = counts => Object.keys(counts).map(team => ({ team, p: counts[team] / N })).sort((a, b) => b.p - a.p);
    WC.proj = {};
    koMatches.forEach(m => { WC.proj[m.matchNumber] = { home: toSorted(tally[m.matchNumber].home), away: toSorted(tally[m.matchNumber].away) }; });
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
  };

  WC.runProjections({}); // baseline at load; app re-runs with results once scores load
})();
