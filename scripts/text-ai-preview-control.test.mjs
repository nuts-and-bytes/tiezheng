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

test('setup token verification uses the same narrow three-permission contract', async () => {
  const fixtures = tokenPermissionFixtures();
  const fake = createFakeClient(new Map([
    ['GET /tokens/verify', [fixtures.verification]],
    [`GET /tokens/${TOKEN_ID}`, [fixtures.details]],
    ['GET /tokens/permission_groups', [fixtures.permissionGroups]],
  ]));
  assert.deepEqual(await verifyTextPreviewSetupToken(ACCOUNT_ID, fake.client), {
    accountId: ACCOUNT_ID,
    missingPermissions: [],
  });
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
