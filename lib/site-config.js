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

/**
 * Get the active site mode from environment or default to season mode
 * @returns {'preseason' | 'season'}
 */
export function getSiteMode() {
  const mode = process.env.SITE_MODE || SITE_MODES.SEASON;

  if (!Object.values(SITE_MODES).includes(mode)) {
    console.warn(`Invalid SITE_MODE "${mode}", defaulting to "${SITE_MODES.SEASON}"`);
    return SITE_MODES.SEASON;
  }

  return mode;
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
