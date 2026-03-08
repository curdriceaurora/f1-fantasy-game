import pdfParse from 'pdf-parse';
import { resolveDriver, resolveTeam } from './canonical.js';
import { scoreFinePoints } from './score-engine.js';

function parseEuros(value) {
  const cleaned = String(value).replace(/[^\d.,]/g, '');
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

export function activeFineFromText(text) {
  const monetaryMatches = [...text.matchAll(/fine(?:\s+of)?\s+€\s?([\d.,]+)/gi)];
  if (!monetaryMatches.length) return 0;

  const total = monetaryMatches.reduce((sum, match) => sum + parseEuros(match[1]), 0);
  const suspendedMatches = [...text.matchAll(/€\s?([\d.,]+)\s+(?:of which is\s+)?suspended/gi)];
  const suspendedTotal = suspendedMatches.reduce((sum, match) => sum + parseEuros(match[1]), 0);

  if (/fine.*fully suspended/i.test(text) || /no operational fine/i.test(text)) {
    return 0;
  }

  return Math.max(0, total - suspendedTotal);
}

export function classifySubject(text) {
  const driver = resolveDriver(text);
  if (driver) {
    return { type: 'driver', id: driver.id };
  }

  const team = resolveTeam(text);
  if (team) {
    return { type: 'team', id: team.id };
  }

  const carMatch = text.match(/CAR\s+\d+\s+\(([A-Z]{3})\)/i);
  if (carMatch) {
    const driverByAcronym = resolveDriver(carMatch[1]);
    if (driverByAcronym) {
      return { type: 'driver', id: driverByAcronym.id };
    }
  }

  return null;
}

export function extractSubjectHints(text) {
  const hints = [];
  const titleLine = text.split('\n').find((line) => line.trim()) || '';
  if (titleLine) hints.push(titleLine);

  const patternMatches = [
    ...text.matchAll(/(?:competitor|driver|team|car)\s*[:\-]?\s*([^\n]+)/gi),
  ];
  for (const match of patternMatches) {
    hints.push(match[1]);
  }
  return hints;
}

export async function fetchPdfText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/pdf,*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch FIA PDF ${url}: ${response.status}`);
  }
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
