import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCloudflareClient } from './cloudflare-api.mjs';
import { signTextAdminRequest } from './text-ai-admin-signature.mjs';

const FAILURE_MESSAGE = 'Text preview control failed';
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MAX_SECRET_LENGTH = 4_096;
const WORKER_NAME = 'tiezheng-photo-ai-gateway';
const PAGES_PROJECT_NAME = 'tiezheng';
const PREVIEW_HOST = 'text-ai-preview.tiezheng.pages.dev';
const PREVIEW_ORIGIN = `https://${PREVIEW_HOST}`;
const EXPECTED_PREVIEW_ENV_NAMES = new Set([
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
  'build_image_major_version',
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
const KNOWN_PERMISSION_SCOPES = Object.freeze([
  ACCOUNT_PERMISSION_SCOPE,
  'com.cloudflare.api.account.flagship.app',
  'com.cloudflare.api.account.zone',
  'com.cloudflare.api.user',
  'com.cloudflare.edge.r2.bucket',
]);
const REQUIRED_TOKEN_CAPABILITY_ALIASES = Object.freeze([
  Object.freeze(['Account API Tokens Read']),
  Object.freeze(['Workers Scripts Edit', 'Workers Scripts Write']),
  Object.freeze(['Cloudflare Pages Edit', 'Pages Write']),
]);
const SETUP_TOKEN_CAPABILITY_ALIASES = REQUIRED_TOKEN_CAPABILITY_ALIASES;
export const TEXT_PREVIEW_TOKEN_PERMISSION_NAMES = Object.freeze(
  REQUIRED_TOKEN_CAPABILITY_ALIASES.map((aliases) => aliases[0]),
);
export const TEXT_PREVIEW_SETUP_PERMISSION_NAMES = Object.freeze(
  SETUP_TOKEN_CAPABILITY_ALIASES.map((aliases) => aliases[0]),
);
const VALID_CONFIGS = new WeakSet();

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

function isCanonicalBase64Url32(value) {
  if (typeof value !== 'string' || !BASE64URL_32_PATTERN.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === 32 && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
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

export function loadTextPreviewConfig(env) {
  try {
    const { accountId, apiToken } = parseCloudflareCredentials(env);
    const arkApiKey = requiredString(env, 'ARK_API_KEY', (value) => isSecret(value));
    const cacheAesKey = requiredString(
      env,
      'PHOTO_AI_CACHE_AES_KEY',
      (value) => isSecret(value, 32),
    );
    const accountHmacKey = requiredString(
      env,
      'PHOTO_AI_ACCOUNT_HMAC_KEY',
      (value) => isSecret(value, 32),
    );
    const user1AccessCodePepper = requiredString(
      env,
      'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
      isCanonicalBase64Url32,
    );
    const user1AccessCodeDigest = requiredString(
      env,
      'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
      (value) => DIGEST_PATTERN.test(value),
    );
    const user2AccessCodePepper = requiredString(
      env,
      'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
      isCanonicalBase64Url32,
    );
    const user2AccessCodeDigest = requiredString(
      env,
      'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
      (value) => DIGEST_PATTERN.test(value),
    );
    const sessionSigningKey = requiredString(
      env,
      'TEXT_AI_SESSION_SIGNING_KEY',
      isCanonicalBase64Url32,
    );
    const rateLimitHmacKey = requiredString(
      env,
      'TEXT_AI_RATE_LIMIT_HMAC_KEY',
      isCanonicalBase64Url32,
    );
    const adminSigningKey = requiredString(
      env,
      'TEXT_AI_ADMIN_SIGNING_KEY',
      isCanonicalBase64Url32,
    );
    const independentKeys = [
      user1AccessCodePepper,
      user2AccessCodePepper,
      sessionSigningKey,
      rateLimitHmacKey,
      adminSigningKey,
    ];
    if (
      new Set(independentKeys).size !== independentKeys.length
      || user1AccessCodeDigest === user2AccessCodeDigest
    ) {
      fail();
    }

    const config = Object.freeze({
      accountId,
      apiToken,
      arkApiKey,
      cacheAesKey,
      accountHmacKey,
      user1AccessCodePepper,
      user1AccessCodeDigest,
      user2AccessCodePepper,
      user2AccessCodeDigest,
      sessionSigningKey,
      rateLimitHmacKey,
      adminSigningKey,
      allowedOrigin: PREVIEW_ORIGIN,
    });
    VALID_CONFIGS.add(config);
    return config;
  } catch {
    fail();
  }
}

function parseTokenVerification(value) {
  const snapshot = snapshotRecord(value);
  const id = snapshot.get('id');
  const allowedKeys = new Set(['id', 'status', 'expires_on']);
  if (
    snapshot.size < 2
    || snapshot.size > allowedKeys.size
    || [...snapshot.keys()].some((key) => !allowedKeys.has(key))
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
      || scopes.length === 0
    ) {
      fail();
    }
    const observedScopes = new Set();
    for (const scope of scopes) {
      if (
        typeof scope !== 'string'
        || !KNOWN_PERMISSION_SCOPES.includes(scope)
        || observedScopes.has(scope)
      ) {
        fail();
      }
      observedScopes.add(scope);
    }
    catalog.set(id, Object.freeze({
      name,
      scopes: Object.freeze([...observedScopes]),
    }));
  }
  if (catalog.size === 0) fail();
  return catalog;
}

function parseTokenDetails(value, tokenId, accountId, permissionCatalog, requiredAliases) {
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
      const permission = permissionCatalog.get(id);
      if (
        permission.scopes.length !== 1
        || permission.scopes[0] !== ACCOUNT_PERMISSION_SCOPE
      ) {
        fail();
      }
      const { name } = permission;
      for (let index = 0; index < requiredAliases.length; index += 1) {
        if (requiredAliases[index].includes(name)) capabilities.add(index);
      }
    }
  }

  return Object.freeze(requiredAliases
    .map((aliases, index) => (capabilities.has(index) ? undefined : aliases[0]))
    .filter((name) => name !== undefined));
}

async function verifyTokenCapabilities(accountId, client, requiredAliases) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId)) fail();
  const get = clientGet(client);
  const tokenId = parseTokenVerification(await get('/tokens/verify'));
  const tokenDetails = await get(`/tokens/${tokenId}`);
  const permissionCatalog = parsePermissionGroupCatalog(
    await get('/tokens/permission_groups'),
  );
  const missingPermissions = parseTokenDetails(
    tokenDetails,
    tokenId,
    accountId,
    permissionCatalog,
    requiredAliases,
  );
  return Object.freeze({
    accountId,
    missingPermissions,
  });
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

export async function preflightTextPreview(config, client, reportStage) {
  try {
    if (!configIsValid(config)) fail();
    if (reportStage !== undefined && typeof reportStage !== 'function') fail();
    const markStage = (stage) => {
      if (reportStage === undefined) return;
      try {
        Promise.resolve(reportStage(stage)).catch(() => undefined);
      } catch {
        // Diagnostic output must never alter the preflight result.
      }
    };
    const get = clientGet(client);

    markStage('token-capabilities');
    const tokenCapabilities = await verifyTokenCapabilities(
      config.accountId,
      client,
      REQUIRED_TOKEN_CAPABILITY_ALIASES,
    );
    if (tokenCapabilities.missingPermissions.length > 0) fail();
    markStage('read-project');
    const projectResult = await get('/pages/projects/tiezheng');
    markStage('inspect-project');
    const project = parsePagesProject(projectResult);
    markStage('read-worker-list');
    const workerList = await get('/workers/scripts');
    markStage('inspect-worker-list');
    parseWorkerList(workerList);
    markStage('read-worker-settings');
    const workerSettingsResult = await get(`/workers/scripts/${WORKER_NAME}/settings`);
    markStage('inspect-worker-settings');
    const workerSettings = parseWorkerSettings(
      workerSettingsResult,
    );
    if (workerSettings.photoAiGatewayEnabled) fail();
    markStage('complete');

    return Object.freeze({
      project,
      workerName: WORKER_NAME,
      photoAiGatewayEnabled: workerSettings.photoAiGatewayEnabled,
      workerTextEnabled: workerSettings.workerTextEnabled,
    });
  } catch {
    fail();
  }
}

export async function verifyTextPreviewSetupToken(accountId, client) {
  try {
    return await verifyTokenCapabilities(accountId, client, SETUP_TOKEN_CAPABILITY_ALIASES);
  } catch {
    fail();
  }
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
  const allowed = new Set(['generateOperationId', 'now', 'setTimeout', 'clearTimeout']);
  for (const key of snapshot.keys()) {
    if (!allowed.has(key)) fail();
  }
  const generateOperationId = snapshot.has('generateOperationId')
    ? snapshot.get('generateOperationId')
    : defaultOperationId;
  const now = snapshot.has('now') ? snapshot.get('now') : () => Date.now();
  const setDeadline = snapshot.has('setTimeout')
    ? snapshot.get('setTimeout')
    : (callback, delay) => globalThis.setTimeout(callback, delay);
  const clearDeadline = snapshot.has('clearTimeout')
    ? snapshot.get('clearTimeout')
    : (timer) => globalThis.clearTimeout(timer);
  if (
    typeof generateOperationId !== 'function'
    || typeof now !== 'function'
    || typeof setDeadline !== 'function'
    || typeof clearDeadline !== 'function'
  ) {
    fail();
  }
  return Object.freeze({ generateOperationId, now, setDeadline, clearDeadline });
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
    const now = runtime.now();
    if (!Number.isSafeInteger(now) || now < 0) fail();
    const timestamp = String(now);
    const body = JSON.stringify({
      schemaVersion: 1,
      operationId,
      operation: parsed.operation,
      target: parsed.target,
    });
    const signature = signTextAdminRequest({
      key: config.adminSigningKey,
      timestamp,
      operationId,
      body,
    });
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
          origin: PREVIEW_ORIGIN,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body, 'utf8')),
          'x-tiezheng-admin-version': 'v1',
          'x-tiezheng-admin-timestamp': timestamp,
          'x-tiezheng-admin-signature': signature,
        },
        body,
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
    && (values[0] === 'preflight' || values[0] === 'configure')
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
    'now',
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
  const now = snapshot.has('now') ? snapshot.get('now') : () => Date.now();
  const writeStdout = snapshot.has('writeStdout')
    ? snapshot.get('writeStdout')
    : (value) => process.stdout.write(value);
  const writeStderr = snapshot.has('writeStderr')
    ? snapshot.get('writeStderr')
    : (value) => process.stderr.write(value);
  for (const value of [clientFactory, fetcher, generateOperationId, now, writeStdout, writeStderr]) {
    if (typeof value !== 'function') fail();
  }
  return Object.freeze({
    clientFactory,
    fetcher,
    generateOperationId,
    now,
    writeStdout,
    writeStderr,
  });
}

function writeCliLine(writer, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (typeof serialized !== 'string' || serialized.length > 4_096) fail();
  writer(serialized);
}

function writeCliStderrSafely(writer, value) {
  try {
    Promise.resolve(writer(value)).catch(() => undefined);
  } catch {
    // Diagnostic output must never alter the control result.
  }
}

function reportCliAdminStage(writer, stage) {
  writeCliStderrSafely(writer, `Text preview admin stage: ${stage}\n`);
}

const ADMIN_DIAGNOSTIC_VALUES = new Set([
  'binding-missing',
  'downstream-configuration',
  'downstream-runtime',
  'downstream-coordinator',
  'downstream-service-disabled',
  'downstream-failed',
]);

function classifyCliAdminResponse(response) {
  try {
    if (!(response instanceof Response)) return 'response-invalid';
    if (response.status === 200) return 'response-200';
    if (response.status === 401) return 'response-401';
    if (response.status === 503) {
      const diagnostic = response.headers.get('x-tiezheng-admin-diagnostic');
      return ADMIN_DIAGNOSTIC_VALUES.has(diagnostic)
        ? `response-503-${diagnostic}`
        : 'response-503';
    }
    return 'response-other';
  } catch {
    return 'response-invalid';
  }
}

export async function runTextPreviewControlCli(argv, env, dependencies = {}) {
  let writeStderr = (value) => process.stderr.write(value);
  try {
    const parsedDependencies = parseCliDependencies(dependencies);
    writeStderr = parsedDependencies.writeStderr;
    const command = parseCliArguments(argv);
    const config = loadTextPreviewConfig(env);
    if (command.command === 'invoke-admin') {
      const fetcher = parsedDependencies.fetcher;
      const diagnosticFetcher = async (url, init) => {
        reportCliAdminStage(parsedDependencies.writeStderr, 'request-dispatched');
        const response = await fetcher(url, init);
        reportCliAdminStage(
          parsedDependencies.writeStderr,
          classifyCliAdminResponse(response),
        );
        return response;
      };
      const result = await invokeTextPreviewAdmin(
        config,
        { operation: command.operation, target: command.target },
        diagnosticFetcher,
        {
          generateOperationId: parsedDependencies.generateOperationId,
          now: parsedDependencies.now,
        },
      );
      reportCliAdminStage(parsedDependencies.writeStderr, 'complete');
      writeCliLine(parsedDependencies.writeStdout, result);
      return 0;
    }

    const client = parsedDependencies.clientFactory(config);
    if (command.command === 'preflight') {
      const result = await preflightTextPreview(config, client, (stage) => {
        parsedDependencies.writeStderr(`Text preview preflight stage: ${stage}\n`);
      });
      writeCliLine(parsedDependencies.writeStdout, {
        command: 'preflight',
        status: 'ready',
        workerTextEnabled: result.workerTextEnabled,
      });
      return 0;
    }
    if (command.command === 'configure') {
      await reconcileTextPreview(config, client, (stage) => {
        parsedDependencies.writeStderr(`Text preview configure stage: ${stage}\n`);
      });
      writeCliLine(parsedDependencies.writeStdout, { command: 'configure', status: 'configured' });
      return 0;
    }
    fail();
  } catch {
    writeCliStderrSafely(writeStderr, `${FAILURE_MESSAGE}\n`);
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

function inspectNamedRecord(value, allowedNames) {
  const snapshot = snapshotRecord(value);
  for (const [name, item] of snapshot) {
    if (!allowedNames.has(name)) fail();
    snapshotRecord(item);
  }
  return snapshot;
}

function inspectOptionalNamedRecord(container, name, allowedNames) {
  if (!container.has(name) || container.get(name) === null) return new Map();
  return inspectNamedRecord(container.get(name), allowedNames);
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
  if (name === 'build_image_major_version') {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail();
    return value;
  }
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

function inspectPreviewProject(project, reportCheckpoint) {
  const checkpoint = (name) => {
    if (typeof reportCheckpoint === 'function') reportCheckpoint(name);
  };
  checkpoint('record');
  const preview = snapshotRecord(project.deployment_configs.preview);
  checkpoint('top-level');
  for (const key of preview.keys()) {
    if (!PREVIEW_TOP_LEVEL_NAMES.has(key)) fail();
  }
  checkpoint('env-vars');
  const envVars = inspectOptionalNamedRecord(
    preview,
    'env_vars',
    EXPECTED_PREVIEW_ENV_NAMES,
  );
  checkpoint('services');
  const services = inspectOptionalNamedRecord(
    preview,
    'services',
    EXPECTED_PREVIEW_SERVICE_NAMES,
  );
  checkpoint('env-entries');
  for (const entry of envVars.values()) {
    const snapshot = snapshotRecord(entry);
    const type = snapshot.get('type');
    if (type !== 'plain_text' && type !== 'secret_text') fail();
    if (snapshot.has('value')) {
      const value = snapshot.get('value');
      if (typeof value !== 'string' && value !== null) fail();
    }
  }
  checkpoint('service-entries');
  for (const entry of services.values()) {
    const snapshot = snapshotRecord(entry);
    if (typeof snapshot.get('service') !== 'string' || typeof snapshot.get('environment') !== 'string') fail();
  }
  checkpoint('binding-containers');
  for (const name of PREVIEW_BINDING_CONTAINER_NAMES) {
    if (name === 'services' || !preview.has(name)) continue;
    const value = preview.get(name);
    if (value !== null && snapshotRecord(value).size !== 0) fail();
  }
  checkpoint('wrangler-config-hash');
  const wranglerConfigHash = preview.has('wrangler_config_hash')
    ? preview.get('wrangler_config_hash')
    : undefined;
  if (
    wranglerConfigHash !== undefined
    && wranglerConfigHash !== null
    && !safeIdentifier(wranglerConfigHash)
  ) {
    fail();
  }
  checkpoint('behavior');
  const behavior = {};
  for (const name of PREVIEW_NON_BINDING_NAMES) {
    if (preview.has(name)) behavior[name] = inspectPreviewNonBinding(preview, name);
  }
  return Object.freeze({
    envVars,
    services,
    behaviorHash: previewBehaviorHash(behavior),
    wranglerConfigHash,
  });
}

function productionHash(project) {
  return createHash('sha256')
    .update(stableJson(project.deployment_configs.production))
    .digest('hex');
}

function desiredPagesPatch(config, wranglerConfigHash) {
  return {
    deployment_configs: {
      preview: {
        ...(typeof wranglerConfigHash === 'string'
          ? { wrangler_config_hash: wranglerConfigHash }
          : {}),
        env_vars: {
          PHOTO_AI_ALLOWED_ORIGINS: { type: 'plain_text', value: PREVIEW_ORIGIN },
          PHOTO_AI_ACCOUNT_HMAC_KEY: { type: 'secret_text', value: config.accountHmacKey },
          TEXT_AI_USER_1_ACCESS_CODE_PEPPER: {
            type: 'secret_text',
            value: config.user1AccessCodePepper,
          },
          TEXT_AI_USER_1_ACCESS_CODE_DIGEST: {
            type: 'secret_text',
            value: config.user1AccessCodeDigest,
          },
          TEXT_AI_USER_2_ACCESS_CODE_PEPPER: {
            type: 'secret_text',
            value: config.user2AccessCodePepper,
          },
          TEXT_AI_USER_2_ACCESS_CODE_DIGEST: {
            type: 'secret_text',
            value: config.user2AccessCodeDigest,
          },
          TEXT_AI_SESSION_SIGNING_KEY: {
            type: 'secret_text',
            value: config.sessionSigningKey,
          },
          TEXT_AI_RATE_LIMIT_HMAC_KEY: {
            type: 'secret_text',
            value: config.rateLimitHmacKey,
          },
          TEXT_AI_ADMIN_SIGNING_KEY: {
            type: 'secret_text',
            value: config.adminSigningKey,
          },
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

function inspectExpectedPreviewProject(project, desiredPreview, reportCheckpoint) {
  const checkpoint = (name) => {
    if (typeof reportCheckpoint === 'function') reportCheckpoint(name);
  };
  const actual = inspectPreviewProject(project, reportCheckpoint);
  checkpoint('env-vars');
  const desired = snapshotRecord(desiredPreview);
  const desiredEnvVars = snapshotRecord(desired.get('env_vars'));
  if (
    actual.envVars.size !== EXPECTED_PREVIEW_ENV_NAMES.size
    || desiredEnvVars.size !== EXPECTED_PREVIEW_ENV_NAMES.size
  ) {
    fail();
  }
  checkpoint('services');
  const desiredServices = snapshotRecord(desired.get('services'));
  if (
    actual.services.size !== EXPECTED_PREVIEW_SERVICE_NAMES.size
    || desiredServices.size !== EXPECTED_PREVIEW_SERVICE_NAMES.size
  ) {
    fail();
  }
  checkpoint('env-entries');
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
  checkpoint('service-entries');
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

export async function reconcileTextPreview(config, client, reportStage) {
  try {
    if (!configIsValid(config)) fail();
    if (reportStage !== undefined && typeof reportStage !== 'function') fail();
    const markStage = (stage) => {
      if (reportStage === undefined) return;
      try {
        Promise.resolve(reportStage(stage)).catch(() => undefined);
      } catch {
        // Diagnostic output must never alter the reconciliation result.
      }
    };
    const get = clientGet(client);
    const patch = clientMethod(client, 'patch');

    markStage('preflight');
    const preflight = await preflightTextPreview(config, client);
    markStage('inspect-initial');
    const beforePreview = inspectPreviewProject(
      preflight.project,
      (checkpoint) => markStage(`inspect-initial:${checkpoint}`),
    );
    const beforeProductionHash = productionHash(preflight.project);
    const pagesPatch = desiredPagesPatch(config, beforePreview.wranglerConfigHash);
    markStage('read-recheck');
    const recheckedResult = await get('/pages/projects/tiezheng');
    markStage('inspect-recheck');
    const recheckedProject = parsePagesProject(recheckedResult);
    const recheckedPreview = inspectPreviewProject(
      recheckedProject,
      (checkpoint) => markStage(`inspect-recheck:${checkpoint}`),
    );
    if (
      recheckedPreview.behaviorHash !== beforePreview.behaviorHash
      || recheckedPreview.wranglerConfigHash !== beforePreview.wranglerConfigHash
      || productionHash(recheckedProject) !== beforeProductionHash
    ) {
      fail();
    }
    markStage('patch-request');
    const patchResponse = await patch('/pages/projects/tiezheng', pagesPatch);
    markStage('inspect-patch-response');
    const patchResult = parsePagesProject(patchResponse);
    const patchedPreview = inspectExpectedPreviewProject(
      patchResult,
      pagesPatch.deployment_configs.preview,
      (checkpoint) => markStage(`inspect-patch-response:${checkpoint}`),
    );
    if (
      patchedPreview.behaviorHash !== beforePreview.behaviorHash
      || productionHash(patchResult) !== beforeProductionHash
    ) {
      fail();
    }
    markStage('read-after');
    const afterResult = await get('/pages/projects/tiezheng');
    markStage('inspect-after');
    const afterProject = parsePagesProject(afterResult);
    const afterPreview = inspectExpectedPreviewProject(
      afterProject,
      pagesPatch.deployment_configs.preview,
      (checkpoint) => markStage(`inspect-after:${checkpoint}`),
    );
    if (
      afterPreview.behaviorHash !== beforePreview.behaviorHash
      || productionHash(afterProject) !== beforeProductionHash
    ) {
      fail();
    }

    return { configured: true };
  } catch {
    fail();
  }
}
