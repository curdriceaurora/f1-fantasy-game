# Martin's F1 Fantasy League 2026

Welcome to the official prediction and entry builder for Martin's F1 Fantasy League!

This is a fun, interactive web app designed to let our league members craft their fantasy entries, manage their £50m budget, and submit their predictions for the 2026 season.

## Features
- **Interactive Team Builder**: Pick 3 drivers and 3 teams while staying under the £50m cap.
- **Season Predictions**: Lock in your picks for Home Circuit, Driver Champion, Constructor Champion, Total Classified, and Colapinto's Best Position.
- **Cost Calculator**: Use the dedicated calculator page to play around with different grid combinations.
- **One-Click Submission**: Automatically format your entire entry into an email perfectly ready to send to Martin!
- **Season Dashboard**: Track every team’s locked selections, race-by-race points, and running standings through the season.
- **Monday Scoring Pipeline**: Import the roster workbook once, then score each race after official classifications and steward decisions are settled.

## How to Run Locally

If you're tinkering with the code or want to run it on your own machine:

1. Ensure you have Node.js installed.
2. Clone or download this repository.
3. Open a terminal in the project folder and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the provided `localhost` URL in your web browser (usually `http://localhost:3456`).

## Season Dashboard Workflow

### 1. Import the league roster

This creates the canonical season entry file from the starting-roster workbook:

```bash
npm run sync:entries -- "/absolute/path/to/Martins FF1 2026 Starting Roster with Prize values.xlsx"
```

Or set the path once for your shell session:

```bash
export ROSTER_XLSX_PATH="/absolute/path/to/Martins FF1 2026 Starting Roster with Prize values.xlsx"
npm run sync:entries
```

The script writes:

- `season/config/entries.json` — canonical league entries
- `season/config/catalog.json` — driver and constructor display metadata
- `season/scored/standings.json` — initial standings scaffold

### 2. Review FIA fine coverage before Monday scoring

`season/config/fine-documents.json` is now an explicit review ledger, not just a loose URL list. That avoids the failure mode where a race publishes as “final” even though nobody checked whether fines existed.

Example:

```json
{
  "australia": {
    "reviewed": true,
    "documents": [
      "https://www.fia.com/sites/default/files/decision-document/example-fine-decision.pdf"
    ],
    "notes": "Reviewed after steward decisions settled.",
    "reviewedAt": "2026-03-09T12:00:00Z"
  }
}
```

Key gotcha:

- `reviewed: true` with an empty `documents` array means “explicitly checked, no applicable fines”.
- Omitting a race entirely means “not reviewed yet”, and `npm run score:race` will fail closed.
- Only non-suspended monetary fine amounts are converted into fantasy points. Suspended fines are ignored.

### 3. Score a race on Monday afternoon

```bash
npm run score:race -- --race australia
```

This command:

- fetches finalized sporting results from OpenF1
- fetches and parses any reviewed FIA fine documents
- stores raw inputs under `season/raw/<raceId>/`
- writes the normalized race result to `season/normalized/<raceId>.json`
- regenerates per-race outputs, per-team breakdowns, and standings under `season/scored/`

### 4. Browse the dashboard

- `http://localhost:3456/dashboard.html` — standings and team list
- `http://localhost:3456/team.html?team=<teamId>` — per-team season breakdown

## Testing

The scoring system now has an offline historical corpus under `test/fixtures/historical-seasons/`. It remaps the 2023, 2024, and 2025 F1 seasons onto the current fantasy catalog so scoring regressions can be exercised without touching live season data.

```bash
npm run test
```

To refresh the fixture corpus from the historical source:

```bash
npm run test:generate-corpus
```

## Rules Overview
- You have a strict **£50m budget**.
- You must pick exactly **3 drivers** and **3 teams**.
- Any unspent budget adds to your "Investment" holding for bonus points. 

Enjoy the 2026 season!
