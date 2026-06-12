#!/usr/bin/env node
/* Rebuild set-piece-goals.json from ESPN's public World Cup API.
   Run any time (e.g. nightly): node scripts/update-setpieces.mjs
   The page also tops up live matches client-side, so this just keeps the
   committed baseline fresh and small. */

import { writeFile, readFile } from 'node:fs/promises';
import {
  ESPN_BASE, goalsFromSummary, matchFromScoreboardEvent, aggregate, applyOverrides, tournamentDatesThrough,
} from '../setpiece-espn.mjs';

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const matches = [];
for (const date of tournamentDatesThrough()) {
  const sb = await get(`${ESPN_BASE}/scoreboard?dates=${date}`);
  for (const e of sb.events || []) {
    const m = matchFromScoreboardEvent(e);
    if (m.state === 'pre') continue;
    const summary = await get(`${ESPN_BASE}/summary?event=${m.espnId}`);
    m.goals = goalsFromSummary(summary, m);
    matches.push(m);
    console.error(`  ${m.home} ${m.homeScore}-${m.awayScore} ${m.away} [${m.statusText}] goals=${m.goals.length}`);
  }
}

matches.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const overrides = JSON.parse(await readFile(new URL('../set-piece-overrides.json', import.meta.url), 'utf8'));
applyOverrides(matches, overrides);
const agg = aggregate(matches);
const out = {
  _meta: {
    generated: new Date().toISOString(),
    source: 'ESPN public API (site.api.espn.com, Opta-sourced commentary)',
    method: 'goals classified by fixed Opta commentary phrases; verbatim evidence retained per goal',
  },
  aggregate: agg,
  matches,
};
await writeFile(new URL('../set-piece-goals.json', import.meta.url), JSON.stringify(out, null, 1));
console.error(`== ${agg.total} goals | corners=${agg.counts.corner} fks=${agg.counts.free_kick} pens=${agg.counts.penalty} open=${agg.counts.open_play} | ${agg.pctExclPens.toFixed(1)}% set pieces excl pens`);
