import { fetchFiaResource, HTML_ACCEPT } from './fia-http.js';
import { activeFineFromText, fetchPdfText } from './fines.js';

const FIA_BASE = 'https://www.fia.com';
const FIA_DOCS_PAGE = `${FIA_BASE}/documents/championships/fia-formula-one-world-championship-14`;

// "Australian Grand Prix" → "australian_grand_prix"
export function meetingToFiaSlug(meetingName) {
  return meetingName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // FIA keeps hyphens inside a name: the Barcelona-Catalunya round publishes
    // as "2026_barcelona-catalunya_grand_prix_-_...".
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// FIA and OpenF1 name the same weekend differently — FIA files the June race as
// the "Barcelona-Catalunya Grand Prix" where OpenF1 calls it the "Barcelona
// Grand Prix" — so each source can be pinned independently on the calendar.
export function fiaEventName(race) {
  return race.sources?.fiaEventName || race.meetingName;
}

export function eventDocumentsPage(meetingName) {
  return `${FIA_DOCS_PAGE}/event/${encodeURIComponent(meetingName)}`;
}

async function decisionUrlsFromPage(pageUrl, label, urlFragment, options) {
  const response = await fetchFiaResource(pageUrl, {
    ...options,
    label,
    accept: HTML_ACCEPT,
  });

  const html = await response.text();
  const pattern = new RegExp(`href="(${urlFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]+\\.pdf)"`, 'gi');
  const seen = new Set();
  let match;
  while ((match = pattern.exec(html)) !== null) {
    seen.add(`${FIA_BASE}${match[1]}`);
  }
  return [...seen];
}

export async function fetchFiaDecisionUrls(race, options = {}) {
  const eventName = fiaEventName(race);
  const year = race.date.slice(0, 4);
  const slug = meetingToFiaSlug(eventName);
  const urlFragment = `/system/files/decision-document/${year}_${slug}_-_`;

  // The championship landing page only lists whichever event it is currently
  // showing — the most recent one — so any earlier race read as "no documents
  // published". Scope the request to this race's own event page instead, and
  // keep the landing page as a fallback for meeting names FIA spells
  // differently from the calendar.
  try {
    const eventUrls = await decisionUrlsFromPage(
      eventDocumentsPage(eventName),
      `FIA documents page for ${eventName}`,
      urlFragment,
      options,
    );
    if (eventUrls.length) {
      return eventUrls;
    }
  } catch (error) {
    console.warn(`Falling back to the FIA documents landing page: ${error.message}`);
  }

  return decisionUrlsFromPage(FIA_DOCS_PAGE, 'FIA documents page', urlFragment, options);
}

const FINE_URL_SIGNALS = ['_infringement_', '_decision_'];
const RESULT_DOCUMENT_URL_SIGNALS = [
  ...FINE_URL_SIGNALS, '_appeal_', '_right_of_review_',
];
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

export function isPotentialResultDocument(url) {
  const lower = url.toLowerCase();
  if (SKIP_URL_SIGNALS.some((s) => lower.includes(s))) return false;
  return RESULT_DOCUMENT_URL_SIGNALS.some((s) => lower.includes(s));
}

// Result-changing decisions are broader than monetary fines: appeals and late
// sporting penalties can alter a classification without containing a fine.
// Keep the full candidate set for post-publication monitoring.
export async function discoverPotentialPenaltyPdfs(race, options = {}) {
  const allUrls = await fetchFiaDecisionUrls(race, options);
  return allUrls.filter(isPotentialResultDocument);
}

export async function discoverMonetaryFinePdfs(race, options = {}) {
  const candidates = await discoverPotentialPenaltyPdfs(race, options);

  const fineUrls = [];
  for (const url of candidates) {
    try {
      const text = await fetchPdfText(url, options);
      if (activeFineFromText(text) > 0) {
        fineUrls.push(url);
      }
    } catch {
      // skip unreadable PDFs
    }
  }
  return fineUrls;
}
