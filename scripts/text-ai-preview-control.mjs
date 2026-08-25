import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCloudflareClient } from './cloudflare-api.mjs';

const FAILURE_MESSAGE = 'Text preview control failed';
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const TEAM_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_PATTERN = /^(?=.{3,254}$)(?=.{1,64}@)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SERVICE_CLIENT_ID_PATTERN = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/;
const MAX_SECRET_LENGTH = 4_096;
const WORKER_NAME = 'tiezheng-photo-ai-gateway';
const PAGES_PROJECT_NAME = 'tiezheng';
const USER_APP_NAME = 'tiezheng-text-ai-preview-users';
const ADMIN_APP_NAME = 'tiezheng-text-ai-preview-admin';
const DEDICATED_APP_PREFIX = 'tiezheng-text-ai-preview-';
const PREVIEW_HOST = 'text-ai-preview.tiezheng.pages.dev';
const PREVIEW_ORIGIN = `https://${PREVIEW_HOST}`;
const USER_APP_DOMAIN = `${PREVIEW_HOST}/api/nutrition/text`;
const ADMIN_APP_DOMAIN = `${PREVIEW_HOST}/api/nutrition/text-admin`;
const EXPECTED_PREVIEW_ENV_NAMES = new Set([
  'PHOTO_AI_TEAM_DOMAIN',
  'PHOTO_AI_ALLOWED_ORIGINS',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_ACCESS_AUD',
  'TEXT_AI_ALLOWED_EMAILS',
  'TEXT_AI_ALLOWED_EMAIL_COUNT',
  'TEXT_AI_ADMIN_ACCESS_AUD',
  'TEXT_AI_ADMIN_EMAIL',
  'TEXT_AI_ADMIN_SERVICE_CLIENT_ID',
]);
const EXPECTED_PREVIEW_SERVICE_NAMES = new Set(['PHOTO_AI_GATEWAY']);
const PREVIEW_BINDING_CONTAINER_NAMES = Object.freeze([
  'ai_bindings',
  'analytics_engine_datasets',
  'browsers',
  'd1_databases',
  'durable_object_namespaces',
  'hyperdrive_bindings',
  'kv_namespaces',
  'mtls_certificates',
  'queue_producers',
  'r2_buckets',
  'services',
  'vectorize_bindings',
]);
const PREVIEW_NON_BINDING_NAMES = Object.freeze([
  'always_use_latest_compatibility_date',
  'compatibility_date',
  'compatibility_flags',
  'fail_open',
  'limits',
  'placement',
  'usage_model',
]);
const PREVIEW_TOP_LEVEL_NAMES = new Set([
  'env_vars',
  'wrangler_config_hash',
  ...PREVIEW_BINDING_CONTAINER_NAMES,
  ...PREVIEW_NON_BINDING_NAMES,
]);
const ADMIN_OPERATIONS = new Set([
  'status',
  'enable-text-global',
  'disable-text-global',
  'enable-account',
  'disable-account',
  'delete-account',
]);
const OPERATION_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_ADMIN_RESPONSE_BYTES = 65_536;
const ADMIN_DEADLINE_MS = 20_000;
const CLOUDFLARE_DEFAULT_PAGE_SIZE = 20;
const ACCOUNT_PERMISSION_SCOPE = 'com.cloudflare.api.account';
const REQUIRED_TOKEN_CAPABILITY_ALIASES = Object.freeze([
  Object.freeze(['Account API Tokens Read']),
  Object.freeze(['Workers Scripts Edit', 'Workers Scripts Write']),
  Object.freeze(['Cloudflare Pages Edit', 'Pages Write']),
  Object.freeze(['Access: Apps and Policies Edit', 'Access: Apps and Policies Write']),
  Object.freeze([
    'Access: Identity Providers Read',
    'Access: Organizations, Identity Providers, and Groups Read',
  ]),
  Object.freeze(['Access: Service Tokens Read']),
]);
const VALID_CONFIGS = new WeakSet();
const VALID_CLOUDFLARE_CONFIGS = new WeakSet();

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function ownDataValue(record, key, required = true) {
  try {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) {
      if (required) fail();
      return undefined;
    }
    if (!Object.hasOwn(descriptor, 'value')) fail();
    return descriptor.value;
  } catch {
    fail();
  }
}

function snapshotRecord(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const snapshot = new Map();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    fail();
  }
}

function snapshotArray(value) {
  try {
    if (!Array.isArray(value)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    const length = descriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) fail();
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const itemDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (itemDescriptor === undefined || !Object.hasOwn(itemDescriptor, 'value')) fail();
      items.push(itemDescriptor.value);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) fail();
    }
    return items;
  } catch {
    fail();
  }
}

function snapshotUnpaginatedList(value) {
  const items = snapshotArray(value);
  if (items.length >= CLOUDFLARE_DEFAULT_PAGE_SIZE) fail();
  return items;
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^(?=.{1,255}$)[A-Za-z0-9._-]+$/.test(value);
}

function configIsValid(config) {
  return config !== null && typeof config === 'object' && VALID_CONFIGS.has(config);
}

function cloudflareConfigIsValid(config) {
  return (
    config !== null
    && typeof config === 'object'
    && VALID_CLOUDFLARE_CONFIGS.has(config)
  );
}

function clientGet(client) {
  return clientMethod(client, 'get');
}

function clientMethod(client, name) {
  const method = ownDataValue(client, name);
  if (typeof method !== 'function') fail();
  return method;
}

function defineClonedData(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneJsonValue(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 20_000 || depth > 64) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail();
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(snapshotArray(value).map((item) => cloneJsonValue(item, state, depth + 1)));
  }
  if (typeof value !== 'object') fail();
  const snapshot = snapshotRecord(value);
  const clone = {};
  for (const [key, item] of snapshot) {
    defineClonedData(clone, key, cloneJsonValue(item, state, depth + 1));
  }
  return Object.freeze(clone);
}

function cloneRedactedJsonValue(
  value,
  state = { nodes: 0 },
  depth = 0,
  path = [],
  envVarEntry = false,
) {
  state.nodes += 1;
  if (state.nodes > 20_000 || depth > 64) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail();
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      snapshotArray(value).map((item, index) => cloneRedactedJsonValue(
        item,
        state,
        depth + 1,
        [...path, String(index)],
        false,
      )),
    );
  }
  if (typeof value !== 'object') fail();
  const snapshot = snapshotRecord(value);
  const secretText = envVarEntry && snapshot.get('type') === 'secret_text';
  const clone = {};
  for (const [key, item] of snapshot) {
    if (secretText && key === 'value' && item !== null && typeof item !== 'string') fail();
    defineClonedData(
      clone,
      key,
      secretText && key === 'value'
        ? '[redacted]'
        : cloneRedactedJsonValue(
          item,
          state,
          depth + 1,
          [...path, key],
          path.length === 1 && path[0] === 'env_vars',
        ),
    );
  }
  return Object.freeze(clone);
}

function requiredString(record, key, validator) {
  const value = ownDataValue(record, key);
  if (typeof value !== 'string' || !validator(value)) fail();
  return value;
}

function isSecret(value, minimumLength = 1) {
  return (
    value.length >= minimumLength
    && value.length <= MAX_SECRET_LENGTH
    && !/\s|[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isNormalizedEmail(value) {
  return EMAIL_PATTERN.test(value);
}

function parseCloudflareCredentials(env) {
  return Object.freeze({
    accountId: requiredString(
      env,
      'CLOUDFLARE_ACCOUNT_ID',
      (value) => ACCOUNT_ID_PATTERN.test(value),
    ),
    apiToken: requiredString(env, 'CLOUDFLARE_API_TOKEN', (value) => isSecret(value)),
  });
}

function loadCloudflareControlConfig(env) {
  try {
    const config = parseCloudflareCredentials(env);
    VALID_CLOUDFLARE_CONFIGS.add(config);
    return config;
  } catch {
    fail();
  }
}

export function loadTextPreviewConfig(env) {
  try {
    const { accountId, apiToken } = parseCloudflareCredentials(env);
    const teamDomain = requiredString(env, 'TEXT_AI_TEAM_DOMAIN', (value) => TEAM_DOMAIN_PATTERN.test(value));
    const countValue = requiredString(env, 'TEXT_AI_ALLOWED_EMAIL_COUNT', (value) => value === '2' || value === '3');
    const allowedEmailCount = Number(countValue);
    const user1Email = requiredString(env, 'TEXT_AI_USER_1_EMAIL', isNormalizedEmail);
    const user2Email = requiredString(env, 'TEXT_AI_USER_2_EMAIL', isNormalizedEmail);
    const adminEmail = requiredString(env, 'TEXT_AI_ADMIN_EMAIL', isNormalizedEmail);
    const serviceClientId = requiredString(
      env,
      'TEXT_AI_CF_ACCESS_CLIENT_ID',
      (value) => SERVICE_CLIENT_ID_PATTERN.test(value),
    );
    const serviceClientSecret = requiredString(
      env,
      'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
      (value) => isSecret(value),
    );
    const accountHmacKey = requiredString(
      env,
      'PHOTO_AI_ACCOUNT_HMAC_KEY',
      (value) => isSecret(value, 32),
    );
    const thirdValue = ownDataValue(env, 'TEXT_AI_USER_3_EMAIL', false);

    if (user1Email === user2Email || adminEmail !== user1Email) fail();

    let user3Email;
    if (allowedEmailCount === 3) {
      if (typeof thirdValue !== 'string' || !isNormalizedEmail(thirdValue)) fail();
      if (thirdValue === user1Email || thirdValue === user2Email) fail();
      user3Email = thirdValue;
    } else if (thirdValue !== undefined) {
      fail();
    }

    const allowedEmailList = Object.freeze([
      user1Email,
      user2Email,
      ...(user3Email === undefined ? [] : [user3Email]),
    ]);

    const config = Object.freeze({
      accountId,
      apiToken,
      teamDomain,
      allowedEmailCount,
      allowedEmailList,
      allowedEmails: allowedEmailList.join(','),
      user1Email,
      user2Email,
      ...(user3Email === undefined ? {} : { user3Email }),
      adminEmail,
      serviceClientId,
      serviceClientSecret,
      accountHmacKey,
    });
    VALID_CONFIGS.add(config);
    VALID_CLOUDFLARE_CONFIGS.add(config);
    return config;
  } catch {
    fail();
  }
}

function parseTokenVerification(value) {
  const snapshot = snapshotRecord(value);
  const id = snapshot.get('id');
  if (
    snapshot.size !== 2
    || !safeIdentifier(id)
    || snapshot.get('status') !== 'active'
  ) {
    fail();
  }
  return id;
}

function rejectPrototypeKeys(snapshot) {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (snapshot.has(key)) fail();
  }
}

function validPermissionName(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parsePermissionGroupCatalog(value) {
  const catalog = new Map();
  for (const item of snapshotArray(value)) {
    const snapshot = snapshotRecord(item);
    rejectPrototypeKeys(snapshot);
    const id = snapshot.get('id');
    const name = snapshot.get('name');
    const scopes = snapshotArray(snapshot.get('scopes'));
    if (
      !safeIdentifier(id)
      || !validPermissionName(name)
      || catalog.has(id)
      || scopes.length !== 1
      || scopes[0] !== ACCOUNT_PERMISSION_SCOPE
    ) {
      fail();
    }
    catalog.set(id, name);
  }
  if (catalog.size === 0) fail();
  return catalog;
}

function parseTokenDetails(value, tokenId, accountId, permissionCatalog) {
  const token = snapshotRecord(value);
  rejectPrototypeKeys(token);
  if (
    token.get('id') !== tokenId
    || token.get('status') !== 'active'
    || !token.has('policies')
  ) {
    fail();
  }

  const expectedResourceKey = `${ACCOUNT_PERMISSION_SCOPE}.${accountId}`;
  const capabilities = new Set();
  const observedPermissionGroupIds = new Set();
  const policies = snapshotArray(token.get('policies'));
  if (policies.length === 0) fail();

  for (const policyValue of policies) {
    const policy = snapshotRecord(policyValue);
    rejectPrototypeKeys(policy);
    if (policy.get('effect') !== 'allow') fail();
    if (policy.has('id') && !safeIdentifier(policy.get('id'))) fail();

    const resources = snapshotRecord(policy.get('resources'));
    rejectPrototypeKeys(resources);
    if (
      resources.size !== 1
      || !resources.has(expectedResourceKey)
      || resources.get(expectedResourceKey) !== '*'
    ) {
      fail();
    }

    const groups = snapshotArray(policy.get('permission_groups'));
    if (groups.length === 0) fail();
    for (const groupValue of groups) {
      const group = snapshotRecord(groupValue);
      rejectPrototypeKeys(group);
      const id = group.get('id');
      if (
        !safeIdentifier(id)
        || observedPermissionGroupIds.has(id)
        || !permissionCatalog.has(id)
        || (group.has('name') && !validPermissionName(group.get('name')))
      ) {
        fail();
      }
      observedPermissionGroupIds.add(id);
      const name = permissionCatalog.get(id);
      for (let index = 0; index < REQUIRED_TOKEN_CAPABILITY_ALIASES.length; index += 1) {
        if (REQUIRED_TOKEN_CAPABILITY_ALIASES[index].includes(name)) capabilities.add(index);
      }
    }
  }

  if (capabilities.size !== REQUIRED_TOKEN_CAPABILITY_ALIASES.length) fail();
}

function parsePagesProject(value) {
  const snapshot = snapshotRecord(value);
  if (
    !safeIdentifier(snapshot.get('id'))
    || snapshot.get('name') !== PAGES_PROJECT_NAME
    || snapshot.get('production_branch') !== 'main'
  ) {
    fail();
  }
  const deploymentConfigs = snapshotRecord(snapshot.get('deployment_configs'));
  if (!deploymentConfigs.has('production') || !deploymentConfigs.has('preview')) fail();
  return Object.freeze({
    id: snapshot.get('id'),
    name: PAGES_PROJECT_NAME,
    production_branch: 'main',
    deployment_configs: Object.freeze({
      production: cloneRedactedJsonValue(deploymentConfigs.get('production')),
      preview: cloneRedactedJsonValue(deploymentConfigs.get('preview')),
    }),
  });
}

function requireSingleBy(items, predicate) {
  const matches = [];
  for (const item of snapshotUnpaginatedList(items)) {
    const snapshot = snapshotRecord(item);
    if (predicate(snapshot)) matches.push(snapshot);
  }
  if (matches.length !== 1) fail();
  return matches[0];
}

function parseWorkerList(value) {
  requireSingleBy(value, (snapshot) => snapshot.get('id') === WORKER_NAME);
}

function parseWorkerSettings(value) {
  const settings = snapshotRecord(value);
  const bindings = snapshotArray(settings.get('bindings'));
  const flags = new Map([
    ['PHOTO_AI_GATEWAY_ENABLED', []],
    ['TEXT_AI_GATEWAY_ENABLED', []],
  ]);
  for (const bindingValue of bindings) {
    const binding = snapshotRecord(bindingValue);
    const type = binding.get('type');
    const name = binding.get('name');
    if (!safeIdentifier(type) || !safeIdentifier(name)) fail();
    if (flags.has(name)) flags.get(name).push(binding);
  }
  const parsed = {};
  for (const [name, matches] of flags) {
    if (matches.length !== 1) fail();
    const flag = matches[0];
    if (
      flag.get('type') !== 'plain_text'
      || (flag.get('text') !== 'false' && flag.get('text') !== 'true')
    ) {
      fail();
    }
    parsed[name] = flag.get('text') === 'true';
  }
  return Object.freeze({
    photoAiGatewayEnabled: parsed.PHOTO_AI_GATEWAY_ENABLED,
    workerTextEnabled: parsed.TEXT_AI_GATEWAY_ENABLED,
  });
}

function parseOtpProvider(value) {
  const provider = requireSingleBy(value, (snapshot) => snapshot.get('type') === 'onetimepin');
  const id = provider.get('id');
  if (!safeIdentifier(id)) fail();
  return id;
}

function parseServiceToken(value, clientId) {
  const token = requireSingleBy(value, (snapshot) => snapshot.get('client_id') === clientId);
  const id = token.get('id');
  if (!safeIdentifier(id)) fail();
  return id;
}

export async function preflightTextPreview(config, client) {
  try {
    if (!configIsValid(config)) fail();
    const get = clientGet(client);

    const tokenId = parseTokenVerification(await get('/tokens/verify'));
    const tokenDetails = await get(`/tokens/${tokenId}`);
    const permissionCatalog = parsePermissionGroupCatalog(
      await get('/tokens/permission_groups'),
    );
    parseTokenDetails(tokenDetails, tokenId, config.accountId, permissionCatalog);
    const project = parsePagesProject(await get('/pages/projects/tiezheng'));
    parseWorkerList(await get('/workers/scripts'));
    const workerSettings = parseWorkerSettings(
      await get(`/workers/scripts/${WORKER_NAME}/settings`),
    );
    if (workerSettings.photoAiGatewayEnabled) fail();
    const otpProviderId = parseOtpProvider(await get('/access/identity_providers'));
    const serviceTokenId = parseServiceToken(
      await get('/access/service_tokens'),
      config.serviceClientId,
    );

    return Object.freeze({
      project,
      workerName: WORKER_NAME,
      otpProviderId,
      serviceTokenId,
      photoAiGatewayEnabled: workerSettings.photoAiGatewayEnabled,
      workerTextEnabled: workerSettings.workerTextEnabled,
    });
  } catch {
    fail();
  }
}

function desiredUserApp() {
  return Object.freeze({
    name: USER_APP_NAME,
    domain: USER_APP_DOMAIN,
    type: 'self_hosted',
    session_duration: '30m',
    app_launcher_visible: false,
  });
}

function desiredAdminApp() {
  return Object.freeze({
    name: ADMIN_APP_NAME,
    domain: ADMIN_APP_DOMAIN,
    type: 'self_hosted',
    session_duration: '30m',
    app_launcher_visible: false,
  });
}

function parseDedicatedApp(value, expectedName) {
  const snapshot = snapshotRecord(value);
  const id = snapshot.get('id');
  const aud = snapshot.get('aud');
  const name = snapshot.get('name');
  if (!safeIdentifier(id) || !safeIdentifier(aud) || name !== expectedName) fail();
  for (const key of ['domain', 'type', 'session_duration']) {
    if (typeof snapshot.get(key) !== 'string') fail();
  }
  if (typeof snapshot.get('app_launcher_visible') !== 'boolean') fail();
  return Object.freeze({ value: cloneJsonValue(value), snapshot, id, aud, name });
}

function scanDedicatedApps(value) {
  const matches = new Map([
    [USER_APP_NAME, []],
    [ADMIN_APP_NAME, []],
  ]);
  const seenIds = new Set();
  for (const item of snapshotUnpaginatedList(value)) {
    const snapshot = snapshotRecord(item);
    const id = snapshot.get('id');
    const name = snapshot.get('name');
    const domain = snapshot.get('domain');
    if (!safeIdentifier(id) || typeof name !== 'string' || seenIds.has(id)) fail();
    seenIds.add(id);
    if (domain !== undefined && typeof domain !== 'string') fail();
    if (
      (domain === USER_APP_DOMAIN && name !== USER_APP_NAME)
      || (domain === ADMIN_APP_DOMAIN && name !== ADMIN_APP_NAME)
    ) {
      fail();
    }
    if (name.startsWith(DEDICATED_APP_PREFIX) && !matches.has(name)) fail();
    if (matches.has(name)) matches.get(name).push(item);
  }
  for (const resources of matches.values()) {
    if (resources.length > 1) fail();
  }
  return Object.freeze({
    observedAppIds: Object.freeze([...seenIds]),
    user: matches.get(USER_APP_NAME).length === 0
      ? undefined
      : parseDedicatedApp(matches.get(USER_APP_NAME)[0], USER_APP_NAME),
    admin: matches.get(ADMIN_APP_NAME).length === 0
      ? undefined
      : parseDedicatedApp(matches.get(ADMIN_APP_NAME)[0], ADMIN_APP_NAME),
  });
}

function appMatches(app, desired) {
  return (
    app.snapshot.get('name') === desired.name
    && app.snapshot.get('domain') === desired.domain
    && app.snapshot.get('type') === desired.type
    && app.snapshot.get('session_duration') === desired.session_duration
    && app.snapshot.get('app_launcher_visible') === desired.app_launcher_visible
  );
}

function parseWrittenApp(value, desired) {
  const app = parseDedicatedApp(value, desired.name);
  if (!appMatches(app, desired)) fail();
  return app;
}

function desiredUserPolicy(config, otpProviderId) {
  return Object.freeze({
    name: `${USER_APP_NAME}-allow`,
    decision: 'allow',
    session_duration: '30m',
    include: config.allowedEmailList.map((email) => ({ email: { email } })),
    require: [{ login_method: { id: otpProviderId } }],
    exclude: [],
  });
}

function desiredAdminHumanPolicy(config, otpProviderId) {
  return Object.freeze({
    name: `${ADMIN_APP_NAME}-human`,
    decision: 'allow',
    session_duration: '30m',
    include: [{ email: { email: config.adminEmail } }],
    require: [{ login_method: { id: otpProviderId } }],
    exclude: [],
  });
}

function desiredAdminServicePolicy(serviceTokenId) {
  return Object.freeze({
    name: `${ADMIN_APP_NAME}-service`,
    decision: 'non_identity',
    session_duration: '30m',
    include: [{ service_token: { token_id: serviceTokenId } }],
    require: [],
    exclude: [],
  });
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${snapshotArray(value).map((item) => stableJson(item)).join(',')}]`;
  }
  const snapshot = snapshotRecord(value);
  const keys = [...snapshot.keys()].sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(snapshot.get(key))}`).join(',')}}`;
}

function policyComparable(policySnapshot) {
  const comparable = {};
  for (const key of ['name', 'decision', 'session_duration', 'include', 'require', 'exclude']) {
    if (!policySnapshot.has(key)) fail();
    comparable[key] = cloneJsonValue(policySnapshot.get(key));
  }
  return comparable;
}

function parsePolicies(value, expectedNames, observedResourceIds = new Set()) {
  const result = new Map();
  for (const item of snapshotUnpaginatedList(value)) {
    cloneJsonValue(item);
    const snapshot = snapshotRecord(item);
    const id = snapshot.get('id');
    const name = snapshot.get('name');
    if (
      !safeIdentifier(id)
      || typeof name !== 'string'
      || !expectedNames.has(name)
      || result.has(name)
      || observedResourceIds.has(id)
    ) {
      fail();
    }
    observedResourceIds.add(id);
    result.set(name, Object.freeze({ id, snapshot }));
  }
  return result;
}

function parseDeletedApp(value, expectedId) {
  const snapshot = snapshotRecord(value);
  if (snapshot.size !== 1 || snapshot.get('id') !== expectedId) fail();
}

function appIsExactDisableTarget(app, desired) {
  return (
    app.snapshot.get('name') === desired.name
    && app.snapshot.get('domain') === desired.domain
    && app.snapshot.get('type') === desired.type
  );
}

function inspectDedicatedAppIdentities(apps) {
  const resourceIds = new Set(apps.observedAppIds);
  const audiences = new Set();
  for (const app of [apps.user, apps.admin]) {
    if (app === undefined) continue;
    if (audiences.has(app.aud)) fail();
    audiences.add(app.aud);
  }
  return { resourceIds, audiences };
}

export async function disableTextPreviewAccess(config, client) {
  try {
    if (!cloudflareConfigIsValid(config)) fail();
    const get = clientGet(client);
    const remove = clientMethod(client, 'delete');
    const apps = scanDedicatedApps(await get('/access/apps'));
    if (
      (apps.user !== undefined && !appIsExactDisableTarget(apps.user, desiredUserApp()))
      || (apps.admin !== undefined && !appIsExactDisableTarget(apps.admin, desiredAdminApp()))
    ) {
      fail();
    }
    const observedResourceIds = new Set(apps.observedAppIds);

    if (apps.user !== undefined) {
      parsePolicies(
        await get(`/access/apps/${apps.user.id}/policies`),
        new Set([`${USER_APP_NAME}-allow`]),
        observedResourceIds,
      );
    }
    if (apps.admin !== undefined) {
      parsePolicies(
        await get(`/access/apps/${apps.admin.id}/policies`),
        new Set([`${ADMIN_APP_NAME}-human`, `${ADMIN_APP_NAME}-service`]),
        observedResourceIds,
      );
    }

    const deletedApps = [];
    if (apps.user !== undefined) {
      parseDeletedApp(await remove(`/access/apps/${apps.user.id}`), apps.user.id);
      deletedApps.push(USER_APP_NAME);
    }
    if (apps.admin !== undefined) {
      parseDeletedApp(await remove(`/access/apps/${apps.admin.id}`), apps.admin.id);
      deletedApps.push(ADMIN_APP_NAME);
    }

    return { disabled: true, deletedApps };
  } catch {
    fail();
  }
}

function isNonNegativeInteger(value) {
  return (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
  );
}

function isCanonicalUtcInstant(value) {
  if (typeof value !== 'string') return false;
  try {
    const date = new Date(value);
    return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
  } catch {
    return false;
  }
}

export function parseRedactedAdminResponse(value, expectedOperationId) {
  try {
    if (typeof expectedOperationId !== 'string' || !OPERATION_ID_PATTERN.test(expectedOperationId)) fail();
    const response = snapshotRecord(value);
    if (
      response.size !== 3
      || response.get('ok') !== true
      || response.get('operationId') !== expectedOperationId
    ) {
      fail();
    }
    const status = snapshotRecord(response.get('status'));
    const expectedKeys = [
      'textGlobalEnabled',
      'accountEnabled',
      'accountRemaining',
      'globalRemaining',
      'budgetSpentMicros',
      'budgetReservedMicros',
      'resetAt',
    ];
    if (status.size !== expectedKeys.length || expectedKeys.some((key) => !status.has(key))) fail();
    const textGlobalEnabled = status.get('textGlobalEnabled');
    const accountEnabled = status.get('accountEnabled');
    const accountRemaining = status.get('accountRemaining');
    const globalRemaining = status.get('globalRemaining');
    const budgetSpentMicros = status.get('budgetSpentMicros');
    const budgetReservedMicros = status.get('budgetReservedMicros');
    const resetAt = status.get('resetAt');
    if (
      typeof textGlobalEnabled !== 'boolean'
      || typeof accountEnabled !== 'boolean'
      || !isNonNegativeInteger(accountRemaining)
      || accountRemaining > 10
      || !isNonNegativeInteger(globalRemaining)
      || globalRemaining > 30
      || !isNonNegativeInteger(budgetSpentMicros)
      || !isNonNegativeInteger(budgetReservedMicros)
      || !isCanonicalUtcInstant(resetAt)
    ) {
      fail();
    }
    return Object.freeze({
      textGlobalEnabled,
      accountEnabled,
      accountRemaining,
      globalRemaining,
      budgetSpentMicros,
      budgetReservedMicros,
      resetAt,
    });
  } catch {
    fail();
  }
}

function cancelBodySilently(body) {
  try {
    const cancelled = body?.cancel();
    if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => undefined);
  } catch {
    // The fixed control-plane error remains the only externally visible detail.
  }
}

function waitForAdminDeadline(value, signal) {
  const awaited = Promise.resolve(value);
  if (signal.aborted) {
    awaited.catch(() => undefined);
    return Promise.reject(new Error(FAILURE_MESSAGE));
  }
  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(new Error(FAILURE_MESSAGE));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  return Promise.race([awaited, aborted]).finally(() => {
    signal.removeEventListener('abort', abortListener);
  });
}

function cancelReaderSilently(reader) {
  try {
    const cancelled = reader.cancel();
    if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => undefined);
  } catch {
    // Cancellation details cannot alter the fixed failure.
  }
}

async function readBoundedAdminJson(response, signal) {
  if (!(response instanceof Response)) fail();
  if (signal.aborted) {
    cancelBodySilently(response.body);
    fail();
  }
  if (
    response.status !== 200
    || response.headers.get('content-type') !== 'application/json; charset=utf-8'
    || response.headers.get('cache-control') !== 'no-store'
    || response.headers.get('x-content-type-options') !== 'nosniff'
  ) {
    cancelBodySilently(response.body);
    fail();
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      cancelBodySilently(response.body);
      fail();
    }
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length > MAX_ADMIN_RESPONSE_BYTES) {
      cancelBodySilently(response.body);
      fail();
    }
  }
  if (response.body === null || typeof response.body.getReader !== 'function') fail();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let reads = 0;
  let complete = false;
  try {
    while (true) {
      const item = await waitForAdminDeadline(reader.read(), signal);
      if (item === null || typeof item !== 'object' || typeof item.done !== 'boolean') fail();
      if (item.done) {
        complete = true;
        break;
      }
      reads += 1;
      if (
        reads > 1_024
        || !ArrayBuffer.isView(item.value)
        || Object.prototype.toString.call(item.value) !== '[object Uint8Array]'
        || item.value.byteLength === 0
      ) {
        fail();
      }
      const chunk = new Uint8Array(item.value.buffer, item.value.byteOffset, item.value.byteLength);
      bytes += chunk.byteLength;
      if (!Number.isSafeInteger(bytes) || bytes > MAX_ADMIN_RESPONSE_BYTES) fail();
      chunks.push(chunk);
    }
  } catch {
    if (!complete) cancelReaderSilently(reader);
    fail();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader cleanup details are intentionally hidden.
    }
  }
  if (bytes === 0) fail();
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(joined);
  return JSON.parse(text);
}

function parseInvokeOptions(options) {
  const snapshot = snapshotRecord(options);
  if (
    snapshot.size !== 2
    || !snapshot.has('operation')
    || !snapshot.has('target')
    || !ADMIN_OPERATIONS.has(snapshot.get('operation'))
    || (snapshot.get('target') !== 'user-1' && snapshot.get('target') !== 'user-2')
  ) {
    fail();
  }
  return Object.freeze({
    operation: snapshot.get('operation'),
    target: snapshot.get('target'),
  });
}

function defaultOperationId() {
  return randomBytes(16).toString('hex');
}

function parseInvokeDependencies(dependencies) {
  const snapshot = snapshotRecord(dependencies);
  const allowed = new Set(['generateOperationId', 'setTimeout', 'clearTimeout']);
  for (const key of snapshot.keys()) {
    if (!allowed.has(key)) fail();
  }
  const generateOperationId = snapshot.has('generateOperationId')
    ? snapshot.get('generateOperationId')
    : defaultOperationId;
  const setDeadline = snapshot.has('setTimeout')
    ? snapshot.get('setTimeout')
    : (callback, delay) => globalThis.setTimeout(callback, delay);
  const clearDeadline = snapshot.has('clearTimeout')
    ? snapshot.get('clearTimeout')
    : (timer) => globalThis.clearTimeout(timer);
  if (
    typeof generateOperationId !== 'function'
    || typeof setDeadline !== 'function'
    || typeof clearDeadline !== 'function'
  ) {
    fail();
  }
  return Object.freeze({ generateOperationId, setDeadline, clearDeadline });
}

export async function invokeTextPreviewAdmin(
  config,
  options,
  fetcher = globalThis.fetch,
  dependencies = {},
) {
  let deadlineExpired = false;
  let timer;
  let timerScheduled = false;
  let runtime;
  try {
    if (!configIsValid(config) || typeof fetcher !== 'function') fail();
    runtime = parseInvokeDependencies(dependencies);
    const parsed = parseInvokeOptions(options);
    const operationId = runtime.generateOperationId();
    if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) fail();
    const targetEmail = parsed.target === 'user-1' ? config.user1Email : config.user2Email;
    const controller = new AbortController();
    timer = runtime.setDeadline(() => {
      deadlineExpired = true;
      controller.abort();
    }, ADMIN_DEADLINE_MS);
    timerScheduled = true;
    const fetchPromise = Promise.resolve().then(() => fetcher(
      `${PREVIEW_ORIGIN}/api/nutrition/text-admin/account`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'cf-access-client-id': config.serviceClientId,
          'cf-access-client-secret': config.serviceClientSecret,
          origin: PREVIEW_ORIGIN,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          schemaVersion: 1,
          operationId,
          operation: parsed.operation,
          targetEmail,
        }),
        signal: controller.signal,
      },
    ));
    fetchPromise.then((lateResponse) => {
      if (!deadlineExpired || !(lateResponse instanceof Response)) return;
      try {
        cancelBodySilently(lateResponse.body);
      } catch {
        // Late response cleanup details remain private.
      }
    }).catch(() => undefined);
    const response = await waitForAdminDeadline(fetchPromise, controller.signal);
    const status = parseRedactedAdminResponse(
      await readBoundedAdminJson(response, controller.signal),
      operationId,
    );
    return Object.freeze({ operation: parsed.operation, ...status });
  } catch {
    fail();
  } finally {
    if (runtime !== undefined && timerScheduled) {
      try {
        runtime.clearDeadline(timer);
      } catch {
        // Timer cleanup details remain private.
      }
    }
  }
}

function parseCliArguments(argv) {
  const values = snapshotArray(argv);
  if (values.some((value) => typeof value !== 'string')) fail();
  if (
    values.length === 1
    && (values[0] === 'preflight' || values[0] === 'configure' || values[0] === 'disable-access')
  ) {
    return Object.freeze({ command: values[0] });
  }
  if (
    values.length === 3
    && values[0] === 'invoke-admin'
    && values[1].startsWith('--operation=')
    && values[2].startsWith('--target=')
  ) {
    const operation = values[1].slice('--operation='.length);
    const target = values[2].slice('--target='.length);
    parseInvokeOptions({ operation, target });
    return Object.freeze({ command: 'invoke-admin', operation, target });
  }
  fail();
}

function parseCliDependencies(dependencies) {
  const snapshot = snapshotRecord(dependencies);
  const allowed = new Set([
    'clientFactory',
    'fetcher',
    'generateOperationId',
    'writeStdout',
    'writeStderr',
  ]);
  for (const key of snapshot.keys()) {
    if (!allowed.has(key)) fail();
  }
  const clientFactory = snapshot.has('clientFactory')
    ? snapshot.get('clientFactory')
    : (config) => createCloudflareClient({
      accountId: config.accountId,
      apiToken: config.apiToken,
    });
  const fetcher = snapshot.has('fetcher') ? snapshot.get('fetcher') : globalThis.fetch;
  const generateOperationId = snapshot.has('generateOperationId')
    ? snapshot.get('generateOperationId')
    : defaultOperationId;
  const writeStdout = snapshot.has('writeStdout')
    ? snapshot.get('writeStdout')
    : (value) => process.stdout.write(value);
  const writeStderr = snapshot.has('writeStderr')
    ? snapshot.get('writeStderr')
    : (value) => process.stderr.write(value);
  for (const value of [clientFactory, fetcher, generateOperationId, writeStdout, writeStderr]) {
    if (typeof value !== 'function') fail();
  }
  return Object.freeze({
    clientFactory,
    fetcher,
    generateOperationId,
    writeStdout,
    writeStderr,
  });
}

function writeCliLine(writer, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (typeof serialized !== 'string' || serialized.length > 4_096) fail();
  writer(serialized);
}

export async function runTextPreviewControlCli(argv, env, dependencies = {}) {
  let writeStderr = (value) => process.stderr.write(value);
  try {
    const parsedDependencies = parseCliDependencies(dependencies);
    writeStderr = parsedDependencies.writeStderr;
    const command = parseCliArguments(argv);
    const config = command.command === 'disable-access'
      ? loadCloudflareControlConfig(env)
      : loadTextPreviewConfig(env);
    if (command.command === 'invoke-admin') {
      const result = await invokeTextPreviewAdmin(
        config,
        { operation: command.operation, target: command.target },
        parsedDependencies.fetcher,
        { generateOperationId: parsedDependencies.generateOperationId },
      );
      writeCliLine(parsedDependencies.writeStdout, result);
      return 0;
    }

    const client = parsedDependencies.clientFactory(config);
    if (command.command === 'preflight') {
      const result = await preflightTextPreview(config, client);
      writeCliLine(parsedDependencies.writeStdout, {
        command: 'preflight',
        status: 'ready',
        workerTextEnabled: result.workerTextEnabled,
      });
      return 0;
    }
    if (command.command === 'configure') {
      await reconcileTextPreview(config, client);
      writeCliLine(parsedDependencies.writeStdout, { command: 'configure', status: 'configured' });
      return 0;
    }
    const result = await disableTextPreviewAccess(config, client);
    writeCliLine(parsedDependencies.writeStdout, {
      command: 'disable-access',
      status: 'disabled',
      deletedApps: result.deletedApps,
    });
    return 0;
  } catch {
    try {
      writeStderr(`${FAILURE_MESSAGE}\n`);
    } catch {
      // Output failures do not expose any captured control-plane detail.
    }
    return 1;
  }
}

function isDirectExecution() {
  try {
    return (
      typeof process.argv[1] === 'string'
      && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = await runTextPreviewControlCli(process.argv.slice(2), process.env);
}

function policyMatches(policy, desired) {
  return stableJson(policyComparable(policy.snapshot)) === stableJson(desired);
}

function inspectNamedRecord(value, allowedNames) {
  const snapshot = snapshotRecord(value);
  for (const [name, item] of snapshot) {
    if (!allowedNames.has(name)) fail();
    snapshotRecord(item);
  }
  return snapshot;
}

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function inspectPreviewNonBinding(preview, name) {
  const value = preview.get(name);
  if (name === 'compatibility_date') {
    if (!canonicalDate(value)) fail();
    return value;
  }
  if (name === 'compatibility_flags') {
    const flags = snapshotArray(value);
    if (
      flags.length > 128
      || flags.some((flag) => !safeIdentifier(flag))
      || new Set(flags).size !== flags.length
    ) {
      fail();
    }
    return Object.freeze([...flags].sort());
  }
  if (name === 'always_use_latest_compatibility_date' || name === 'fail_open') {
    if (typeof value !== 'boolean') fail();
    return value;
  }
  if (name === 'usage_model') {
    if (value !== 'bundled' && value !== 'unbound' && value !== 'standard') fail();
    return value;
  }
  if (name === 'limits' || name === 'placement') {
    snapshotRecord(value);
    return cloneJsonValue(value);
  }
  fail();
}

function previewBehaviorHash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function inspectPreviewProject(project) {
  const preview = snapshotRecord(project.deployment_configs.preview);
  for (const key of preview.keys()) {
    if (!PREVIEW_TOP_LEVEL_NAMES.has(key)) fail();
  }
  const envVars = preview.has('env_vars')
    ? inspectNamedRecord(preview.get('env_vars'), EXPECTED_PREVIEW_ENV_NAMES)
    : new Map();
  const services = preview.has('services')
    ? inspectNamedRecord(preview.get('services'), EXPECTED_PREVIEW_SERVICE_NAMES)
    : new Map();
  for (const entry of envVars.values()) {
    const snapshot = snapshotRecord(entry);
    const type = snapshot.get('type');
    if (type !== 'plain_text' && type !== 'secret_text') fail();
    if (snapshot.has('value')) {
      const value = snapshot.get('value');
      if (typeof value !== 'string' && value !== null) fail();
    }
  }
  for (const entry of services.values()) {
    const snapshot = snapshotRecord(entry);
    if (typeof snapshot.get('service') !== 'string' || typeof snapshot.get('environment') !== 'string') fail();
  }
  for (const name of PREVIEW_BINDING_CONTAINER_NAMES) {
    if (name === 'services' || !preview.has(name)) continue;
    if (snapshotRecord(preview.get(name)).size !== 0) fail();
  }
  if (
    preview.has('wrangler_config_hash')
    && preview.get('wrangler_config_hash') !== null
    && !safeIdentifier(preview.get('wrangler_config_hash'))
  ) {
    fail();
  }
  const behavior = {};
  for (const name of PREVIEW_NON_BINDING_NAMES) {
    if (preview.has(name)) behavior[name] = inspectPreviewNonBinding(preview, name);
  }
  return Object.freeze({
    envVars,
    services,
    behaviorHash: previewBehaviorHash(behavior),
  });
}

function productionHash(project) {
  return createHash('sha256')
    .update(stableJson(project.deployment_configs.production))
    .digest('hex');
}

function desiredPagesPatch(config, userAudience, adminAudience) {
  return {
    deployment_configs: {
      preview: {
        env_vars: {
          PHOTO_AI_TEAM_DOMAIN: { type: 'plain_text', value: config.teamDomain },
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

function inspectExpectedPreviewProject(project, desiredPreview) {
  const actual = inspectPreviewProject(project);
  const desired = snapshotRecord(desiredPreview);
  const desiredEnvVars = snapshotRecord(desired.get('env_vars'));
  const desiredServices = snapshotRecord(desired.get('services'));
  if (
    actual.envVars.size !== EXPECTED_PREVIEW_ENV_NAMES.size
    || actual.services.size !== EXPECTED_PREVIEW_SERVICE_NAMES.size
    || desiredEnvVars.size !== EXPECTED_PREVIEW_ENV_NAMES.size
    || desiredServices.size !== EXPECTED_PREVIEW_SERVICE_NAMES.size
  ) {
    fail();
  }
  for (const name of EXPECTED_PREVIEW_ENV_NAMES) {
    if (!actual.envVars.has(name) || !desiredEnvVars.has(name)) fail();
    const actualEntry = snapshotRecord(actual.envVars.get(name));
    const desiredEntry = snapshotRecord(desiredEnvVars.get(name));
    const desiredType = desiredEntry.get('type');
    if (actualEntry.get('type') !== desiredType) fail();
    if (desiredType === 'plain_text') {
      if (!actualEntry.has('value') || actualEntry.get('value') !== desiredEntry.get('value')) fail();
    } else if (desiredType === 'secret_text') {
      if (actualEntry.has('value') && actualEntry.get('value') !== '[redacted]') fail();
    } else {
      fail();
    }
  }
  for (const name of EXPECTED_PREVIEW_SERVICE_NAMES) {
    if (!actual.services.has(name) || !desiredServices.has(name)) fail();
    const actualBinding = snapshotRecord(actual.services.get(name));
    const desiredBinding = snapshotRecord(desiredServices.get(name));
    if (
      actualBinding.get('service') !== desiredBinding.get('service')
      || actualBinding.get('environment') !== desiredBinding.get('environment')
    ) {
      fail();
    }
  }
  return actual;
}

async function writeApp(client, existing, desired) {
  if (existing === undefined) {
    return {
      app: parseWrittenApp(await client.post('/access/apps', desired), desired),
      created: true,
    };
  }
  if (!appMatches(existing, desired)) {
    const app = parseWrittenApp(await client.put(`/access/apps/${existing.id}`, desired), desired);
    if (app.id !== existing.id) fail();
    return {
      app,
      created: false,
    };
  }
  return { app: existing, created: false };
}

async function writePolicy(client, appId, existing, desired) {
  const value = existing === undefined
    ? await client.post(`/access/apps/${appId}/policies`, desired)
    : policyMatches(existing, desired)
      ? undefined
      : await client.put(`/access/apps/${appId}/policies/${existing.id}`, desired);
  if (value === undefined) return existing.id;
  const snapshot = snapshotRecord(value);
  const id = snapshot.get('id');
  if (
    !safeIdentifier(id)
    || (existing !== undefined && id !== existing.id)
    || stableJson(policyComparable(snapshot)) !== stableJson(desired)
  ) {
    fail();
  }
  return id;
}

async function writeObservedPolicy(client, appId, existing, desired, observedResourceIds) {
  const policyId = await writePolicy(client, appId, existing, desired);
  if (existing === undefined) {
    if (observedResourceIds.has(policyId)) fail();
    observedResourceIds.add(policyId);
  }
  return policyId;
}

async function reconcileAccessAppPlans(client, plans, observedResourceIds, observedAudiences) {
  const results = new Map();

  for (const plan of plans) {
    if (plan.existing !== undefined) continue;
    const written = await writeApp(client, undefined, plan.desiredApp);
    if (
      observedResourceIds.has(written.app.id)
      || observedAudiences.has(written.app.aud)
    ) {
      fail();
    }
    observedResourceIds.add(written.app.id);
    observedAudiences.add(written.app.aud);
    for (const policy of plan.policies) {
      await writeObservedPolicy(
        client,
        written.app.id,
        undefined,
        policy.desired,
        observedResourceIds,
      );
    }
    results.set(plan.name, written);
  }

  for (const plan of plans) {
    if (plan.existing === undefined) continue;
    for (const policy of plan.policies) {
      await writeObservedPolicy(
        client,
        plan.existing.id,
        policy.existing,
        policy.desired,
        observedResourceIds,
      );
    }
  }

  for (const plan of plans) {
    if (plan.existing === undefined) continue;
    const written = await writeApp(client, plan.existing, plan.desiredApp);
    if (written.app.aud !== plan.existing.aud) {
      observedAudiences.delete(plan.existing.aud);
      if (observedAudiences.has(written.app.aud)) fail();
      observedAudiences.add(written.app.aud);
    }
    results.set(plan.name, written);
  }

  return results;
}

export async function reconcileTextPreview(config, client) {
  try {
    if (!configIsValid(config)) fail();
    const get = clientGet(client);
    const post = clientMethod(client, 'post');
    const put = clientMethod(client, 'put');
    const patch = clientMethod(client, 'patch');
    const api = Object.freeze({ get, post, put, patch });

    const preflight = await preflightTextPreview(config, client);
    const beforePreview = inspectPreviewProject(preflight.project);
    const beforeProductionHash = productionHash(preflight.project);
    const apps = scanDedicatedApps(await get('/access/apps'));
    const identities = inspectDedicatedAppIdentities(apps);
    const userPolicies = apps.user === undefined
      ? new Map()
      : parsePolicies(
        await get(`/access/apps/${apps.user.id}/policies`),
        new Set([`${USER_APP_NAME}-allow`]),
        identities.resourceIds,
      );
    const adminPolicies = apps.admin === undefined
      ? new Map()
      : parsePolicies(
        await get(`/access/apps/${apps.admin.id}/policies`),
        new Set([`${ADMIN_APP_NAME}-human`, `${ADMIN_APP_NAME}-service`]),
        identities.resourceIds,
      );

    const userPolicy = desiredUserPolicy(config, preflight.otpProviderId);
    const adminHumanPolicy = desiredAdminHumanPolicy(config, preflight.otpProviderId);
    const adminServicePolicy = desiredAdminServicePolicy(preflight.serviceTokenId);

    const writtenApps = await reconcileAccessAppPlans(api, [
      {
        name: 'user',
        existing: apps.user,
        desiredApp: desiredUserApp(),
        policies: [{
          existing: userPolicies.get(userPolicy.name),
          desired: userPolicy,
        }],
      },
      {
        name: 'admin',
        existing: apps.admin,
        desiredApp: desiredAdminApp(),
        policies: [
          {
            existing: adminPolicies.get(adminHumanPolicy.name),
            desired: adminHumanPolicy,
          },
          {
            existing: adminPolicies.get(adminServicePolicy.name),
            desired: adminServicePolicy,
          },
        ],
      },
    ], identities.resourceIds, identities.audiences);
    const writtenUser = writtenApps.get('user');
    const writtenAdmin = writtenApps.get('admin');
    if (
      writtenUser === undefined
      || writtenAdmin === undefined
      || writtenUser.app.id === writtenAdmin.app.id
      || writtenUser.app.aud === writtenAdmin.app.aud
    ) {
      fail();
    }

    const pagesPatch = desiredPagesPatch(config, writtenUser.app.aud, writtenAdmin.app.aud);
    const recheckedProject = parsePagesProject(await get('/pages/projects/tiezheng'));
    const recheckedPreview = inspectPreviewProject(recheckedProject);
    if (
      recheckedPreview.behaviorHash !== beforePreview.behaviorHash
      || productionHash(recheckedProject) !== beforeProductionHash
    ) {
      fail();
    }
    const patchResult = parsePagesProject(await patch('/pages/projects/tiezheng', pagesPatch));
    const patchedPreview = inspectExpectedPreviewProject(
      patchResult,
      pagesPatch.deployment_configs.preview,
    );
    if (
      patchedPreview.behaviorHash !== beforePreview.behaviorHash
      || productionHash(patchResult) !== beforeProductionHash
    ) {
      fail();
    }
    const afterProject = parsePagesProject(await get('/pages/projects/tiezheng'));
    const afterPreview = inspectExpectedPreviewProject(
      afterProject,
      pagesPatch.deployment_configs.preview,
    );
    if (
      afterPreview.behaviorHash !== beforePreview.behaviorHash
      || productionHash(afterProject) !== beforeProductionHash
    ) {
      fail();
    }

    return {
      configured: true,
      userApp: { name: USER_APP_NAME, created: writtenUser.created },
      adminApp: { name: ADMIN_APP_NAME, created: writtenAdmin.created },
    };
  } catch {
    fail();
  }
}
