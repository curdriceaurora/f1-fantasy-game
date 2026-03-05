#!/usr/bin/env python3
"""
Generate 100K ranked F1 Fantasy selections.

Enumerates all valid 3-driver + 3-team combinations within £50m budget,
ranks them by estimated season points, and outputs the top 100K as JSON.
"""

import json
import math
from itertools import combinations

# ── Driver data: (name, fullName, team, cost_m, est_season_pts) ──
# Index order MUST match constants.js on the client side
DRIVERS = [
    ("Leclerc",    "Charles Leclerc",    "Ferrari",       11, 411),
    ("Russell",    "George Russell",     "Mercedes",      12, 384),
    ("Piastri",    "Oscar Piastri",      "McLaren",       16, 297),
    ("Antonelli",  "Kimi Antonelli",     "Mercedes",      10, 287),
    ("Verstappen", "Max Verstappen",     "Red Bull",      16, 270),
    ("Norris",     "Lando Norris",       "McLaren",       16, 252),
    ("Hamilton",   "Lewis Hamilton",     "Ferrari",        9, 224),
    ("Gasly",      "Pierre Gasly",       "Alpine",         5, 144),
    ("Lindblad",   "Arvid Lindblad",     "Racing Bulls",   5, 144),
    ("Colapinto",  "Franco Colapinto",   "Alpine",         5, 144),
    ("Ocon",       "Esteban Ocon",       "Haas",           6, 120),
    ("Bearman",    "Oliver Bearman",     "Haas",           6,  84),
    ("Hadjar",     "Isack Hadjar",       "Racing Bulls",  10,  80),
    ("Lawson",     "Liam Lawson",        "Red Bull",       6,  48),
    ("Stroll",     "Lance Stroll",       "Aston Martin",   5,   0),
    ("Hulkenberg", "Nico Hulkenberg",    "Audi",           6,   0),
    ("Bortoleto",  "Gabriel Bortoleto",  "Audi",           6,   0),
    ("Bottas",     "Valtteri Bottas",    "Cadillac",       6,   0),
    ("Sainz",      "Carlos Sainz",       "Williams",       7, -48),
    ("Albon",      "Alex Albon",         "Williams",       6, -48),
    ("Perez",      "Sergio Perez",       "Cadillac",       6, -48),
    ("Alonso",     "Fernando Alonso",    "Aston Martin",   7, -96),
]

# ── Team data: (name, cost_m, est_season_pts) ──
TEAMS = [
    ("Mercedes",     13, 360),
    ("Ferrari",      10, 336),
    ("McLaren",      15, 288),
    ("Red Bull",     13, 216),
    ("Alpine",        5, 144),
    ("Haas",          6, 120),
    ("Racing Bulls",  6,  96),
    ("Audi",          5,   0),
    ("Cadillac",      5, -24),
    ("Williams",      8, -48),
    ("Aston Martin",  6, -48),
]

BUDGET = 50
NUM_RACES = 24
TOP_N = 100_000


def main():
    print(f"Drivers: {len(DRIVERS)}, Teams: {len(TEAMS)}")
    print(f"Driver combos: C({len(DRIVERS)},3) = {math.comb(len(DRIVERS), 3)}")
    print(f"Team combos: C({len(TEAMS)},3) = {math.comb(len(TEAMS), 3)}")

    all_combos = []
    checked = 0
    valid = 0

    # Pre-compute driver combo data
    driver_combos = []
    for d_indices in combinations(range(len(DRIVERS)), 3):
        d_cost = sum(DRIVERS[i][3] for i in d_indices)
        d_pts = sum(DRIVERS[i][4] for i in d_indices)
        driver_combos.append((d_indices, d_cost, d_pts))

    # Pre-compute team combo data
    team_combos = []
    for t_indices in combinations(range(len(TEAMS)), 3):
        t_cost = sum(TEAMS[i][1] for i in t_indices)
        t_pts = sum(TEAMS[i][2] for i in t_indices)
        team_combos.append((t_indices, t_cost, t_pts))

    print(f"Enumerating {len(driver_combos)} x {len(team_combos)} = {len(driver_combos) * len(team_combos)} combinations...")

    for d_indices, d_cost, d_pts in driver_combos:
        for t_indices, t_cost, t_pts in team_combos:
            checked += 1
            total_cost = d_cost + t_cost
            if total_cost <= BUDGET:
                valid += 1
                unspent = BUDGET - total_cost
                investment_bonus = (unspent // 2) * NUM_RACES
                est_points = d_pts + t_pts + investment_bonus
                all_combos.append((est_points, total_cost, list(d_indices), list(t_indices)))

    print(f"Checked: {checked}, Valid (within budget): {valid}")

    # Sort: highest points first, then lowest cost as tiebreaker
    all_combos.sort(key=lambda x: (-x[0], x[1]))

    if len(all_combos) < TOP_N:
        print(f"WARNING: Only {len(all_combos)} valid combos, less than {TOP_N}")
        top = all_combos
    else:
        top = all_combos[:TOP_N]

    print(f"Top entry: pts={top[0][0]}, cost={top[0][1]}, drivers={top[0][2]}, teams={top[0][3]}")
    print(f"Last entry: pts={top[-1][0]}, cost={top[-1][1]}, drivers={top[-1][2]}, teams={top[-1][3]}")

    # Build compact JSON output
    entries = []
    for pts, cost, d_idx, t_idx in top:
        entries.append({"p": pts, "d": d_idx, "t": t_idx})

    output = {
        "meta": {
            "count": len(entries),
            "maxPts": top[0][0],
            "minPts": top[-1][0],
        },
        "entries": entries,
    }

    out_path = "data/selections.json"
    with open(out_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    import os
    size_bytes = os.path.getsize(out_path)
    print(f"\nWrote {len(entries)} entries to {out_path}")
    print(f"File size: {size_bytes:,} bytes ({size_bytes / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
