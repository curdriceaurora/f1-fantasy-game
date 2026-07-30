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

// "is fined €30,000 of which €10,000 is suspended for 12 months" — the awarded
// total and the suspended part sit either side of a line break, so the clause
// scan below sees two unrelated amounts and adds them. Read the pair off the
// flattened text instead: only €20,000 is actually payable.
function partiallySuspendedFines(text) {
  const flattened = String(text || '').replace(/\s+/g, ' ');
  const pattern = /€\s*([\d][\d.,]*)\s+of which\s+€\s*([\d][\d.,]*)\s+(?:is|are)\s+suspend/gi;
  return [...flattened.matchAll(pattern)].map((match) => ({
    awarded: parseEuros(match[1]),
    suspended: parseEuros(match[2]),
  }));
}

export function activeFineFromText(text) {
  const fineContextPattern = FINE_CONTEXT_PATTERN;
  const suspendedPattern = /\bsuspend(?:ed|sion)?\b/i;
  const ofWhichPattern = /\bof which\b/i;

  const partialSuspensions = partiallySuspendedFines(text);
  if (partialSuspensions.length) {
    return partialSuspensions.reduce(
      (sum, { awarded, suspended }) => sum + Math.max(0, awarded - suspended),
      0,
    );
  }

  const euroContexts = euroAmountsWithContext(text);
  const fineAmounts = euroContexts.filter(({ clause }) => fineContextPattern.test(clause));
  if (!fineAmounts.length) return 0;

  if (/fine.*fully suspended/i.test(text) || /no operational fine/i.test(text)) {
    return 0;
  }

  const total = [...new Set(fineAmounts.map((entry) => entry.amount))]
    .reduce((sum, amount) => sum + amount, 0);
  const suspendedTotal = [...new Set(
    euroContexts
    .filter(({ clause }) => suspendedPattern.test(clause) && (fineContextPattern.test(clause) || ofWhichPattern.test(clause)))
      .map((entry) => entry.amount),
  )].reduce((sum, amount) => sum + amount, 0);

  return Math.max(0, total - suspendedTotal);
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

export async function fetchPdfText(url, options = {}) {
  const response = await fetchFiaResource(url, {
    ...options,
    label: `FIA PDF ${url}`,
    accept: PDF_ACCEPT,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await pdfParse(buffer);
  return parsed.text || '';
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

  // "A fine of €5,000 is also imposed on the Competitor" names no team, so the
  // scan falls through to the entry line and lands on the driver. The money is
  // still the competitor's: bill it to the team that entered the car.
  if (subject?.type === 'driver' && fineClauses(text).some((clause) => /\bcompetitor\b|\bentrant\b/i.test(clause))) {
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

export async function fetchFineSummary(raceId, fineDocuments = []) {
  const summary = {
    raceId,
    drivers: {},
    teams: {},
    documents: [],
    warnings: [],
  };

  for (const url of fineDocuments) {
    const text = await fetchPdfText(url);
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
