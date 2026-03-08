// Client-side site mode utilities
// Fetches current site mode and provides navigation helpers

let cachedSiteMode = null;

/**
 * Fetch the current site mode from the API
 * @returns {Promise<{mode: string, isPreseason: boolean, isSeason: boolean}>}
 */
export async function getSiteMode() {
  if (cachedSiteMode) {
    return cachedSiteMode;
  }

  try {
    const response = await fetch('/api/site-mode');
    if (!response.ok) {
      throw new Error('Failed to fetch site mode');
    }
    cachedSiteMode = await response.json();
    return cachedSiteMode;
  } catch (error) {
    console.error('Error fetching site mode:', error);
    // Default to season mode on error and cache the fallback
    cachedSiteMode = {
      mode: 'season',
      isPreseason: false,
      isSeason: true,
    };
    return cachedSiteMode;
  }
}

/**
 * Add site mode indicator to the page banner
 */
export async function addModeIndicator() {
  const siteMode = await getSiteMode();
  const banner = document.querySelector('.site-banner');

  if (banner && siteMode.isPreseason) {
    // Add a subtle indicator for preseason mode
    const indicator = document.createElement('span');
    indicator.className = 'mode-indicator';
    indicator.textContent = 'Preseason Entry Builder';
    indicator.style.cssText = `
      display: inline-block;
      margin-left: 12px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(255, 215, 0, 0.2);
      border: 1px solid rgba(255, 215, 0, 0.4);
      border-radius: 4px;
      color: #ffd700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    banner.appendChild(indicator);
  }
}

/**
 * Update global navigation based on site mode
 */
export async function updateGlobalNav() {
  const siteMode = await getSiteMode();
  const nav = document.querySelector('.global-nav');

  if (!nav) return;

  // Preseason mode: show Home and Calculator links
  // Season mode: show Dashboard link
  const links = Array.from(nav.querySelectorAll('a'));

  links.forEach(link => {
    const href = link.getAttribute('href');

    // Hide/show links based on mode
    if (siteMode.isPreseason) {
      // In preseason mode, hide dashboard link
      if (href === 'dashboard.html' || href === '/dashboard.html') {
        link.style.display = 'none';
      }
    } else if (siteMode.isSeason) {
      // In season mode, hide home/calculator links
      if (href === 'index.html' || href === '/index.html' ||
          href === 'calculator.html' || href === '/calculator.html') {
        link.style.display = 'none';
      }
    }
  });
}

/**
 * Initialize site mode features on page load
 */
export async function initSiteMode() {
  await addModeIndicator();
  await updateGlobalNav();
}
