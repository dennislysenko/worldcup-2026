#!/usr/bin/env python3
"""Compute set-piece goal baselines for WC 2018 + 2022 from StatsBomb open data.

Definition (kept consistent across tournaments, and mirrored by the 2026 ESPN
classifier in update-setpieces.mjs):
  - corner     : goal scored in a possession that started From Corner
  - free_kick  : From Free Kick (direct or delivered)
  - throw_in   : From Throw In
  - penalty    : shot type Penalty (in-game only; shootouts excluded)
  - open_play  : everything else (Regular Play, From Counter, From Goal Kick,
                 From Keeper, From Kick Off, Other)
Own goals are classified by the play_pattern of the Own Goal Against event.
Caveat noted in output: StatsBomb play_pattern persists for the whole
possession, so long phases after a set piece still count as set-piece-derived.

Output: set-piece-baselines.json (aggregates + per-goal records for audit).
"""
import json, sys, urllib.request, time

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
SEASONS = {"2018": ("43", "3"), "2022": ("43", "106")}

def fetch(url, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))

def classify(play_pattern, shot_type):
    if shot_type == "Penalty":
        return "penalty"
    return {
        "From Corner": "corner",
        "From Free Kick": "free_kick",
        "From Throw In": "throw_in",
    }.get(play_pattern, "open_play")

def ts_seconds(e):
    h, m, s = e["timestamp"].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)

DELIVERY_PASS = {"From Corner": "Corner", "From Free Kick": "Free Kick", "From Throw In": "Throw-in"}

def elapsed_since_delivery(goal_event, events_by_possession):
    """Seconds from the dead-ball delivery to the goal, within the same possession.
    Direct free-kick goals → 0. None if no delivery found (treat as whole-possession)."""
    pp = goal_event["play_pattern"]["name"]
    if pp not in DELIVERY_PASS:
        return None
    if goal_event["type"]["name"] == "Shot" and goal_event["shot"].get("type", {}).get("name") == "Free Kick":
        return 0.0
    want = DELIVERY_PASS[pp]
    for e in events_by_possession.get(goal_event["possession"], []):
        if e["type"]["name"] == "Pass" and e.get("pass", {}).get("type", {}).get("name") == want \
           and e.get("period") == goal_event.get("period"):
            return max(0.0, round(ts_seconds(goal_event) - ts_seconds(e), 1))
    return None

def main():
    out = {"_meta": {
        "source": "StatsBomb open data (github.com/statsbomb/open-data)",
        "definition": "headline set piece = goal from a possession starting From Corner / From Free Kick (StatsBomb play_pattern) scored within 15s of the dead-ball delivery; direct free-kick goals = 0s; penalties counted separately; throw-ins tallied but excluded from the headline (Opta commentary never attributes them, so 2026 can't count them either); shootout kicks excluded; own goals classified by the play_pattern of the conceding event",
        "caveat": "windows direct_10s / direct_15s / whole_possession are all included so the definitional sensitivity is visible; headline uses direct_15s to approximate Opta's 'following a corner / set piece' phase attribution used for 2026",
    }, "tournaments": {}}

    for year, (comp, season) in SEASONS.items():
        matches = fetch(f"{BASE}/matches/{comp}/{season}.json")
        goals = []
        for n, m in enumerate(sorted(matches, key=lambda x: x["match_date"]), 1):
            mid = m["match_id"]
            events = fetch(f"{BASE}/events/{mid}.json")
            label = f"{m['home_team']['home_team_name']} {m['home_score']}-{m['away_score']} {m['away_team']['away_team_name']}"
            by_poss = {}
            for e in events:
                by_poss.setdefault(e.get("possession"), []).append(e)
            for e in events:
                if e.get("period") == 5:  # penalty shootout
                    continue
                t = e["type"]["name"]
                is_goal = t == "Shot" and e["shot"]["outcome"]["name"] == "Goal"
                is_og = t == "Own Goal Against"
                if not (is_goal or is_og):
                    continue
                shot_type = e["shot"]["type"]["name"] if is_goal else None
                goals.append({
                    "match": label, "date": m["match_date"],
                    "minute": e["minute"] + 1,
                    "team": e["team"]["name"],
                    "scorer": (e.get("player") or {}).get("name", "?"),
                    "own_goal": is_og,
                    "play_pattern": e["play_pattern"]["name"],
                    "category": classify(e["play_pattern"]["name"], shot_type),
                    "elapsed_s": elapsed_since_delivery(e, by_poss),
                })
            print(f"  {year} {n}/64 {label} (goals so far: {len(goals)})", file=sys.stderr)

        def tally(window):
            """window: max elapsed_s from delivery to goal, or None = whole possession."""
            counts = {"corner": 0, "free_kick": 0, "throw_in": 0, "penalty": 0, "open_play": 0}
            for g in goals:
                cat = g["category"]
                if cat in ("corner", "free_kick", "throw_in") and window is not None:
                    el = g["elapsed_s"]
                    if el is None or el > window:
                        cat = "open_play"
                counts[cat] += 1
            total = len(goals)
            sp = counts["corner"] + counts["free_kick"]  # headline excludes throw-ins
            pen = counts["penalty"]
            return {
                "counts": counts,
                "set_piece_excl_pens": sp,
                "pct_excl_pens": round(100 * sp / total, 1),
                "pct_incl_pens": round(100 * (sp + pen) / total, 1),
            }

        out["tournaments"][year] = {
            "total_goals": len(goals),
            "windows": {"direct_15s": tally(15), "direct_10s": tally(10), "whole_possession": tally(None)},
            "goals": goals,
        }
        w = out["tournaments"][year]["windows"]
        print(f"== {year}: {len(goals)} goals | 15s: {w['direct_15s']} | possession: {w['whole_possession']}", file=sys.stderr)

    with open("set-piece-baselines.json", "w") as f:
        json.dump(out, f, indent=1)
    print("wrote set-piece-baselines.json", file=sys.stderr)

if __name__ == "__main__":
    main()
