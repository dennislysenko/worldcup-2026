/* Shared ESPN goal-classification logic for the set-piece tracker.
   Used by scripts/update-setpieces.mjs (Node) and set-piece-tracker.html (browser).

   Classification is regex over ESPN/Opta match commentary, which uses fixed
   phrasings ("following a corner", "following a set piece situation",
   "direct free kick", "converts the penalty"). Each goal keeps its verbatim
   commentary line as evidence, plus minute and the scoreline it produced. */

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

export const CATEGORIES = ['corner', 'free_kick', 'throw_in', 'penalty', 'open_play'];

/* Hand-tagged corrections (set-piece-overrides.json) for what Opta commentary
   can't see — mainly long throws. Each override carries a cited source+quote,
   which gets surfaced in the UI next to the verbatim ESPN line. */
export function applyOverrides(matches, overridesDoc) {
  const ov = overridesDoc?.overrides || {};
  for (const m of matches) {
    for (const g of m.goals || []) {
      const o = ov[g.espnPlayId];
      if (o) {
        g.category = o.category;
        g.override = { source: o.source, sourceName: o.sourceName, quote: o.quote };
      }
    }
  }
  return matches;
}

export function classifyGoal(typeText, text) {
  const t = (text || '').toLowerCase();
  const ty = (typeText || '').toLowerCase();
  if (ty.includes('penalty') || /converts the penalty|scores the penalty|penalty kick/.test(t)) return 'penalty';
  if (/following a corner|from a corner|corner kick/.test(t)) return 'corner';
  if (/direct free kick|from a free kick|following a set piece/.test(t)) return 'free_kick';
  return 'open_play';
}

/* "Goal! Canada 0, Bosnia and Herzegovina 1." → { score: "0–1", detail } */
export function parseScoreFromText(text, homeName, awayName) {
  const m = (text || '').match(/([A-Za-zÀ-ž'’. -]+?) (\d+), ([A-Za-zÀ-ž'’. -]+?) (\d+)\./);
  if (!m) return null;
  // ESPN lists the home side first in the running-score sentence.
  return `${m[2]}–${m[4]}`;
}

export function goalsFromSummary(summary, match) {
  const out = [];
  for (const ev of summary.keyEvents || []) {
    if (!ev.scoringPlay) continue;
    const period = ev.period?.number ?? 0;
    if (period >= 5) continue; // shootout kicks are not goals
    const typeText = ev.type?.text || '';
    const isOwnGoal = /own goal/i.test(typeText) || /own goal/i.test(ev.text || '');
    const scorer = ev.participants?.[0]?.athlete?.displayName
      || (ev.text || '').match(/(?:Goal!.*?\.\s*|Own Goal by )([A-Za-zÀ-ž'’. -]+?)[,(]/)?.[1]?.trim()
      || 'Unknown';
    out.push({
      espnPlayId: ev.id,
      minute: ev.clock?.displayValue || '?',
      team: ev.team?.displayName || '?',
      scorer,
      ownGoal: isOwnGoal,
      header: /header/i.test(typeText),
      category: classifyGoal(typeText, ev.text),
      scoreAfter: parseScoreFromText(ev.text, match.home, match.away),
      evidence: ev.text || '',
      wallclock: ev.wallclock || null,
    });
  }
  return out;
}

export function matchFromScoreboardEvent(e) {
  const comp = e.competitions?.[0] || {};
  const home = (comp.competitors || []).find((c) => c.homeAway === 'home') || {};
  const away = (comp.competitors || []).find((c) => c.homeAway === 'away') || {};
  return {
    espnId: e.id,
    name: e.name,
    kickoff: e.date,
    state: e.status?.type?.state || '?', // pre | in | post
    statusText: e.status?.type?.description || '',
    home: home.team?.displayName || '?',
    away: away.team?.displayName || '?',
    homeScore: home.score != null ? Number(home.score) : null,
    awayScore: away.score != null ? Number(away.score) : null,
  };
}

export function aggregate(matches) {
  const counts = { corner: 0, free_kick: 0, throw_in: 0, penalty: 0, open_play: 0 };
  let total = 0;
  for (const m of matches) {
    for (const g of m.goals || []) {
      counts[g.category] = (counts[g.category] || 0) + 1;
      total += 1;
    }
  }
  const sp = counts.corner + counts.free_kick + counts.throw_in;
  return {
    total,
    counts,
    setPieceExclPens: sp,
    pctExclPens: total ? (100 * sp) / total : 0,
    pctInclPens: total ? (100 * (sp + counts.penalty)) / total : 0,
  };
}

/* Tournament calendar dates (America/New_York) from June 11 to today, capped at July 19. */
export function tournamentDatesThrough(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  const today = fmt.format(now); // YYYY-MM-DD
  const end = today < '2026-07-19' ? today : '2026-07-19';
  const dates = [];
  for (let d = new Date(Date.UTC(2026, 5, 11)); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10);
    if (s > end) break;
    dates.push(s.replace(/-/g, ''));
  }
  return dates;
}
