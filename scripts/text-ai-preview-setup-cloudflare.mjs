import { verifyTextPreviewSetupToken } from './text-ai-preview-control.mjs';
import { SETUP_POLICY, parseTeamDomain } from './text-ai-preview-setup-values.mjs';

const FAILURE_MESSAGE = 'Text preview setup failed';
const BLOCKED_MESSAGE = 'Text preview setup blocked: cloudflare.service-token';
const PAGE_SIZE = 20;
const MAX_RECORD_PROPERTIES = 64;
const ID_PATTERN = /^(?=.{1,255}$)[A-Za-z0-9._-]+$/u;
const CLIENT_ID_PATTERN = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/u;
const SECRET_PATTERN = /[\u0000-\u001f\u007f]/u;
const RESERVED_IDS = new Set(['.', '..', '__proto__', 'constructor', 'prototype']);

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function blocked() {
  throw new Error(BLOCKED_MESSAGE);
}

function ownMethod(client, name) {
  try {
    if (client === null || (typeof client !== 'object' && typeof client !== 'function')) fail();
    const descriptor = Object.getOwnPropertyDescriptor(client, name);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    if (typeof descriptor.value !== 'function') fail();
    return descriptor.value;
  } catch {
    fail();
  }
}

function call(client, method, ...args) {
  return Reflect.apply(method, client, args);
}

function snapshotRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_RECORD_PROPERTIES) fail();
  const result = new Map();
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    result.set(key, descriptor.value);
  }
  return result;
}

function snapshotDenseArray(value) {
  if (!Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype) fail();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')) fail();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length >= PAGE_SIZE) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) fail();
  const indexKeys = new Set();
  let hasLength = false;
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail();
    if (key === 'length') {
      if (hasLength) fail();
      hasLength = true;
      continue;
    }
    if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length) fail();
    indexKeys.add(key);
  }
  if (!hasLength || indexKeys.size !== length) fail();
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    items.push(descriptor.value);
  }
  return items;
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

function validClientId(value) {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

function validSecret(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 4_096
    && value.trim() === value
    && !SECRET_PATTERN.test(value);
}

function validInventoryName(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.trim() === value
    && !SECRET_PATTERN.test(value);
}

function parseInventory(value) {
  const items = snapshotDenseArray(value);
  const seenIds = new Set();
  for (const item of items) {
    const record = snapshotRecord(item);
    const id = record.get('id');
    const name = record.get('name');
    if (!record.has('id') || !validId(id) || seenIds.has(id)) fail();
    seenIds.add(id);
    if (!record.has('name') || !validInventoryName(name)) fail();
    if (name === SETUP_POLICY.serviceTokenName) fail();
  }
  return items;
}

function parseOrganization(value) {
  const record = snapshotRecord(value);
  return parseTeamDomain(record.get('auth_domain'));
}

function readResponseRecord(value) {
  const state = { malformed: false, id: undefined, data: new Map() };
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      state.malformed = true;
      return state;
    }
    let idDescriptor;
    try {
      idDescriptor = Object.getOwnPropertyDescriptor(value, 'id');
      if (idDescriptor === undefined || !Object.hasOwn(idDescriptor, 'value')) {
        state.malformed = true;
      } else {
        state.data.set('id', idDescriptor.value);
        if (validId(idDescriptor.value)) state.id = idDescriptor.value;
      }
    } catch {
      state.malformed = true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) state.malformed = true;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_RECORD_PROPERTIES) {
      state.malformed = true;
      return state;
    }
    let sawIdKey = false;
    for (const key of ownKeys) {
      if (typeof key !== 'string') {
        state.malformed = true;
        continue;
      }
      if (key === 'id') {
        sawIdKey = true;
        if (idDescriptor === undefined || !Object.hasOwn(idDescriptor, 'value')) {
          state.malformed = true;
        }
        continue;
      }
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        state.malformed = true;
        continue;
      }
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        state.malformed = true;
        continue;
      }
      state.data.set(key, descriptor.value);
    }
    if (!sawIdKey) state.malformed = true;
  } catch {
    state.malformed = true;
  }
  return state;
}

function responseIsValid(parsed) {
  const { data } = parsed;
  return !parsed.malformed
    && validId(data.get('id'))
    && data.get('name') === SETUP_POLICY.serviceTokenName
    && data.get('duration') === SETUP_POLICY.serviceTokenDuration
    && (!data.has('enabled') || data.get('enabled') === true)
    && validClientId(data.get('client_id'))
    && validSecret(data.get('client_secret'));
}

async function inventoryCompensation(client) {
  try {
    const get = ownMethod(client, 'get');
    parseInventory(await call(client, get, '/access/service_tokens'));
  } catch {
    blocked();
  }
  fail();
}

async function deleteCompensation(client, id) {
  try {
    const remove = ownMethod(client, 'delete');
    await call(client, remove, `/access/service_tokens/${id}`);
  } catch {
    blocked();
  }
  fail();
}

export async function inspectCloudflareSetup(accountId, client) {
  try {
    const token = await verifyTextPreviewSetupToken(accountId, client);
    const tokenRecord = snapshotRecord(token);
    const missingPermissions = tokenRecord.get('missingPermissions');
    const missing = snapshotDenseArray(missingPermissions);
    for (const permission of missing) {
      if (typeof permission !== 'string') fail();
    }
    if (missing.length > 0) {
      return Object.freeze({ status: 'missing-permissions', missingPermissions });
    }
    const get = ownMethod(client, 'get');
    const teamDomain = parseOrganization(await call(client, get, '/access/organizations'));
    parseInventory(await call(client, get, '/access/service_tokens'));
    return Object.freeze({ status: 'ready', teamDomain });
  } catch {
    fail();
  }
}

export async function createSetupServiceToken(client) {
  const body = Object.freeze({
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
  });
  let response;
  try {
    const post = ownMethod(client, 'post');
    response = await call(client, post, '/access/service_tokens', body);
  } catch {
    return inventoryCompensation(client);
  }

  const parsed = readResponseRecord(response);
  if (responseIsValid(parsed)) {
    return Object.freeze({
      id: parsed.data.get('id'),
      clientId: parsed.data.get('client_id'),
      clientSecret: parsed.data.get('client_secret'),
    });
  }
  if (parsed.id !== undefined) return deleteCompensation(client, parsed.id);
  return inventoryCompensation(client);
}

export async function deleteSetupServiceToken(client, id) {
  if (!validId(id)) fail();
  try {
    const remove = ownMethod(client, 'delete');
    await call(client, remove, `/access/service_tokens/${id}`);
  } catch {
    fail();
  }
}
