/* DRY RUN: compare current (pre-tournament, Elo-only) projections vs
   results-conditioned projections. Does NOT write anything. Mirrors sim.js's
   model. Optionally also refreshes Elo from results (--elo) to show that lever. */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const WC = Function(readFileSync(new URL('data.js', root), 'utf8') + ';return WC;')();
Function('WC', readFileSync(new URL('elo.js', root), 'utf8'))(WC);
const scores = JSON.parse(readFileSync(new URL('scores.json', root), 'utf8')).scores;

const REFRESH_ELO = process.argv.includes('--elo');
const K_ELO = +(process.argv.find(a => a.startsWith('--k='))?.slice(4) || 60); // Elo refresh K-factor
const N = 12000;

// ---- structure ----
const groups = {}, groupMatches = {};
WC.matches.filter(m => m.stage === 'Group').forEach(m => {
  (groups[m.group] = groups[m.group] || []);
  if (!groups[m.group].includes(m.home)) groups[m.group].push(m.home);
  if (!groups[m.group].includes(m.away)) groups[m.group].push(m.away);
  (groupMatches[m.group] = groupMatches[m.group] || []).push(m);
});
const GL = Object.keys(groups).sort();
const ko = WC.matches.filter(m => m.stage !== 'Group').sort((a, b) => a.matchNumber - b.matchNumber);
const koByNum = {}; ko.forEach(m => koByNum[m.matchNumber] = m);
const thirdSlots = ko.filter(m => m.away === 'Third-place qualifier').map(m => m.matchNumber);

// map data.js name -> scores.json result (by matchNumber)
const finalOf = mn => { const s = scores[mn]; return s && s.state === 'post' && s.homeScore != null ? s : null; };

// ---- optional Elo refresh (World Football Elo, K=60 World Cup) ----
const elo = { ...WC.elo };
if (REFRESH_ELO) {
  const gd = WC.matches.filter(m => m.stage === 'Group').sort((a, b) => a.matchNumber - b.matchNumber);
  for (const m of gd) {
    const s = finalOf(m.matchNumber); if (!s) continue;
    const ga = s.homeScore, gb = s.awayScore, dr = elo[m.home] - elo[m.away];
    const We = 1 / (1 + Math.pow(10, -dr / 400));
    const W = ga > gb ? 1 : ga < gb ? 0 : 0.5;
    const diff = Math.abs(ga - gb);
    const G = diff <= 1 ? 1 : diff === 2 ? 1.5 : (11 + diff) / 8;
    const delta = K_ELO * G * (W - We);
    elo[m.home] += delta; elo[m.away] -= delta;
  }
}

// ---- model (mirrors sim.js) ----
const BASE = 1.35, K = 0.5;
function poisson(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
function goals(a, b) { const d = (elo[a] - elo[b]) / 400; return [poisson(BASE * Math.exp(K * d)), poisson(BASE * Math.exp(-K * d))]; }
function winProb(a, b) { return 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400)); }
function koWin(a, b) { return Math.random() < winProb(a, b) ? a : b; }

function simGroup(L, conditioned) {
  const st = {}; groups[L].forEach(t => st[t] = { pts: 0, gd: 0, gf: 0, r: Math.random() });
  for (const m of groupMatches[L]) {
    let ga, gb; const s = conditioned && finalOf(m.matchNumber);
    if (s) { ga = s.homeScore; gb = s.awayScore; } else { [ga, gb] = goals(m.home, m.away); }
    st[m.home].gf += ga; st[m.away].gf += gb; st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
    if (ga > gb) st[m.home].pts += 3; else if (gb > ga) st[m.away].pts += 3; else { st[m.home].pts++; st[m.away].pts++; }
  }
  const r = groups[L].slice().sort((x, y) => st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf || st[x].r - st[y].r);
  return { ranked: r, st };
}

function simTournament(conditioned, tally) {
  const gw = {}, ru = {}, thirds = [];
  for (const L of GL) { const r = simGroup(L, conditioned); gw[L] = r.ranked[0]; ru[L] = r.ranked[1]; const t = r.ranked[2]; thirds.push({ team: t, group: L, pts: r.st[t].pts, gd: r.st[t].gd, gf: r.st[t].gf, r: Math.random() }); }
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
  const used = new Set(), slotAssign = {};
  for (const sN of thirdSlots) { const wg = koByNum[sN].home.replace('Winner Group ', ''); const pick = thirds.slice(0, 8).find(t => !used.has(t.team) && t.group !== wg) || thirds.slice(0, 8).find(t => !used.has(t.team)); used.add(pick.team); slotAssign[sN] = pick.team; }
  const winnerOf = {};
  const resolve = (str, mn) => str.startsWith('Winner Group ') ? gw[str.slice(13)] : str.startsWith('Runner-up Group ') ? ru[str.slice(16)] : str === 'Third-place qualifier' ? slotAssign[mn] : str.startsWith('Winner Match ') ? winnerOf[+str.slice(13)] : null;
  for (const m of ko) {
    if (m.stage === 'Third-place') continue;
    const h = resolve(m.home, m.matchNumber), a = resolve(m.away, m.matchNumber);
    const w = koWin(h, a); winnerOf[m.matchNumber] = w;
    if (m.stage === 'Final') { tally.champ[w] = (tally.champ[w] || 0) + 1; tally.finalist[h] = (tally.finalist[h] || 0) + 1; tally.finalist[a] = (tally.finalist[a] || 0) + 1; }
  }
  for (const L of GL) { tally.gw[gw[L]] = (tally.gw[gw[L]] || 0) + 1; }
  thirds.slice(0, 8).forEach(t => tally.adv3[t.team] = (tally.adv3[t.team] || 0) + 1);
  for (const L of GL) { tally.adv[gw[L]] = (tally.adv[gw[L]] || 0) + 1; tally.adv[ru[L]] = (tally.adv[ru[L]] || 0) + 1; }
  thirds.slice(0, 8).forEach(t => tally.adv[t.team] = (tally.adv[t.team] || 0) + 1);
}

function run(conditioned) {
  const tally = { champ: {}, finalist: {}, gw: {}, adv: {}, adv3: {} };
  const t0 = performance.now();
  for (let i = 0; i < N; i++) simTournament(conditioned, tally);
  return { tally, ms: Math.round(performance.now() - t0) };
}

const base = run(false);
const cond = run(true);
const pc = (t, k) => ((100 * (t[k] || 0) / N)).toFixed(1) + '%';
const TEAMS = ['Spain', 'France', 'Argentina', 'England', 'Brazil', 'Germany', 'Portugal', 'Netherlands', 'Norway', 'Sweden', 'Croatia', 'Japan'];
const spainElo = REFRESH_ELO ? Math.round(elo['Spain']) : WC.elo['Spain'];
console.log(`\nElo: ${REFRESH_ELO ? `REFRESHED (K=${K_ELO})` : 'static snapshot'} | Spain Elo ${WC.elo['Spain']}->${spainElo} | N=${N} | ~${cond.ms}ms\n`);
console.log('Team           Champion        Reach Final      Win Group        Advance');
console.log('               now -> cond     now -> cond      now -> cond      now -> cond');
for (const t of TEAMS) {
  const row = (k) => `${pc(base.tally[k], t)}->${pc(cond.tally[k], t)}`.padEnd(16);
  console.log(t.padEnd(14), row('champ'), row('finalist'), row('gw'), row('adv'));
}
