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
