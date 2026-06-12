# World Cup 2026 — Calendar & Match Planner

A single-page calendar for the 2026 FIFA World Cup (USA · Canada · Mexico, June 11 – July 19). Browse all 104 matches, follow the teams you care about, and spot the **banger matchups** by Elo rating.

**Live:** https://banger-watch.vercel.app

## Features

- **Full schedule** — all 104 matches from the Dec 5 2025 final draw (12 groups + the new 48-team knockout bracket), spot-checked against FIFA, Wikipedia and ESPN.
- **Calendar view** — month grid on desktop, a day-by-day agenda on mobile, with both teams' flags, kickoff times and venues.
- **Follow your teams** — pick from all 48 nations; selections persist in `localStorage`, get highlighted across the calendar, and roll up into a "when my teams play" list.
- **Banger highlighting** — matches where both sides rate highly (and aren't lopsided) by [World Football Elo](https://www.eloratings.net) get a 🔥.
- **Knockout-aware** — knockout fixtures show bracket slots (Winner Group A, etc.) until the groups resolve.

## Stack

Plain HTML/CSS/JS — no build step, no dependencies. Open `index.html` (via a static server, so the flag images load over `http`).

```
index.html    markup + meta
styles.css    light theme, responsive (grid ↔ agenda)
app.js        rendering + favorites + banger logic
data.js       teams + 104-match schedule
elo.js        Elo ratings
og.html       template used to render og.png
```

## Run locally

```bash
python3 -m http.server 8770
# open http://localhost:8770
```

## Data notes

Schedule reflects the official draw; group-stage fixtures are concrete, knockout matchups are bracket slots. Elo ratings are a mid-2026 snapshot.

## Set-piece tracker (`/set-piece-tracker`)

Live share of 2026 goals from corners & free kicks, compared to 2018/2022, with per-goal evidence (minute, scoreline, verbatim Opta/ESPN commentary). Arteta supervises.

- `set-piece-tracker.html` — the page; fetches ESPN's public API client-side (CORS is open) every minute during live matches.
- `setpiece-espn.mjs` — shared goal classifier (regex over Opta commentary phrases), used by the page and the updater.
- `set-piece-goals.json` — baked 2026 goals; refresh with `node scripts/update-setpieces.mjs` (run nightly-ish so first paint doesn't refetch the whole tournament).
- `set-piece-overrides.json` — hand-tagged corrections, mainly long throws (Opta commentary never attributes throw-ins). Every override must cite a published match report; the citation renders inline (✎).
- `set-piece-baselines.json` — 2018/2022 baselines computed from StatsBomb open data by `scripts/compute-baselines.py` (one-time; ~5 min, downloads 128 event files). Headline definition: goal ≤ 15 s after the corner/free-kick/throw-in delivery, penalties separate.
