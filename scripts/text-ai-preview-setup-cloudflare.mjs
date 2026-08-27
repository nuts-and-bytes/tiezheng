import { types as NODE_UTIL_TYPES } from 'node:util';

import { verifyTextPreviewSetupToken } from './text-ai-preview-control.mjs';
import { SETUP_POLICY, parseTeamDomain } from './text-ai-preview-setup-values.mjs';

const FAILURE_MESSAGE = 'Text preview setup failed';
const BLOCKED_MESSAGE = 'Text preview setup blocked: cloudflare.service-token';
const PAGE_SIZE = 20;
const MAX_RECORD_PROPERTIES = 64;
const ID_PATTERN = /^(?=.{1,255}$)[A-Za-z0-9._-]+$/u;
const CLIENT_ID_PATTERN = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/u;
const SECRET_PATTERN = /[\u0000-\u001f\u007f]/u;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const IS_PROXY = NODE_UTIL_TYPES.isProxy;
const MAP_CONSTRUCTOR = Map;
const MAP_GET = Map.prototype.get;
const MAP_HAS = Map.prototype.has;
const MAP_SET = Map.prototype.set;
const SET_CONSTRUCTOR = Set;
const SET_ADD = Set.prototype.add;
const SET_HAS = Set.prototype.has;
const SET_SIZE_GET = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
const RESERVED_IDS = new SET_CONSTRUCTOR(['.', '..', '__proto__', 'constructor', 'prototype']);

function mapGet(value, key) {
  return REFLECT_APPLY(MAP_GET, value, [key]);
}

function mapHas(value, key) {
  return REFLECT_APPLY(MAP_HAS, value, [key]);
}

function mapSet(value, key, item) {
  return REFLECT_APPLY(MAP_SET, value, [key, item]);
}

function setAdd(value, item) {
  return REFLECT_APPLY(SET_ADD, value, [item]);
}

function setHas(value, item) {
  return REFLECT_APPLY(SET_HAS, value, [item]);
}

function setSize(value) {
  return REFLECT_APPLY(SET_SIZE_GET, value, []);
}

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
  return REFLECT_APPLY(method, client, args);
}

function snapshotRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const ownKeys = REFLECT_OWN_KEYS(value);
  if (ownKeys.length > MAX_RECORD_PROPERTIES) fail();
  const result = new MAP_CONSTRUCTOR();
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    mapSet(result, key, descriptor.value);
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
  const ownKeys = REFLECT_OWN_KEYS(value);
  if (ownKeys.length !== length + 1) fail();
  const indexKeys = new SET_CONSTRUCTOR();
  let hasLength = false;
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail();
    if (key === 'length') {
      if (hasLength) fail();
      hasLength = true;
      continue;
    }
    if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length) fail();
    setAdd(indexKeys, key);
  }
  if (!hasLength || setSize(indexKeys) !== length) fail();
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    items.push(descriptor.value);
  }
  return items;
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !setHas(RESERVED_IDS, value);
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
  const seenIds = new SET_CONSTRUCTOR();
  for (const item of items) {
    const record = snapshotRecord(item);
    const id = mapGet(record, 'id');
    const name = mapGet(record, 'name');
    if (!mapHas(record, 'id') || !validId(id) || setHas(seenIds, id)) fail();
    setAdd(seenIds, id);
    if (!mapHas(record, 'name') || !validInventoryName(name)) fail();
    if (name === SETUP_POLICY.serviceTokenName) fail();
  }
  return items;
}

function parseOrganization(value) {
  const record = snapshotRecord(value);
  return parseTeamDomain(mapGet(record, 'auth_domain'));
}

function readResponseRecord(value) {
  const state = { malformed: false, id: undefined, data: new MAP_CONSTRUCTOR() };
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      state.malformed = true;
      return state;
    }
    if (REFLECT_APPLY(IS_PROXY, undefined, [value])) state.malformed = true;
    let idDescriptor;
    try {
      idDescriptor = Object.getOwnPropertyDescriptor(value, 'id');
      if (idDescriptor === undefined || !Object.hasOwn(idDescriptor, 'value')) {
        state.malformed = true;
      } else {
        mapSet(state.data, 'id', idDescriptor.value);
        if (validId(idDescriptor.value)) state.id = idDescriptor.value;
      }
    } catch {
      state.malformed = true;
    }
    let enabledDescriptor;
    try {
      enabledDescriptor = Object.getOwnPropertyDescriptor(value, 'enabled');
      if (enabledDescriptor !== undefined) {
        if (!Object.hasOwn(enabledDescriptor, 'value')) {
          state.malformed = true;
        } else {
          mapSet(state.data, 'enabled', enabledDescriptor.value);
        }
      }
    } catch {
      state.malformed = true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) state.malformed = true;
    const ownKeys = REFLECT_OWN_KEYS(value);
    if (ownKeys.length > MAX_RECORD_PROPERTIES) {
      state.malformed = true;
      return state;
    }
    let sawIdKey = false;
    let sawEnabledKey = false;
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
      if (key === 'enabled') {
        sawEnabledKey = true;
        if (enabledDescriptor === undefined || !Object.hasOwn(enabledDescriptor, 'value')) {
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
      mapSet(state.data, key, descriptor.value);
    }
    if (!sawIdKey || sawEnabledKey !== (enabledDescriptor !== undefined)) state.malformed = true;
  } catch {
    state.malformed = true;
  }
  return state;
}

function responseIsValid(parsed) {
  const { data } = parsed;
  return !parsed.malformed
    && validId(mapGet(data, 'id'))
    && mapGet(data, 'name') === SETUP_POLICY.serviceTokenName
    && mapGet(data, 'duration') === SETUP_POLICY.serviceTokenDuration
    && (!mapHas(data, 'enabled') || mapGet(data, 'enabled') === true)
    && validClientId(mapGet(data, 'client_id'))
    && validSecret(mapGet(data, 'client_secret'));
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
    const missingPermissions = mapGet(tokenRecord, 'missingPermissions');
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
      id: mapGet(parsed.data, 'id'),
      clientId: mapGet(parsed.data, 'client_id'),
      clientSecret: mapGet(parsed.data, 'client_secret'),
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
