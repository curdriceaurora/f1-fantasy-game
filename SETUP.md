# F1 Fantasy Team Selector — Setup & Deployment Guide

## Overview

A web app for Martin's FF1 2026 fantasy league that lets players "earn" their team selection through a **PocketTanks-style aiming game** — the closer you hit the target, the better your team rank.

The app serves 100,000 pre-ranked team combinations via a serverless API. Players get a ready-to-send email entry based on their result.

---

## Prerequisites

- **Node.js** 18+ (tested with v25.7.0)
- **Python** 3.8+ (for one-time data generation)
- **Git**
- **Vercel account** (free tier is fine) — [vercel.com/signup](https://vercel.com/signup)
- **GitHub account** (to connect repo to Vercel)

---

## Project Structure

```
f1-fantasy-game/
├── api/
│   └── selection.js         ← Vercel serverless function (API)
├── public/
│   ├── index.html           ← Single-page app
│   ├── styles.css           ← F1-themed styles
│   ├── game.js              ← Canvas tank aiming game
│   ├── ui.js                ← Screen flow, results, email display
│   └── constants.js         ← Driver/team data for client display
├── data/
│   └── selections.json      ← 100K ranked selections (3.6MB, server-only)
├── scripts/
│   └── generate-selections.py  ← One-time data generator
├── server.js                ← Local dev server (not deployed)
├── vercel.json              ← Vercel deployment config
├── package.json
└── .gitignore
```

---

## Step 1: Generate the Selection Data

The data file contains 100,000 ranked team combinations. Run this once:

```bash
cd f1-fantasy-game
python3 scripts/generate-selections.py
```

**Expected output:**
```
Drivers: 22, Teams: 11
Driver combos: C(22,3) = 1540
Team combos: C(11,3) = 165
Enumerating 1540 x 165 = 254100 combinations...
Checked: 254100, Valid (within budget): 138239
Top entry: pts=1539, cost=49, drivers=[0, 1, 7], teams=[1, 4, 5]
Last entry: pts=504, cost=50, ...
Wrote 100000 entries to data/selections.json
File size: 3,604,490 bytes (3520.0 KB)
```

This creates `data/selections.json` (~3.6MB). The file is included in the API function bundle but never served to browsers.

**Note:** The displayed points are 24 higher than the raw values because a constant "prediction bonus" (+24) is added by the API at response time.

---

## Step 2: Test Locally

```bash
node server.js
```

Opens at **http://localhost:3456**

Test the API directly:
```bash
# Best possible selection (accuracy = 1.0)
curl "http://localhost:3456/api/selection?accuracy=1.0"

# Custom name + team
curl "http://localhost:3456/api/selection?accuracy=0.8&name=Alice&team=Speed+Queens"
```

**Verify:**
- Welcome screen shows with name/team inputs and PLAY button
- Tank game: canvas renders terrain, F1 car, target; sliders and LAUNCH work
- Results: rank, points, drivers, teams, email body, Copy/Mail buttons
- Copy Email copies to clipboard; Open in Mail opens mailto: link

---

## Step 3: Deploy to Vercel

### Option A: Via Vercel CLI

```bash
# Install Vercel CLI (if not already)
npm i -g vercel

# Login
vercel login

# Deploy (from the f1-fantasy-game directory)
cd f1-fantasy-game
vercel

# Follow the prompts:
#   - Set up and deploy? Yes
#   - Which scope? (your account)
#   - Link to existing project? No
#   - Project name: f1-fantasy-game
#   - In which directory is your code? ./
#   - Override settings? No

# Deploy to production
vercel --prod
```

### Option B: Via GitHub + Vercel Dashboard

1. **Push to GitHub:**
   ```bash
   cd f1-fantasy-game
   git init
   git add -A
   git commit -m "F1 Fantasy Team Selector"
   git remote add origin https://github.com/YOUR_USERNAME/f1-fantasy-game.git
   git push -u origin main
   ```

2. **Connect to Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Vercel auto-detects the config from `vercel.json`
   - Click **Deploy**

3. **Verify deployment:**
   - Visit the provided `.vercel.app` URL
   - Test: `https://YOUR-APP.vercel.app/api/selection?accuracy=1.0`

---

## Step 4: Share the URL

Once deployed, share the Vercel URL with anyone who wants to play. They can:
1. Enter their own name and team name
2. Aim and fire — accuracy determines team quality
3. Get a rank + full email body
4. Copy or email it directly to Martin

---

## API Reference

### `GET /api/selection`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `accuracy` | float (0-1) | Yes | Shot accuracy. 1.0 = bullseye (rank 1), 0.0 = total miss |
| `name` | string | No | Player name (default: "Rahul") |
| `team` | string | No | Team name (default: "Ask MOM Before Overtaking") |

**Response:**
```json
{
  "rank": 42,
  "totalEntries": 100000,
  "estPoints": 1539,
  "totalCost": 49,
  "investmentValue": 1,
  "drivers": [
    { "name": "Charles Leclerc", "team": "Ferrari", "cost": 11 },
    { "name": "George Russell", "team": "Mercedes", "cost": 12 },
    { "name": "Pierre Gasly", "team": "Alpine", "cost": 5 }
  ],
  "teams": [
    { "name": "Ferrari", "cost": 10 },
    { "name": "Alpine", "cost": 5 },
    { "name": "Haas", "cost": 6 }
  ],
  "predictions": {
    "homeCircuit": "Britain",
    "driverChampion": "George Russell",
    "constructorChampion": "Mercedes",
    "totalClassified": 440,
    "bestPosColapinto": "9th"
  },
  "emailBody": "To: Email Martin\nSubject: ..."
}
```

---

## How the Scoring Model Works

1. **22 drivers** and **11 teams** each have estimated season points based on 2026 pre-season testing analysis
2. All valid 3-driver + 3-team combinations within the £50m budget are enumerated (138,239 total)
3. Each combination's score = sum(driver points) + sum(team points) + investment bonus
4. Investment bonus = floor((50 - total_cost) / 2) × 24 races
5. Top 100,000 are ranked by score (descending), then by cost (ascending) as tiebreaker
6. A constant prediction bonus of +24 is added at display time

**Key insight:** The league's qualifying scoring matrix rewards drivers whose "rank" is lower than their actual performance — so cheap "No-Hoper" drivers who qualify well are the most valuable picks.

---

## Customisation

### Change player defaults
Edit `public/constants.js` → `DEFAULTS` object:
```js
export const DEFAULTS = {
  managerName: "Your Name",
  teamName: "Your Team Name",
  emailTo: "Email Martin",
  emailSubject: "Martin's FF1 2026 - Entry Submission",
};
```

### Update driver/team data for a new season
1. Edit driver and team arrays in `scripts/generate-selections.py`
2. Mirror the same changes in `api/selection.js` and `public/constants.js`
3. Re-run `python3 scripts/generate-selections.py`
4. Commit and redeploy

### Adjust game physics
In `public/game.js`, tweak:
- `GRAVITY` (default 500) — higher = steeper arcs
- `MAX_VELOCITY` (default 1100) — higher = longer range at 100% power
- `windSpeed` range — set to 0 to disable wind

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| API returns 500 | Check that `data/selections.json` exists and `vercel.json` has `includeFiles: "data/**"` |
| Blank canvas | Ensure browser supports Canvas API (all modern browsers do) |
| Fonts not loading | Google Fonts requires internet access; app will fall back to system fonts |
| Data file too large | The 3.6MB JSON is within Vercel's 50MB function size limit |

---

## Cost

- **Vercel free tier**: 100K serverless function invocations/month, unlimited static bandwidth
- **Expected usage**: Well within free tier limits for a small friends' league
- **Total cost: $0/month**
