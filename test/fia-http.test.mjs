import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFiaResource, isRetryableStatus } from '../lib/fia-http.js';

function stubResponse(status) {
  return { ok: status >= 200 && status < 300, status };
}

function recordingWait(waits) {
  return async (milliseconds) => {
    waits.push(milliseconds);
  };
}

test('a bot-filter 403 is retried until FIA answers', async () => {
  const waits = [];
  const statuses = [403, 403, 200];
  let calls = 0;

  const response = await fetchFiaResource('https://fia.test/documents', {
    label: 'FIA documents page',
    fetchImpl: async () => {
      calls += 1;
      return stubResponse(statuses[calls - 1]);
    },
    wait: recordingWait(waits),
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 3000]);
});

test('persistent 403s fail with the attempt count once retries are exhausted', async () => {
  const waits = [];
  let calls = 0;

  await assert.rejects(
    () => fetchFiaResource('https://fia.test/documents', {
      label: 'FIA documents page',
      fetchImpl: async () => {
        calls += 1;
        return stubResponse(403);
      },
      wait: recordingWait(waits),
    }),
    (error) => {
      assert.match(error.message, /FIA documents page unavailable: 403 \(after 4 attempts\)/);
      assert.equal(error.status, 403);
      assert.equal(error.attempts, 4);
      return true;
    },
  );

  assert.equal(calls, 4);
  assert.deepEqual(waits, [1500, 3000, 6000]);
});

test('non-retryable statuses fail on the first response', async () => {
  let calls = 0;

  await assert.rejects(
    () => fetchFiaResource('https://fia.test/missing.pdf', {
      label: 'FIA PDF https://fia.test/missing.pdf',
      fetchImpl: async () => {
        calls += 1;
        return stubResponse(404);
      },
      wait: async () => assert.fail('non-retryable statuses must not back off'),
    }),
    /FIA PDF https:\/\/fia\.test\/missing\.pdf unavailable: 404$/,
  );

  assert.equal(calls, 1);
});

test('network errors are retried and surface their reason when they persist', async () => {
  const waits = [];
  let calls = 0;

  await assert.rejects(
    () => fetchFiaResource('https://fia.test/documents', {
      label: 'FIA documents page',
      attempts: 2,
      fetchImpl: async () => {
        calls += 1;
        throw new Error('socket hang up');
      },
      wait: recordingWait(waits),
    }),
    /FIA documents page unavailable: socket hang up \(after 2 attempts\)/,
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [1500]);
});

test('requests identify as a browser so the FIA bot filter serves the document list', async () => {
  let seenHeaders = null;

  await fetchFiaResource('https://fia.test/documents', {
    fetchImpl: async (_url, init) => {
      seenHeaders = init.headers;
      return stubResponse(200);
    },
  });

  assert.match(seenHeaders['User-Agent'], /^Mozilla\/5\.0 \(.+\) AppleWebKit/);
  assert.equal(seenHeaders['Accept-Language'], 'en-US,en;q=0.9');
});

test('retryable statuses cover the bot filter and transient server failures', () => {
  for (const status of [403, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true, `${status} should be retried`);
  }
  for (const status of [400, 401, 404, 410]) {
    assert.equal(isRetryableStatus(status), false, `${status} should not be retried`);
  }
});
