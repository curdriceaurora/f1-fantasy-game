import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';
import { driverById, resolveDriver, resolveDriverByCarNumber, resolveTeam } from './canonical.js';
import { fetchFiaResource, PDF_ACCEPT } from './fia-http.js';
import { scoreFinePoints } from './score-engine.js';

function parseEuros(value) {
  const cleaned = String(value).replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    return Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (hasComma) {
    const commaParts = cleaned.split(',');
    if (commaParts.at(-1)?.length === 3) {
      return Number.parseFloat(cleaned.replace(/,/g, '')) || 0;
    }
    return Number.parseFloat(cleaned.replace(',', '.')) || 0;
  }
  if (hasDot) {
    const dotParts = cleaned.split('.');
    if (dotParts.at(-1)?.length === 3) {
      return Number.parseFloat(cleaned.replace(/\./g, '')) || 0;
    }
  }
  return Number.parseFloat(cleaned) || 0;
}

function extractClause(text, startIndex, endIndex) {
  const isSeparator = (char) => char === '\n' || char === '\r' || char === '.' || char === ';' || char === ':';

  let left = startIndex;
  while (left > 0 && !isSeparator(text[left - 1])) {
    left -= 1;
  }

  let right = endIndex;
  while (right < text.length && !isSeparator(text[right])) {
    right += 1;
  }

  return text.slice(left, right);
}

function euroAmountsWithContext(text) {
  const amounts = [];
  const seen = new Set();
  const amountPattern = /€\s*([\d][\d.,]*)/gi;
  let match = amountPattern.exec(text);
  while (match) {
    const amount = parseEuros(match[1]);
    const clause = extractClause(text, match.index, match.index + match[0].length);
    const clauseKey = clause.replace(/\s+/g, ' ').trim().toLowerCase();
    const dedupeKey = `${clauseKey}::${amount}`;
    if (!seen.has(dedupeKey)) {
      amounts.push({ amount, clause });
      seen.add(dedupeKey);
    }
    match = amountPattern.exec(text);
  }
  return amounts;
}

const FINE_CONTEXT_PATTERN = /\bfine(?:d|s)?\b|\bfinancial penalty\b|\bmonetary penalty\b/i;

// The clauses that actually award the money, e.g. "The competitor (Oracle Red
// Bull Racing) is fined €400" — whoever they name is who pays.
export function fineClauses(text) {
  return euroAmountsWithContext(text)
    .filter(({ clause }) => FINE_CONTEXT_PATTERN.test(clause))
    .map(({ clause }) => clause);
}

// FIA steward documents phrase suspended fines three ways, and in each the word
// "suspend" can land in a different clause from the amount, so the clause scan
// below cannot net them on its own. Each pattern captures the awarded amount and
// the suspended amount (equal to the award when the whole fine is suspended); the
// payable part is awarded - suspended. Every gap is \s+ because steward PDFs put
// line breaks and non-breaking spaces between these words, where a literal space
// silently matches nothing. The reader and the remover in activeFineFromText must
// see exactly the same spans, so both iterate this one list.
const SUSPENSION_PATTERNS = [
  // "€30,000 of which €10,000 is suspended" — suspended part named after "of which".
  { source: '€\\s*([\\d][\\d.,]*)\\s+of\\s+which\\s+€\\s*([\\d][\\d.,]*)\\s+(?:is|are)\\s+suspend', full: false },
  // "€30,000, €20,000 of which is suspended" — total first, suspended part named
  // second before "of which" (Canada RBPT, Monaco McLaren technical).
  { source: '€\\s*([\\d][\\d.,]*)\\s*,\\s*€\\s*([\\d][\\d.,]*)\\s+of\\s+which\\s+(?:is|are)\\s+suspend', full: false },
  // "is fined €5,000. This fine is suspended" — a single fine suspended in full,
  // with the suspension in its own sentence (Monaco media commitments).
  { source: 'fined\\s+€\\s*([\\d][\\d.,]*)\\s*\\.?\\s*(?:this\\s+fine|the\\s+fine|it)\\s+(?:is|are)\\s+(?:fully\\s+)?suspend', full: true },
];

function suspensionAdjustments(text) {
  const src = String(text || '');
  const out = [];
  for (const { source, full } of SUSPENSION_PATTERNS) {
    for (const match of src.matchAll(new RegExp(source, 'gi'))) {
      const awarded = parseEuros(match[1]);
      out.push({ awarded, suspended: full ? awarded : parseEuros(match[2]) });
    }
  }
  return out;
}

function stripSuspensionSpans(text) {
  let result = String(text || '');
  for (const { source } of SUSPENSION_PATTERNS) {
    result = result.replace(new RegExp(source, 'gi'), ' ');
  }
  return result;
}

export function activeFineFromText(text) {
  const fineContextPattern = FINE_CONTEXT_PATTERN;
  const suspendedPattern = /\bsuspend(?:ed|sion)?\b/i;
  const ofWhichPattern = /\bof which\b/i;

  const partialPayable = suspensionAdjustments(text).reduce(
    (sum, { awarded, suspended }) => sum + Math.max(0, awarded - suspended),
    0,
  );
  // Remove the suspended-fine spans already accounted for above, so the general
  // scan below sees only the remaining, independent fines rather than re-reading
  // the paired amounts (which it would net to zero) or dropping a separate full
  // fine published in the same document.
  const remainder = stripSuspensionSpans(text);

  const euroContexts = euroAmountsWithContext(remainder);
  const fineAmounts = euroContexts.filter(({ clause }) => fineContextPattern.test(clause));
  if (!fineAmounts.length) return partialPayable;

  if (/fine.*fully suspended/i.test(remainder) || /no operational fine/i.test(remainder)) {
    return partialPayable;
  }

  const total = [...new Set(fineAmounts.map((entry) => entry.amount))]
    .reduce((sum, amount) => sum + amount, 0);
  const suspendedTotal = [...new Set(
    euroContexts
    .filter(({ clause }) => suspendedPattern.test(clause) && (fineContextPattern.test(clause) || ofWhichPattern.test(clause)))
      .map((entry) => entry.amount),
  )].reduce((sum, amount) => sum + amount, 0);

  return partialPayable + Math.max(0, total - suspendedTotal);
}


// Steward documents wrap the names we care about in surrounding words: the
// entry list line reads "6 - Isack Hadjar" and competitors carry their title
// sponsor ("Oracle Red Bull Racing", "Scuderia Ferrari HP"). Exact alias lookup
// misses both, so fall back to scanning the word windows of the phrase. Driver
// windows stay at two words or more because a lone token like "law" collides
// with the three-letter acronym aliases; team names have no such collisions.
function resolveFromWordWindows(text, resolve, minWords = 2) {
  const words = String(text || '').trim().split(/\s+/);
  for (let size = Math.min(words.length, 8); size >= minWords; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const resolved = resolve(words.slice(start, start + size).join(' '));
      if (resolved) return resolved;
    }
  }
  return null;
}

export function classifySubject(text) {
  const driver = resolveDriver(text) || resolveFromWordWindows(text, resolveDriver);
  if (driver) {
    return { type: 'driver', id: driver.id };
  }

  // "No / Driver" lines pair the car number with the name: "6 - Isack Hadjar".
  const numberedDriverMatch = String(text || '').match(/(?:^|\s)(\d{1,2})\s*[-–—]\s*\S/);
  if (numberedDriverMatch) {
    const driverByNumber = resolveDriverByCarNumber(numberedDriverMatch[1]);
    if (driverByNumber) {
      return { type: 'driver', id: driverByNumber.id };
    }
  }

  const team = resolveTeam(text) || resolveFromWordWindows(text, resolveTeam, 1);
  if (team) {
    return { type: 'team', id: team.id };
  }

  const carMatch = text.match(/CAR\s+(\d+)(?:\s+\(([A-Z]{3})\))?/i);
  if (carMatch) {
    if (carMatch[2]) {
      const driverByAcronym = resolveDriver(carMatch[2]);
      if (driverByAcronym) {
        return { type: 'driver', id: driverByAcronym.id };
      }
    }
    const driverByNumber = resolveDriverByCarNumber(carMatch[1]);
    if (driverByNumber) {
      return { type: 'driver', id: driverByNumber.id };
    }
  }

  return null;
}

// Infringements that belong to the driver who committed them, even though the
// FIA fines "the competitor": speeding, the start procedure and on-track driving
// offences are the driver's own actions. Everything else (unsafe release,
// technical, media, tyre return, article breaches) is the team's and stays with
// the competitor. Matched against the document title / URL slug only, whose
// wording is stable — never the free-text reason, which narrates the incident
// (an unsafe release "into a collision", say) and would misfile team fines.
const DRIVER_FAULT_INFRINGEMENT = /pit[_\s-]*lane[_\s-]*speeding|pit[_\s-]*lane[_\s-]*incident|start[_\s-]*procedure|causing[_\s-]*a[_\s-]*collision|collision[_\s-]*with[_\s-]*car|impeding|moving[_\s-]*under[_\s-]*braking|blue[_\s-]*flags|false[_\s-]*start|track[_\s-]*limits/i;

// Returns the driver a driver-fault fine belongs to, or null when the document is
// not a driver-fault infringement or its car number is not on the fantasy roster
// (an FP1 reservist, say) — in which case the fine stays with the entrant team.
export function driverFaultDriver(url, text) {
  if (!DRIVER_FAULT_INFRINGEMENT.test(String(url))) return null;
  const carMatch = String(url).match(/car[_\s-]?(\d{1,2})/i) || String(text).match(/\bCar\s+(\d{1,2})\b/i);
  return carMatch ? resolveDriverByCarNumber(carMatch[1]) : null;
}

export function extractSubjectHints(text) {
  // The awarding clause comes first: a pit lane speeding document names the
  // driver in its entry line but fines the competitor, and the money follows
  // the decision, not the entry line.
  const hints = [...fineClauses(text)];
  const titleLine = text.split('\n').find((line) => line.trim()) || '';
  if (titleLine) hints.push(titleLine);

  const patternMatches = [
    ...text.matchAll(/(?:competitor|driver|team|car)\s*[:-]?\s*([^\n]+)/gi),
  ];
  for (const match of patternMatches) {
    hints.push(match[1]);
  }
  return hints;
}

// FIA decision documents are immutable once published, so cache the extracted
// text on disk (gitignored). Repeated scoring/audit passes over the same race
// then avoid re-fetching through fia.com's bot filter. Set FIA_CACHE_DISABLED=1
// to force a live fetch (e.g. if a document is amended).
const FIA_TEXT_CACHE_DIR = fileURLToPath(new URL('../.fia-cache/', import.meta.url));

function fiaCachePath(url, cacheDir = FIA_TEXT_CACHE_DIR) {
  const name = url.split('/').pop().replace(/[^\w.-]/g, '_');
  return join(cacheDir, `${name}.txt`);
}

export async function fetchPdfText(url, options = {}) {
  const cacheDir = options.cacheDir || FIA_TEXT_CACHE_DIR;
  const parsePdf = options.parsePdf || pdfParse;
  const cachePath = fiaCachePath(url, cacheDir);
  if (!process.env.FIA_CACHE_DISABLED && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }
  const response = await fetchFiaResource(url, {
    ...options,
    label: `FIA PDF ${url}`,
    accept: PDF_ACCEPT,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await parsePdf(buffer);
  const text = parsed.text || '';
  if (text) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, text);
  }
  return text;
}

export function summarizeFineDocumentText(url, text) {
  const fineEuros = activeFineFromText(text);
  if (!fineEuros) {
    return {
      document: { url, fineEuros: 0, finePoints: 0, appliedTo: null },
      warning: null,
    };
  }

  const hints = extractSubjectHints(text);
  let subject = null;
  for (const hint of hints) {
    subject = classifySubject(hint);
    if (subject) break;
  }

  // Speeding, start-procedure and other driving offences are the driver's own,
  // so they are charged to the driver even though the FIA names the competitor as
  // the party fined. This wins over the competitor-reassignment below.
  const faultDriver = driverFaultDriver(url, text);
  if (faultDriver) {
    subject = { type: 'driver', id: faultDriver.id };
  } else if (subject?.type === 'driver' && fineClauses(text).some((clause) => /\bcompetitor\b|\bentrant\b/i.test(clause))) {
    // "A fine of €5,000 is also imposed on the Competitor" names no team, so the
    // scan falls through to the entry line and lands on the driver. The money is
    // still the competitor's: bill it to the team that entered the car.
    const entrant = resolveTeam(driverById(subject.id)?.team || '');
    if (entrant) {
      subject = { type: 'team', id: entrant.id };
    }
  }

  if (!subject) {
    return {
      document: { url, fineEuros, finePoints: scoreFinePoints(fineEuros), appliedTo: null },
      warning: `Unable to classify fine subject for ${url}`,
    };
  }

  return {
    document: {
      url,
      fineEuros,
      finePoints: scoreFinePoints(fineEuros),
      appliedTo: subject,
    },
    warning: null,
  };
}

export async function fetchFineSummary(raceId, fineDocuments = [], options = {}) {
  const fetchPdfTextImpl = options.fetchPdfTextImpl || fetchPdfText;
  const summary = {
    raceId,
    drivers: {},
    teams: {},
    documents: [],
    warnings: [],
  };

  for (const url of fineDocuments) {
    const text = await fetchPdfTextImpl(url, options);
    const { document, warning } = summarizeFineDocumentText(url, text);
    summary.documents.push(document);
    if (warning) {
      summary.warnings.push(warning);
      continue;
    }
    if (!document.appliedTo) {
      continue;
    }

    if (document.appliedTo.type === 'driver') {
      summary.drivers[document.appliedTo.id] = (summary.drivers[document.appliedTo.id] || 0) + document.fineEuros;
    } else {
      summary.teams[document.appliedTo.id] = (summary.teams[document.appliedTo.id] || 0) + document.fineEuros;
    }
  }

  return summary;
}
