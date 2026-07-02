/* Shared score-matching logic for the live calendar.
   Used by scripts/update-scores.mjs (Node bake). A compact copy of the same
   matching lives inline in app.js for the browser live-poll — keep them in sync.

   Join key: the UTC kickoff instant (data.js `utc` === ESPN event.date to the
   minute). Instant alone is unique except for the simultaneous final-round
   group games, so team-name token overlap disambiguates those. */

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

// data.js name -> canonical token bag tweaks for the few ESPN divergences
const ALIASES = {
  'ivory coast': 'cote ivoire ivory coast',
  'cote d’ivoire': 'cote ivoire ivory coast',
};

export function tokens(name) {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const aliased = ALIASES[n] || n;
  return new Set(aliased.split(/[^a-z]+/).filter((t) => t.length >= 4));
}

export function overlap(a, b) {
  const ta = tokens(a), tb = tokens(b);
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

export function eventToScore(e) {
  const c = e.competitions?.[0] || {};
  const comp = c.competitors || [];
  const h = comp.find((x) => x.homeAway === 'home') || {};
  const a = comp.find((x) => x.homeAway === 'away') || {};
  const st = e.status || c.status || {};
  return {
    espnId: e.id,
    utc: e.date,
    home: h.team?.displayName || '',
    away: a.team?.displayName || '',
    homeScore: h.score != null && h.score !== '' ? Number(h.score) : null,
    awayScore: a.score != null && a.score !== '' ? Number(a.score) : null,
    homePens: h.shootoutScore != null && h.shootoutScore !== '' ? Number(h.shootoutScore) : null,
    awayPens: a.shootoutScore != null && a.shootoutScore !== '' ? Number(a.shootoutScore) : null,
    winner: h.winner ? 'home' : a.winner ? 'away' : null, // knockout shootout/ET winner
    state: st.type?.state || 'pre', // pre | in | post
    statusText: st.type?.shortDetail || st.type?.description || '',
    minute: st.displayClock || '',
    period: st.period || 0,
  };
}

/* Map ESPN scoreboard events to { matchNumber: scoreObj } against data.js matches. */
export function indexScores(dataMatches, events, { includePre = false } = {}) {
  const out = {};
  const byInstant = new Map();
  for (const m of dataMatches) {
    const t = new Date(m.utc).getTime();
    if (!byInstant.has(t)) byInstant.set(t, []);
    byInstant.get(t).push(m);
  }
  const used = new Set(), pending = [];
  // Pass 1: exact kickoff instant + best name overlap.
  for (const e of events) {
    const sc = eventToScore(e);
    if (!includePre && sc.state === 'pre') continue;
    const cands = (byInstant.get(new Date(e.date).getTime()) || []).filter((m) => !used.has(m.matchNumber));
    if (!cands.length) { pending.push({ t: new Date(e.date).getTime(), sc }); continue; }
    let best = cands[0], bestScore = -1;
    for (const m of cands) {
      const s = overlap(m.home, sc.home) + overlap(m.away, sc.away);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    out[best.matchNumber] = sc; used.add(best.matchNumber);
  }
  // Pass 2: kickoff-time drift — nearest unused match within 6h (name overlap preferred).
  for (const { t, sc } of pending) {
    let best = null, bestOv = -1, bestDt = Infinity;
    for (const m of dataMatches) {
      if (used.has(m.matchNumber)) continue;
      const dt = Math.abs(new Date(m.utc).getTime() - t);
      if (dt > 6 * 3600e3) continue;
      const ov = overlap(m.home, sc.home) + overlap(m.away, sc.away);
      if (ov > bestOv || (ov === bestOv && dt < bestDt)) { bestOv = ov; bestDt = dt; best = m; }
    }
    if (best) { out[best.matchNumber] = sc; used.add(best.matchNumber); }
  }
  return out;
}

export function tournamentDatesThrough(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  const today = fmt.format(now);
  const end = today < '2026-07-19' ? today : '2026-07-19';
  const dates = [];
  for (let d = new Date(Date.UTC(2026, 5, 11)); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10);
    if (s > end) break;
    dates.push(s.replace(/-/g, ''));
  }
  return dates;
}
