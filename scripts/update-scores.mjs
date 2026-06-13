#!/usr/bin/env node
/* Bake scores.json (historical + any started match) from ESPN's public API.
   Keyed by data.js matchNumber. The browser tops up live matches itself, so
   this just keeps finished scores fresh & instant on first paint.
   Run: node scripts/update-scores.mjs */

import { readFile, writeFile } from 'node:fs/promises';
import { ESPN_BASE, indexScores, tournamentDatesThrough } from '../scores-espn.mjs';

// data.js is a classic script declaring `const WC = {...}`; eval it to read matches.
const dataSrc = await readFile(new URL('../data.js', import.meta.url), 'utf8');
const WC = Function(`${dataSrc}\n;return WC;`)();

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const events = [];
for (const date of tournamentDatesThrough()) {
  const sb = await get(`${ESPN_BASE}/scoreboard?dates=${date}`);
  for (const e of sb.events || []) events.push(e);
}

const scores = indexScores(WC.matches, events);
const out = {
  _meta: {
    generated: new Date().toISOString(),
    source: 'ESPN public API (site.api.espn.com)',
    note: 'keyed by data.js matchNumber; browser live-polls in-progress matches',
  },
  scores,
};
await writeFile(new URL('../scores.json', import.meta.url), JSON.stringify(out, null, 1));

const n = Object.keys(scores).length;
const live = Object.values(scores).filter((s) => s.state === 'in').length;
console.error(`== scores.json: ${n} matches (${live} live) ==`);
for (const [mn, s] of Object.entries(scores)) {
  console.error(`  #${mn} ${s.home} ${s.homeScore}-${s.awayScore} ${s.away} [${s.statusText}]`);
}
