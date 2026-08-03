import { expect } from '@playwright/test';

const LOCAL_ORIGINS = new Set([
  'http://127.0.0.1:3456',
  'http://127.0.0.1:3457',
]);

export async function monitorPage(page) {
  const problems = [];

  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));

  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (LOCAL_ORIGINS.has(url.origin) && response.status() >= 400) {
      problems.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (LOCAL_ORIGINS.has(url.origin)) {
      problems.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown error'})`);
    }
  });

  return () => expect(problems, 'page should load without browser or same-origin request errors').toEqual([]);
}

export function signedPoints(points) {
  return `${points > 0 ? '+' : ''}${points}`;
}
