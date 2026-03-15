import { DRIVERS, TEAMS, DRIVER_RANKS, TEAM_LOGO_SLUGS } from '../public/constants.js';

function stripDiacritics(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value) {
  return stripDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, '-');
}

function createAliasSet(values) {
  return new Set(values.filter(Boolean).map(normalizeKey));
}

function driverAliasVariants(driver) {
  const names = driver.fullName.split(' ');
  const first = names[0];
  const last = names[names.length - 1];
  const firstInitial = `${first[0]}. ${last}`;
  const acronym = last.slice(0, 3);

  return [
    driver.fullName,
    driver.name,
    `${first} ${last}`,
    firstInitial,
    firstInitial.replace('. ', '.'),
    `${first[0]} ${last}`,
    `${first} ${last}`.replace(' Jr', ''),
    `${firstInitial} Jr`,
    `${firstInitial} Jr.`,
    `${first} ${last} Jr`,
    `${first} ${last} Jr.`,
    acronym,
  ];
}

const DRIVER_MANUAL_ALIASES = {
  'charles leclerc': ['c leclerc', 'c leclerc', 'c. leclerc'],
  'george russell': ['g russell', 'g. russell'],
  'oscar piastri': ['o piastri', 'o. piastri'],
  'kimi antonelli': ['k antonelli', 'k. antonelli', 'a antonelli', 'a. antonelli', 'andrea kimi antonelli'],
  'max verstappen': ['m verstappen', 'm. verstappen'],
  'lando norris': ['l norris', 'l. norris'],
  'lewis hamilton': ['l hamilton', 'l. hamilton'],
  'pierre gasly': ['p gasly', 'p. gasly'],
  'arvid lindblad': ['a lindblad', 'a. lindblad'],
  'franco colapinto': ['f colapinto', 'f. colapinto'],
  'esteban ocon': ['e ocon', 'e. ocon'],
  'oliver bearman': ['o bearman', 'o. bearman'],
  'isack hadjar': ['i hadjar', 'i. hadjar'],
  'liam lawson': ['l lawson', 'l. lawson'],
  'lance stroll': ['l stroll', 'l. stroll'],
  'nico hulkenberg': ['n hulkenberg', 'n. hulkenberg', 'n hülkenberg', 'n. hülkenberg'],
  'gabriel bortoleto': ['g bortoleto', 'g. bortoleto'],
  'valtteri bottas': ['v bottas', 'v. bottas'],
  'carlos sainz': ['c sainz', 'c. sainz', 'c sainz jr', 'c. sainz jr', 'c sainz jr.', 'c. sainz jr.', 'carlos sainz jr', 'carlos sainz jr.'],
  'alex albon': ['a albon', 'a. albon', 'alexander albon'],
  'sergio perez': ['s perez', 's. perez', 'checo perez'],
  'fernando alonso': ['f alonso', 'f. alonso'],
};

const TEAM_MANUAL_ALIASES = {
  'red bull': ['rbpt', 'red bull racing'],
  'racing bulls': ['rb', 'visa cash app rb', 'racing bulls f1 team'],
  'audi': ['kick sauber', 'sauber'],
  'haas': ['haas f1 team', 'moneygram haas'],
  'aston martin': ['aston martin aramco'],
  'mercedes': ['mercedes-amg petronas'],
};

const CIRCUIT_ALIASES = {
  australia: 'australia',
  china: 'china',
  japan: 'japan',
  bahrain: 'bahrain',
  'saudi arabia': 'saudi-arabia',
  saudi: 'saudi-arabia',
  miami: 'miami',
  canada: 'canada',
  monaco: 'monaco',
  britain: 'great-britain',
  'great britain': 'great-britain',
  belgium: 'belgium',
  hungary: 'hungary',
  netherlands: 'netherlands',
  italy: 'italy',
  spain: 'spain',
  madrid: 'spain',
  'barcelona-catalunya': 'barcelona-catalunya',
  barcelona: 'barcelona-catalunya',
  austria: 'austria',
  azerbaijan: 'azerbaijan',
  singapore: 'singapore',
  'usa (austin)': 'united-states',
  usa: 'united-states',
  austin: 'united-states',
  'united states': 'united-states',
  mexico: 'mexico',
  brazil: 'brazil',
  'las vegas': 'las-vegas',
  qatar: 'qatar',
  'abu dhabi': 'abu-dhabi',
};

export const CANONICAL_DRIVERS = DRIVERS.map((driver, index) => {
  const manual = DRIVER_MANUAL_ALIASES[normalizeKey(driver.fullName)] || [];
  return {
    ...driver,
    id: slugify(driver.fullName),
    rank: DRIVER_RANKS[index],
    imageSlug: driver.name.toLowerCase(),
    aliases: createAliasSet([
      ...driverAliasVariants(driver),
      ...manual,
    ]),
  };
});

export const CANONICAL_TEAMS = TEAMS.map((team) => {
  const manual = TEAM_MANUAL_ALIASES[normalizeKey(team.name)] || [];
  return {
    ...team,
    id: slugify(team.name),
    imageSlug: TEAM_LOGO_SLUGS[team.name] || slugify(team.name),
    aliases: createAliasSet([
      team.name,
      ...manual,
    ]),
  };
});

const DRIVER_LOOKUP = new Map();
for (const driver of CANONICAL_DRIVERS) {
  for (const alias of driver.aliases) {
    DRIVER_LOOKUP.set(alias, driver);
  }
}

const TEAM_LOOKUP = new Map();
for (const team of CANONICAL_TEAMS) {
  for (const alias of team.aliases) {
    TEAM_LOOKUP.set(alias, team);
  }
}

export function normalizeText(value) {
  return normalizeKey(value);
}

export function driverById(driverId) {
  return CANONICAL_DRIVERS.find((driver) => driver.id === driverId) || null;
}

export function teamById(teamId) {
  return CANONICAL_TEAMS.find((team) => team.id === teamId) || null;
}

export function resolveDriver(value) {
  return DRIVER_LOOKUP.get(normalizeKey(value)) || null;
}

export function resolveTeam(value) {
  return TEAM_LOOKUP.get(normalizeKey(value)) || null;
}

export function resolveCircuitId(value) {
  return CIRCUIT_ALIASES[normalizeKey(value)] || null;
}

export function displayDriverName(driverId) {
  const driver = driverById(driverId);
  return driver ? driver.fullName : driverId;
}

export function displayTeamName(teamId) {
  const team = teamById(teamId);
  return team ? team.name : teamId;
}

export const CAR_NUMBER_DRIVER_MAP = {
  1: 'lando-norris',
  3: 'max-verstappen',
  5: 'gabriel-bortoleto',
  6: 'isack-hadjar',
  10: 'pierre-gasly',
  11: 'sergio-perez',
  12: 'kimi-antonelli',
  14: 'fernando-alonso',
  16: 'charles-leclerc',
  18: 'lance-stroll',
  23: 'alex-albon',
  27: 'nico-hulkenberg',
  30: 'liam-lawson',
  31: 'esteban-ocon',
  41: 'arvid-lindblad',
  43: 'franco-colapinto',
  44: 'lewis-hamilton',
  55: 'carlos-sainz',
  63: 'george-russell',
  77: 'valtteri-bottas',
  81: 'oscar-piastri',
  87: 'oliver-bearman',
};

export function resolveDriverByCarNumber(carNumber) {
  const driverId = CAR_NUMBER_DRIVER_MAP[Number(carNumber)];
  return driverId ? driverById(driverId) : null;
}
