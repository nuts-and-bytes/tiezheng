import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let testModule;
try {
  testModule = await import('vitest');
} catch {
  testModule = await import('node:test');
}
const { test } = testModule;

import {
  disableTextPreviewAccess,
  invokeTextPreviewAdmin,
  loadTextPreviewConfig,
  parseRedactedAdminResponse,
  preflightTextPreview,
  reconcileTextPreview,
  runTextPreviewControlCli,
} from './text-ai-preview-control.mjs';

const SENSITIVE = Object.freeze({
  accountId: 'a'.repeat(32),
  apiToken: 'private-cf-token-value',
  teamDomain: 'team-alpha',
  user1: 'alice@example.com',
  user2: 'bob@example.com',
  user3: 'carol@example.com',
  admin: 'alice@example.com',
  serviceClientId: 'service-client.access',
  serviceClientSecret: 'private-service-secret-value',
  hmac: '0123456789abcdef0123456789abcdef',
});

function validEnv(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: SENSITIVE.accountId,
    CLOUDFLARE_API_TOKEN: SENSITIVE.apiToken,
    TEXT_AI_TEAM_DOMAIN: SENSITIVE.teamDomain,
    TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
    TEXT_AI_USER_1_EMAIL: SENSITIVE.user1,
    TEXT_AI_USER_2_EMAIL: SENSITIVE.user2,
    TEXT_AI_ADMIN_EMAIL: SENSITIVE.admin,
    TEXT_AI_CF_ACCESS_CLIENT_ID: SENSITIVE.serviceClientId,
    TEXT_AI_CF_ACCESS_CLIENT_SECRET: SENSITIVE.serviceClientSecret,
    PHOTO_AI_ACCOUNT_HMAC_KEY: SENSITIVE.hmac,
    ...overrides,
  };
}

function expectFixedFailure(action) {
  assert.throws(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, 'Text preview control failed');
    const rendered = String(error);
    for (const value of Object.values(SENSITIVE)) {
      assert.equal(rendered.includes(value), false);
    }
    return true;
  });
}

async function expectFixedRejection(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, 'Text preview control failed');
    const rendered = String(error);
    for (const value of Object.values(SENSITIVE)) {
      assert.equal(rendered.includes(value), false);
    }
    return true;
  });
}

const WORKER_NAME = 'tiezheng-photo-ai-gateway';
const TOKEN_ID = 'token-id';
const USER_APP_NAME = 'tiezheng-text-ai-preview-users';
const ADMIN_APP_NAME = 'tiezheng-text-ai-preview-admin';
const OTP_PROVIDER_ID = 'otp-provider-id';
const SERVICE_TOKEN_ID = 'service-token-resource-id';
const USER_APP_ID = 'user-app-id';
const ADMIN_APP_ID = 'admin-app-id';
const USER_AUDIENCE = 'private-user-audience-value';
const ADMIN_AUDIENCE = 'private-admin-audience-value';
const PREVIEW_ORIGIN = 'https://text-ai-preview.tiezheng.pages.dev';
const OPERATION_ID = '1'.repeat(32);
const RESET_AT = '2026-08-26T00:00:00.000Z';
const ADMIN_OPERATIONS = Object.freeze([
  'status',
  'enable-text-global',
  'disable-text-global',
  'enable-account',
  'disable-account',
  'delete-account',
]);
const ACCOUNT_RESOURCE_KEY = `com.cloudflare.api.account.${SENSITIVE.accountId}`;
const REQUIRED_TOKEN_PERMISSION_NAMES = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
  'Access: Apps and Policies Edit',
  'Access: Identity Providers Read',
  'Access: Service Tokens Read',
]);

const USER_APP_PAYLOAD = Object.freeze({
  name: USER_APP_NAME,
  domain: 'text-ai-preview.tiezheng.pages.dev/api/nutrition/text',
  type: 'self_hosted',
  session_duration: '30m',
  app_launcher_visible: false,
});

const ADMIN_APP_PAYLOAD = Object.freeze({
  name: ADMIN_APP_NAME,
  domain: 'text-ai-preview.tiezheng.pages.dev/api/nutrition/text-admin',
  type: 'self_hosted',
  session_duration: '30m',
  app_launcher_visible: false,
});

function userPolicyPayload(emailList = [SENSITIVE.user1, SENSITIVE.user2]) {
  return {
    name: `${USER_APP_NAME}-allow`,
    decision: 'allow',
    session_duration: '30m',
    include: emailList.map((email) => ({ email: { email } })),
    require: [{ login_method: { id: OTP_PROVIDER_ID } }],
    exclude: [],
  };
}

function adminHumanPolicyPayload() {
  return {
    name: `${ADMIN_APP_NAME}-human`,
    decision: 'allow',
    session_duration: '30m',
    include: [{ email: { email: SENSITIVE.user1 } }],
    require: [{ login_method: { id: OTP_PROVIDER_ID } }],
    exclude: [],
  };
}

function adminServicePolicyPayload() {
  return {
    name: `${ADMIN_APP_NAME}-service`,
    decision: 'non_identity',
    session_duration: '30m',
    include: [{ service_token: { token_id: SERVICE_TOKEN_ID } }],
    require: [],
    exclude: [],
  };
}

function appResult(id, aud, payload) {
  return { id, aud, ...payload };
}

function policyResult(id, payload) {
  return { id, ...payload };
}

function permissionGroupCatalog(names = REQUIRED_TOKEN_PERMISSION_NAMES) {
  return names.map((name, index) => ({
    id: `permission-group-${index}`,
    name,
    scopes: ['com.cloudflare.api.account'],
  }));
}

function tokenDetail(overrides = {}) {
  return {
    id: TOKEN_ID,
    status: 'active',
    policies: [{
      id: 'token-policy-id',
      effect: 'allow',
      resources: { [ACCOUNT_RESOURCE_KEY]: '*' },
      permission_groups: REQUIRED_TOKEN_PERMISSION_NAMES.map((_, index) => ({
        id: `permission-group-${index}`,
        name: `cosmetic-name-${index}`,
      })),
    }],
    ...overrides,
  };
}

function adminSuccess(operationId = OPERATION_ID, statusOverrides = {}) {
  return {
    ok: true,
    operationId,
    status: {
      textGlobalEnabled: false,
      accountEnabled: false,
      accountRemaining: 10,
      globalRemaining: 30,
      budgetSpentMicros: 1_000_000,
      budgetReservedMicros: 0,
      resetAt: RESET_AT,
      ...statusOverrides,
    },
  };
}

function adminResponse(body = adminSuccess(), overrides = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    ...overrides,
  });
}

function manualInvokeDependencies() {
  let nextId = 1;
  let setCalls = 0;
  let clearCalls = 0;
  const timers = new Map();
  return {
    dependencies: {
      generateOperationId: () => OPERATION_ID,
      setTimeout(callback, delay) {
        assert.equal(typeof callback, 'function');
        assert.equal(delay, 20_000);
        const id = nextId;
        nextId += 1;
        setCalls += 1;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        clearCalls += 1;
        timers.delete(id);
      },
    },
    fire() {
      assert.equal(timers.size, 1);
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
    activeCount: () => timers.size,
    setCalls: () => setCalls,
    clearCalls: () => clearCalls,
  };
}

function expectedPagesPatch(config, userAudience = USER_AUDIENCE, adminAudience = ADMIN_AUDIENCE) {
  return {
    deployment_configs: {
      preview: {
        env_vars: {
          PHOTO_AI_TEAM_DOMAIN: { type: 'plain_text', value: SENSITIVE.teamDomain },
          PHOTO_AI_ALLOWED_ORIGINS: { type: 'plain_text', value: PREVIEW_ORIGIN },
          PHOTO_AI_ACCOUNT_HMAC_KEY: { type: 'secret_text', value: config.accountHmacKey },
          TEXT_AI_ACCESS_AUD: { type: 'secret_text', value: userAudience },
          TEXT_AI_ALLOWED_EMAILS: { type: 'secret_text', value: config.allowedEmails },
          TEXT_AI_ALLOWED_EMAIL_COUNT: { type: 'plain_text', value: String(config.allowedEmailCount) },
          TEXT_AI_ADMIN_ACCESS_AUD: { type: 'secret_text', value: adminAudience },
          TEXT_AI_ADMIN_EMAIL: { type: 'secret_text', value: config.adminEmail },
          TEXT_AI_ADMIN_SERVICE_CLIENT_ID: { type: 'secret_text', value: config.serviceClientId },
        },
        services: {
          PHOTO_AI_GATEWAY: {
            service: WORKER_NAME,
            environment: 'production',
          },
        },
      },
    },
  };
}

function projectWithPreview(preview, production = projectResult().deployment_configs.production) {
  return projectResult({
    deployment_configs: { production, preview },
  });
}

function reconciliationResults({
  apps = [],
  projectBefore = projectResult(),
  projectAfter = projectBefore,
  projectRecheck = projectAfter,
  patchProject = projectAfter,
  extra = [],
} = {}) {
  const base = preflightResults([
    ['GET /pages/projects/tiezheng', ({ calls }) => {
      const count = calls.filter(({ method, path }) => method === 'GET' && path === '/pages/projects/tiezheng').length;
      if (count === 1) return projectBefore;
      if (count === 2) return projectRecheck;
      return projectAfter;
    }],
    ['GET /access/apps', apps],
    ['POST /access/apps', ({ body }) => {
      if (body.name === USER_APP_NAME) return appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
      if (body.name === ADMIN_APP_NAME) return appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
      throw new Error('unexpected app create');
    }],
    [`POST /access/apps/${USER_APP_ID}/policies`, ({ body }) => policyResult('user-policy-id', body)],
    [`POST /access/apps/${ADMIN_APP_ID}/policies`, ({ body }) => policyResult(`admin-${body.decision}-policy-id`, body)],
    ['PATCH /pages/projects/tiezheng', patchProject],
    ...extra,
  ]);
  return base;
}

function projectResult(overrides = {}) {
  return {
    id: 'pages-project-id',
    name: 'tiezheng',
    production_branch: 'main',
    deployment_configs: {
      production: {
        env_vars: {
          EXISTING_PRODUCTION_VALUE: { type: 'plain_text', value: 'unchanged' },
          EXISTING_PRODUCTION_SECRET: { type: 'secret_text', value: SENSITIVE.apiToken },
        },
        services: {},
      },
      preview: { env_vars: {}, services: {} },
    },
    ...overrides,
  };
}

function preflightResults(overrides = []) {
  return new Map([
    ['GET /tokens/verify', { id: TOKEN_ID, status: 'active' }],
    [`GET /tokens/${TOKEN_ID}`, tokenDetail()],
    ['GET /tokens/permission_groups', permissionGroupCatalog()],
    ['GET /pages/projects/tiezheng', projectResult()],
    ['GET /workers/scripts', [{ id: WORKER_NAME, modified_on: '2026-08-25T00:00:00.000Z' }]],
    [`GET /workers/scripts/${WORKER_NAME}/settings`, {
      bindings: [
        { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
        { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'false' },
        { type: 'secret_text', name: 'ARK_API_KEY' },
        { type: 'durable_object_namespace', name: 'PHOTO_AI_COORDINATOR', namespace_id: 'do-id' },
      ],
    }],
    ['GET /access/identity_providers', [
      { id: OTP_PROVIDER_ID, type: 'onetimepin', name: 'One-time PIN' },
      { id: 'google-idp-id', type: 'google', name: 'Google' },
    ]],
    ['GET /access/service_tokens', [
      {
        id: SERVICE_TOKEN_ID,
        client_id: SENSITIVE.serviceClientId,
        name: 'text preview admin',
      },
    ]],
    ...overrides,
  ]);
}

function createFakeClient(results = preflightResults()) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (!results.has(key)) throw new Error(`unexpected fake request: ${key}`);
    const value = results.get(key);
    return typeof value === 'function' ? value({ method, path, body, calls }) : value;
  };
  return {
    calls,
    client: Object.freeze({
      get: (path) => request('GET', path),
      post: (path, body) => request('POST', path, body),
      put: (path, body) => request('PUT', path, body),
      patch: (path, body) => request('PATCH', path, body),
      delete: (path) => request('DELETE', path),
    }),
  };
}

test('loads only normalized primitive two-account preview configuration', () => {
  const config = loadTextPreviewConfig(validEnv());

  assert.equal(config.accountId, SENSITIVE.accountId);
  assert.equal(config.teamDomain, SENSITIVE.teamDomain);
  assert.equal(config.allowedEmailCount, 2);
  assert.deepEqual(config.allowedEmailList, [SENSITIVE.user1, SENSITIVE.user2]);
  assert.equal(config.allowedEmails, `${SENSITIVE.user1},${SENSITIVE.user2}`);
  assert.equal(config.adminEmail, SENSITIVE.user1);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.allowedEmailList), true);
});

test('allows exactly three distinct users only when the third normalized email exists', () => {
  const config = loadTextPreviewConfig(validEnv({
    TEXT_AI_ALLOWED_EMAIL_COUNT: '3',
    TEXT_AI_USER_3_EMAIL: SENSITIVE.user3,
  }));

  assert.equal(config.allowedEmailCount, 3);
  assert.deepEqual(config.allowedEmailList, [SENSITIVE.user1, SENSITIVE.user2, SENSITIVE.user3]);

  expectFixedFailure(() => loadTextPreviewConfig(validEnv({ TEXT_AI_ALLOWED_EMAIL_COUNT: '3' })));
  expectFixedFailure(() => loadTextPreviewConfig(validEnv({
    TEXT_AI_ALLOWED_EMAIL_COUNT: '3',
    TEXT_AI_USER_3_EMAIL: SENSITIVE.user1,
  })));
  expectFixedFailure(() => loadTextPreviewConfig(validEnv({
    TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
    TEXT_AI_USER_3_EMAIL: SENSITIVE.user3,
  })));
});

test('requires user-1 to be the administrator and all users to be distinct', () => {
  expectFixedFailure(() => loadTextPreviewConfig(validEnv({
    TEXT_AI_ADMIN_EMAIL: SENSITIVE.user2,
  })));
  expectFixedFailure(() => loadTextPreviewConfig(validEnv({
    TEXT_AI_USER_2_EMAIL: SENSITIVE.user1,
  })));
});

test('rejects noncanonical primitives instead of trimming or coercing them', () => {
  const invalidOverrides = [
    { CLOUDFLARE_ACCOUNT_ID: 'A'.repeat(32) },
    { CLOUDFLARE_API_TOKEN: ` ${SENSITIVE.apiToken}` },
    { TEXT_AI_TEAM_DOMAIN: 'Team-Alpha' },
    { TEXT_AI_ALLOWED_EMAIL_COUNT: 2 },
    { TEXT_AI_ALLOWED_EMAIL_COUNT: '02' },
    { TEXT_AI_USER_1_EMAIL: 'Alice@example.com' },
    { TEXT_AI_USER_2_EMAIL: ` ${SENSITIVE.user2}` },
    { TEXT_AI_CF_ACCESS_CLIENT_ID: new String(SENSITIVE.serviceClientId) },
    { TEXT_AI_CF_ACCESS_CLIENT_SECRET: { toString: () => SENSITIVE.serviceClientSecret } },
    { PHOTO_AI_ACCOUNT_HMAC_KEY: `${SENSITIVE.hmac}\n` },
  ];

  for (const overrides of invalidOverrides) {
    expectFixedFailure(() => loadTextPreviewConfig(validEnv(overrides)));
  }
});

test('does not read required configuration through inherited or accessor properties', () => {
  const inherited = Object.create(validEnv());
  expectFixedFailure(() => loadTextPreviewConfig(inherited));

  const accessor = validEnv();
  let getterReads = 0;
  Object.defineProperty(accessor, 'CLOUDFLARE_API_TOKEN', {
    enumerable: true,
    get() {
      getterReads += 1;
      return SENSITIVE.apiToken;
    },
  });
  expectFixedFailure(() => loadTextPreviewConfig(accessor));
  assert.equal(getterReads, 0);
});

test('preflight performs eight ordered read-only account checks and validates fixed resources', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const fake = createFakeClient();

  const result = await preflightTextPreview(config, fake.client);

  assert.equal(result.project.name, 'tiezheng');
  assert.equal(result.workerName, WORKER_NAME);
  assert.equal(result.otpProviderId, OTP_PROVIDER_ID);
  assert.equal(result.serviceTokenId, SERVICE_TOKEN_ID);
  assert.equal(result.photoAiGatewayEnabled, false);
  assert.equal(result.workerTextEnabled, false);
  assert.deepEqual(fake.calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
    'GET /pages/projects/tiezheng',
    'GET /workers/scripts',
    `GET /workers/scripts/${WORKER_NAME}/settings`,
    'GET /access/identity_providers',
    'GET /access/service_tokens',
  ]);
  assert.equal(fake.calls.every(({ method, body }) => method === 'GET' && body === undefined), true);
  assert.equal(JSON.stringify(result).includes(SENSITIVE.apiToken), false);
});

test('preflight exposes the existing Worker text flag as a boolean without secrets', async () => {
  const fake = createFakeClient(preflightResults([
    [`GET /workers/scripts/${WORKER_NAME}/settings`, {
      bindings: [
        { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
        { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'true' },
        { type: 'secret_text', name: 'ARK_API_KEY' },
      ],
    }],
  ]));

  const result = await preflightTextPreview(loadTextPreviewConfig(validEnv()), fake.client);

  assert.equal(result.workerTextEnabled, true);
  const serialized = JSON.stringify(result);
  for (const secret of Object.values(SENSITIVE)) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('preflight accepts only the documented account permission aliases resolved by catalog ID', async () => {
  const aliasNames = [
    'Account API Tokens Read',
    'Workers Scripts Write',
    'Pages Write',
    'Access: Apps and Policies Write',
    'Access: Organizations, Identity Providers, and Groups Read',
    'Access: Service Tokens Read',
  ];
  const detail = tokenDetail();
  for (const group of detail.policies[0].permission_groups) delete group.name;
  delete detail.name;
  const fake = createFakeClient(preflightResults([
    [`GET /tokens/${TOKEN_ID}`, detail],
    ['GET /tokens/permission_groups', permissionGroupCatalog(aliasNames)],
  ]));

  await assert.doesNotReject(() => preflightTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
});

test('configure fails before every write on token capability, account scope, or ID drift', async () => {
  const missingCapability = tokenDetail();
  missingCapability.policies[0].permission_groups.pop();

  const wrongAccount = tokenDetail();
  wrongAccount.policies[0].resources = {
    [`com.cloudflare.api.account.${'b'.repeat(32)}`]: '*',
  };

  const wildcardAccount = tokenDetail();
  wildcardAccount.policies[0].resources = { 'com.cloudflare.api.account.*': '*' };

  const additionalAccount = tokenDetail();
  additionalAccount.policies[0].resources[`com.cloudflare.api.account.${'b'.repeat(32)}`] = '*';

  const deniedPolicy = tokenDetail();
  deniedPolicy.policies[0].effect = 'deny';

  const mismatchedToken = tokenDetail({ id: 'different-token-id' });

  const unknownGroup = tokenDetail();
  unknownGroup.policies[0].permission_groups[0].id = 'unknown-permission-group-id';

  const malformedGroup = tokenDetail();
  malformedGroup.policies[0].permission_groups[0] = { name: 'cosmetic-only' };

  const pollutedResources = { [ACCOUNT_RESOURCE_KEY]: '*' };
  Object.defineProperty(pollutedResources, '__proto__', {
    enumerable: true,
    value: '*',
  });
  const pollutedDetail = tokenDetail();
  pollutedDetail.policies[0].resources = pollutedResources;

  const cases = [
    { detail: missingCapability },
    { detail: wrongAccount },
    { detail: wildcardAccount },
    { detail: additionalAccount },
    { detail: deniedPolicy },
    { detail: mismatchedToken },
    { detail: unknownGroup },
    { detail: malformedGroup },
    { detail: pollutedDetail },
  ];

  for (const { detail } of cases) {
    const fake = createFakeClient(reconciliationResults({
      extra: [[`GET /tokens/${TOKEN_ID}`, detail]],
    }));
    await expectFixedRejection(() => reconcileTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('configure fails before every write on malformed permission-group catalogs', async () => {
  const missingName = permissionGroupCatalog();
  delete missingName[0].name;

  const missingScopes = permissionGroupCatalog();
  delete missingScopes[0].scopes;

  const wrongScope = permissionGroupCatalog();
  wrongScope[0].scopes = ['com.cloudflare.api.zone'];

  const mixedScope = permissionGroupCatalog();
  mixedScope[0].scopes = ['com.cloudflare.api.account', 'com.cloudflare.api.zone'];

  const duplicateId = permissionGroupCatalog();
  duplicateId.push({ ...duplicateId[0] });

  const accessorEntry = permissionGroupCatalog();
  let getterReads = 0;
  Object.defineProperty(accessorEntry[0], 'name', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'Account API Tokens Read';
    },
  });

  for (const catalog of [
    missingName,
    missingScopes,
    wrongScope,
    mixedScope,
    duplicateId,
    accessorEntry,
  ]) {
    const fake = createFakeClient(reconciliationResults({
      extra: [['GET /tokens/permission_groups', catalog]],
    }));
    await expectFixedRejection(() => reconcileTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
  assert.equal(getterReads, 0);
});

test('preflight and configure require the Pages production branch to be exact main', async () => {
  const missingBranch = projectResult();
  delete missingBranch.production_branch;
  const projects = [
    missingBranch,
    projectResult({ production_branch: 'release' }),
    projectResult({ production_branch: new String('main') }),
  ];

  for (const project of projects) {
    const preflightFake = createFakeClient(preflightResults([
      ['GET /pages/projects/tiezheng', project],
    ]));
    await expectFixedRejection(() => preflightTextPreview(
      loadTextPreviewConfig(validEnv()),
      preflightFake.client,
    ));

    const configureFake = createFakeClient(reconciliationResults({ projectBefore: project }));
    await expectFixedRejection(() => reconcileTextPreview(
      loadTextPreviewConfig(validEnv()),
      configureFake.client,
    ));
    assert.equal(configureFake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('preflight requires one exact Worker text flag binding', async () => {
  const cases = [
    [
      { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
    ],
    [
      { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
      { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'false' },
      { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'true' },
    ],
    [
      { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
      { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'FALSE' },
    ],
    [
      { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
      { type: 'secret_text', name: 'TEXT_AI_GATEWAY_ENABLED' },
    ],
  ];

  for (const bindings of cases) {
    const fake = createFakeClient(preflightResults([[
      `GET /workers/scripts/${WORKER_NAME}/settings`,
      { bindings },
    ]]));
    await expectFixedRejection(() => preflightTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
  }
});

test('preflight stops immediately when the existing photo Worker flag is exact true', async () => {
  const results = preflightResults([
    [`GET /workers/scripts/${WORKER_NAME}/settings`, {
      bindings: [
        { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'true' },
        { type: 'plain_text', name: 'TEXT_AI_GATEWAY_ENABLED', text: 'false' },
      ],
    }],
  ]);
  const fake = createFakeClient(results);

  await expectFixedRejection(() => preflightTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));

  assert.deepEqual(fake.calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
    'GET /pages/projects/tiezheng',
    'GET /workers/scripts',
    `GET /workers/scripts/${WORKER_NAME}/settings`,
  ]);
  assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
});

test('preflight fails closed for missing, duplicate, unknown, or malformed fixed resources', async () => {
  const cases = [
    [['GET /tokens/verify', { id: 'token-id', status: 'disabled' }]],
    [['GET /pages/projects/tiezheng', projectResult({ name: 'other-project' })]],
    [['GET /workers/scripts', []]],
    [['GET /workers/scripts', [{ id: WORKER_NAME }, { id: WORKER_NAME }]]],
    [[`GET /workers/scripts/${WORKER_NAME}/settings`, { bindings: [] }]],
    [[`GET /workers/scripts/${WORKER_NAME}/settings`, {
      bindings: [
        { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
        { type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'false' },
      ],
    }]],
    [[`GET /workers/scripts/${WORKER_NAME}/settings`, {
      bindings: [{ type: 'plain_text', name: 'PHOTO_AI_GATEWAY_ENABLED', text: 'FALSE' }],
    }]],
    [['GET /access/identity_providers', []]],
    [['GET /access/identity_providers', [
      { id: 'otp-1', type: 'onetimepin', name: 'OTP one' },
      { id: 'otp-2', type: 'onetimepin', name: 'OTP two' },
    ]]],
    [['GET /access/service_tokens', []]],
    [['GET /access/service_tokens', [
      { id: 'service-1', client_id: SENSITIVE.serviceClientId, name: 'one' },
      { id: 'service-2', client_id: SENSITIVE.serviceClientId, name: 'two' },
    ]]],
  ];

  for (const entries of cases) {
    const fake = createFakeClient(preflightResults(entries));
    await expectFixedRejection(() => preflightTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('unpaginated account lists fail closed at the Cloudflare default page boundary', async () => {
  const workerPage = [
    { id: WORKER_NAME },
    ...Array.from({ length: 19 }, (_, index) => ({ id: `other-worker-${index}` })),
  ];
  const preflightFake = createFakeClient(preflightResults([
    ['GET /workers/scripts', workerPage],
  ]));
  await expectFixedRejection(() => preflightTextPreview(
    loadTextPreviewConfig(validEnv()),
    preflightFake.client,
  ));

  const appPage = Array.from({ length: 20 }, (_, index) => ({
    id: `other-app-${index}`,
    name: `other-application-${index}`,
  }));
  const configureFake = createFakeClient(reconciliationResults({ apps: appPage }));
  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    configureFake.client,
  ));
  assert.equal(configureFake.calls.some(({ method }) => method !== 'GET'), false);
});

test('preflight rejects accessor/prototype API shapes and hides downstream errors', async () => {
  const inheritedToken = Object.create({ id: 'token-id', status: 'active' });
  const accessorToken = {};
  let getterReads = 0;
  Object.defineProperty(accessorToken, 'status', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'active';
    },
  });
  Object.defineProperty(accessorToken, 'id', { enumerable: true, value: 'token-id' });
  for (const tokenResult of [inheritedToken, accessorToken]) {
    const fake = createFakeClient(preflightResults([['GET /tokens/verify', tokenResult]]));
    await expectFixedRejection(() => preflightTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
  }
  assert.equal(getterReads, 0);

  const fake = createFakeClient(preflightResults([
    ['GET /pages/projects/tiezheng', () => {
      throw new Error(`${SENSITIVE.apiToken}:${SENSITIVE.user1}`);
    }],
  ]));
  await expectFixedRejection(() => preflightTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
});

test('configure creates only the two dedicated Access apps and exact three policies before preview-only Pages patch', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const projectAfter = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const fake = createFakeClient(reconciliationResults({ projectAfter }));

  const result = await reconcileTextPreview(config, fake.client);

  assert.deepEqual(result, {
    configured: true,
    userApp: { name: USER_APP_NAME, created: true },
    adminApp: { name: ADMIN_APP_NAME, created: true },
  });
  const writes = fake.calls.filter(({ method }) => method !== 'GET');
  assert.deepEqual(writes, [
    { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
    {
      method: 'POST',
      path: `/access/apps/${USER_APP_ID}/policies`,
      body: userPolicyPayload(),
    },
    { method: 'POST', path: '/access/apps', body: ADMIN_APP_PAYLOAD },
    {
      method: 'POST',
      path: `/access/apps/${ADMIN_APP_ID}/policies`,
      body: adminHumanPolicyPayload(),
    },
    {
      method: 'POST',
      path: `/access/apps/${ADMIN_APP_ID}/policies`,
      body: adminServicePolicyPayload(),
    },
    {
      method: 'PATCH',
      path: '/pages/projects/tiezheng',
      body: expectedPagesPatch(config),
    },
  ]);
  assert.equal(
    writes.some(({ body }) => Object.hasOwn(body ?? {}, 'production')),
    false,
  );
  const firstWriteIndex = fake.calls.findIndex(({ method }) => method !== 'GET');
  assert.deepEqual(
    fake.calls.slice(0, firstWriteIndex).map(({ method, path }) => `${method} ${path}`),
    [
      'GET /tokens/verify',
      `GET /tokens/${TOKEN_ID}`,
      'GET /tokens/permission_groups',
      'GET /pages/projects/tiezheng',
      'GET /workers/scripts',
      `GET /workers/scripts/${WORKER_NAME}/settings`,
      'GET /access/identity_providers',
      'GET /access/service_tokens',
      'GET /access/apps',
    ],
  );
});

test('configure updates existing exact apps and policies idempotently without creating duplicates', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: 'stale.example.test/api/nutrition/text',
  });
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const projectAfter = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const fake = createFakeClient(reconciliationResults({
    apps: [userApp, adminApp, { id: 'unrelated-id', aud: 'other-aud', name: 'other-app' }],
    projectAfter,
    extra: [
      [`GET /access/apps/${USER_APP_ID}/policies`, [
        policyResult('user-policy-id', userPolicyPayload([SENSITIVE.user2, SENSITIVE.user1])),
      ]],
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
        policyResult('admin-service-policy-id', adminServicePolicyPayload()),
      ]],
      [`PUT /access/apps/${USER_APP_ID}`, appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD)],
      [`PUT /access/apps/${USER_APP_ID}/policies/user-policy-id`,
        policyResult('user-policy-id', userPolicyPayload())],
    ],
  }));

  const result = await reconcileTextPreview(config, fake.client);

  assert.equal(result.userApp.created, false);
  assert.equal(result.adminApp.created, false);
  const writes = fake.calls.filter(({ method }) => method !== 'GET');
  assert.deepEqual(writes, [
    {
      method: 'PUT',
      path: `/access/apps/${USER_APP_ID}/policies/user-policy-id`,
      body: userPolicyPayload(),
    },
    { method: 'PUT', path: `/access/apps/${USER_APP_ID}`, body: USER_APP_PAYLOAD },
    {
      method: 'PATCH',
      path: '/pages/projects/tiezheng',
      body: expectedPagesPatch(config),
    },
  ]);
  const firstWriteIndex = fake.calls.findIndex(({ method }) => method !== 'GET');
  assert.deepEqual(
    fake.calls.slice(0, firstWriteIndex).map(({ path }) => path),
    [
      '/tokens/verify',
      `/tokens/${TOKEN_ID}`,
      '/tokens/permission_groups',
      '/pages/projects/tiezheng',
      '/workers/scripts',
      `/workers/scripts/${WORKER_NAME}/settings`,
      '/access/identity_providers',
      '/access/service_tokens',
      '/access/apps',
      `/access/apps/${USER_APP_ID}/policies`,
      `/access/apps/${ADMIN_APP_ID}/policies`,
    ],
  );
});

test('configure validates every drifted policy before migrating either existing app', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: 'stale-user.example.test/api/nutrition/text',
  });
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, {
    ...ADMIN_APP_PAYLOAD,
    domain: 'stale-admin.example.test/api/nutrition/text-admin',
  });
  const projectAfter = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const fake = createFakeClient(reconciliationResults({
    apps: [userApp, adminApp],
    projectAfter,
    extra: [
      [`GET /access/apps/${USER_APP_ID}/policies`, [
        policyResult('user-policy-id', {
          ...userPolicyPayload(),
          session_duration: '24h',
        }),
      ]],
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', {
          ...adminHumanPolicyPayload(),
          session_duration: '24h',
        }),
        policyResult('admin-service-policy-id', {
          ...adminServicePolicyPayload(),
          session_duration: '24h',
        }),
      ]],
      [`PUT /access/apps/${USER_APP_ID}/policies/user-policy-id`,
        policyResult('user-policy-id', userPolicyPayload())],
      [`PUT /access/apps/${USER_APP_ID}`,
        appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD)],
      [`PUT /access/apps/${ADMIN_APP_ID}/policies/admin-human-policy-id`,
        policyResult('admin-human-policy-id', adminHumanPolicyPayload())],
      [`PUT /access/apps/${ADMIN_APP_ID}/policies/admin-service-policy-id`,
        policyResult('admin-service-policy-id', adminServicePolicyPayload())],
      [`PUT /access/apps/${ADMIN_APP_ID}`,
        appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD)],
    ],
  }));

  await reconcileTextPreview(config, fake.client);

  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET').slice(0, 5), [
    {
      method: 'PUT',
      path: `/access/apps/${USER_APP_ID}/policies/user-policy-id`,
      body: userPolicyPayload(),
    },
    {
      method: 'PUT',
      path: `/access/apps/${ADMIN_APP_ID}/policies/admin-human-policy-id`,
      body: adminHumanPolicyPayload(),
    },
    {
      method: 'PUT',
      path: `/access/apps/${ADMIN_APP_ID}/policies/admin-service-policy-id`,
      body: adminServicePolicyPayload(),
    },
    { method: 'PUT', path: `/access/apps/${USER_APP_ID}`, body: USER_APP_PAYLOAD },
    { method: 'PUT', path: `/access/apps/${ADMIN_APP_ID}`, body: ADMIN_APP_PAYLOAD },
  ]);
});

test('configure never migrates an existing app or patches Pages after a policy write failure', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: 'stale-user.example.test/api/nutrition/text',
  });
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, {
    ...ADMIN_APP_PAYLOAD,
    domain: 'stale-admin.example.test/api/nutrition/text-admin',
  });
  const cases = [
    {
      failingPath: `/access/apps/${USER_APP_ID}/policies/user-policy-id`,
      userPolicy: { ...userPolicyPayload(), session_duration: '24h' },
      adminHumanPolicy: adminHumanPolicyPayload(),
    },
    {
      failingPath: `/access/apps/${ADMIN_APP_ID}/policies/admin-human-policy-id`,
      userPolicy: userPolicyPayload(),
      adminHumanPolicy: { ...adminHumanPolicyPayload(), session_duration: '24h' },
    },
  ];

  for (const { failingPath, userPolicy, adminHumanPolicy } of cases) {
    const fake = createFakeClient(reconciliationResults({
      apps: [userApp, adminApp],
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicy),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
          policyResult('admin-human-policy-id', adminHumanPolicy),
          policyResult('admin-service-policy-id', adminServicePolicyPayload()),
        ]],
        [`PUT ${failingPath}`, () => {
          throw new Error(`${SENSITIVE.apiToken}:${SENSITIVE.user1}`);
        }],
      ],
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

    const writes = fake.calls.filter(({ method }) => method !== 'GET');
    assert.equal(writes.at(-1).path, failingPath);
    assert.equal(writes.some(({ path }) => path === `/access/apps/${USER_APP_ID}`), false);
    assert.equal(writes.some(({ path }) => path === `/access/apps/${ADMIN_APP_ID}`), false);
    assert.equal(writes.some(({ method }) => method === 'PATCH'), false);
  }
});

test('configure correlates existing policy and app PUT responses to the exact URL resource ID', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const staleUser = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: 'stale-user.example.test/api/nutrition/text',
  });
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const expectedProject = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const cases = [
    {
      userPolicy: { ...userPolicyPayload(), session_duration: '24h' },
      extraWrites: [
        [`PUT /access/apps/${USER_APP_ID}/policies/user-policy-id`,
          policyResult('other-policy-id', userPolicyPayload())],
        [`PUT /access/apps/${USER_APP_ID}`,
          appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD)],
      ],
      expectedWrites: [{
        method: 'PUT',
        path: `/access/apps/${USER_APP_ID}/policies/user-policy-id`,
        body: userPolicyPayload(),
      }],
    },
    {
      userPolicy: userPolicyPayload(),
      extraWrites: [[`PUT /access/apps/${USER_APP_ID}`,
        appResult('other-app-id', USER_AUDIENCE, USER_APP_PAYLOAD)]],
      expectedWrites: [{
        method: 'PUT',
        path: `/access/apps/${USER_APP_ID}`,
        body: USER_APP_PAYLOAD,
      }],
    },
  ];

  for (const { userPolicy, extraWrites, expectedWrites } of cases) {
    const fake = createFakeClient(reconciliationResults({
      apps: [staleUser, adminApp],
      projectAfter: expectedProject,
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicy),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
          policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
          policyResult('admin-service-policy-id', adminServicePolicyPayload()),
        ]],
        ...extraWrites,
      ],
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), expectedWrites);
  }
});

test('configure rejects a newly created app ID that collides with an observed dedicated app', async () => {
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const fake = createFakeClient(reconciliationResults({
    apps: [adminApp],
    extra: [
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
        policyResult('admin-service-policy-id', adminServicePolicyPayload()),
      ]],
      ['POST /access/apps', appResult(ADMIN_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD)],
    ],
  }));

  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
    { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
  ]);
});

test('configure rejects a newly created app ID that collides with any observed Access app', async () => {
  const unrelatedAppId = 'unrelated-existing-app-id';
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const fake = createFakeClient(reconciliationResults({
    apps: [
      { id: unrelatedAppId, name: 'unrelated-existing-app' },
      adminApp,
    ],
    extra: [
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
        policyResult('admin-service-policy-id', adminServicePolicyPayload()),
      ]],
      ['POST /access/apps', appResult(unrelatedAppId, USER_AUDIENCE, USER_APP_PAYLOAD)],
    ],
  }));

  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
    { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
  ]);
});

test('configure stops before Pages when a new app receives duplicate policy IDs', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const expectedProject = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const fake = createFakeClient(reconciliationResults({
    projectAfter: expectedProject,
    extra: [[
      `POST /access/apps/${ADMIN_APP_ID}/policies`,
      ({ body }) => policyResult('shared-new-policy-id', body),
    ]],
  }));

  await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
    { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
    {
      method: 'POST',
      path: `/access/apps/${USER_APP_ID}/policies`,
      body: userPolicyPayload(),
    },
    { method: 'POST', path: '/access/apps', body: ADMIN_APP_PAYLOAD },
    {
      method: 'POST',
      path: `/access/apps/${ADMIN_APP_ID}/policies`,
      body: adminHumanPolicyPayload(),
    },
    {
      method: 'POST',
      path: `/access/apps/${ADMIN_APP_ID}/policies`,
      body: adminServicePolicyPayload(),
    },
  ]);
  assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
});

test('configure tracks newly created policy IDs for existing apps before Pages', async () => {
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const cases = [
    {
      response: ({ body }) => policyResult('shared-created-policy-id', body),
      expectedPolicyPosts: 2,
    },
    {
      response: ({ body }) => policyResult(USER_APP_ID, body),
      expectedPolicyPosts: 1,
    },
  ];

  for (const { response, expectedPolicyPosts } of cases) {
    const fake = createFakeClient(reconciliationResults({
      apps: [userApp, adminApp],
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicyPayload()),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, []],
        [`POST /access/apps/${ADMIN_APP_ID}/policies`, response],
      ],
    }));

    await expectFixedRejection(() => reconcileTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(
      fake.calls.filter(({ method, path }) => (
        method === 'POST' && path === `/access/apps/${ADMIN_APP_ID}/policies`
      )).length,
      expectedPolicyPosts,
    );
    assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
  }
});

test('configure stops before new admin policies when created app audiences collide', async () => {
  const fake = createFakeClient(reconciliationResults({
    extra: [[
      'POST /access/apps',
      ({ body }) => body.name === USER_APP_NAME
        ? appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD)
        : appResult(ADMIN_APP_ID, USER_AUDIENCE, ADMIN_APP_PAYLOAD),
    ]],
  }));

  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
    { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
    {
      method: 'POST',
      path: `/access/apps/${USER_APP_ID}/policies`,
      body: userPolicyPayload(),
    },
    { method: 'POST', path: '/access/apps', body: ADMIN_APP_PAYLOAD },
  ]);
  assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
});

test('configure rejects duplicate dedicated app IDs before policy reads', async () => {
  const sharedId = 'shared-dedicated-app-id';
  const fake = createFakeClient(reconciliationResults({
    apps: [
      appResult(sharedId, USER_AUDIENCE, USER_APP_PAYLOAD),
      appResult(sharedId, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD),
    ],
  }));

  await expectFixedRejection(() => reconcileTextPreview(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.equal(fake.calls.some(({ path }) => path.includes('/policies')), false);
  assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
});

test('configure fails before every write on duplicate/fuzzy apps, unknown policies, or unknown preview keys', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const cases = [
    reconciliationResults({ apps: [userApp, userApp] }),
    reconciliationResults({
      apps: [{ id: 'fuzzy-id', aud: 'fuzzy-aud', name: `${USER_APP_NAME}-old` }],
    }),
    reconciliationResults({
      apps: [userApp, adminApp],
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('unknown-policy-id', { ...userPolicyPayload(), name: 'unexpected-policy' }),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, []],
      ],
    }),
    reconciliationResults({
      apps: [userApp, adminApp],
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicyPayload()),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
          policyResult('shared-policy-id', adminHumanPolicyPayload()),
          policyResult('shared-policy-id', adminServicePolicyPayload()),
        ]],
      ],
    }),
    reconciliationResults({
      apps: [
        userApp,
        appResult(ADMIN_APP_ID, USER_AUDIENCE, ADMIN_APP_PAYLOAD),
      ],
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicyPayload()),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
          policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
          policyResult('admin-service-policy-id', adminServicePolicyPayload()),
        ]],
      ],
    }),
    reconciliationResults({
      projectBefore: projectWithPreview({
        env_vars: { UNKNOWN_PREVIEW_KEY: { type: 'plain_text', value: 'danger' } },
        services: {},
      }),
    }),
    reconciliationResults({
      projectBefore: projectWithPreview({
        env_vars: {},
        services: { UNKNOWN_BINDING: { service: 'other', environment: 'production' } },
      }),
    }),
  ];

  for (const results of cases) {
    const fake = createFakeClient(results);
    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('configure fails before every write on any nonempty unowned Preview binding container', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const bindingContainers = [
    'kv_namespaces',
    'd1_databases',
    'ai_bindings',
    'queue_producers',
    'vectorize_bindings',
    'analytics_engine_datasets',
    'browsers',
    'durable_object_namespaces',
    'hyperdrive_bindings',
    'mtls_certificates',
    'r2_buckets',
  ];

  for (const container of bindingContainers) {
    const fake = createFakeClient(reconciliationResults({
      projectBefore: projectWithPreview({
        env_vars: {},
        services: {},
        [container]: { EXISTING_BINDING: { id: 'resource-id' } },
      }),
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false, container);
  }
});

test('configure rejects unknown Preview top-level fields even when their containers are empty', async () => {
  const previews = [
    {
      env_vars: {},
      services: {},
      unknown_binding_container: {},
    },
    JSON.parse('{"__proto__":"unknown-field","env_vars":{},"services":{}}'),
    JSON.parse('{"__proto__":null,"env_vars":{},"services":{}}'),
    JSON.parse('{"constructor":"unknown-field","env_vars":{},"services":{}}'),
    JSON.parse('{"prototype":"unknown-field","env_vars":{},"services":{}}'),
  ];

  for (const preview of previews) {
    const fake = createFakeClient(reconciliationResults({
      projectBefore: projectWithPreview(preview),
    }));

    await expectFixedRejection(() => reconcileTextPreview(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('configure rechecks Preview immediately before PATCH and stops on late binding drift', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const expectedPreview = expectedPagesPatch(config).deployment_configs.preview;
  const fake = createFakeClient(reconciliationResults({
    projectBefore: projectResult(),
    projectRecheck: projectWithPreview({
      env_vars: {},
      services: {},
      kv_namespaces: { LATE_BINDING: { namespace_id: 'late-id' } },
    }),
    projectAfter: projectWithPreview(expectedPreview),
    patchProject: projectWithPreview(expectedPreview),
  }));

  await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

  const pageCalls = fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng');
  assert.deepEqual(pageCalls.map(({ method }) => method), ['GET', 'GET']);
  assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
});

test('configure preserves every allowed nonowned Preview behavior across PATCH response and final GET', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const nonowned = {
    compatibility_date: '2026-08-25',
    compatibility_flags: ['nodejs_compat', 'streams_enable_constructors'],
    always_use_latest_compatibility_date: false,
    placement: { mode: 'smart' },
    limits: { cpu_ms: 50 },
    fail_open: false,
    usage_model: 'standard',
  };
  const beforePreview = {
    ...nonowned,
    env_vars: {},
    services: {},
    kv_namespaces: {},
    d1_databases: {},
    ai_bindings: {},
    queue_producers: {},
    vectorize_bindings: {},
    wrangler_config_hash: null,
  };
  const expectedPreview = {
    ...nonowned,
    ...expectedPagesPatch(config).deployment_configs.preview,
    wrangler_config_hash: 'b'.repeat(64),
  };
  const stableProject = projectWithPreview(expectedPreview);
  const recheckedPreview = structuredClone(beforePreview);
  recheckedPreview.compatibility_flags.reverse();
  recheckedPreview.wrangler_config_hash = 'a'.repeat(64);
  const fake = createFakeClient(reconciliationResults({
    projectBefore: projectWithPreview(beforePreview),
    projectRecheck: projectWithPreview(recheckedPreview),
    patchProject: stableProject,
    projectAfter: stableProject,
  }));

  await assert.doesNotReject(() => reconcileTextPreview(config, fake.client));

  const patch = fake.calls.find(({ method }) => method === 'PATCH');
  assert.deepEqual(Object.keys(patch.body.deployment_configs.preview).sort(), ['env_vars', 'services']);
});

test('configure rejects nonowned Preview behavior drift in PATCH response or final GET', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const nonowned = {
    compatibility_date: '2026-08-25',
    compatibility_flags: ['nodejs_compat'],
    placement: { mode: 'smart' },
  };
  const before = projectWithPreview({ ...nonowned, env_vars: {}, services: {} });
  const expected = {
    ...nonowned,
    ...expectedPagesPatch(config).deployment_configs.preview,
  };
  const drifted = {
    ...expected,
    placement: { mode: 'off' },
  };
  const cases = [
    {
      patchProject: projectWithPreview(drifted),
      projectAfter: projectWithPreview(expected),
      expectedPageMethods: ['GET', 'GET', 'PATCH'],
    },
    {
      patchProject: projectWithPreview(expected),
      projectAfter: projectWithPreview(drifted),
      expectedPageMethods: ['GET', 'GET', 'PATCH', 'GET'],
    },
  ];

  for (const { patchProject, projectAfter, expectedPageMethods } of cases) {
    const fake = createFakeClient(reconciliationResults({
      projectBefore: before,
      projectRecheck: before,
      patchProject,
      projectAfter,
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.deepEqual(
      fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng').map(({ method }) => method),
      expectedPageMethods,
    );
  }
});

test('configure preserves dangerous own keys when hashing nested nonowned Preview behavior', async () => {
  const config = loadTextPreviewConfig(validEnv());
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const beforeLimits = JSON.parse(`{"cpu_ms":50,"${key}":"before"}`);
    const afterLimits = JSON.parse(`{"cpu_ms":50,"${key}":"after"}`);
    const beforePreview = { env_vars: {}, services: {}, limits: beforeLimits };
    const recheckedPreview = { env_vars: {}, services: {}, limits: afterLimits };
    const expectedPreview = {
      ...expectedPagesPatch(config).deployment_configs.preview,
      limits: beforeLimits,
    };
    const fake = createFakeClient(reconciliationResults({
      projectBefore: projectWithPreview(beforePreview),
      projectRecheck: projectWithPreview(recheckedPreview),
      patchProject: projectWithPreview(expectedPreview),
      projectAfter: projectWithPreview(expectedPreview),
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.deepEqual(
      fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng').map(({ method }) => method),
      ['GET', 'GET'],
    );
    assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
  }
});

test('configure hashes nested secret-shaped behavior outside env_vars for Preview and production', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const fakeSecret = (value) => ({
    nested: { type: 'secret_text', value },
  });
  const expectedPreview = {
    ...expectedPagesPatch(config).deployment_configs.preview,
    limits: fakeSecret('before'),
  };
  const baseProduction = projectResult().deployment_configs.production;
  const cases = [
    {
      projectBefore: projectWithPreview({
        env_vars: {},
        services: {},
        limits: fakeSecret('before'),
      }),
      projectRecheck: projectWithPreview({
        env_vars: {},
        services: {},
        limits: fakeSecret('after'),
      }),
      stableProject: projectWithPreview(expectedPreview),
    },
    {
      projectBefore: projectWithPreview(
        { env_vars: {}, services: {} },
        { ...baseProduction, limits: fakeSecret('before') },
      ),
      projectRecheck: projectWithPreview(
        { env_vars: {}, services: {} },
        { ...baseProduction, limits: fakeSecret('after') },
      ),
      stableProject: projectWithPreview(
        expectedPagesPatch(config).deployment_configs.preview,
        { ...baseProduction, limits: fakeSecret('before') },
      ),
    },
  ];

  for (const { projectBefore, projectRecheck, stableProject } of cases) {
    const fake = createFakeClient(reconciliationResults({
      projectBefore,
      projectRecheck,
      patchProject: stableProject,
      projectAfter: stableProject,
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.deepEqual(
      fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng').map(({ method }) => method),
      ['GET', 'GET'],
    );
    assert.equal(fake.calls.some(({ method }) => method === 'PATCH'), false);
  }
});

test('configure fails before writes when another Access app occupies either exact target domain', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const fullPreview = expectedPagesPatch(config).deployment_configs.preview;
  const unrelatedOccupant = appResult('unrelated-id', 'unrelated-aud', {
    ...USER_APP_PAYLOAD,
    name: 'unrelated-application',
  });
  const swappedUser = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: ADMIN_APP_PAYLOAD.domain,
  });
  const swappedAdmin = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, {
    ...ADMIN_APP_PAYLOAD,
    domain: USER_APP_PAYLOAD.domain,
  });
  const cases = [
    reconciliationResults({
      apps: [unrelatedOccupant],
      projectAfter: projectWithPreview(fullPreview),
    }),
    reconciliationResults({
      apps: [swappedUser, swappedAdmin],
      projectAfter: projectWithPreview(fullPreview),
      extra: [
        [`GET /access/apps/${USER_APP_ID}/policies`, [
          policyResult('user-policy-id', userPolicyPayload()),
        ]],
        [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
          policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
          policyResult('admin-service-policy-id', adminServicePolicyPayload()),
        ]],
      ],
    }),
  ];

  for (const results of cases) {
    const fake = createFakeClient(results);
    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
    assert.equal(fake.calls.some(({ method }) => method !== 'GET'), false);
  }
});

test('configure stops after a create response that does not match every desired app field', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const fullProject = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const staleResponses = [
    { domain: 'stale.example.test/api/nutrition/text' },
    { type: 'saas' },
    { session_duration: '1h' },
    { app_launcher_visible: true },
  ];

  for (const stale of staleResponses) {
    const fake = createFakeClient(reconciliationResults({
      projectAfter: fullProject,
      extra: [[
        'POST /access/apps',
        appResult(USER_APP_ID, USER_AUDIENCE, { ...USER_APP_PAYLOAD, ...stale }),
      ]],
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

    assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
      { method: 'POST', path: '/access/apps', body: USER_APP_PAYLOAD },
    ]);
  }
});

test('configure stops after an update response that remains stale before policy or Pages writes', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const staleUser = appResult(USER_APP_ID, USER_AUDIENCE, {
    ...USER_APP_PAYLOAD,
    domain: 'stale.example.test/api/nutrition/text',
  });
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const fake = createFakeClient(reconciliationResults({
    apps: [staleUser, adminApp],
    projectAfter: projectWithPreview(expectedPagesPatch(config).deployment_configs.preview),
    extra: [
      [`GET /access/apps/${USER_APP_ID}/policies`, [
        policyResult('user-policy-id', userPolicyPayload()),
      ]],
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
        policyResult('admin-service-policy-id', adminServicePolicyPayload()),
      ]],
      [`PUT /access/apps/${USER_APP_ID}`, appResult(USER_APP_ID, USER_AUDIENCE, {
        ...USER_APP_PAYLOAD,
        domain: 'still-stale.example.test/api/nutrition/text',
      })],
    ],
  }));

  await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

  assert.deepEqual(fake.calls.filter(({ method }) => method !== 'GET'), [
    { method: 'PUT', path: `/access/apps/${USER_APP_ID}`, body: USER_APP_PAYLOAD },
  ]);
});

test('configure detects production deployment drift after patch without ever sending production config', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const beforeProduction = projectResult().deployment_configs.production;
  const afterProduction = {
    ...beforeProduction,
    env_vars: {
      ...beforeProduction.env_vars,
      ACCIDENTAL_PRODUCTION_CHANGE: { type: 'plain_text', value: 'changed' },
    },
  };
  const projectAfter = projectWithPreview(
    expectedPagesPatch(config).deployment_configs.preview,
    afterProduction,
  );
  const fake = createFakeClient(reconciliationResults({
    projectRecheck: projectResult(),
    projectAfter,
  }));

  await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

  const pagesPatches = fake.calls.filter(({ method, path }) => (
    method === 'PATCH' && path === '/pages/projects/tiezheng'
  ));
  assert.equal(pagesPatches.length, 1);
  assert.deepEqual(Object.keys(pagesPatches[0].body.deployment_configs), ['preview']);
});

test('configure rejects an incomplete PATCH response before the final Pages GET', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const fullProject = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const fake = createFakeClient(reconciliationResults({
    patchProject: projectWithPreview({ env_vars: {}, services: {} }),
    projectAfter: fullProject,
  }));

  await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

  const pageCalls = fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng');
  assert.deepEqual(pageCalls.map(({ method }) => method), ['GET', 'GET', 'PATCH']);
  assert.deepEqual(Object.keys(pageCalls[2].body.deployment_configs), ['preview']);
});

test('configure rejects incomplete or stale final Preview state after a valid PATCH response', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const expectedPreview = expectedPagesPatch(config).deployment_configs.preview;
  const patchProject = projectWithPreview(expectedPreview);
  const stalePlain = structuredClone(expectedPreview);
  stalePlain.env_vars.PHOTO_AI_TEAM_DOMAIN.value = 'stale-team';
  const badBinding = structuredClone(expectedPreview);
  badBinding.services.PHOTO_AI_GATEWAY.service = 'wrong-worker';
  const badSecretType = structuredClone(expectedPreview);
  badSecretType.env_vars.TEXT_AI_ACCESS_AUD.type = 'plain_text';
  const cases = [
    { env_vars: {}, services: {} },
    stalePlain,
    badBinding,
    badSecretType,
  ];

  for (const preview of cases) {
    const fake = createFakeClient(reconciliationResults({
      patchProject,
      projectAfter: projectWithPreview(preview),
    }));

    await expectFixedRejection(() => reconcileTextPreview(config, fake.client));

    const patches = fake.calls.filter(({ method, path }) => (
      method === 'PATCH' && path === '/pages/projects/tiezheng'
    ));
    assert.equal(patches.length, 1);
    assert.deepEqual(Object.keys(patches[0].body.deployment_configs), ['preview']);
    assert.equal(
      fake.calls.filter(({ method, path }) => method === 'GET' && path === '/pages/projects/tiezheng').length,
      3,
    );
  }
});

test('configure rejects non-string secret values before redaction in PATCH response or final GET', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const expectedPreview = expectedPagesPatch(config).deployment_configs.preview;
  const validProject = projectWithPreview(expectedPreview);
  const invalidValues = [42, true, { nested: SENSITIVE.apiToken }];

  for (const invalidValue of invalidValues) {
    const invalidPreview = structuredClone(expectedPreview);
    invalidPreview.env_vars.TEXT_AI_ACCESS_AUD.value = invalidValue;
    const invalidProject = projectWithPreview(invalidPreview);
    const cases = [
      {
        patchProject: invalidProject,
        projectAfter: validProject,
        expectedPageMethods: ['GET', 'GET', 'PATCH'],
      },
      {
        patchProject: validProject,
        projectAfter: invalidProject,
        expectedPageMethods: ['GET', 'GET', 'PATCH', 'GET'],
      },
    ];

    for (const { patchProject, projectAfter, expectedPageMethods } of cases) {
      const fake = createFakeClient(reconciliationResults({
        projectRecheck: projectResult(),
        patchProject,
        projectAfter,
      }));

      await expectFixedRejection(() => reconcileTextPreview(config, fake.client));
      assert.deepEqual(
        fake.calls.filter(({ path }) => path === '/pages/projects/tiezheng').map(({ method }) => method),
        expectedPageMethods,
      );
    }
  }
});

test('configure accepts complete secret_text entries when Cloudflare omits or redacts secret values', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const preview = structuredClone(expectedPagesPatch(config).deployment_configs.preview);
  const secretNames = [
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_ACCESS_AUD',
    'TEXT_AI_ALLOWED_EMAILS',
    'TEXT_AI_ADMIN_ACCESS_AUD',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_ADMIN_SERVICE_CLIENT_ID',
  ];
  for (const [index, name] of secretNames.entries()) {
    if (index % 3 === 0) delete preview.env_vars[name].value;
    if (index % 3 === 1) preview.env_vars[name].value = null;
    if (index % 3 === 2) preview.env_vars[name].value = '[redacted]';
  }
  const project = projectWithPreview(preview);
  const fake = createFakeClient(reconciliationResults({
    patchProject: project,
    projectAfter: project,
  }));

  await assert.doesNotReject(() => reconcileTextPreview(config, fake.client));
});

test('production redacted hash ignores only secret_text value rotation while preserving structure checks', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const beforeProduction = projectResult().deployment_configs.production;
  const afterProduction = structuredClone(beforeProduction);
  afterProduction.env_vars.EXISTING_PRODUCTION_SECRET.value = 'different-private-secret';
  const projectAfter = projectWithPreview(
    expectedPagesPatch(config).deployment_configs.preview,
    afterProduction,
  );
  const fake = createFakeClient(reconciliationResults({ projectAfter }));

  await assert.doesNotReject(() => reconcileTextPreview(config, fake.client));
});

test('disable-access reads and validates both dedicated apps before deleting only their exact IDs', async () => {
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const fake = createFakeClient(new Map([
    ['GET /access/apps', [
      userApp,
      { id: 'unrelated-id', aud: 'unrelated-aud', name: 'unrelated-application' },
      adminApp,
    ]],
    [`GET /access/apps/${USER_APP_ID}/policies`, [
      policyResult('user-policy-id', userPolicyPayload()),
    ]],
    [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
      policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
      policyResult('admin-service-policy-id', adminServicePolicyPayload()),
    ]],
    [`DELETE /access/apps/${USER_APP_ID}`, { id: USER_APP_ID }],
    [`DELETE /access/apps/${ADMIN_APP_ID}`, { id: ADMIN_APP_ID }],
  ]));

  const result = await disableTextPreviewAccess(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  );

  assert.deepEqual(result, {
    disabled: true,
    deletedApps: [USER_APP_NAME, ADMIN_APP_NAME],
  });
  assert.deepEqual(fake.calls, [
    { method: 'GET', path: '/access/apps', body: undefined },
    { method: 'GET', path: `/access/apps/${USER_APP_ID}/policies`, body: undefined },
    { method: 'GET', path: `/access/apps/${ADMIN_APP_ID}/policies`, body: undefined },
    { method: 'DELETE', path: `/access/apps/${USER_APP_ID}`, body: undefined },
    { method: 'DELETE', path: `/access/apps/${ADMIN_APP_ID}`, body: undefined },
  ]);
});

test('disable-access can remove exact dedicated apps whose audiences collide', async () => {
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const adminApp = appResult(ADMIN_APP_ID, USER_AUDIENCE, ADMIN_APP_PAYLOAD);
  const fake = createFakeClient(new Map([
    ['GET /access/apps', [userApp, adminApp]],
    [`GET /access/apps/${USER_APP_ID}/policies`, [
      policyResult('user-policy-id', userPolicyPayload()),
    ]],
    [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
      policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
      policyResult('admin-service-policy-id', adminServicePolicyPayload()),
    ]],
    [`DELETE /access/apps/${USER_APP_ID}`, { id: USER_APP_ID }],
    [`DELETE /access/apps/${ADMIN_APP_ID}`, { id: ADMIN_APP_ID }],
  ]));

  const result = await disableTextPreviewAccess(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  );

  assert.deepEqual(result, {
    disabled: true,
    deletedApps: [USER_APP_NAME, ADMIN_APP_NAME],
  });
  assert.deepEqual(fake.calls.filter(({ method }) => method === 'DELETE'), [
    { method: 'DELETE', path: `/access/apps/${USER_APP_ID}`, body: undefined },
    { method: 'DELETE', path: `/access/apps/${ADMIN_APP_ID}`, body: undefined },
  ]);
});

test('disable-access is idempotent when exact apps are absent and never deletes unrelated apps', async () => {
  const fake = createFakeClient(new Map([
    ['GET /access/apps', [
      { id: 'unrelated-id', aud: 'unrelated-aud', name: 'another-team-application' },
    ]],
  ]));

  const result = await disableTextPreviewAccess(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  );

  assert.deepEqual(result, { disabled: true, deletedApps: [] });
  assert.equal(fake.calls.some(({ method }) => method === 'DELETE'), false);
});

test('disable-access validates both exact-name app domains and types before deleting either candidate', async () => {
  const exactUser = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const exactAdmin = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const cases = [
    [
      appResult(USER_APP_ID, USER_AUDIENCE, {
        ...USER_APP_PAYLOAD,
        domain: 'tiezheng.pages.dev/api/nutrition/text',
      }),
      exactAdmin,
    ],
    [
      exactUser,
      appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, {
        ...ADMIN_APP_PAYLOAD,
        type: 'saas',
      }),
    ],
  ];

  for (const apps of cases) {
    const fake = createFakeClient(new Map([
      ['GET /access/apps', apps],
      [`GET /access/apps/${USER_APP_ID}/policies`, [
        policyResult('user-policy-id', userPolicyPayload()),
      ]],
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, [
        policyResult('admin-human-policy-id', adminHumanPolicyPayload()),
        policyResult('admin-service-policy-id', adminServicePolicyPayload()),
      ]],
      [`DELETE /access/apps/${USER_APP_ID}`, { id: USER_APP_ID }],
      [`DELETE /access/apps/${ADMIN_APP_ID}`, { id: ADMIN_APP_ID }],
    ]));

    await expectFixedRejection(() => disableTextPreviewAccess(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method === 'DELETE'), false);
  }
});

test('disable-access rejects duplicate IDs across the full Access app list before policy reads', async () => {
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const fake = createFakeClient(new Map([
    ['GET /access/apps', [
      userApp,
      { id: USER_APP_ID, aud: 'unrelated-aud', name: 'unrelated-application' },
    ]],
    [`GET /access/apps/${USER_APP_ID}/policies`, [
      policyResult('user-policy-id', userPolicyPayload()),
    ]],
    [`DELETE /access/apps/${USER_APP_ID}`, { id: USER_APP_ID }],
  ]));

  await expectFixedRejection(() => disableTextPreviewAccess(
    loadTextPreviewConfig(validEnv()),
    fake.client,
  ));
  assert.equal(fake.calls.some(({ path }) => path.includes('/policies')), false);
  assert.equal(fake.calls.some(({ method }) => method === 'DELETE'), false);
});

test('disable-access fails before any delete on duplicate, fuzzy, accessor, or unknown-policy drift', async () => {
  const userApp = appResult(USER_APP_ID, USER_AUDIENCE, USER_APP_PAYLOAD);
  const adminApp = appResult(ADMIN_APP_ID, ADMIN_AUDIENCE, ADMIN_APP_PAYLOAD);
  const accessorApp = { id: USER_APP_ID, aud: USER_AUDIENCE };
  Object.defineProperty(accessorApp, 'name', {
    enumerable: true,
    get() {
      throw new Error(SENSITIVE.serviceClientSecret);
    },
  });
  const cases = [
    new Map([['GET /access/apps', [userApp, userApp]]]),
    new Map([['GET /access/apps', [
      { id: 'fuzzy-id', aud: 'fuzzy-aud', name: `${ADMIN_APP_NAME}-backup` },
    ]]]),
    new Map([['GET /access/apps', [accessorApp]]]),
    new Map([
      ['GET /access/apps', [userApp, adminApp]],
      [`GET /access/apps/${USER_APP_ID}/policies`, [
        policyResult('unknown-policy-id', { ...userPolicyPayload(), name: 'unknown-policy' }),
      ]],
      [`GET /access/apps/${ADMIN_APP_ID}/policies`, []],
    ]),
  ];

  for (const results of cases) {
    const fake = createFakeClient(results);
    await expectFixedRejection(() => disableTextPreviewAccess(
      loadTextPreviewConfig(validEnv()),
      fake.client,
    ));
    assert.equal(fake.calls.some(({ method }) => method === 'DELETE'), false);
  }
});

test('invoke-admin accepts only six fixed operations and two logical targets with exact service request shape', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return adminResponse();
  };

  for (const operation of ADMIN_OPERATIONS) {
    for (const target of ['user-1', 'user-2']) {
      const result = await invokeTextPreviewAdmin(
        config,
        { operation, target },
        fetcher,
        { generateOperationId: () => OPERATION_ID },
      );
      assert.deepEqual(result, {
        operation,
        textGlobalEnabled: false,
        accountEnabled: false,
        accountRemaining: 10,
        globalRemaining: 30,
        budgetSpentMicros: 1_000_000,
        budgetReservedMicros: 0,
        resetAt: RESET_AT,
      });
    }
  }

  assert.equal(calls.length, 12);
  for (let index = 0; index < calls.length; index += 1) {
    const { url, init } = calls[index];
    const operation = ADMIN_OPERATIONS[Math.floor(index / 2)];
    const target = index % 2 === 0 ? 'user-1' : 'user-2';
    assert.equal(url, `${PREVIEW_ORIGIN}/api/nutrition/text-admin/account`);
    assert.deepEqual(init, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'cf-access-client-id': SENSITIVE.serviceClientId,
        'cf-access-client-secret': SENSITIVE.serviceClientSecret,
        origin: PREVIEW_ORIGIN,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        operationId: OPERATION_ID,
        operation,
        targetEmail: target === 'user-1' ? SENSITIVE.user1 : SENSITIVE.user2,
      }),
      signal: init.signal,
    });
    assert.equal(init.signal instanceof AbortSignal, true);
    assert.equal(init.signal.aborted, false);
    assert.equal(url.includes('@'), false);
    assert.equal(JSON.stringify(init.headers).includes('@'), false);
  }
});

test('invoke-admin output is an operation/status whitelist with no identity, operation ID, audience, or secret', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const result = await invokeTextPreviewAdmin(
    config,
    { operation: 'status', target: 'user-1' },
    async () => adminResponse(),
    { generateOperationId: () => OPERATION_ID },
  );
  const serialized = JSON.stringify(result);

  assert.deepEqual(Object.keys(result), [
    'operation',
    'textGlobalEnabled',
    'accountEnabled',
    'accountRemaining',
    'globalRemaining',
    'budgetSpentMicros',
    'budgetReservedMicros',
    'resetAt',
  ]);
  for (const forbidden of [
    ...Object.values(SENSITIVE),
    USER_AUDIENCE,
    ADMIN_AUDIENCE,
    OPERATION_ID,
    'accountKey',
    'targetEmail',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('invoke-admin rejects extra/accessor/coercible options and invalid operation IDs before fetch', async () => {
  let fetchCalls = 0;
  let generatorCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return adminResponse();
  };
  const generate = () => {
    generatorCalls += 1;
    return OPERATION_ID;
  };
  const accessor = { target: 'user-1' };
  Object.defineProperty(accessor, 'operation', {
    enumerable: true,
    get() {
      throw new Error(SENSITIVE.apiToken);
    },
  });
  const invalidOptions = [
    { operation: 'unknown', target: 'user-1' },
    { operation: 'status', target: 'user-3' },
    { operation: new String('status'), target: 'user-1' },
    { operation: 'status', target: { toString: () => 'user-1' } },
    { operation: 'status', target: 'user-1', email: SENSITIVE.user1 },
    accessor,
  ];

  for (const options of invalidOptions) {
    await expectFixedRejection(() => invokeTextPreviewAdmin(
      loadTextPreviewConfig(validEnv()),
      options,
      fetcher,
      { generateOperationId: generate },
    ));
  }
  await expectFixedRejection(() => invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-1' },
    fetcher,
    { generateOperationId: () => 'A'.repeat(32) },
  ));
  assert.equal(fetchCalls, 0);
  assert.equal(generatorCalls, 0);
});

test('invoke-admin rejects inherited, accessor, coercible, or extra runtime dependencies before fetch', async () => {
  let fetchCalls = 0;
  let accessorReads = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return adminResponse();
  };
  const inherited = Object.create({ generateOperationId: () => OPERATION_ID });
  const accessor = {};
  Object.defineProperty(accessor, 'generateOperationId', {
    enumerable: true,
    get() {
      accessorReads += 1;
      throw new Error(SENSITIVE.serviceClientSecret);
    },
  });
  const invalidDependencies = [
    inherited,
    accessor,
    { generateOperationId: new String(OPERATION_ID) },
    { generateOperationId: () => OPERATION_ID, secret: SENSITIVE.apiToken },
    { setTimeout: { call: () => undefined } },
    { clearTimeout: null },
  ];

  for (const dependencies of invalidDependencies) {
    await expectFixedRejection(() => invokeTextPreviewAdmin(
      loadTextPreviewConfig(validEnv()),
      { operation: 'status', target: 'user-1' },
      fetcher,
      dependencies,
    ));
  }
  assert.equal(fetchCalls, 0);
  assert.equal(accessorReads, 0);
});

test('redacted admin parser enforces the Task2 exact response contract and operation correlation', () => {
  assert.deepEqual(
    parseRedactedAdminResponse(adminSuccess(), OPERATION_ID),
    adminSuccess().status,
  );

  const inherited = Object.create(adminSuccess());
  const extra = { ...adminSuccess(), targetEmail: SENSITIVE.user1 };
  const invalid = [
    inherited,
    extra,
    adminSuccess('2'.repeat(32)),
    { ok: false, code: 'service-disabled' },
    adminSuccess(OPERATION_ID, { accountRemaining: 11 }),
    adminSuccess(OPERATION_ID, { globalRemaining: 31 }),
    adminSuccess(OPERATION_ID, { budgetSpentMicros: -0 }),
    adminSuccess(OPERATION_ID, { budgetReservedMicros: Number.MAX_SAFE_INTEGER + 1 }),
    adminSuccess(OPERATION_ID, { resetAt: '2026-08-26' }),
    { ...adminSuccess(), status: { ...adminSuccess().status, accountKey: 'f'.repeat(64) } },
  ];
  for (const body of invalid) {
    expectFixedFailure(() => parseRedactedAdminResponse(body, OPERATION_ID));
  }
});

test('invoke-admin rejects redirects, unsafe headers, correlation errors, fatal UTF-8, and streamed overflow', async () => {
  const invalidResponses = [
    new Response(JSON.stringify(adminSuccess()), {
      status: 302,
      headers: { location: 'https://evil.example.test' },
    }),
    adminResponse(adminSuccess(), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }),
    adminResponse(adminSuccess(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public',
        'x-content-type-options': 'nosniff',
      },
    }),
    adminResponse(adminSuccess('2'.repeat(32))),
    new Response(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }),
    new Response(`{"ok":true,"padding":"${'x'.repeat(65_537)}"}`, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': '1',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }),
  ];

  for (const response of invalidResponses) {
    await expectFixedRejection(() => invokeTextPreviewAdmin(
      loadTextPreviewConfig(validEnv()),
      { operation: 'status', target: 'user-1' },
      async () => response,
      { generateOperationId: () => OPERATION_ID },
    ));
  }
});

test('invoke-admin hides fetch and response failures containing every sensitive value', async () => {
  const leaked = Object.values(SENSITIVE).join(':');
  await expectFixedRejection(() => invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-1' },
    async () => {
      throw new Error(leaked);
    },
    { generateOperationId: () => OPERATION_ID },
  ));
  await expectFixedRejection(() => invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-1' },
    async () => adminResponse({ ok: false, code: leaked }),
    { generateOperationId: () => OPERATION_ID },
  ));
});

test('invoke-admin aborts a fetch that ignores signal at one fixed deadline and clears its timer', async () => {
  const runtime = manualInvokeDependencies();
  let rejectFetch;
  let signal;
  const pending = invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-1' },
    async (_url, init) => {
      signal = init.signal;
      return new Promise((_, reject) => {
        rejectFetch = reject;
      });
    },
    runtime.dependencies,
  );
  pending.catch(() => undefined);

  await Promise.resolve();
  assert.equal(runtime.setCalls(), 1);
  assert.equal(runtime.activeCount(), 1);
  runtime.fire();

  await expectFixedRejection(() => pending);
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(signal.aborted, true);
  assert.equal(runtime.activeCount(), 0);
  assert.equal(runtime.clearCalls(), 1);
  rejectFetch(new Error(`${SENSITIVE.serviceClientSecret}:${SENSITIVE.user1}`));
  await Promise.resolve();
  await Promise.resolve();
});

test('invoke-admin cancels a response body that resolves only after the fetch deadline wins', async () => {
  const runtime = manualInvokeDependencies();
  let resolveFetch;
  let cancelCalls = 0;
  let signal;
  const lateResponse = new Response(new ReadableStream({
    cancel() {
      cancelCalls += 1;
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
  const pending = invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-1' },
    async (_url, init) => {
      signal = init.signal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
    runtime.dependencies,
  );
  pending.catch(() => undefined);

  await Promise.resolve();
  runtime.fire();
  await expectFixedRejection(() => pending);
  assert.equal(signal.aborted, true);
  assert.equal(cancelCalls, 0);

  resolveFetch(lateResponse);
  for (let index = 0; index < 16 && cancelCalls === 0; index += 1) {
    await Promise.resolve();
  }

  assert.equal(cancelCalls, 1);
  assert.equal(lateResponse.body.locked, false);
  assert.equal(runtime.activeCount(), 0);
  assert.equal(runtime.clearCalls(), 1);
});

test('invoke-admin applies the same deadline to a stalled response body and cancels the reader', async () => {
  const runtime = manualInvokeDependencies();
  let cancelCalls = 0;
  let signal;
  const response = new Response(new ReadableStream({
    pull() {
      return new Promise(() => undefined);
    },
    cancel() {
      cancelCalls += 1;
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
  const pending = invokeTextPreviewAdmin(
    loadTextPreviewConfig(validEnv()),
    { operation: 'status', target: 'user-2' },
    async (_url, init) => {
      signal = init.signal;
      return response;
    },
    runtime.dependencies,
  );
  pending.catch(() => undefined);

  for (let index = 0; index < 8 && !response.body.locked; index += 1) {
    await Promise.resolve();
  }
  assert.equal(runtime.setCalls(), 1);
  assert.equal(runtime.activeCount(), 1);
  assert.equal(response.body.locked, true);
  runtime.fire();

  await expectFixedRejection(() => pending);
  assert.equal(signal instanceof AbortSignal, true);
  assert.equal(signal.aborted, true);
  assert.equal(cancelCalls, 1);
  assert.equal(response.body.locked, false);
  assert.equal(runtime.activeCount(), 0);
  assert.equal(runtime.clearCalls(), 1);
});

test('invoke-admin clears the single deadline after success, fetch error, and read error', async () => {
  const config = loadTextPreviewConfig(validEnv());
  const invalidBody = new Response('{', {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
  const cases = [
    {
      fetcher: async () => adminResponse(),
      succeeds: true,
    },
    {
      fetcher: async () => {
        throw new Error(`${SENSITIVE.apiToken}:${SENSITIVE.user2}`);
      },
      succeeds: false,
    },
    {
      fetcher: async () => invalidBody,
      succeeds: false,
    },
  ];

  for (const { fetcher, succeeds } of cases) {
    const runtime = manualInvokeDependencies();
    const action = () => invokeTextPreviewAdmin(
      config,
      { operation: 'status', target: 'user-1' },
      fetcher,
      runtime.dependencies,
    );
    if (succeeds) await assert.doesNotReject(action);
    else await expectFixedRejection(action);
    assert.equal(runtime.setCalls(), 1);
    assert.equal(runtime.activeCount(), 0);
    assert.equal(runtime.clearCalls(), 1);
  }
  assert.equal(invalidBody.body.locked, false);
});

test('CLI accepts only four exact commands and emits only fixed redacted JSON', async () => {
  const stdout = [];
  const stderr = [];
  const config = loadTextPreviewConfig(validEnv());
  const projectAfter = projectWithPreview(expectedPagesPatch(config).deployment_configs.preview);
  const configureFake = createFakeClient(reconciliationResults({ projectAfter }));
  const preflightFake = createFakeClient();
  const disableFake = createFakeClient(new Map([
    ['GET /access/apps', []],
  ]));
  const clients = [preflightFake.client, configureFake.client, disableFake.client];
  let clientIndex = 0;
  const dependencies = {
    clientFactory: () => clients[clientIndex++],
    fetcher: async () => adminResponse(),
    generateOperationId: () => OPERATION_ID,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  };

  assert.equal(await runTextPreviewControlCli(['preflight'], validEnv(), dependencies), 0);
  assert.equal(await runTextPreviewControlCli(['configure'], validEnv(), dependencies), 0);
  assert.equal(await runTextPreviewControlCli(['disable-access'], validEnv(), dependencies), 0);
  assert.equal(await runTextPreviewControlCli([
    'invoke-admin',
    '--operation=status',
    '--target=user-2',
  ], validEnv(), dependencies), 0);

  assert.deepEqual(stdout.map((line) => JSON.parse(line)), [
    { command: 'preflight', status: 'ready', workerTextEnabled: false },
    { command: 'configure', status: 'configured' },
    { command: 'disable-access', status: 'disabled', deletedApps: [] },
    {
      operation: 'status',
      textGlobalEnabled: false,
      accountEnabled: false,
      accountRemaining: 10,
      globalRemaining: 30,
      budgetSpentMicros: 1_000_000,
      budgetReservedMicros: 0,
      resetAt: RESET_AT,
    },
  ]);
  assert.deepEqual(stderr, []);
  const output = stdout.join('');
  for (const forbidden of [
    ...Object.values(SENSITIVE),
    USER_AUDIENCE,
    ADMIN_AUDIENCE,
    OPERATION_ID,
    'accountKey',
    'targetEmail',
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
});

test('CLI disable-access uses only account credentials and fails before fetch when either is missing', async () => {
  const minimalEnv = {
    CLOUDFLARE_ACCOUNT_ID: SENSITIVE.accountId,
    CLOUDFLARE_API_TOKEN: SENSITIVE.apiToken,
  };
  const stdout = [];
  const stderr = [];
  const receivedConfigs = [];
  let clientCalls = 0;
  let fetchCalls = 0;
  const dependencies = {
    clientFactory: (config) => {
      clientCalls += 1;
      receivedConfigs.push(config);
      return createFakeClient(new Map([['GET /access/apps', []]])).client;
    },
    fetcher: async () => {
      fetchCalls += 1;
      return adminResponse();
    },
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  };

  assert.equal(await runTextPreviewControlCli(['disable-access'], minimalEnv, dependencies), 0);
  assert.deepEqual(Object.keys(receivedConfigs[0]).sort(), [
    'accountId',
    'apiToken',
  ]);
  assert.equal(clientCalls, 1);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(stdout.map((line) => JSON.parse(line)), [{
    command: 'disable-access',
    status: 'disabled',
    deletedApps: [],
  }]);

  for (const missingKey of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
    const invalidEnv = { ...minimalEnv };
    delete invalidEnv[missingKey];
    assert.equal(await runTextPreviewControlCli(['disable-access'], invalidEnv, dependencies), 1);
  }
  assert.equal(clientCalls, 1);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(stderr, [
    'Text preview control failed\n',
    'Text preview control failed\n',
  ]);
  const output = [...stdout, ...stderr].join('');
  for (const secret of Object.values(SENSITIVE)) {
    assert.equal(output.includes(secret), false);
  }
});

test('CLI preflight, configure, and invoke-admin retain the full configuration boundary', async () => {
  let clientCalls = 0;
  let fetchCalls = 0;
  const dependencies = {
    clientFactory: () => {
      clientCalls += 1;
      return createFakeClient().client;
    },
    fetcher: async () => {
      fetchCalls += 1;
      return adminResponse();
    },
    writeStdout: () => undefined,
    writeStderr: () => undefined,
  };
  const minimalEnv = {
    CLOUDFLARE_ACCOUNT_ID: SENSITIVE.accountId,
    CLOUDFLARE_API_TOKEN: SENSITIVE.apiToken,
  };

  assert.equal(await runTextPreviewControlCli(['preflight'], minimalEnv, dependencies), 1);
  assert.equal(await runTextPreviewControlCli(['configure'], minimalEnv, dependencies), 1);
  assert.equal(await runTextPreviewControlCli([
    'invoke-admin',
    '--operation=status',
    '--target=user-1',
  ], minimalEnv, dependencies), 1);
  assert.equal(clientCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('CLI rejects unknown, reordered, extra, coercible, and accessor arguments without API or fetch calls', async () => {
  let clientCalls = 0;
  let fetchCalls = 0;
  const stdout = [];
  const stderr = [];
  const dependencies = {
    clientFactory: () => {
      clientCalls += 1;
      return createFakeClient().client;
    },
    fetcher: async () => {
      fetchCalls += 1;
      return adminResponse();
    },
    generateOperationId: () => OPERATION_ID,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  };
  const accessorArgs = ['preflight'];
  Object.defineProperty(accessorArgs, '0', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error(SENSITIVE.apiToken);
    },
  });
  const invalid = [
    [],
    ['unknown'],
    ['preflight', '--extra'],
    ['invoke-admin', '--target=user-1', '--operation=status'],
    ['invoke-admin', '--operation=status', '--target=user-3'],
    ['invoke-admin', '--operation=status', `--target=user-1=${SENSITIVE.user1}`],
    [new String('preflight')],
    accessorArgs,
  ];

  for (const argv of invalid) {
    assert.equal(await runTextPreviewControlCli(argv, validEnv(), dependencies), 1);
  }

  assert.equal(clientCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, invalid.map(() => 'Text preview control failed\n'));
  assert.equal(stderr.join('').includes(SENSITIVE.apiToken), false);
});

test('CLI import has no side effects and implementation contains no console object logging', async () => {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  const writes = [];
  try {
    process.stdout.write = ((value) => {
      writes.push(String(value));
      return true;
    });
    process.stderr.write = ((value) => {
      writes.push(String(value));
      return true;
    });
    await import('./text-ai-preview-control.mjs?side-effect-check');
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
  assert.deepEqual(writes, []);

  const source = await readFile(resolve(process.cwd(), 'scripts/text-ai-preview-control.mjs'), 'utf8');
  assert.equal(/console\.(?:log|error|warn|info)\s*\(/u.test(source), false);
});
