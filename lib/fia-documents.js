import { activeFineFromText, fetchPdfText } from './fines.js';

const FIA_BASE = 'https://www.fia.com';
const FIA_DOCS_PAGE = `${FIA_BASE}/documents/championships/fia-formula-one-world-championship-14`;

// "Australian Grand Prix" → "australian_grand_prix"
export function meetingToFiaSlug(meetingName) {
  return meetingName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

export async function fetchFiaDecisionUrls(race) {
  const year = race.date.slice(0, 4);
  const slug = meetingToFiaSlug(race.meetingName);
  const urlFragment = `/system/files/decision-document/${year}_${slug}_-_`;

  const response = await fetch(FIA_DOCS_PAGE, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) {
    throw new Error(`FIA documents page unavailable: ${response.status}`);
  }

  const html = await response.text();
  const pattern = new RegExp(`href="(${urlFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]+\\.pdf)"`, 'gi');
  const seen = new Set();
  let match;
  while ((match = pattern.exec(html)) !== null) {
    seen.add(`${FIA_BASE}${match[1]}`);
  }
  return [...seen];
}

const FINE_URL_SIGNALS = ['_infringement_', '_decision_'];
const SKIP_URL_SIGNALS = [
  '_classification_', '_result_', '_grid_', '_provisional_',
  '_starting_grid_', '_restricted_', '_note_', '_reprimand_',
  '_weather_', '_track_limits_',
];

export function isPotentialFineDocument(url) {
  const lower = url.toLowerCase();
  if (SKIP_URL_SIGNALS.some((s) => lower.includes(s))) return false;
  return FINE_URL_SIGNALS.some((s) => lower.includes(s));
}

export async function discoverMonetaryFinePdfs(race) {
  const allUrls = await fetchFiaDecisionUrls(race);
  const candidates = allUrls.filter(isPotentialFineDocument);

  const fineUrls = [];
  for (const url of candidates) {
    try {
      const text = await fetchPdfText(url);
      if (activeFineFromText(text) > 0) {
        fineUrls.push(url);
      }
    } catch {
      // skip unreadable PDFs
    }
  }
  return fineUrls;
}
