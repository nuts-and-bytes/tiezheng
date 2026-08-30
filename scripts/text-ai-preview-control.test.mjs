import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { signTextAdminRequest } from './text-ai-admin-signature.mjs';
import {
  invokeTextPreviewAdmin,
  loadTextPreviewConfig,
  parseRedactedAdminResponse,
  preflightTextPreview,
  reconcileTextPreview,
  runTextPreviewControlCli,
  TEXT_PREVIEW_SETUP_PERMISSION_NAMES,
  TEXT_PREVIEW_TOKEN_PERMISSION_NAMES,
  verifyTextPreviewSetupToken,
} from './text-ai-preview-control.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const TOKEN_ID = 'token-id';
const WORKER_NAME = 'tiezheng-photo-ai-gateway';
const PREVIEW_ORIGIN = 'https://text-ai-preview.tiezheng.pages.dev';
const OPERATION_ID = '1'.repeat(32);
const NOW = 1_777_777_777_000;
const PERMISSIONS = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
]);
const ENV_NAMES = Object.freeze([
  'PHOTO_AI_ALLOWED_ORIGINS',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  'TEXT_AI_SESSION_SIGNING_KEY',
  'TEXT_AI_RATE_LIMIT_HMAC_KEY',
  'TEXT_AI_ADMIN_SIGNING_KEY',
]);

function key(byte) {
  return Buffer.alloc(32, byte).toString('base64url');
}

const SENSITIVE = Object.freeze({
  apiToken: 'private-cf-token-value',
  arkKey: 'private-ark-key-value',
  cacheKey: key(6),
  accountHmacKey: '0123456789abcdef0123456789abcdef',
  user1Pepper: key(1),
  user1Digest: '1'.repeat(64),
  user2Pepper: key(5),
  user2Digest: '2'.repeat(64),
  sessionKey: key(2),
  rateLimitKey: key(3),
  adminKey: key(4),
});

function validEnv(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: SENSITIVE.apiToken,
    ARK_API_KEY: SENSITIVE.arkKey,
    PHOTO_AI_CACHE_AES_KEY: SENSITIVE.cacheKey,
    PHOTO_AI_ACCOUNT_HMAC_KEY: SENSITIVE.accountHmacKey,
    TEXT_AI_USER_1_ACCESS_CODE_PEPPER: SENSITIVE.user1Pepper,
    TEXT_AI_USER_1_ACCESS_CODE_DIGEST: SENSITIVE.user1Digest,
    TEXT_AI_USER_2_ACCESS_CODE_PEPPER: SENSITIVE.user2Pepper,
    TEXT_AI_USER_2_ACCESS_CODE_DIGEST: SENSITIVE.user2Digest,
    TEXT_AI_SESSION_SIGNING_KEY: SENSITIVE.sessionKey,
    TEXT_AI_RATE_LIMIT_HMAC_KEY: SENSITIVE.rateLimitKey,
    TEXT_AI_ADMIN_SIGNING_KEY: SENSITIVE.adminKey,
    ...overrides,
  };
}

function expectFixedFailure(action) {
  assert.throws(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, 'Text preview control failed');
    for (const value of Object.values(SENSITIVE)) {
      assert.equal(String(error).includes(value), false);
    }
    return true;
  });
}

async function expectFixedRejection(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, 'Text preview control failed');
    for (const value of Object.values(SENSITIVE)) {
      assert.equal(String(error).includes(value), false);
    }
    return true;
  });
}

function tokenPermissionFixtures(permissionNames = PERMISSIONS) {
  const permissionGroups = permissionNames.map((name, index) => ({
    id: `permission-${index + 1}`,
    name,
    scopes: ['com.cloudflare.api.account'],
  }));
  return {
    verification: { id: TOKEN_ID, status: 'active' },
    details: {
      id: TOKEN_ID,
      status: 'active',
      policies: [{
        effect: 'allow',
        resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
        permission_groups: permissionGroups.map(({ id, name }) => ({ id, name })),
      }],
    },
    permissionGroups,
  };
}

function setupTokenClient(fixtures) {
  return createFakeClient(new Map([
    ['GET /tokens/verify', [fixtures.verification]],
    [`GET /tokens/${TOKEN_ID}`, [fixtures.details]],
    ['GET /tokens/permission_groups', [fixtures.permissionGroups]],
  ]));
}

function workerSettings(text = 'false') {
  return {
    bindings: [
      { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
      { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text },
    ],
  };
}

function pagesProject(preview = { env_vars: {}, services: {} }) {
  return {
    id: 'pages-project-id',
    name: 'tiezheng',
    production_branch: 'main',
    deployment_configs: {
      production: {
        env_vars: { PRODUCTION_SENTINEL: { type: 'plain_text', value: 'keep' } },
      },
      preview,
    },
  };
}

function preflightRoutes({ project = pagesProject(), permissions = PERMISSIONS } = {}) {
  const fixtures = tokenPermissionFixtures(permissions);
  return new Map([
    ['GET /tokens/verify', [fixtures.verification]],
    [`GET /tokens/${TOKEN_ID}`, [fixtures.details]],
    ['GET /tokens/permission_groups', [fixtures.permissionGroups]],
    ['GET /pages/projects/tiezheng', [project]],
    ['GET /workers/scripts', [[{ id: WORKER_NAME }]]],
    [`GET /workers/scripts/${WORKER_NAME}/settings`, [workerSettings()]],
  ]);
}

function createFakeClient(routes) {
  const queues = new Map(
    [...routes].map(([route, values]) => [route, Array.isArray(values) ? [...values] : [values]]),
  );
  const calls = [];
  const invoke = async (method, path, body) => {
    calls.push({ method, path, body });
    const queue = queues.get(`${method} ${path}`);
    if (queue === undefined || queue.length === 0) throw new Error(`unexpected ${method} ${path}`);
    const value = queue.shift();
    return typeof value === 'function' ? value({ method, path, body, calls }) : structuredClone(value);
  };
  return {
    calls,
    client: Object.freeze({
      get: (path) => invoke('GET', path),
      post: (path, body) => invoke('POST', path, body),
      put: (path, body) => invoke('PUT', path, body),
      patch: (path, body) => invoke('PATCH', path, body),
      delete: (path) => invoke('DELETE', path),
    }),
  };
}

function addRoute(routes, route, ...values) {
  const current = routes.get(route) ?? [];
  routes.set(route, [...current, ...values]);
}

function adminSuccess(operationId = OPERATION_ID) {
  return {
    ok: true,
    operationId,
    status: {
      textGlobalEnabled: false,
      accountEnabled: false,
      accountRemaining: 10,
      globalRemaining: 30,
      budgetSpentMicros: 0,
      budgetReservedMicros: 0,
      resetAt: '2026-08-28T00:00:00.000Z',
    },
  };
}

function adminResponse(value = adminSuccess()) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

test('exports only the three narrow Cloudflare token permissions', () => {
  assert.deepEqual(TEXT_PREVIEW_TOKEN_PERMISSION_NAMES, PERMISSIONS);
  assert.deepEqual(TEXT_PREVIEW_SETUP_PERMISSION_NAMES, PERMISSIONS);
  assert.equal(Object.isFrozen(TEXT_PREVIEW_TOKEN_PERMISSION_NAMES), true);
});

test('loads only the new secret inventory and never reads legacy Access or email fields', () => {
  const source = validEnv();
  for (const name of [
    'TEXT_AI_TEAM_DOMAIN',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ]) {
    Object.defineProperty(source, name, {
      configurable: true,
      get() {
        throw new Error(`must not read ${name}`);
      },
    });
  }

  const config = loadTextPreviewConfig(source);
  assert.equal(config.accountId, ACCOUNT_ID);
  assert.equal(config.allowedOrigin, PREVIEW_ORIGIN);
  assert.equal(config.adminSigningKey, SENSITIVE.adminKey);
  assert.deepEqual(Object.keys(config).sort(), [
    'accountHmacKey',
    'accountId',
    'adminSigningKey',
    'allowedOrigin',
    'apiToken',
    'arkApiKey',
    'cacheAesKey',
    'rateLimitHmacKey',
    'sessionSigningKey',
    'user1AccessCodeDigest',
    'user1AccessCodePepper',
    'user2AccessCodeDigest',
    'user2AccessCodePepper',
  ]);
});

test('rejects missing, non-canonical, reused, inherited, and accessor secret values', () => {
  for (const overrides of [
    { TEXT_AI_ADMIN_SIGNING_KEY: 'short' },
    { TEXT_AI_SESSION_SIGNING_KEY: `${SENSITIVE.sessionKey}=` },
    { TEXT_AI_USER_1_ACCESS_CODE_DIGEST: 'A'.repeat(64) },
    { TEXT_AI_USER_2_ACCESS_CODE_DIGEST: SENSITIVE.user1Digest },
    { TEXT_AI_RATE_LIMIT_HMAC_KEY: SENSITIVE.sessionKey },
    { ARK_API_KEY: '' },
  ]) {
    expectFixedFailure(() => loadTextPreviewConfig(validEnv(overrides)));
  }
  const inherited = Object.create(validEnv());
  expectFixedFailure(() => loadTextPreviewConfig(inherited));
  const accessor = validEnv();
  Object.defineProperty(accessor, 'TEXT_AI_ADMIN_SIGNING_KEY', {
    get: () => SENSITIVE.adminKey,
  });
  expectFixedFailure(() => loadTextPreviewConfig(accessor));
});

test('preflight reads only token, Pages project, Worker inventory, and Worker settings', async () => {
  const fake = createFakeClient(preflightRoutes());
  const result = await preflightTextPreview(loadTextPreviewConfig(validEnv()), fake.client);

  assert.deepEqual(result, {
    project: pagesProject(),
    workerName: WORKER_NAME,
    photoAiGatewayEnabled: false,
    workerTextEnabled: false,
  });
  assert.deepEqual(fake.calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
    'GET /pages/projects/tiezheng',
    'GET /workers/scripts',
    `GET /workers/scripts/${WORKER_NAME}/settings`,
  ]);
  assert.equal(JSON.stringify(result).includes('access'), false);
});

test('CLI reports only fixed preflight stages and hides the failing Cloudflare response', async () => {
  const stderr = [];
  const fake = createFakeClient(preflightRoutes({ project: { malformed: true } }));

  assert.equal(await runTextPreviewControlCli(['preflight'], validEnv(), {
    clientFactory: () => fake.client,
    writeStdout: () => assert.fail('failed preflight must not write stdout'),
    writeStderr: (value) => stderr.push(value),
  }), 1);

  assert.deepEqual(stderr, [
    'Text preview preflight stage: token-capabilities\n',
    'Text preview preflight stage: read-project\n',
    'Text preview preflight stage: inspect-project\n',
    'Text preview control failed\n',
  ]);
  assert.equal(JSON.stringify(stderr).includes(SENSITIVE.apiToken), false);
  assert.equal(JSON.stringify(stderr).includes('malformed'), false);
});

test('preflight reports the complete fixed stage sequence', async () => {
  const stages = [];
  const fake = createFakeClient(preflightRoutes());

  await preflightTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
    (stage) => stages.push(stage),
  );

  assert.deepEqual(stages, [
    'token-capabilities',
    'read-project',
    'inspect-project',
    'read-worker-list',
    'inspect-worker-list',
    'read-worker-settings',
    'inspect-worker-settings',
    'complete',
  ]);
});

test('preflight stage reporting failures never change the result or API calls', async () => {
  const expectedCalls = [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
    'GET /pages/projects/tiezheng',
    'GET /workers/scripts',
    `GET /workers/scripts/${WORKER_NAME}/settings`,
  ];
  for (const reporter of [
    () => { throw new Error(`private stage detail ${SENSITIVE.apiToken}`); },
    () => Promise.reject(new Error(`private async stage detail ${SENSITIVE.apiToken}`)),
  ]) {
    const fake = createFakeClient(preflightRoutes());
    const result = await preflightTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
      reporter,
    );
    assert.equal(result.workerTextEnabled, false);
    assert.equal(result.photoAiGatewayEnabled, false);
    assert.deepEqual(
      fake.calls.map(({ method, path }) => `${method} ${path}`),
      expectedCalls,
    );
  }
});

test('setup token verification uses the same narrow three-permission contract', async () => {
  const fixtures = tokenPermissionFixtures();
  const fake = setupTokenClient(fixtures);
  assert.deepEqual(await verifyTextPreviewSetupToken(ACCOUNT_ID, fake.client), {
    accountId: ACCOUNT_ID,
    missingPermissions: [],
  });
});

test('setup token verification accepts Cloudflare expiry metadata', async () => {
  const fixtures = tokenPermissionFixtures();
  fixtures.verification.expires_on = '2027-08-29T00:00:00Z';
  const fake = setupTokenClient(fixtures);

  assert.deepEqual(await verifyTextPreviewSetupToken(ACCOUNT_ID, fake.client), {
    accountId: ACCOUNT_ID,
    missingPermissions: [],
  });
});

test('setup token verification accepts unrelated current Cloudflare catalog scopes', async () => {
  const fixtures = tokenPermissionFixtures();
  fixtures.permissionGroups.push({
    id: 'unrelated-permission',
    name: 'Unrelated Permission',
    scopes: ['com.cloudflare.api.account.flagship.app'],
  });
  const fake = setupTokenClient(fixtures);

  assert.deepEqual(await verifyTextPreviewSetupToken(ACCOUNT_ID, fake.client), {
    accountId: ACCOUNT_ID,
    missingPermissions: [],
  });
});

test('setup token verification keeps strict identity, resource, field, and scope boundaries', async () => {
  const cases = [
    (fixtures) => { fixtures.verification.unexpected = true; },
    (fixtures) => {
      fixtures.permissionGroups.push({
        id: 'future-permission',
        name: 'Future Permission',
        scopes: ['com.cloudflare.api.account.future'],
      });
    },
    (fixtures) => {
      fixtures.permissionGroups[0].scopes = ['com.cloudflare.api.account.flagship.app'];
    },
    (fixtures) => { fixtures.details.id = 'other-token-id'; },
    (fixtures) => { fixtures.verification.status = 'inactive'; },
    (fixtures) => { fixtures.details.status = 'inactive'; },
    (fixtures) => {
      fixtures.details.policies[0].resources = {
        [`com.cloudflare.api.account.${'b'.repeat(32)}`]: '*',
      };
    },
  ];

  for (const mutate of cases) {
    const fixtures = tokenPermissionFixtures();
    mutate(fixtures);
    const fake = setupTokenClient(fixtures);
    await expectFixedRejection(() => verifyTextPreviewSetupToken(ACCOUNT_ID, fake.client));
  }
});

test('configure patches only nine Preview env vars and the fixed Worker service binding', async () => {
  const before = pagesProject();
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    patched = structuredClone(body);
    return pagesProject(body.deployment_configs.preview);
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject(
    patched.deployment_configs.preview,
  ));
  const fake = createFakeClient(routes);

  assert.deepEqual(
    await reconcileTextPreview(loadTextPreviewConfig(validEnv()), fake.client),
    { configured: true },
  );
  const writes = fake.calls.filter(({ method }) => method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].path, '/pages/projects/tiezheng');
  const preview = writes[0].body.deployment_configs.preview;
  assert.deepEqual(Object.keys(preview.env_vars).sort(), [...ENV_NAMES].sort());
  assert.deepEqual(preview.services, {
    PHOTO_AI_GATEWAY: { service: WORKER_NAME, environment: 'production' },
  });
  assert.deepEqual(preview.env_vars.PHOTO_AI_ALLOWED_ORIGINS, {
    type: 'plain_text',
    value: PREVIEW_ORIGIN,
  });
  for (const name of ENV_NAMES.filter((name) => name !== 'PHOTO_AI_ALLOWED_ORIGINS')) {
    assert.equal(preview.env_vars[name].type, 'secret_text');
    assert.equal(typeof preview.env_vars[name].value, 'string');
  }
  assert.equal(fake.calls.some(({ path }) => path.includes('/access/')), false);
  assert.equal(fake.calls.some(({ method }) => method === 'POST' || method === 'PUT' || method === 'DELETE'), false);
});

test('configure forwards the current Preview Wrangler config hash for a config-managed project', async () => {
  const wranglerConfigHash = 'wrangler-config-hash';
  const beforePreview = {
    compatibility_date: '2026-07-11',
    wrangler_config_hash: wranglerConfigHash,
    env_vars: {},
    services: {},
  };
  const before = pagesProject(beforePreview);
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    assert.equal(
      body.deployment_configs.preview.wrangler_config_hash,
      wranglerConfigHash,
    );
    patched = structuredClone(body);
    return pagesProject({
      ...beforePreview,
      ...body.deployment_configs.preview,
      wrangler_config_hash: 'next-wrangler-config-hash',
    });
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject({
    ...beforePreview,
    ...patched.deployment_configs.preview,
    wrangler_config_hash: 'next-wrangler-config-hash',
  }));
  const fake = createFakeClient(routes);

  assert.deepEqual(
    await reconcileTextPreview(loadTextPreviewConfig(validEnv()), fake.client),
    { configured: true },
  );
});

test('configure omits a null Preview Wrangler config hash from the Pages PATCH', async () => {
  const beforePreview = {
    wrangler_config_hash: null,
    env_vars: {},
    services: {},
  };
  const before = pagesProject(beforePreview);
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    assert.equal(
      Object.hasOwn(body.deployment_configs.preview, 'wrangler_config_hash'),
      false,
    );
    patched = structuredClone(body);
    return pagesProject({
      ...beforePreview,
      ...body.deployment_configs.preview,
    });
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject({
    ...beforePreview,
    ...patched.deployment_configs.preview,
  }));
  const fake = createFakeClient(routes);

  assert.deepEqual(
    await reconcileTextPreview(loadTextPreviewConfig(validEnv()), fake.client),
    { configured: true },
  );
});

test('configure preserves the current Pages build image major version', async () => {
  const beforePreview = {
    build_image_major_version: 3,
    env_vars: {},
    services: {},
  };
  const before = pagesProject(beforePreview);
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    assert.equal(
      Object.hasOwn(body.deployment_configs.preview, 'build_image_major_version'),
      false,
    );
    patched = structuredClone(body);
    return pagesProject({
      ...beforePreview,
      ...body.deployment_configs.preview,
    });
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject({
    ...beforePreview,
    ...patched.deployment_configs.preview,
  }));
  const fake = createFakeClient(routes);

  assert.deepEqual(
    await reconcileTextPreview(loadTextPreviewConfig(validEnv()), fake.client),
    { configured: true },
  );
});

test('configure treats null optional Preview maps as empty before PATCH', async () => {
  const beforePreview = {
    env_vars: null,
    services: null,
    ai_bindings: null,
    kv_namespaces: null,
  };
  const before = pagesProject(beforePreview);
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    patched = structuredClone(body);
    return pagesProject({
      ...beforePreview,
      ...body.deployment_configs.preview,
    });
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject({
    ...beforePreview,
    ...patched.deployment_configs.preview,
  }));
  const fake = createFakeClient(routes);

  assert.deepEqual(
    await reconcileTextPreview(loadTextPreviewConfig(validEnv()), fake.client),
    { configured: true },
  );
});

test('configure fails before PATCH on unknown Preview bindings or late project drift', async () => {
  const unsafe = pagesProject({ env_vars: { UNKNOWN: { type: 'plain_text', value: 'x' } }, services: {} });
  const unknownFake = createFakeClient(preflightRoutes({ project: unsafe }));
  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    unknownFake.client,
  ));
  assert.equal(unknownFake.calls.some(({ method }) => method === 'PATCH'), false);

  const before = pagesProject({ compatibility_date: '2026-08-18', env_vars: {}, services: {} });
  const drifted = pagesProject({ compatibility_date: '2026-08-19', env_vars: {}, services: {} });
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', drifted);
  const driftFake = createFakeClient(routes);
  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    driftFake.client,
  ));
  assert.equal(driftFake.calls.some(({ method }) => method === 'PATCH'), false);
});

test('configure fails before PATCH when the Preview Wrangler config hash drifts', async () => {
  const before = pagesProject({
    wrangler_config_hash: 'before-wrangler-config-hash',
    env_vars: {},
    services: {},
  });
  const drifted = pagesProject({
    wrangler_config_hash: 'drifted-wrangler-config-hash',
    env_vars: {},
    services: {},
  });
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', drifted);
  const fake = createFakeClient(routes);

  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
});

test('invoke-admin sends canonical slot JSON and only HMAC request headers', async () => {
  const config = loadTextPreviewConfig(validEnv());
  let captured;
  const fetcher = async (url, init) => {
    captured = { url, init };
    return adminResponse();
  };
  const result = await invokeTextPreviewAdmin(
    config,
    { operation: 'status', target: 'user-2' },
    fetcher,
    { generateOperationId: () => OPERATION_ID, now: () => NOW },
  );

  assert.equal(captured.url, `${PREVIEW_ORIGIN}/api/nutrition/text-admin/account`);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.init.body, JSON.stringify({
    schemaVersion: 1,
    operationId: OPERATION_ID,
    operation: 'status',
    target: 'user-2',
  }));
  const expectedSignature = signTextAdminRequest({
    key: SENSITIVE.adminKey,
    timestamp: String(NOW),
    operationId: OPERATION_ID,
    body: captured.init.body,
  });
  assert.deepEqual(captured.init.headers, {
    origin: PREVIEW_ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(captured.init.body)),
    'x-tiezheng-admin-version': 'v1',
    'x-tiezheng-admin-timestamp': String(NOW),
    'x-tiezheng-admin-signature': expectedSignature,
  });
  assert.deepEqual(result, { operation: 'status', ...adminSuccess().status });
  assert.equal(JSON.stringify(captured).includes('cf-access'), false);
  assert.equal(JSON.stringify(captured).includes('targetEmail'), false);
});

test('invoke-admin rejects invalid options and hides signing/fetch/response details', async () => {
  const config = loadTextPreviewConfig(validEnv());
  for (const options of [
    { operation: 'status', target: 'user-3' },
    { operation: 'unknown', target: 'user-1' },
    { operation: 'status', target: 'user-1', extra: true },
  ]) {
    await expectFixedRejection(() => invokeTextPreviewAdmin(
      config,
      options,
      async () => adminResponse(),
      { generateOperationId: () => OPERATION_ID, now: () => NOW },
    ));
  }
  await expectFixedRejection(() => invokeTextPreviewAdmin(
    config,
    { operation: 'status', target: 'user-1' },
    async () => { throw new Error(SENSITIVE.adminKey); },
    { generateOperationId: () => OPERATION_ID, now: () => NOW },
  ));
  await expectFixedRejection(() => invokeTextPreviewAdmin(
    config,
    { operation: 'status', target: 'user-1' },
    async () => adminResponse({ ...adminSuccess(), target: 'user-1' }),
    { generateOperationId: () => OPERATION_ID, now: () => NOW },
  ));
});

test('redacted admin response remains an exact correlated whitelist', () => {
  assert.deepEqual(parseRedactedAdminResponse(adminSuccess(), OPERATION_ID), adminSuccess().status);
  for (const value of [
    { ...adminSuccess(), operationId: '2'.repeat(32) },
    { ...adminSuccess(), target: 'user-1' },
    { ...adminSuccess(), status: { ...adminSuccess().status, accountRemaining: 11 } },
  ]) {
    expectFixedFailure(() => parseRedactedAdminResponse(value, OPERATION_ID));
  }
});

test('CLI accepts only preflight, configure, and strict invoke-admin commands', async () => {
  const stdout = [];
  const stderr = [];
  const baseDependencies = {
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    generateOperationId: () => OPERATION_ID,
    now: () => NOW,
  };

  const preflightFake = createFakeClient(preflightRoutes());
  assert.equal(await runTextPreviewControlCli(['preflight'], validEnv(), {
    ...baseDependencies,
    clientFactory: () => preflightFake.client,
  }), 0);

  const before = pagesProject();
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  let patched;
  addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
    patched = structuredClone(body);
    return pagesProject(body.deployment_configs.preview);
  });
  addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject(patched.deployment_configs.preview));
  const configureFake = createFakeClient(routes);
  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), {
    ...baseDependencies,
    clientFactory: () => configureFake.client,
  }), 0);

  assert.equal(await runTextPreviewControlCli([
    'invoke-admin',
    '--operation=status',
    '--target=user-1',
  ], validEnv(), {
    ...baseDependencies,
    fetcher: async () => adminResponse(),
  }), 0);

  assert.equal(await runTextPreviewControlCli(['disable-access'], validEnv(), baseDependencies), 1);
  assert.deepEqual(stdout.map((line) => JSON.parse(line)), [
    { command: 'preflight', status: 'ready', workerTextEnabled: false },
    { command: 'configure', status: 'configured' },
    { operation: 'status', ...adminSuccess().status },
  ]);
  assert.equal(stderr.at(-1), 'Text preview control failed\n');
  assert.equal(JSON.stringify({ stdout, stderr }).includes(SENSITIVE.adminKey), false);
});

test('CLI classifies every admin response path with fixed stages and never prints private detail', async () => {
  const privateBody = JSON.stringify({
    ok: false,
    code: 'private-upstream-detail',
    private: SENSITIVE.adminKey,
  });
  const cases = [
    {
      name: 'success',
      fetcher: async () => adminResponse(),
      expectedExit: 0,
      expectedStages: ['request-dispatched', 'response-200', 'complete'],
    },
    {
      name: 'unauthorized',
      fetcher: async () => new Response(privateBody, { status: 401 }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', 'response-401'],
    },
    {
      name: 'service unavailable without a trusted diagnostic',
      fetcher: async () => new Response(privateBody, { status: 503 }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', 'response-503'],
    },
    ...[
      'binding-missing',
      'downstream-configuration',
      'downstream-runtime',
      'downstream-coordinator',
      'downstream-service-disabled',
      'downstream-failed',
    ].map((diagnostic) => ({
      name: `service unavailable: ${diagnostic}`,
      fetcher: async () => new Response(privateBody, {
        status: 503,
        headers: { 'x-tiezheng-admin-diagnostic': diagnostic },
      }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', `response-503-${diagnostic}`],
    })),
    {
      name: 'service unavailable with an untrusted diagnostic',
      fetcher: async () => new Response(privateBody, {
        status: 503,
        headers: { 'x-tiezheng-admin-diagnostic': SENSITIVE.adminKey },
      }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', 'response-503'],
    },
    {
      name: 'other HTTP status',
      fetcher: async () => new Response(privateBody, { status: 418 }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', 'response-other'],
    },
    {
      name: 'invalid response',
      fetcher: async () => ({ private: SENSITIVE.adminKey }),
      expectedExit: 1,
      expectedStages: ['request-dispatched', 'response-invalid'],
    },
    {
      name: 'fetch rejection',
      fetcher: async () => { throw new Error(`private fetch detail ${SENSITIVE.adminKey}`); },
      expectedExit: 1,
      expectedStages: ['request-dispatched'],
    },
  ];

  for (const scenario of cases) {
    const stdout = [];
    const stderr = [];
    const exitCode = await runTextPreviewControlCli([
      'invoke-admin',
      '--operation=status',
      '--target=user-1',
    ], validEnv(), {
      fetcher: scenario.fetcher,
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      generateOperationId: () => OPERATION_ID,
      now: () => NOW,
    });

    assert.equal(exitCode, scenario.expectedExit, scenario.name);
    assert.deepEqual(
      stderr,
      [
        ...scenario.expectedStages.map((stage) => `Text preview admin stage: ${stage}\n`),
        ...(scenario.expectedExit === 1 ? ['Text preview control failed\n'] : []),
      ],
      scenario.name,
    );
    assert.equal(JSON.stringify({ stdout, stderr }).includes(SENSITIVE.adminKey), false);
    assert.equal(JSON.stringify({ stdout, stderr }).includes('private-upstream-detail'), false);
    if (scenario.expectedExit === 0) {
      assert.deepEqual(stdout.map((line) => JSON.parse(line)), [
        { operation: 'status', ...adminSuccess().status },
      ]);
    } else {
      assert.deepEqual(stdout, []);
    }
  }
});

test('CLI preserves the injected admin fetcher call contract', async () => {
  let callCount = 0;
  let receiver = Symbol('not-called');
  let capturedUrl;
  let capturedInit;
  async function fetcher(url, init) {
    callCount += 1;
    receiver = this;
    capturedUrl = url;
    capturedInit = init;
    return adminResponse();
  }

  assert.equal(await runTextPreviewControlCli([
    'invoke-admin',
    '--operation=status',
    '--target=user-1',
  ], validEnv(), {
    fetcher,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    generateOperationId: () => OPERATION_ID,
    now: () => NOW,
  }), 0);

  assert.equal(callCount, 1);
  assert.equal(receiver, undefined);
  assert.equal(capturedUrl, `${PREVIEW_ORIGIN}/api/nutrition/text-admin/account`);
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(typeof capturedInit?.body, 'string');
  assert.equal(capturedInit?.signal instanceof AbortSignal, true);
});

test('admin stage reporting failures never alter a successful CLI invoke', async () => {
  for (const failWriter of [
    () => { throw new Error(`private stage detail ${SENSITIVE.adminKey}`); },
    () => Promise.reject(new Error(`private async stage detail ${SENSITIVE.adminKey}`)),
  ]) {
    const stdout = [];
    let stageCalls = 0;
    assert.equal(await runTextPreviewControlCli([
      'invoke-admin',
      '--operation=status',
      '--target=user-1',
    ], validEnv(), {
      fetcher: async () => adminResponse(),
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => {
        stageCalls += 1;
        return failWriter();
      },
      generateOperationId: () => OPERATION_ID,
      now: () => NOW,
    }), 0);
    assert.equal(stageCalls, 3);
    assert.deepEqual(stdout.map((line) => JSON.parse(line)), [
      { operation: 'status', ...adminSuccess().status },
    ]);
  }
});

test('CLI failure output safely handles synchronous throws and rejected Promises', async () => {
  for (const mode of ['throw', 'reject']) {
    let writerCalls = 0;
    let rejectionHandlers = 0;
    const stdout = [];
    const writeStderr = () => {
      writerCalls += 1;
      if (mode === 'throw') {
        throw new Error(`private sync output detail ${SENSITIVE.adminKey}`);
      }
      const rejected = Promise.reject(
        new Error(`private async output detail ${SENSITIVE.adminKey}`),
      );
      Promise.prototype.catch.call(rejected, () => undefined);
      const originalCatch = rejected.catch.bind(rejected);
      rejected.catch = (...args) => {
        rejectionHandlers += 1;
        return originalCatch(...args);
      };
      return rejected;
    };

    assert.equal(await runTextPreviewControlCli([
      'invoke-admin',
      '--operation=status',
      '--target=user-1',
    ], validEnv(), {
      fetcher: async () => new Response('{}', { status: 401 }),
      writeStdout: (value) => stdout.push(value),
      writeStderr,
      generateOperationId: () => OPERATION_ID,
      now: () => NOW,
    }), 1, mode);

    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(writerCalls, 3, mode);
    if (mode === 'reject') assert.equal(rejectionHandlers, writerCalls, mode);
    assert.deepEqual(stdout, [], mode);
  }
});

test('CLI reports only fixed configure stages and hides the underlying failure', async () => {
  const stdout = [];
  const stderr = [];
  const before = pagesProject({
    wrangler_config_hash: 'wrangler-config-hash',
    env_vars: {},
    services: {},
  });
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  addRoute(routes, 'PATCH /pages/projects/tiezheng', () => {
    throw new Error(`private upstream detail ${SENSITIVE.apiToken}`);
  });
  const fake = createFakeClient(routes);

  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), {
    clientFactory: () => fake.client,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  }), 1);

  assert.deepEqual(stdout, []);
  const checkpoints = [
    'record',
    'top-level',
    'env-vars',
    'services',
    'env-entries',
    'service-entries',
    'binding-containers',
    'wrangler-config-hash',
    'behavior',
  ];
  const checkpointLines = (prefix) => checkpoints.map(
    (checkpoint) => `Text preview configure stage: ${prefix}:${checkpoint}\n`,
  );
  assert.deepEqual(stderr, [
    'Text preview configure stage: preflight\n',
    'Text preview configure stage: inspect-initial\n',
    ...checkpointLines('inspect-initial'),
    'Text preview configure stage: read-recheck\n',
    'Text preview configure stage: inspect-recheck\n',
    ...checkpointLines('inspect-recheck'),
    'Text preview configure stage: patch-request\n',
    'Text preview control failed\n',
  ]);
  const rendered = JSON.stringify(stderr);
  assert.equal(rendered.includes(SENSITIVE.apiToken), false);
  assert.equal(rendered.includes('private upstream detail'), false);
});

test('CLI attributes a malformed PATCH response to response inspection', async () => {
  const stderr = [];
  const before = pagesProject({
    wrangler_config_hash: 'wrangler-config-hash',
    env_vars: {},
    services: {},
  });
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  addRoute(routes, 'PATCH /pages/projects/tiezheng', { malformed: true });
  const fake = createFakeClient(routes);

  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), {
    clientFactory: () => fake.client,
    writeStdout: () => assert.fail('failed configure must not write stdout'),
    writeStderr: (value) => stderr.push(value),
  }), 1);

  assert.equal(stderr.at(-2), 'Text preview configure stage: inspect-patch-response\n');
  assert.equal(stderr.at(-1), 'Text preview control failed\n');
});

test('CLI attributes incomplete PATCH env vars to expected env validation', async () => {
  const stderr = [];
  const before = pagesProject();
  const routes = preflightRoutes({ project: before });
  addRoute(routes, 'GET /pages/projects/tiezheng', before);
  addRoute(routes, 'PATCH /pages/projects/tiezheng', pagesProject({
    env_vars: {},
    services: {
      PHOTO_AI_GATEWAY: { service: WORKER_NAME, environment: 'production' },
    },
  }));
  const fake = createFakeClient(routes);

  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), {
    clientFactory: () => fake.client,
    writeStdout: () => assert.fail('failed configure must not write stdout'),
    writeStderr: (value) => stderr.push(value),
  }), 1);

  assert.equal(stderr.at(-2), 'Text preview configure stage: inspect-patch-response:env-vars\n');
  assert.equal(stderr.at(-1), 'Text preview control failed\n');
});

test('CLI pinpoints invalid initial Preview behavior without exposing its value', async () => {
  const stderr = [];
  const unsafe = pagesProject({
    build_image_major_version: null,
    env_vars: {},
    services: {},
  });
  const fake = createFakeClient(preflightRoutes({ project: unsafe }));

  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), {
    clientFactory: () => fake.client,
    writeStdout: () => assert.fail('failed configure must not write stdout'),
    writeStderr: (value) => stderr.push(value),
  }), 1);

  assert.equal(stderr.at(-2), 'Text preview configure stage: inspect-initial:behavior\n');
  assert.equal(stderr.at(-1), 'Text preview control failed\n');
  assert.equal(JSON.stringify(stderr).includes('build_image_major_version'), false);
});

test('configure stage reporting failures never change reconciliation', async () => {
  const createSuccessfulFake = () => {
    const before = pagesProject();
    const routes = preflightRoutes({ project: before });
    addRoute(routes, 'GET /pages/projects/tiezheng', before);
    let patched;
    addRoute(routes, 'PATCH /pages/projects/tiezheng', ({ body }) => {
      patched = structuredClone(body);
      return pagesProject(body.deployment_configs.preview);
    });
    addRoute(routes, 'GET /pages/projects/tiezheng', () => pagesProject(
      patched.deployment_configs.preview,
    ));
    return createFakeClient(routes);
  };

  const syncFake = createSuccessfulFake();
  assert.deepEqual(await reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    syncFake.client,
    () => { throw new Error(`private reporter detail ${SENSITIVE.adminKey}`); },
  ), { configured: true });

  const asyncFake = createSuccessfulFake();
  assert.deepEqual(await reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    asyncFake.client,
    async () => { throw new Error(`private async reporter detail ${SENSITIVE.adminKey}`); },
  ), { configured: true });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
});

test('runtime control source contains no Zero Trust, email, or Access credential shape', async () => {
  const source = await readFile(resolve('scripts/text-ai-preview-control.mjs'), 'utf8');
  for (const pattern of [
    /\/access\//i,
    /cloudflareaccess[.]com/i,
    /cf-access-client/i,
    /TEXT_AI_TEAM_DOMAIN/,
    /TEXT_AI_USER_[123]_EMAIL/,
    /TEXT_AI_ADMIN_EMAIL/,
    /TEXT_AI_CF_ACCESS/,
    /targetEmail/,
  ]) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
  assert.equal(source.includes('console.'), false);
});
