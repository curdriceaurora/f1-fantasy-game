import { readFileSync } from 'fs';
import { join } from 'path';

// ── Load data once at module level (cached across warm invocations) ──
const dataPath = join(process.cwd(), 'data', 'selections.json');
const DATA = JSON.parse(readFileSync(dataPath, 'utf-8'));

const PREDICTION_BONUS = 24; // Constant added to all entries

// Driver/team lookup tables — indices match the Python generator
const DRIVERS = [
  { name: "Charles Leclerc",    team: "Ferrari",       cost: 11 },
  { name: "George Russell",     team: "Mercedes",      cost: 12 },
  { name: "Oscar Piastri",      team: "McLaren",       cost: 16 },
  { name: "Kimi Antonelli",     team: "Mercedes",      cost: 10 },
  { name: "Max Verstappen",     team: "Red Bull",      cost: 16 },
  { name: "Lando Norris",       team: "McLaren",       cost: 16 },
  { name: "Lewis Hamilton",     team: "Ferrari",       cost:  9 },
  { name: "Pierre Gasly",       team: "Alpine",        cost:  5 },
  { name: "Arvid Lindblad",     team: "Racing Bulls",  cost:  5 },
  { name: "Franco Colapinto",   team: "Alpine",        cost:  5 },
  { name: "Esteban Ocon",       team: "Haas",          cost:  6 },
  { name: "Oliver Bearman",     team: "Haas",          cost:  6 },
  { name: "Isack Hadjar",       team: "Racing Bulls",  cost: 10 },
  { name: "Liam Lawson",        team: "Red Bull",      cost:  6 },
  { name: "Lance Stroll",       team: "Aston Martin",  cost:  5 },
  { name: "Nico Hulkenberg",    team: "Audi",          cost:  6 },
  { name: "Gabriel Bortoleto",  team: "Audi",          cost:  6 },
  { name: "Valtteri Bottas",    team: "Cadillac",      cost:  6 },
  { name: "Carlos Sainz",       team: "Williams",      cost:  7 },
  { name: "Alex Albon",         team: "Williams",      cost:  6 },
  { name: "Sergio Perez",       team: "Cadillac",      cost:  6 },
  { name: "Fernando Alonso",    team: "Aston Martin",  cost:  7 },
];

const TEAMS = [
  { name: "Mercedes",     cost: 13 },
  { name: "Ferrari",      cost: 10 },
  { name: "McLaren",      cost: 15 },
  { name: "Red Bull",     cost: 13 },
  { name: "Alpine",       cost:  5 },
  { name: "Haas",         cost:  6 },
  { name: "Racing Bulls", cost:  6 },
  { name: "Audi",         cost:  5 },
  { name: "Cadillac",     cost:  5 },
  { name: "Williams",     cost:  8 },
  { name: "Aston Martin", cost:  6 },
];

const PREDICTIONS = {
  homeCircuit: "Britain",
  driverChampion: "George Russell",
  constructorChampion: "Mercedes",
  totalClassified: 440,
  bestPosColapinto: "9th",
};

// ── Helper: pick entry by accuracy or random ──
function pickEntry(accuracy, mode) {
  const entries = DATA.entries;
  const count = entries.length;

  if (mode === 'random') {
    const idx = Math.floor(Math.random() * count);
    return { entry: entries[idx], rank: idx + 1 };
  }

  // Map accuracy (0–1) to target points
  const maxPts = DATA.meta.maxPts;
  const minPts = DATA.meta.minPts;
  const targetPts = minPts + accuracy * (maxPts - minPts);

  // Find entries within a band of the target points
  // Start with ±5 points, expand until we have at least 5 candidates
  let bandWidth = 5;
  let candidates = [];

  while (candidates.length < 5 && bandWidth <= 200) {
    candidates = [];
    for (let i = 0; i < count; i++) {
      if (Math.abs(entries[i].p - targetPts) <= bandWidth) {
        candidates.push({ entry: entries[i], rank: i + 1 });
      }
    }
    if (candidates.length < 5) bandWidth += 5;
  }

  // If still empty (shouldn't happen), fall back to closest
  if (candidates.length === 0) {
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < count; i++) {
      const diff = Math.abs(entries[i].p - targetPts);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return { entry: entries[bestIdx], rank: bestIdx + 1 };
  }

  // Pick a random candidate from the band
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick;
}

// ── Build email body ──
function buildEmail(drivers, teams, totalCost, investmentValue, managerName, teamName) {
  const p = PREDICTIONS;
  return [
    `To: mblewis@ntlworld.com`,
    `Subject: Martin's FF1 2026 - Entry Submission`,
    ``,
    `Hi Martin,`,
    ``,
    `Please find my entry for Martin's FF1 2026 below. Hoping to sneak in before the deadline!`,
    ``,
    `Team Manager: ${managerName}`,
    `Team Name: ${teamName}`,
    ``,
    `Driver 1: ${drivers[0].name} (${drivers[0].team}) - \u00a3${drivers[0].cost}m`,
    `Driver 2: ${drivers[1].name} (${drivers[1].team}) - \u00a3${drivers[1].cost}m`,
    `Driver 3: ${drivers[2].name} (${drivers[2].team}) - \u00a3${drivers[2].cost}m`,
    ``,
    `Team 1: ${teams[0].name} - \u00a3${teams[0].cost}m`,
    `Team 2: ${teams[1].name} - \u00a3${teams[1].cost}m`,
    `Team 3: ${teams[2].name} - \u00a3${teams[2].cost}m`,
    ``,
    `Total Team Cost: \u00a3${totalCost}m`,
    `Investment Value: \u00a3${investmentValue}m`,
    ``,
    `Home Circuit: ${p.homeCircuit}`,
    `Driver Champion: ${p.driverChampion}`,
    `Constructor Champion: ${p.constructorChampion}`,
    `Total Classified: ${p.totalClassified}`,
    `Best Pos. (Colapinto): ${p.bestPosColapinto}`,
    ``,
    `Happy to pay the \u00a315 entry fee electronically - please send me the details.`,
    ``,
    `All the best,`,
    `${managerName}`,
  ].join('\n');
}

// ── API handler ──
export default function handler(req, res) {
  try {
    const { accuracy, mode, name, team } = req.query;

    const managerName = name || 'Rahul';
    const teamName = team || 'Ask MOM Before Overtaking';

    let acc = parseFloat(accuracy);
    let selectedMode = mode;

    if (selectedMode !== 'random' && (isNaN(acc) || acc < 0 || acc > 1)) {
      return res.status(400).json({
        error: 'Provide accuracy (0-1) or mode=random',
      });
    }

    if (selectedMode !== 'random') {
      selectedMode = 'accuracy';
    }

    const { entry, rank } = pickEntry(
      selectedMode === 'random' ? 0 : acc,
      selectedMode
    );

    // Reconstruct full selection
    const drivers = entry.d.map(i => DRIVERS[i]);
    const teams = entry.t.map(i => TEAMS[i]);
    const totalCost = drivers.reduce((s, d) => s + d.cost, 0)
                    + teams.reduce((s, t) => s + t.cost, 0);
    const investmentValue = 50 - totalCost;
    const estPoints = entry.p + PREDICTION_BONUS;

    const emailBody = buildEmail(drivers, teams, totalCost, investmentValue, managerName, teamName);

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json({
      rank,
      totalEntries: DATA.meta.count,
      estPoints,
      totalCost,
      investmentValue,
      drivers: drivers.map(d => ({ name: d.name, team: d.team, cost: d.cost })),
      teams: teams.map(t => ({ name: t.name, cost: t.cost })),
      predictions: PREDICTIONS,
      emailBody,
    });
  } catch (err) {
    console.error('Selection API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
