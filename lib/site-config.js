// Site mode configuration
// Controls which UI experience is active: preseason entry builder or in-season dashboard

/**
 * Site modes:
 * - 'preseason': Selector/calculator/entry builder flows are active
 * - 'season': Dashboard/team/standings flows are active
 */
export const SITE_MODES = {
  PRESEASON: 'preseason',
  SEASON: 'season',
};

// Cache for the validated site mode to avoid repeated env reads and warnings
let cachedSiteMode = null;
let hasLoggedInvalidSiteModeWarning = false;

/**
 * Get the active site mode from environment or default to season mode
 * @returns {'preseason' | 'season'}
 */
export function getSiteMode() {
  // Return cached value if we've already resolved the mode
  if (cachedSiteMode) {
    return cachedSiteMode;
  }

  const rawMode = process.env.SITE_MODE || SITE_MODES.SEASON;

  if (!Object.values(SITE_MODES).includes(rawMode)) {
    if (!hasLoggedInvalidSiteModeWarning) {
      console.warn(`Invalid SITE_MODE "${rawMode}", defaulting to "${SITE_MODES.SEASON}"`);
      hasLoggedInvalidSiteModeWarning = true;
    }
    cachedSiteMode = SITE_MODES.SEASON;
  } else {
    cachedSiteMode = rawMode;
  }

  return cachedSiteMode;
}

/**
 * Check if site is in preseason mode
 * @returns {boolean}
 */
export function isPreseasonMode() {
  return getSiteMode() === SITE_MODES.PRESEASON;
}

/**
 * Check if site is in season mode
 * @returns {boolean}
 */
export function isSeasonMode() {
  return getSiteMode() === SITE_MODES.SEASON;
}

/**
 * Get the default landing page based on current mode
 * @returns {string}
 */
export function getDefaultLandingPage() {
  return isPreseasonMode() ? '/index.html' : '/dashboard.html';
}

/**
 * Reset the cached site mode (for testing purposes)
 * @internal
 */
export function resetSiteModeCache() {
  cachedSiteMode = null;
  hasLoggedInvalidSiteModeWarning = false;
}
