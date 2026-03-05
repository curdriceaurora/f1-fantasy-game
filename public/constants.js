// Driver/team data — indices MUST match generate-selections.py
// Used client-side for display in slot machine reels and results

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
