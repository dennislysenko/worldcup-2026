#!/usr/bin/env node
/* Maintains proj-history.json — projection snapshots over time so the Movers
   panel can show how odds shift between rounds.
   - Seeds a "start" baseline (pre-tournament Elo, no results) if absent.
   - Appends a snapshot of the CURRENT projection (current Elo + results),
     keyed by the number of group games completed, if that key is new.
   Run nightly. Read model mirrors sim.js. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const groupPlayed = WC.matches.filter(m => m.stage === 'Group' && finalOf(m.matchNumber)).length;

let elo;
const BASE = 1.35, KG = 0.5;
const poisson = l => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; };
const goals = (a, b) => { const d = (elo[a] - elo[b]) / 400; return [poisson(BASE * Math.exp(KG * d)), poisson(BASE * Math.exp(-KG * d))]; };
const koWin = (a, b) => (Math.random() < 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400))) ? a : b;
function simGroup(L, useResults) {
  const st = {}; groups[L].forEach(t => st[t] = { pts: 0, gd: 0, gf: 0, r: Math.random() });
  for (const m of groupMatches[L]) {
    let ga, gb; const s = useResults && finalOf(m.matchNumber);
    if (s) { ga = s.homeScore; gb = s.awayScore; } else { [ga, gb] = goals(m.home, m.away); }
    st[m.home].gf += ga; st[m.away].gf += gb; st[m.home].gd += ga - gb; st[m.away].gd += gb - ga;
    if (ga > gb) st[m.home].pts += 3; else if (gb > ga) st[m.away].pts += 3; else { st[m.home].pts++; st[m.away].pts++; }
  }
  return groups[L].slice().sort((x, y) => st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf || st[x].r - st[y].r).map(t => ({ t, st: st[t] }));
}
function snapshot(eloSet, useResults) {
  elo = eloSet;
  const champ = {}, adv = {}, gw = {}; WC.teams.forEach(t => { champ[t.name] = adv[t.name] = gw[t.name] = 0; });
  for (let n = 0; n < N; n++) {
    const win = {}, ru = {}, thirds = [];
    for (const L of GL) { const r = simGroup(L, useResults); win[L] = r[0].t; ru[L] = r[1].t; thirds.push({ team: r[2].t, group: L, pts: r[2].st.pts, gd: r[2].st.gd, gf: r[2].st.gf, r: Math.random() }); }
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.r - b.r);
    const used = new Set(), slot = {};
    for (const sN of thirdSlots) { const wgp = koByNum[sN].home.replace('Winner Group ', ''); const p = thirds.slice(0, 8).find(t => !used.has(t.team) && t.group !== wgp) || thirds.slice(0, 8).find(t => !used.has(t.team)); used.add(p.team); slot[sN] = p.team; }
    for (const L of GL) { gw[win[L]]++; adv[win[L]]++; adv[ru[L]]++; }
    thirds.slice(0, 8).forEach(t => adv[t.team]++);
    const wOf = {};
    const res = (str, mn) => str.startsWith('Winner Group ') ? win[str.slice(13)] : str.startsWith('Runner-up Group ') ? ru[str.slice(16)] : str === 'Third-place qualifier' ? slot[mn] : str.startsWith('Winner Match ') ? wOf[+str.slice(13)] : null;
    for (const m of ko) { if (m.stage === 'Third-place') continue; wOf[m.matchNumber] = koWin(res(m.home, m.matchNumber), res(m.away, m.matchNumber)); }
    champ[wOf[104]]++;
  }
  const round = v => Math.round(v / N * 1000) / 1000;
  const pack = o => { const r = {}; WC.teams.forEach(t => r[t.name] = round(o[t.name])); return r; };
  return { champ: pack(champ), adv: pack(adv), gw: pack(gw) };
}

const file = new URL('proj-history.json', root);
const hist = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { snapshots: [] };
if (!hist.snapshots.some(s => s.key === 'start')) {
  hist.snapshots.unshift({ key: 'start', label: 'Tournament start', played: 0, ...snapshot(preElo, false) });
  console.error('seeded start baseline');
}
const key = `g${groupPlayed}`;
if (hist.snapshots[hist.snapshots.length - 1].key !== key && groupPlayed > 0) {
  hist.snapshots.push({ key, label: `${groupPlayed} group games in`, played: groupPlayed, ...snapshot(nowElo, true) });
  console.error(`appended snapshot ${key}`);
} else {
  console.error(`no new snapshot (latest already ${hist.snapshots[hist.snapshots.length - 1].key})`);
}
writeFileSync(file, JSON.stringify(hist));
console.error(`proj-history.json: ${hist.snapshots.length} snapshots`);
