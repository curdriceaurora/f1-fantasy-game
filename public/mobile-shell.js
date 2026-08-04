const MOBILE_BREAKPOINT = 640;
const globalNav = document.querySelector('.global-nav');

if (globalNav) {
  const activeLink = globalNav.querySelector('.nav-active');
  if (activeLink) activeLink.setAttribute('aria-current', 'page');

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'mobile-menu-btn';
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-controls', 'mobile-nav-drawer');
  menuButton.setAttribute('aria-label', 'Toggle navigation menu');
  menuButton.textContent = '☰';

  const drawer = document.createElement('div');
  drawer.id = 'mobile-nav-drawer';
  drawer.className = 'mobile-nav-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Main Navigation');
  drawer.hidden = true;

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'drawer-backdrop';
  backdrop.setAttribute('aria-label', 'Close navigation menu');
  backdrop.tabIndex = -1;

  const panel = document.createElement('div');
  panel.className = 'mobile-drawer-panel';

  const drawerHeader = document.createElement('div');
  drawerHeader.className = 'mobile-drawer-header';
  drawerHeader.innerHTML = '<span>Navigation</span>';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'mobile-drawer-close';
  closeButton.setAttribute('aria-label', 'Close navigation menu');
  closeButton.textContent = '×';
  drawerHeader.append(closeButton);

  const links = document.createElement('nav');
  links.className = 'mobile-drawer-links';
  links.setAttribute('aria-label', 'Mobile navigation');
  for (const sourceLink of globalNav.querySelectorAll('a')) {
    const link = sourceLink.cloneNode(true);
    if (link.classList.contains('nav-active')) link.setAttribute('aria-current', 'page');
    links.append(link);
  }

  panel.append(drawerHeader, links);
  drawer.append(backdrop, panel);
  document.body.append(menuButton, drawer);

  const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function closeDrawer({ restoreFocus = true } = {}) {
    if (drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('mobile-nav-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.textContent = '☰';
    if (restoreFocus) menuButton.focus();
  }

  function openDrawer() {
    drawer.hidden = false;
    document.body.classList.add('mobile-nav-open');
    menuButton.setAttribute('aria-expanded', 'true');
    menuButton.textContent = '×';
    closeButton.focus();
  }

  menuButton.addEventListener('click', () => {
    if (drawer.hidden) openDrawer();
    else closeDrawer();
  });
  closeButton.addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  links.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeDrawer({ restoreFocus: false });
  });

  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...panel.querySelectorAll(focusableSelector)]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) closeDrawer({ restoreFocus: false });
  });
}

const secondaryNav = document.querySelector('.rules-nav');
if (secondaryNav) {
  let previousScrollY = window.scrollY;
  let scrollFrame = null;

  window.addEventListener('scroll', () => {
    if (scrollFrame !== null) return;
    scrollFrame = window.requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        if (currentScrollY > 40 && currentScrollY > previousScrollY) {
          secondaryNav.classList.add('rules-nav-hidden');
        } else if (currentScrollY < previousScrollY) {
          secondaryNav.classList.remove('rules-nav-hidden');
        }
      } else {
        secondaryNav.classList.remove('rules-nav-hidden');
      }
      previousScrollY = currentScrollY;
      scrollFrame = null;
    });
  }, { passive: true });
}
