import test from 'node:test';
import assert from 'node:assert/strict';

import siteModeHandler from '../api/site-mode.js';
import standingsHandler from '../api/dashboard/standings.js';
import calendarHandler from '../api/dashboard/calendar.js';
import teamsIndexHandler from '../api/dashboard/teams/index.js';
import teamDetailHandler from '../api/dashboard/teams/[teamId].js';
import raceDetailHandler from '../api/dashboard/races/[raceId].js';
import selectionHandler from '../api/selection.js';
import { resolveApiRoute } from '../server.js';

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
