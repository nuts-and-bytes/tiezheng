import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';
import {
  createSetupServiceToken,
  deleteSetupServiceToken,
  inspectCloudflareSetup,
} from './text-ai-preview-setup-cloudflare.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const TOKEN_ID = 'token-1';
const PERMISSIONS = [
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
  'Access: Apps and Policies Edit',
  'Access: Organizations, Identity Providers, and Groups Read',
  'Access: Service Tokens Read',
  'Access: Service Tokens Write',
];
const FAILURE = 'Text preview setup failed';
const BLOCKED = 'Text preview setup blocked: cloudflare.service-token';

function tokenFixture(missing = []) {
  const catalog = PERMISSIONS.map((name, index) => ({
    id: `permission-${index}`,
    name,
    scopes: ['com.cloudflare.api.account'],
  }));
  const groups = catalog
    .filter(({ name }) => !missing.includes(name))
    .map(({ id, name }) => ({ id, name }));
  return [
    { id: TOKEN_ID, status: 'active' },
    {
      id: TOKEN_ID,
      status: 'active',
      policies: [{
        effect: 'allow',
        resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
        permission_groups: groups,
      }],
    },
    catalog,
  ];
}

function fakeClient(routes = {}) {
  const calls = [];
  const client = {
    async get(path) {
      calls.push({ method: 'GET', path });
      const route = routes[`GET ${path}`];
      if (route instanceof Error) throw route;
      if (typeof route === 'function') return route();
      return route;
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      const route = routes[`POST ${path}`];
      if (route instanceof Error) throw route;
      if (typeof route === 'function') return route(body);
      return route;
    },
    async delete(path) {
      calls.push({ method: 'DELETE', path });
      const route = routes[`DELETE ${path}`];
      if (route instanceof Error) throw route;
      if (typeof route === 'function') return route();
      return route;
    },
  };
  return { client, calls };
}

function setupRoutes({ missing = [], organization = { auth_domain: 'preview.cloudflareaccess.com' }, inventory = [] } = {}) {
  const [verify, details, catalog] = tokenFixture(missing);
  return {
    'GET /tokens/verify': verify,
    [`GET /tokens/${TOKEN_ID}`]: details,
    'GET /tokens/permission_groups': catalog,
    'GET /access/organizations': organization,
    'GET /access/service_tokens': inventory,
  };
}

function validCreated(overrides = {}) {
  return {
    id: 'service-token-1',
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
    client_id: 'abcd1234.access',
    client_secret: 'secret-value',
    ...overrides,
  };
}

function withExtraFields(value, count = 65) {
  const result = { ...value };
  for (let index = 0; index < count; index += 1) {
    result[`extra_${index}`] = `value-${index}`;
  }
  return result;
}

async function assertFailure(action, message = FAILURE, forbidden = []) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, message);
    for (const value of forbidden) assert.equal(error.message.includes(value), false);
    return true;
  });
}

test('inspect uses five GETs in order, returns frozen team slug, and create/delete use exact write shapes', async () => {
  const { client, calls } = fakeClient({
    ...setupRoutes(),
    'POST /access/service_tokens': validCreated(),
    'DELETE /access/service_tokens/service-token-1': {},
  });
  const inspected = await inspectCloudflareSetup(ACCOUNT_ID, client);
  assert.deepEqual(inspected, { status: 'ready', teamDomain: 'preview' });
  assert.equal(Object.isFrozen(inspected), true);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
    'GET /access/organizations',
    'GET /access/service_tokens',
  ]);

  const created = await createSetupServiceToken(client);
  assert.deepEqual(created, {
    id: 'service-token-1',
    clientId: 'abcd1234.access',
    clientSecret: 'secret-value',
  });
  assert.equal(Object.isFrozen(created), true);
  await deleteSetupServiceToken(client, created.id);
  assert.deepEqual(calls.slice(-2), [
    {
      method: 'POST',
      path: '/access/service_tokens',
      body: {
        name: SETUP_POLICY.serviceTokenName,
        duration: SETUP_POLICY.serviceTokenDuration,
        enabled: true,
      },
    },
    { method: 'DELETE', path: '/access/service_tokens/service-token-1' },
  ]);
});

test('inspect returns only canonical missing permissions and stops after token verification', async () => {
  const missing = [
    'Access: Service Tokens Read',
    'Access: Service Tokens Write',
  ];
  const { client, calls } = fakeClient(setupRoutes({ missing }));
  const result = await inspectCloudflareSetup(ACCOUNT_ID, client);
  assert.deepEqual(result, { status: 'missing-permissions', missingPermissions: missing });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.missingPermissions), true);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
  ]);
});

test('inspect rejects existing fixed-name token before any write', async () => {
  const { client, calls } = fakeClient(setupRoutes({
    inventory: [{ id: 'existing', name: SETUP_POLICY.serviceTokenName }],
  }));
  await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, client));
  assert.equal(calls.some(({ method }) => method !== 'GET'), false);
});

test('inspect fails closed for malformed organization and inventory shapes', async () => {
  for (const organization of [
    { auth_domain: 'Preview.cloudflareaccess.com' },
    { auth_domain: 'https://preview.cloudflareaccess.com' },
    { auth_domain: 'preview.example.com' },
    Object.defineProperty({}, 'auth_domain', { get: () => 'preview.cloudflareaccess.com' }),
  ]) {
    const { client, calls } = fakeClient(setupRoutes({ organization }));
    await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, client));
    assert.equal(calls.some(({ method }) => method !== 'GET'), false);
  }
  for (const inventory of [
    { 0: { name: 'other' }, length: 1 },
    Object.assign([], [, { name: 'other' }]),
    Object.defineProperty([{ name: 'other' }], '0', { get: () => ({ name: 'other' }) }),
    Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: 'other' })),
  ]) {
    const { client, calls } = fakeClient(setupRoutes({ inventory }));
    await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, client));
    assert.equal(calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('inspect requires every inventory item to own a primitive name without invoking accessors', async () => {
  let getterReads = 0;
  const accessorItem = {};
  Object.defineProperty(accessorItem, 'name', {
    get() {
      getterReads += 1;
      return 'other-token';
    },
  });
  const hostileItem = Object.create({ inherited: true });
  Object.defineProperty(hostileItem, 'name', {
    value: 'other-token',
    enumerable: true,
  });
  const symbolItem = { name: 'other-token', [Symbol('sentinel')]: true };
  for (const inventory of [
    [{ id: 'missing-name' }],
    [symbolItem],
    [hostileItem],
    [accessorItem],
    Object.assign([], [, { name: 'other-token' }]),
  ]) {
    const { client, calls } = fakeClient(setupRoutes({ inventory }));
    await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, client));
    assert.equal(calls.some(({ method }) => method !== 'GET'), false);
  }
  assert.equal(getterReads, 0);
});

test('create succeeds only for exact primitive fields and freezes the redacted result', async () => {
  const { client } = fakeClient({ 'POST /access/service_tokens': validCreated() });
  const result = await createSetupServiceToken(client);
  assert.deepEqual(result, {
    id: 'service-token-1',
    clientId: 'abcd1234.access',
    clientSecret: 'secret-value',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal('name' in result, false);
});

test('create accepts the official response shape without enabled while still requesting enabled true', async () => {
  const response = validCreated();
  delete response.enabled;
  const { client, calls } = fakeClient({ 'POST /access/service_tokens': response });

  const result = await createSetupServiceToken(client);

  assert.deepEqual(result, {
    id: 'service-token-1',
    clientId: 'abcd1234.access',
    clientSecret: 'secret-value',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(calls, [{
    method: 'POST',
    path: '/access/service_tokens',
    body: {
      name: SETUP_POLICY.serviceTokenName,
      duration: SETUP_POLICY.serviceTokenDuration,
      enabled: true,
    },
  }]);
});

test('create rejects explicit false enabled and compensates the observed token id', async () => {
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': validCreated({ enabled: false }),
    'DELETE /access/service_tokens/service-token-1': {},
  });

  await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'DELETE /access/service_tokens/service-token-1',
  ]);
});

test('create rejects a proxy that hides its real false enabled key and deletes the observed id once', async () => {
  const target = validCreated({ enabled: false });
  const response = new Proxy(target, {
    ownKeys(value) {
      return Reflect.ownKeys(value).filter((key) => key !== 'enabled');
    },
  });
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': response,
    'DELETE /access/service_tokens/service-token-1': {},
  });

  await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'DELETE /access/service_tokens/service-token-1',
  ]);
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('create rejects a proxy that hides false enabled from both descriptor and key snapshots', async () => {
  const target = validCreated({ enabled: false });
  const response = new Proxy(target, {
    getOwnPropertyDescriptor(value, key) {
      if (key === 'enabled') return undefined;
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
    ownKeys(value) {
      return Reflect.ownKeys(value).filter((key) => key !== 'enabled');
    },
  });
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': response,
    'DELETE /access/service_tokens/service-token-1': {},
  });

  await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'DELETE /access/service_tokens/service-token-1',
  ]);
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('create uses captured Map intrinsics after a response trap pollutes Map.prototype', { concurrency: false }, async () => {
  const originalDescriptors = Object.getOwnPropertyDescriptors(Map.prototype);
  let polluted = false;
  const originalGet = originalDescriptors.get.value;
  const originalHas = originalDescriptors.has.value;
  const originalSet = originalDescriptors.set.value;
  const response = new Proxy(validCreated({ enabled: false }), {
    ownKeys(value) {
      polluted = true;
      Object.defineProperties(Map.prototype, {
        get: {
          ...originalDescriptors.get,
          value(key) {
            return Reflect.apply(originalGet, this, [key]);
          },
        },
        has: {
          ...originalDescriptors.has,
          value(key) {
            return Reflect.apply(originalHas, this, [key]);
          },
        },
        set: {
          ...originalDescriptors.set,
          value(key, valueToStore) {
            return Reflect.apply(originalSet, this, [key, key === 'enabled' ? true : valueToStore]);
          },
        },
      });
      return Reflect.ownKeys(value);
    },
  });
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': response,
    'DELETE /access/service_tokens/service-token-1': {},
  });

  let error;
  try {
    await createSetupServiceToken(client);
  } catch (caught) {
    error = caught;
  } finally {
    Object.defineProperties(Map.prototype, {
      get: originalDescriptors.get,
      has: originalDescriptors.has,
      set: originalDescriptors.set,
    });
  }

  assert.equal(polluted, true);
  assert.equal(error?.constructor, Error);
  assert.equal(error.message, FAILURE);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'DELETE /access/service_tokens/service-token-1',
  ]);
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('reserved ids are rejected without direct delete or malformed-response delete', async () => {
  const reserved = ['.', '..', '__proto__', 'constructor', 'prototype'];
  let directDeleteCalls = 0;
  const direct = fakeClient({
    'DELETE /access/service_tokens/constructor': () => { directDeleteCalls += 1; },
  });
  for (const id of reserved) {
    await assertFailure(() => deleteSetupServiceToken(direct.client, id));
  }
  assert.equal(directDeleteCalls, 0);
  for (const id of reserved) {
    const { client, calls } = fakeClient({
      'POST /access/service_tokens': validCreated({ id }),
      'GET /access/service_tokens': [{ id: 'other', name: 'other-token' }],
    });
    await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
    assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
      'POST /access/service_tokens',
      'GET /access/service_tokens',
    ]);
  }
});

test('inventory requires unique strict ids and normalized nonempty names', async () => {
  const invalidInventories = [
    [{ name: 'other-token' }],
    [{ id: '.', name: 'other-token' }],
    [{ id: 'valid-id', name: '' }],
    [{ id: 'valid-id', name: ' other-token' }],
    [{ id: 'valid-id', name: 'other-token ' }],
    [{ id: 'valid-id', name: 'other\u0000token' }],
    [{ id: 'valid-id', name: new String('other-token') }],
    [{ id: 'valid-id', name: 'other-token' }, { id: 'valid-id', name: 'another-token' }],
  ];
  for (const inventory of invalidInventories) {
    const inspectClient = fakeClient(setupRoutes({ inventory }));
    await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, inspectClient.client));
    assert.equal(inspectClient.calls.some(({ method }) => method !== 'GET'), false);

    const createClient = fakeClient({
      'POST /access/service_tokens': validCreated({ id: undefined }),
      'GET /access/service_tokens': inventory,
    });
    await assertFailure(() => createSetupServiceToken(createClient.client), BLOCKED, ['secret-value']);
    assert.equal(createClient.calls.filter(({ method }) => method === 'DELETE').length, 0);
  }
});

test('POST body is frozen and mutation attempts cannot change its exact primitive shape', async () => {
  const expected = {
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
  };
  let bodySeen;
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': (body) => {
      bodySeen = body;
      assert.equal(Object.isFrozen(body), true);
      for (const mutation of [
        () => { body.name = 'tampered'; },
        () => { delete body.enabled; },
        () => { body.extra = 'tampered'; },
      ]) {
        assert.throws(mutation, TypeError);
      }
      assert.deepEqual(body, expected);
      throw new Error('sentinel-secret');
    },
    'GET /access/service_tokens': [{ id: 'other', name: 'other-token' }],
  });
  await assertFailure(() => createSetupServiceToken(client), FAILURE, ['sentinel-secret']);
  assert.equal(Object.isFrozen(bodySeen), true);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'GET /access/service_tokens',
  ]);
});

test('create compensates a safely observed id with one delete, then hides the failure', async () => {
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': validCreated({ client_id: 'bad id' }),
    'DELETE /access/service_tokens/service-token-1': {},
  });
  await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
  assert.deepEqual(calls, [
    {
      method: 'POST',
      path: '/access/service_tokens',
      body: {
        name: SETUP_POLICY.serviceTokenName,
        duration: SETUP_POLICY.serviceTokenDuration,
        enabled: true,
      },
    },
    { method: 'DELETE', path: '/access/service_tokens/service-token-1' },
  ]);
});

test('create blocks when id compensation fails', async () => {
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': validCreated({ enabled: false }),
    'DELETE /access/service_tokens/service-token-1': new Error('sentinel-secret'),
  });
  await assertFailure(() => createSetupServiceToken(client), BLOCKED, ['sentinel-secret', 'secret-value']);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('create inventories after unknown id and fails normally only when absence is reliable', async () => {
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': validCreated({ id: undefined }),
    'GET /access/service_tokens': [{ id: 'other', name: 'other-token' }],
  });
  await assertFailure(() => createSetupServiceToken(client));
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'GET /access/service_tokens',
  ]);
});

test('create blocks after unknown id when inventory is unreliable or fixed name exists', async () => {
  for (const inventory of [
    Object.assign([], [, { id: 'other', name: 'other-token' }]),
    Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: 'other-token' })),
    [{ id: 'fixed', name: SETUP_POLICY.serviceTokenName }],
  ]) {
    const { client, calls } = fakeClient({
      'POST /access/service_tokens': validCreated({ id: {} }),
      'GET /access/service_tokens': inventory,
    });
    await assertFailure(() => createSetupServiceToken(client), BLOCKED, ['secret-value']);
    assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 0);
  }
});

test('unknown-id compensation blocks for nameless, symbol, or hostile inventory items without writes', async () => {
  const hostileItem = Object.create({ inherited: true });
  Object.defineProperty(hostileItem, 'name', { value: 'other-token', enumerable: true });
  const symbolItem = { name: 'other-token', [Symbol('sentinel')]: true };
  for (const inventory of [
    [{ id: 'missing-name' }],
    [symbolItem],
    [hostileItem],
  ]) {
    const { client, calls } = fakeClient({
      'POST /access/service_tokens': validCreated({ id: undefined }),
      'GET /access/service_tokens': inventory,
    });
    await assertFailure(() => createSetupServiceToken(client), BLOCKED, ['secret-value']);
    assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 0);
  }
});

test('malformed create responses use inventory for unknown ids and delete safely observed ids', async () => {
  let getterReads = 0;
  const accessorId = validCreated();
  Object.defineProperty(accessorId, 'id', {
    get() {
      getterReads += 1;
      return 'service-token-1';
    },
  });
  const unknownIdCases = [null, 'not-a-record', accessorId];
  for (const response of unknownIdCases) {
    const { client, calls } = fakeClient({
      'POST /access/service_tokens': response,
      'GET /access/service_tokens': [{ id: 'other', name: 'other-token' }],
    });
    await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 0);
  }
  assert.equal(getterReads, 0);

  const symbolResponse = validCreated();
  symbolResponse[Symbol('sentinel')] = true;
  const hostileResponse = Object.assign(Object.create({ inherited: true }), validCreated());
  let accessorReads = 0;
  const fieldAccessorResponse = validCreated();
  Object.defineProperty(fieldAccessorResponse, 'duration', {
    get() {
      accessorReads += 1;
      return SETUP_POLICY.serviceTokenDuration;
    },
  });
  for (const response of [symbolResponse, hostileResponse, fieldAccessorResponse]) {
    const { client, calls } = fakeClient({
      'POST /access/service_tokens': response,
      'DELETE /access/service_tokens/service-token-1': {},
    });
    await assertFailure(() => createSetupServiceToken(client), FAILURE, ['secret-value']);
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
  }
  assert.equal(accessorReads, 0);
});

test('malformed response with observed id still blocks when delete compensation fails', async () => {
  const response = validCreated({ enabled: false });
  const { client, calls } = fakeClient({
    'POST /access/service_tokens': response,
    'DELETE /access/service_tokens/service-token-1': new Error('sentinel-secret'),
  });
  await assertFailure(() => createSetupServiceToken(client), BLOCKED, ['sentinel-secret', 'secret-value']);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'POST /access/service_tokens',
    'DELETE /access/service_tokens/service-token-1',
  ]);
});

test('organization and inventory records over the own-key budget fail before descriptor traversal', async () => {
  const organization = withExtraFields({ auth_domain: 'preview.cloudflareaccess.com' });
  const inspectOrganization = fakeClient(setupRoutes({ organization }));
  await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, inspectOrganization.client));
  assert.equal(inspectOrganization.calls.some(({ method }) => method !== 'GET'), false);

  const inventory = [{ ...withExtraFields({ id: 'other-id', name: 'other-token' }) }];
  const inspectInventory = fakeClient(setupRoutes({ inventory }));
  await assertFailure(() => inspectCloudflareSetup(ACCOUNT_ID, inspectInventory.client));
  assert.equal(inspectInventory.calls.some(({ method }) => method !== 'GET'), false);
});

test('oversized create responses snapshot only id and enabled before enforcing the key budget', async () => {
  let safeIdDescriptorReads = 0;
  const oversizedWithId = new Proxy(withExtraFields(validCreated()), {
    getOwnPropertyDescriptor(target, key) {
      safeIdDescriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const safeIdClient = fakeClient({
    'POST /access/service_tokens': oversizedWithId,
    'DELETE /access/service_tokens/service-token-1': {},
  });
  await assertFailure(() => createSetupServiceToken(safeIdClient.client), FAILURE, ['secret-value']);
  assert.equal(safeIdClient.calls.filter(({ method }) => method === 'DELETE').length, 1);
  assert.equal(safeIdDescriptorReads, 2);

  let accessorDescriptorReads = 0;
  const oversizedAccessorId = withExtraFields(validCreated());
  Object.defineProperty(oversizedAccessorId, 'id', {
    get() {
      throw new Error('id getter sentinel');
    },
  });
  const accessorClient = fakeClient({
    'POST /access/service_tokens': new Proxy(oversizedAccessorId, {
      getOwnPropertyDescriptor(target, key) {
        accessorDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }),
    'GET /access/service_tokens': [{ id: 'other-id', name: 'other-token' }],
  });
  await assertFailure(() => createSetupServiceToken(accessorClient.client), FAILURE, ['id getter sentinel']);
  assert.equal(accessorClient.calls.filter(({ method }) => method === 'DELETE').length, 0);
  assert.equal(accessorDescriptorReads, 2);
});

test('delete validates strict primitive id before calling client and hides failures', async () => {
  let calls = 0;
  const { client } = fakeClient({ 'DELETE /access/service_tokens/valid-id': () => { calls += 1; } });
  for (const id of ['', 'bad/id', {}, new String('valid-id'), undefined]) {
    await assertFailure(() => deleteSetupServiceToken(client, id));
  }
  assert.equal(calls, 0);
  await deleteSetupServiceToken(client, 'valid-id');
  assert.equal(calls, 1);
  const failing = fakeClient({ 'DELETE /access/service_tokens/valid-id': new Error('secret') });
  await assertFailure(() => deleteSetupServiceToken(failing.client, 'valid-id'), FAILURE, ['secret']);
});
