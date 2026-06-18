#!/usr/bin/env node
/* Refresh elo.js from eloratings.net's current World ratings (a plain TSV, so it
   works in CI with no browser). These ratings already reflect results to date,
   so the sim uses them directly — no self-replay. Run: node scripts/update-elo.mjs */
import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://www.eloratings.net';
const get = async (f) => { const r = await fetch(`${BASE}/${f}?_=${Date.now()}`); if (!r.ok) throw new Error(`${r.status} ${f}`); return r.text(); };

// our 48 team names → eloratings name (only the divergences need listing)
const ALIAS = { 'Türkiye': 'Turkey' };

const dataSrc = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const WC = Function(`${dataSrc}\n;return WC;`)();

const [world, teams] = await Promise.all([get('World.tsv'), get('en.teams.tsv')]);

const codeToName = {};
for (const line of teams.split('\n')) {
  const c = line.split('\t');
  if (c[0] && c[1] && !c[0].endsWith('_loc')) codeToName[c[0]] = c[1];
}
const nameToRating = {};
for (const line of world.split('\n')) {
  const c = line.split('\t');
  const code = c[2], rating = parseInt(c[3], 10);
  if (code && Number.isFinite(rating) && codeToName[code]) nameToRating[codeToName[code]] = rating;
}

const elo = {}, missing = [];
for (const t of WC.teams) {
  const key = ALIAS[t.name] || t.name;
  if (nameToRating[key] != null) elo[t.name] = nameToRating[key];
  else missing.push(t.name);
}
if (missing.length) { console.error('UNMATCHED (fix ALIAS):', missing); process.exit(1); }

const lines = WC.teams.map(t => `  "${t.name}": ${elo[t.name]}`);
const out = `// World Football Elo ratings — auto-refreshed from eloratings.net (current, reflects results).
// Regenerate: node scripts/update-elo.mjs   ·   pre-tournament snapshot archived in elo-pretournament.js
WC.elo = {\n${lines.join(',\n')}\n};\n`;
await writeFile(new URL('../elo.js', import.meta.url), out);
console.error(`== elo.js refreshed: ${WC.teams.length} teams. Spain ${elo['Spain']}, Ecuador ${elo['Ecuador']}, England ${elo['England']} ==`);
