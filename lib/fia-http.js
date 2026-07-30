// fia.com sits behind a bot filter that intermittently answers shared CI egress
// IPs with 403 instead of the document list. Those blocks clear on their own, so
// FIA requests go through a single retrying helper with browser-like headers.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RETRYABLE_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = 1500;

export const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
export const PDF_ACCEPT = 'application/pdf,*/*';

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

export async function fetchFiaResource(url, {
  label = url,
  accept = HTML_ACCEPT,
  attempts = DEFAULT_ATTEMPTS,
  backoffMs = DEFAULT_BACKOFF_MS,
  fetchImpl = fetch,
  wait = defaultWait,
} = {}) {
  let lastStatus = null;
  let lastNetworkError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsMade = attempt;
    let retryable = true;

    try {
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': accept,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (response.ok) {
        return response;
      }
      lastStatus = response.status;
      lastNetworkError = null;
      retryable = isRetryableStatus(response.status);
    } catch (error) {
      lastStatus = null;
      lastNetworkError = error;
    }

    if (!retryable || attempt === attempts) {
      break;
    }
    await wait(backoffMs * 2 ** (attempt - 1));
  }

  const reason = lastStatus != null ? lastStatus : (lastNetworkError?.message || 'network error');
  const suffix = attemptsMade > 1 ? ` (after ${attemptsMade} attempts)` : '';
  const failure = new Error(`${label} unavailable: ${reason}${suffix}`);
  failure.status = lastStatus;
  failure.attempts = attemptsMade;
  failure.cause = lastNetworkError || undefined;
  return Promise.reject(failure);
}
