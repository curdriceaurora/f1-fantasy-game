import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import siteModeHandler from '../api/site-mode.js';
import standingsHandler, { createStandingsHandler } from '../api/dashboard/standings.js';
import calendarHandler, { createCalendarHandler } from '../api/dashboard/calendar.js';
import teamsIndexHandler, { createTeamsIndexHandler } from '../api/dashboard/teams/index.js';
import teamDetailHandler, { createTeamDetailHandler } from '../api/dashboard/teams/[teamId].js';
import raceDetailHandler, { createRaceDetailHandler } from '../api/dashboard/races/[raceId].js';
import selectionHandler, { createSelectionHandler, pickEntry, resolveSelectionDataPath } from '../api/selection.js';
import { createAppServer, resolveApiRoute, startServer } from '../server.js';
import { SITE_MODES } from '../lib/site-config.js';

// Helper mock response factory
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    end(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

test('api/site-mode returns current mode status', () => {
  const req = { query: {}, method: 'GET' };
  const res = createMockRes();

  siteModeHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok(res.body.mode);
  assert.strictEqual(typeof res.body.isPreseason, 'boolean');
  assert.strictEqual(typeof res.body.isSeason, 'boolean');
});

test('api/dashboard/standings returns standings payload', () => {
  const req = { query: {}, method: 'GET' };
  const res = createMockRes();

  standingsHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok(Array.isArray(res.body.standings));
  assert.ok(Array.isArray(res.body.races));
});

test('api/dashboard/calendar returns calendar payload', () => {
  const req = { query: {}, method: 'GET' };
  const res = createMockRes();

  calendarHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok(Array.isArray(res.body.races));
  assert.strictEqual(typeof res.body.activeCount, 'number');
});

test('api/dashboard/teams index returns teams list', () => {
  const req = { query: {}, method: 'GET' };
  const res = createMockRes();

  teamsIndexHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok(Array.isArray(res.body.teams));
  assert.ok(res.body.teams.length > 0);
});

test('api/dashboard/teams/[teamId] returns team details for valid teamId', () => {
  const teamsReq = { query: {}, method: 'GET' };
  const teamsRes = createMockRes();
  teamsIndexHandler(teamsReq, teamsRes);

  const validTeamId = teamsRes.body.teams[0].teamId;

  const req = { query: { teamId: validTeamId }, method: 'GET' };
  const res = createMockRes();

  teamDetailHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.strictEqual(res.body.teamId, validTeamId);
});

test('api/dashboard/teams/[teamId] returns 404 for non-existent teamId', () => {
  const req = { query: { teamId: 'unknown-team-id-999' }, method: 'GET' };
  const res = createMockRes();

  teamDetailHandler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: 'Team not found' });
});

test('api/dashboard/races/[raceId] returns 404 for non-existent raceId', () => {
  const req = { query: { raceId: 'unknown-race-id-999' }, method: 'GET' };
  const res = createMockRes();

  raceDetailHandler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: 'Race not found' });
});

test('api/dashboard/races/[raceId] returns an existing scored race', () => {
  const req = { query: { raceId: 'australia' }, method: 'GET' };
  const res = createMockRes();
  raceDetailHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.raceId, 'australia');
  assert.ok(Array.isArray(res.body.teams));
});

test('api/selection rejects missing or invalid accuracy parameter', () => {
  const reqInvalid1 = { query: {}, method: 'GET' };
  const res1 = createMockRes();
  selectionHandler(reqInvalid1, res1);
  assert.strictEqual(res1.statusCode, 400);

  const reqInvalid2 = { query: { accuracy: '1.5' }, method: 'GET' };
  const res2 = createMockRes();
  selectionHandler(reqInvalid2, res2);
  assert.strictEqual(res2.statusCode, 400);

  const reqInvalid3 = { query: { accuracy: '-0.1' }, method: 'GET' };
  const res3 = createMockRes();
  selectionHandler(reqInvalid3, res3);
  assert.strictEqual(res3.statusCode, 400);
});

test('api/selection returns valid selection and email for valid accuracy', () => {
  const req = { query: { accuracy: '0.8', name: 'Test Manager', team: 'Test Team', investment: '5' }, method: 'GET' };
  const res = createMockRes();

  selectionHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok(res.body.drivers);
  assert.ok(res.body.teams);
  assert.strictEqual(res.body.drivers.length, 3);
  assert.strictEqual(res.body.teams.length, 3);
  assert.ok(res.body.emailBody.includes('Test Manager'));
  assert.ok(res.body.emailBody.includes('Test Team'));
});

test('selection endpoint exposes fallback, failure, and data-path behavior', () => {
  const fallback = pickEntry(0.5, undefined, [
    { p: 1000, d: [0, 1, 2], t: [0, 1, 2] },
    { p: 0, d: [3, 4, 5], t: [3, 4, 5] },
  ]);
  assert.equal(fallback.rank, 1);
  assert.equal(fallback.totalEntries, 2);
  assert.equal(
    resolveSelectionDataPath('/missing-cwd', '/module/api', () => { throw new Error('missing'); }),
    '/module/data/selections.json',
  );

  const originalError = console.error;
  console.error = () => {};
  try {
    const res = createMockRes();
    createSelectionHandler(() => { throw new Error('selection unavailable'); })(
      { query: { accuracy: '0.5' } },
      res,
    );
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal server error' });
  } finally {
    console.error = originalError;
  }
});

test('dashboard API handlers return stable 500 payloads when loaders fail', () => {
  const originalError = console.error;
  console.error = () => {};
  const failingLoader = () => { throw new Error('storage unavailable'); };
  try {
    const cases = [
      [createCalendarHandler(failingLoader), {}, 'Unable to load calendar'],
      [createStandingsHandler(failingLoader), {}, 'Unable to load standings'],
      [createTeamsIndexHandler(failingLoader), {}, 'Unable to load teams'],
      [createTeamDetailHandler(failingLoader), { teamId: 'one' }, 'Unable to load team detail'],
      [createRaceDetailHandler(failingLoader), { raceId: 'australia' }, 'Unable to load race detail'],
    ];
    for (const [handler, query, message] of cases) {
      const res = createMockRes();
      handler({ query, method: 'GET' }, res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: message });
    }
  } finally {
    console.error = originalError;
  }
});

test('server.js resolveApiRoute maps static and dynamic API paths correctly', () => {
  const selectionRoute = resolveApiRoute('/api/selection');
  assert.ok(selectionRoute);
  assert.ok(selectionRoute.filePath.endsWith('api/selection.js'));

  const teamsIndexRoute = resolveApiRoute('/api/dashboard/teams');
  assert.ok(teamsIndexRoute);
  assert.ok(teamsIndexRoute.filePath.endsWith('api/dashboard/teams/index.js'));

  const teamDetailRoute = resolveApiRoute('/api/dashboard/teams/team-123');
  assert.ok(teamDetailRoute);
  assert.ok(teamDetailRoute.filePath.endsWith('api/dashboard/teams/[teamId].js'));
  assert.strictEqual(teamDetailRoute.params.teamId, 'team-123');

  const raceDetailRoute = resolveApiRoute('/api/dashboard/races/australia');
  assert.ok(raceDetailRoute);
  assert.ok(raceDetailRoute.filePath.endsWith('api/dashboard/races/[raceId].js'));
  assert.strictEqual(raceDetailRoute.params.raceId, 'australia');

  const invalidRoute = resolveApiRoute('/api/nonexistent/path/999');
  assert.strictEqual(invalidRoute, null);
});

async function request(server, pathname) {
  if (!server.listening) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { redirect: 'manual' });
  return {
    status: response.status,
    location: response.headers.get('location'),
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  };
}

test('dev server enforces season and preseason redirects', async (t) => {
  const season = createAppServer({ getSiteMode: () => SITE_MODES.SEASON });
  const preseason = createAppServer({ getSiteMode: () => SITE_MODES.PRESEASON });
  t.after(() => season.close());
  t.after(() => preseason.close());

  assert.deepEqual(await request(season, '/'), {
    status: 302, location: '/dashboard.html', contentType: null, body: '',
  });
  assert.equal((await request(season, '/calculator.html')).location, '/dashboard.html');
  assert.equal((await request(preseason, '/')).location, '/index.html');
  assert.equal((await request(preseason, '/dashboard.html')).location, '/index.html');
});

test('dev server serves static and API responses and their failure paths', async (t) => {
  const publicDir = mkdtempSync(join(tmpdir(), 'f1-server-public-'));
  writeFileSync(join(publicDir, 'asset.bin'), 'binary-content');
  const server = createAppServer({ publicDir, getSiteMode: () => SITE_MODES.SEASON });
  t.after(() => {
    server.close();
    rmSync(publicDir, { recursive: true, force: true });
  });

  const api = await request(server, '/api/site-mode?source=test');
  assert.equal(api.status, 200);
  assert.match(api.contentType, /application\/json/);
  assert.equal(JSON.parse(api.body).mode, SITE_MODES.SEASON);

  const missingApi = await request(server, '/api/not-real');
  assert.equal(missingApi.status, 404);
  assert.equal(missingApi.body, 'API route not found');

  const asset = await request(server, '/asset.bin');
  assert.equal(asset.status, 200);
  assert.equal(asset.contentType, 'application/octet-stream');
  assert.equal(asset.body, 'binary-content');

  const missingFile = await request(server, '/missing.html');
  assert.equal(missingFile.status, 404);
  assert.equal(missingFile.body, 'Not found');
});

test('dev server returns 500 when an API module cannot load', async (t) => {
  const server = createAppServer({
    getSiteMode: () => SITE_MODES.SEASON,
    resolveApiRoute: () => ({ filePath: '/invalid/api.js', params: {} }),
    importApiModule: async () => { throw new Error('load failed'); },
  });
  t.after(() => server.close());

  const response = await request(server, '/api/failure');
  assert.equal(response.status, 500);
  assert.equal(response.body, 'API route error');
});

test('startServer starts on an ephemeral port', async (t) => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...values) => logs.push(values.join(' '));
  const server = startServer(0, { getSiteMode: () => SITE_MODES.PRESEASON });
  t.after(() => {
    console.log = originalLog;
    server.close();
  });
  await once(server, 'listening');

  assert.ok(server.address().port > 0);
  assert.ok(logs.some((line) => line.includes('Preseason Entry Builder')));
});
