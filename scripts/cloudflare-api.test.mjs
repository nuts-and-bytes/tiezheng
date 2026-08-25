import assert from 'node:assert/strict';

let testModule;
try {
  testModule = await import('vitest');
} catch {
  testModule = await import('node:test');
}
const { test } = testModule;

import { createCloudflareClient } from './cloudflare-api.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const API_TOKEN = 'private-token';
const FAILURE_MESSAGE = 'Cloudflare request failed';
const MAX_RESPONSE_BYTES = 1_048_576;

function successResponse(result = { id: 'safe-id' }, init = {}) {
  return new Response(JSON.stringify({ success: true, result }), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

async function expectFixedFailure(action, forbiddenValues = []) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, FAILURE_MESSAGE);
    assert.equal(String(error), `Error: ${FAILURE_MESSAGE}`);
    for (const forbiddenValue of forbiddenValues) {
      if (forbiddenValue.length === 0) {
        continue;
      }
      assert.equal(String(error).includes(forbiddenValue), false);
    }
    return true;
  });
}

test('returns only a successful result and sends the token only in authorization', async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    calls += 1;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/tiezheng`);
    assert.equal(url.includes(API_TOKEN), false);
    assert.deepEqual(init, {
      method: 'GET',
      headers: { authorization: `Bearer ${API_TOKEN}` },
      body: undefined,
    });
    return successResponse();
  };

  const client = createCloudflareClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher });

  assert.deepEqual(await client.get('/pages/projects/tiezheng'), { id: 'safe-id' });
  assert.equal(calls, 1);
});

test('exposes only fixed HTTP verbs with the expected request shapes', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return successResponse({ call: calls.length });
  };
  const client = createCloudflareClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher });

  assert.deepEqual(Object.keys(client).sort(), ['delete', 'get', 'patch', 'post', 'put']);
  assert.deepEqual(await client.get('/workers/scripts/example'), { call: 1 });
  assert.deepEqual(await client.post('/access/apps', { name: 'preview' }), { call: 2 });
  assert.deepEqual(await client.put('/pages/projects/tiezheng', { enabled: true }), { call: 3 });
  assert.deepEqual(await client.patch('/workers/scripts/example/settings', { bindings: [] }), { call: 4 });
  assert.deepEqual(await client.delete('/access/apps/abc123'), { call: 5 });

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
  assert.deepEqual(calls, [
    {
      url: `${baseUrl}/workers/scripts/example`,
      init: {
        method: 'GET',
        headers: { authorization: `Bearer ${API_TOKEN}` },
        body: undefined,
      },
    },
    {
      url: `${baseUrl}/access/apps`,
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: '{"name":"preview"}',
      },
    },
    {
      url: `${baseUrl}/pages/projects/tiezheng`,
      init: {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: '{"enabled":true}',
      },
    },
    {
      url: `${baseUrl}/workers/scripts/example/settings`,
      init: {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: '{"bindings":[]}',
      },
    },
    {
      url: `${baseUrl}/access/apps/abc123`,
      init: {
        method: 'DELETE',
        headers: { authorization: `Bearer ${API_TOKEN}` },
        body: undefined,
      },
    },
  ]);
});

test('rejects invalid account identifiers, secrets, and fetchers with one fixed error', () => {
  const invalidInputs = [
    { accountId: '', apiToken: API_TOKEN, fetcher: async () => successResponse() },
    { accountId: 'a'.repeat(31), apiToken: API_TOKEN, fetcher: async () => successResponse() },
    { accountId: 'a'.repeat(33), apiToken: API_TOKEN, fetcher: async () => successResponse() },
    { accountId: 'A'.repeat(32), apiToken: API_TOKEN, fetcher: async () => successResponse() },
    { accountId: `${'a'.repeat(31)}g`, apiToken: API_TOKEN, fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: '', fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: '   ', fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: 'token\nvalue', fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: 'x'.repeat(4_097), fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: 123, fetcher: async () => successResponse() },
    { accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher: null },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => createCloudflareClient(input),
      (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
    );
  }
});

test('rejects non-primitive account identifiers without coercion or fetch', () => {
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return successResponse();
  };
  const candidates = [
    () => {
      let calls = 0;
      return {
        accountId: {
          toString() {
            calls += 1;
            return calls === 1 ? ACCOUNT_ID : 'ID/../../zones';
          },
        },
        coercions: () => calls,
      };
    },
    () => {
      let calls = 0;
      const accountId = new String(ACCOUNT_ID);
      accountId.toString = () => {
        calls += 1;
        return ACCOUNT_ID;
      };
      return { accountId, coercions: () => calls };
    },
    () => {
      let calls = 0;
      return {
        accountId: {
          toString() {
            calls += 1;
            return '[object Object]';
          },
        },
        coercions: () => calls,
      };
    },
  ];

  for (const createCandidate of candidates) {
    const candidate = createCandidate();
    assert.throws(
      () => createCloudflareClient({ accountId: candidate.accountId, apiToken: API_TOKEN, fetcher }),
      (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
    );
    assert.equal(candidate.coercions(), 0);
  }
  assert.equal(fetchCalls, 0);
});

test('rejects paths that could escape or alter the fixed account scope before fetch', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return successResponse();
  };
  const client = createCloudflareClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher });
  const invalidPaths = [
    '',
    '/',
    'pages/projects/tiezheng',
    '../pages/projects/tiezheng',
    '/pages/../zones',
    '/pages/./projects',
    '/pages//projects',
    '/%2e%2e/zones',
    '/%252e%252e/zones',
    '/pages/projects?name=tiezheng',
    '/pages/projects#fragment',
    'https://api.cloudflare.com/client/v4/zones',
    '//example.com/zones',
    '/pages\\projects',
    '/pages/projects\nnext',
    '/pages/projects\0next',
    42,
  ];

  for (const path of invalidPaths) {
    await expectFixedFailure(() => client.get(path), [String(path), API_TOKEN]);
  }
  assert.equal(calls, 0);
});

test('hides JSON serialization failures and never calls fetch', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return successResponse();
  };
  const client = createCloudflareClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher });
  const circularBody = { safe: true };
  circularBody.self = circularBody;
  const throwingBody = {};
  Object.defineProperty(throwingBody, 'secret', {
    enumerable: true,
    get() {
      throw new Error('sensitive getter failure');
    },
  });

  await expectFixedFailure(() => client.post('/access/apps', circularBody), [API_TOKEN]);
  await expectFixedFailure(() => client.put('/access/apps/example', { value: 1n }), [API_TOKEN]);
  await expectFixedFailure(() => client.patch('/access/apps/example', throwingBody), [
    API_TOKEN,
    'sensitive getter failure',
  ]);
  assert.equal(calls, 0);
});

test('accepts a response exactly at the byte limit and split across chunks', async () => {
  const prefix = '{"success":true,"result":{"value":"';
  const suffix = '"}}';
  const payload = `${prefix}${'a'.repeat(MAX_RESPONSE_BYTES - prefix.length - suffix.length)}${suffix}`;
  assert.equal(Buffer.byteLength(payload), MAX_RESPONSE_BYTES);
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 333_333));
      controller.enqueue(bytes.subarray(333_333, 777_777));
      controller.enqueue(bytes.subarray(777_777));
      controller.close();
    },
  });
  const client = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => new Response(stream),
  });

  const result = await client.get('/pages/projects/tiezheng');
  assert.equal(result.value.length, MAX_RESPONSE_BYTES - prefix.length - suffix.length);
});

test('rejects cumulative cross-chunk overflow despite a lying content-length and cancels the reader', async () => {
  let reads = 0;
  let cancels = 0;
  let releases = 0;
  const chunks = [new Uint8Array(700_000), new Uint8Array(348_577)];
  const reader = {
    async read() {
      const value = chunks[reads];
      reads += 1;
      return value ? { done: false, value } : { done: true, value: undefined };
    },
    async cancel() {
      cancels += 1;
    },
    releaseLock() {
      releases += 1;
    },
  };
  const response = {
    ok: true,
    headers: new Headers({ 'content-length': '1' }),
    body: { getReader: () => reader },
  };
  const client = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => response,
  });

  await expectFixedFailure(() => client.get('/pages/projects/tiezheng'), [API_TOKEN]);
  assert.equal(reads, 2);
  assert.equal(cancels, 1);
  assert.equal(releases, 1);
});

test('uses fatal UTF-8 decoding and rejects invalid bytes', async () => {
  const client = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => new Response(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])),
  });

  await expectFixedFailure(() => client.get('/pages/projects/tiezheng'), [API_TOKEN]);
});

test('rejects malformed JSON, failed APIs, non-ok responses, and invalid envelopes', async () => {
  const cases = [
    async () => new Response('<html>sensitive upstream page</html>'),
    async () => new Response('{"success":true,"result":{}} trailing'),
    async () => new Response(JSON.stringify({ success: false, result: {}, errors: [{ message: 'private API error' }] })),
    async () => new Response(JSON.stringify({ success: true })),
    async () => new Response(JSON.stringify([])),
    async () => new Response(JSON.stringify(null)),
    async () => new Response(JSON.stringify('not-an-envelope')),
    async () => successResponse({ safe: true }, { status: 503 }),
  ];

  for (const fetcher of cases) {
    const client = createCloudflareClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetcher });
    await expectFixedFailure(() => client.get('/pages/projects/tiezheng'), [
      API_TOKEN,
      'sensitive upstream page',
      'private API error',
    ]);
  }
});

test('hides fetch and reader failures, cancels failed reads, and releases reader locks', async () => {
  const fetchClient = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => {
      throw new Error('secret fetch failure');
    },
  });
  await expectFixedFailure(() => fetchClient.get('/pages/projects/tiezheng'), [
    API_TOKEN,
    'secret fetch failure',
  ]);

  let cancels = 0;
  let releases = 0;
  const reader = {
    async read() {
      throw new Error('secret reader failure');
    },
    async cancel() {
      cancels += 1;
    },
    releaseLock() {
      releases += 1;
    },
  };
  const readClient = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => ({ ok: true, body: { getReader: () => reader } }),
  });
  await expectFixedFailure(() => readClient.get('/pages/projects/tiezheng'), [
    API_TOKEN,
    'secret reader failure',
  ]);
  assert.equal(cancels, 1);
  assert.equal(releases, 1);
});

test('releases the reader lock after a successful response', async () => {
  const bytes = new TextEncoder().encode('{"success":true,"result":{"id":"safe-id"}}');
  let reads = 0;
  let releases = 0;
  const reader = {
    async read() {
      reads += 1;
      return reads === 1 ? { done: false, value: bytes } : { done: true, value: undefined };
    },
    async cancel() {
      assert.fail('a completely consumed successful response must not be cancelled');
    },
    releaseLock() {
      releases += 1;
    },
  };
  const client = createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetcher: async () => ({ ok: true, body: { getReader: () => reader } }),
  });

  assert.deepEqual(await client.get('/pages/projects/tiezheng'), { id: 'safe-id' });
  assert.equal(releases, 1);
});
