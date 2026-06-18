/* Movement so far: pre-tournament projection (pre-tourney Elo, no results) vs
   now (current eloratings + results conditioned). Prints the biggest swings.
   Read-only. Mirrors sim.js's model. */
import { readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const WC = Function(readFileSync(new URL('data.js', root), 'utf8') + ';return WC;')();
const preElo = Function('WC', readFileSync(new URL('elo-pretournament.js', root), 'utf8') + ';return WC.elo;')({});
const nowElo = Function('WC', readFileSync(new URL('elo.js', root), 'utf8') + ';return WC.elo;')({});
const scores = JSON.parse(readFileSync(new URL('scores.json', root), 'utf8')).scores;
const N = 12000;

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
const finalOf = mn => { const s = scores[mn]; return s && s.state === 'post' && s.homeScore != null ? s : null; };

let elo;
const BASE = 1.35, KG = 0.5;
const poisson = l => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; };
const goals = (a, b) => { const d = (elo[a] - elo[b]) / 400; return [poisson(BASE * Math.exp(KG * d)), poisson(BASE * Math.exp(-KG * d))]; };
const winProb = (a, b) => 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400));
const koWin = (a, b) => Math.random() < winProb(a, b) ? a : b;

function simGroup(L, useResults) {
  const st = {}; groups[L].forEach(t => st[t] = { pts: 0, gd: 0, gf: 0, r: Math.random() });
  for (const m of groupMatches[L]) {
    let ga, gb; const s = useResults && finalOf(m.matchNumber);
    if (s) { ga = s.homeScore; gb = s.awayScore; } else { [ga, gb] = goals(m.home, m.away); }
    st[m.home].gf += ga; st[m.away].gf += gb; st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
    if (ga > gb) st[m.home].pts += 3; else if (gb > ga) st[m.away].pts += 3; else { st[m.home].pts++; st[m.away].pts++; }
  }
  return groups[L].slice().sort((x, y) => st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf || st[x].r - st[y].r).map((t, i) => ({ t, st: st[t], i }));
}
function run(useResults) {
  const champ = {}, adv = {}, gw = {};
  WC.teams.forEach(t => { champ[t.name] = adv[t.name] = gw[t.name] = 0; });
  for (let n = 0; n < N; n++) {
    const win = {}, ru = {}, thirds = [];
    for (const L of GL) { const r = simGroup(L, useResults); win[L] = r[0].t; ru[L] = r[1].t; const t3 = r[2]; thirds.push({ team: t3.t, group: L, pts: t3.st.pts, gd: t3.st.gd, gf: t3.st.gf, r: Math.random() }); }
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
    const used = new Set(), slot = {};
    for (const sN of thirdSlots) { const wg = koByNum[sN].home.replace('Winner Group ', ''); const p = thirds.slice(0, 8).find(t => !used.has(t.team) && t.group !== wg) || thirds.slice(0, 8).find(t => !used.has(t.team)); used.add(p.team); slot[sN] = p.team; }
    for (const L of GL) { gw[win[L]]++; adv[win[L]]++; adv[ru[L]]++; }
    thirds.slice(0, 8).forEach(t => adv[t.team]++);
    const wOf = {};
    const res = (str, mn) => str.startsWith('Winner Group ') ? win[str.slice(13)] : str.startsWith('Runner-up Group ') ? ru[str.slice(16)] : str === 'Third-place qualifier' ? slot[mn] : str.startsWith('Winner Match ') ? wOf[+str.slice(13)] : null;
    for (const m of ko) { if (m.stage === 'Third-place') continue; const h = res(m.home, m.matchNumber), a = res(m.away, m.matchNumber); wOf[m.matchNumber] = koWin(h, a); }
    champ[wOf[104]]++;
  }
  const f = o => { const r = {}; WC.teams.forEach(t => r[t.name] = o[t.name] / N); return r; };
  return { champ: f(champ), adv: f(adv), gw: f(gw) };
}

elo = preElo; const before = run(false);
elo = nowElo; const after = run(true);

function movers(key, label, n = 6) {
  const rows = WC.teams.map(t => ({ team: t.name, d: (after[key][t.name] - before[key][t.name]) * 100, now: after[key][t.name] * 100, was: before[key][t.name] * 100 }));
  const up = rows.slice().sort((a, b) => b.d - a.d).slice(0, n).filter(r => r.d > 0.5);
  const dn = rows.slice().sort((a, b) => a.d - b.d).slice(0, n).filter(r => r.d < -0.5);
  const fmt = r => `   ${(r.d >= 0 ? '+' : '') + r.d.toFixed(0)}%  ${r.team.padEnd(22)} ${r.was.toFixed(0)}% -> ${r.now.toFixed(0)}%`;
  console.log(`\n== ${label} ==`);
  console.log(' RISERS'); up.forEach(r => console.log(fmt(r)));
  console.log(' FALLERS'); dn.forEach(r => console.log(fmt(r)));
}
movers('gw', 'WIN GROUP');
movers('adv', 'ADVANCE (reach knockouts)');
movers('champ', 'CHAMPION');
