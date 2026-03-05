// Driver/team data — indices MUST match generate-selections.py
// Used client-side for display in results + rules calculator

export const DRIVERS = [
  { name: "Leclerc",    fullName: "Charles Leclerc",    team: "Ferrari",       cost: 11 },
  { name: "Russell",    fullName: "George Russell",     team: "Mercedes",      cost: 12 },
  { name: "Piastri",    fullName: "Oscar Piastri",      team: "McLaren",       cost: 16 },
  { name: "Antonelli",  fullName: "Kimi Antonelli",     team: "Mercedes",      cost: 10 },
  { name: "Verstappen", fullName: "Max Verstappen",     team: "Red Bull",      cost: 16 },
  { name: "Norris",     fullName: "Lando Norris",       team: "McLaren",       cost: 16 },
  { name: "Hamilton",   fullName: "Lewis Hamilton",     team: "Ferrari",       cost:  9 },
  { name: "Gasly",      fullName: "Pierre Gasly",       team: "Alpine",        cost:  5 },
  { name: "Lindblad",   fullName: "Arvid Lindblad",     team: "Racing Bulls",  cost:  5 },
  { name: "Colapinto",  fullName: "Franco Colapinto",   team: "Alpine",        cost:  5 },
  { name: "Ocon",       fullName: "Esteban Ocon",       team: "Haas",          cost:  6 },
  { name: "Bearman",    fullName: "Oliver Bearman",     team: "Haas",          cost:  6 },
  { name: "Hadjar",     fullName: "Isack Hadjar",       team: "Racing Bulls",  cost: 10 },
  { name: "Lawson",     fullName: "Liam Lawson",        team: "Red Bull",      cost:  6 },
  { name: "Stroll",     fullName: "Lance Stroll",       team: "Aston Martin",  cost:  5 },
  { name: "Hulkenberg", fullName: "Nico Hulkenberg",    team: "Audi",          cost:  6 },
  { name: "Bortoleto",  fullName: "Gabriel Bortoleto",  team: "Audi",          cost:  6 },
  { name: "Bottas",     fullName: "Valtteri Bottas",    team: "Cadillac",      cost:  6 },
  { name: "Sainz",      fullName: "Carlos Sainz",       team: "Williams",      cost:  7 },
  { name: "Albon",      fullName: "Alex Albon",         team: "Williams",      cost:  6 },
  { name: "Perez",      fullName: "Sergio Perez",       team: "Cadillac",      cost:  6 },
  { name: "Alonso",     fullName: "Fernando Alonso",    team: "Aston Martin",  cost:  7 },
];

export const TEAMS = [
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

// F1 team colours for UI accents
export const TEAM_COLORS = {
  "Ferrari":       "#e8002d",
  "Mercedes":      "#27f4d2",
  "McLaren":       "#ff8000",
  "Red Bull":      "#3671c6",
  "Alpine":        "#ff87bc",
  "Haas":          "#b6babd",
  "Racing Bulls":  "#6692ff",
  "Audi":          "#00e701",
  "Cadillac":      "#1d1d1b",
  "Williams":      "#64c4ff",
  "Aston Martin":  "#229971",
};

export const PREDICTIONS = {
  homeCircuit: "Britain",
  driverChampion: "George Russell",
  constructorChampion: "Mercedes",
  totalClassified: 440,
  bestPosColapinto: "9th",
};

export const DEFAULTS = {
  managerName: "Rahul",
  teamName: "Ask MOM Before Overtaking",
  emailTo: "mblewis@ntlworld.com",
  emailSubject: "Martin's FF1 2026 - Entry Submission",
};

// ── Driver ranks (from Martin's rules — for calculator display) ──
export const DRIVER_RANKS = [
  "Top Ten",    // 0  Leclerc
  "Contender",  // 1  Russell
  "Contender",  // 2  Piastri
  "Top Ten",    // 3  Antonelli
  "Contender",  // 4  Verstappen
  "Champion",   // 5  Norris
  "Top Ten",    // 6  Hamilton
  "No Hoper",   // 7  Gasly
  "No Hoper",   // 8  Lindblad
  "No Hoper",   // 9  Colapinto
  "Outsider",   // 10 Ocon
  "Outsider",   // 11 Bearman
  "Top Ten",    // 12 Hadjar
  "Outsider",   // 13 Lawson
  "No Hoper",   // 14 Stroll
  "Mid Runner", // 15 Hulkenberg
  "Mid Runner", // 16 Bortoleto
  "Outsider",   // 17 Bottas
  "Top Ten",    // 18 Sainz
  "Mid Runner", // 19 Albon
  "Mid Runner", // 20 Perez
  "Mid Runner", // 21 Alonso
];

// ── Team logo file slugs (maps team name → /images/teams/{slug}.png) ──
export const TEAM_LOGO_SLUGS = {
  "Mercedes":    "mercedes",
  "Ferrari":     "ferrari",
  "McLaren":     "mclaren",
  "Red Bull":    "redbull",
  "Alpine":      "alpine",
  "Haas":        "haas",
  "Racing Bulls":"racing_bulls",
  "Audi":        "audi",
  "Cadillac":    "cadillac",
  "Williams":    "williams",
  "Aston Martin":"aston_martin",
};

// ── Team Name Generator — 50K+ unique F1 meme names ──
const _ADJ = [
  "Turbo","Nitro","Apex","DRS","Podium","Grid","Backmarker","Privateer",
  "Cursed","Blessed","Chaotic","Sneaky","Legendary","Controversial","Mysterious",
  "Strategic","Aggressive","Unhinged","Fearless","Reckless","Relentless",
  "Maximum-Attack","Full-Send","Zero-Regrets","Flexi-Wing","Budget-Cap",
  "Ground-Effect","VSC-Deployed","Track-Limit","Penalty-Point","Parc-Ferme",
  "Technically","Allegedly","Dangerously","Suspiciously","Heroically",
  "Absolutely","Definitely","Obviously","Calculated","Martin-Approved",
  "Spreadsheet","Optimised","Statistical",
];
const _NOUN = [
  "Racing","Legends","Warriors","Bandits","Vipers","Wolves","Hawks","Rockets",
  "Champions","Pretenders","Hopefuls","Dreamers","Strategists","Engineers",
  "Pit-Crew","Armchair-Experts","Hotshots","Underdogs","Wildcards",
  "Investments","Spreadsheets","Gut-Feelings","Slicks","Intermediates",
  "Barriers","Chicanes","Simracers","Pundits","Analysts","Speculators",
  "Gambles","Portfolios","Pit-Wall","Outsiders","Theorists","Fanatics",
];
const _DRIVER_NAMES = [
  "Leclerc","Russell","Piastri","Antonelli","Verstappen","Norris","Hamilton",
  "Gasly","Lindblad","Colapinto","Ocon","Bearman","Hadjar","Lawson","Stroll",
  "Hulkenberg","Bortoleto","Bottas","Sainz","Albon","Perez","Alonso",
];
const _TERM = [
  "DRS-Zone","Pit-Lane","Chequered-Flag","Pole-Position","Fastest-Lap",
  "Tyre-Strategy","Dirty-Air","Clean-Air","Slipstream","Graining","Blistering",
  "Cliff","Degradation","Downforce","Oversteer","Understeer","Drive-Through",
  "Stop-Go","Scrutineering","Virtual-SC","Safety-Car-Delta","Formation-Lap",
  "Tyre-Stack","Marbles","Ballast","Crosswind","Track-Evo","Budget-Cap",
  "Ground-Effect","Parc-Ferme",
];
const _CITY = [
  "Monza","Monaco","Silverstone","Suzuka","Spa","Interlagos","Melbourne",
  "Baku","Singapore","Bahrain","Jeddah","Miami","Las-Vegas","Lusail",
  "Zandvoort","Barcelona","Budapest","Imola","Mexico-City","Austin",
  "Sao-Paulo","Abu-Dhabi","Shanghai","Montreal","Spielberg",
];
const _MEME = [
  "Martin's Spreadsheet FC","Colapinto's Wildcard","Hamilton's Red Era FC",
  "Team VSC Heroes","The Investment Committee","Bonus Points Brigade",
  "Blue Flag Warriors","Pit Wall Panic FC","Tyre Strategy Department",
  "Entry Fee Warriors","Ground Effect Gang","Active Suspension FC",
  "Maximum Attack Racing","Full Send Motorsport","The Stewards Decision",
  "Zero Regrets Racing","Purely Statistical FC","The Dirty Air Boys",
  "Armchair Strategists FC","Budget Cap Busters","No Hoper Heroes FC",
  "Penalty Point FC","The Grid Walk FC","Gravel Trap Racing",
];

function _r(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 12 templates → 51,000+ unique combinations
const _TEMPLATES = [
  () => `${_r(_ADJ)} ${_r(_NOUN)}`,
  () => `Team ${_r(_ADJ)} ${_r(_NOUN)}`,
  () => `FC ${_r(_ADJ)} ${_r(_NOUN)}`,
  () => `${_r(_DRIVER_NAMES)}'s ${_r(_NOUN)}`,
  () => `${_r(_ADJ)} ${_r(_TERM)}`,
  () => `${_r(_CITY)} ${_r(_NOUN)}`,
  () => `${_r(_ADJ)} ${_r(_DRIVER_NAMES)}s`,
  () => `The ${_r(_ADJ)} ${_r(_NOUN)}s`,
  () => `${_r(_TERM)} ${_r(_NOUN)}`,
  () => `${_r(_DRIVER_NAMES)} and the ${_r(_NOUN)}s`,
  () => `${_r(_ADJ)} ${_r(_CITY)} ${_r(_NOUN)}`,
  () => _r(_MEME),
];

export function generateTeamName() {
  return _TEMPLATES[Math.floor(Math.random() * _TEMPLATES.length)]();
}
