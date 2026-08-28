import { verifyTextPreviewSetupToken } from './text-ai-preview-control.mjs';

const FAILURE = 'Text preview setup failed';
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const SAFE_ID = /^(?=.{1,255}$)[A-Za-z0-9._-]+$/u;
const WORKER_NAME = 'tiezheng-photo-ai-gateway';

function fail() {
  throw new Error(FAILURE);
}

function plainRecord(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    return value;
  } catch {
    fail();
  }
}

function ownValue(value, name) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(plainRecord(value), name);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    return descriptor.value;
  } catch {
    fail();
  }
}

function ownMethod(value, name) {
  const method = ownValue(value, name);
  if (typeof method !== 'function') fail();
  return method;
}

function denseArray(value, maximum = 100) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
    if (!Number.isSafeInteger(value.length) || value.length < 0 || value.length > maximum) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) fail();
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    }
    return [...value];
  } catch {
    fail();
  }
}

function parseTokenState(value, accountId) {
  const state = plainRecord(value);
  if (ownValue(state, 'accountId') !== accountId) fail();
  const missingPermissions = denseArray(ownValue(state, 'missingPermissions'), 3);
  if (
    new Set(missingPermissions).size !== missingPermissions.length
    || missingPermissions.some((name) => typeof name !== 'string')
  ) fail();
  return Object.freeze([...missingPermissions]);
}

function inspectProject(value) {
  const project = plainRecord(value);
  if (
    !SAFE_ID.test(ownValue(project, 'id'))
    || ownValue(project, 'name') !== 'tiezheng'
    || ownValue(project, 'production_branch') !== 'main'
  ) fail();
}

function inspectWorkerInventory(value) {
  const workers = denseArray(value);
  let matches = 0;
  for (const item of workers) {
    const worker = plainRecord(item);
    const id = ownValue(worker, 'id');
    if (typeof id !== 'string' || !SAFE_ID.test(id)) fail();
    if (id === WORKER_NAME) matches += 1;
  }
  if (matches !== 1) fail();
}

export async function inspectCloudflareSetup(accountId, client) {
  try {
    if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) fail();
    const get = ownMethod(client, 'get');
    const missingPermissions = parseTokenState(
      await verifyTextPreviewSetupToken(accountId, client),
      accountId,
    );
    if (missingPermissions.length > 0) {
      return Object.freeze({ status: 'missing-permissions', missingPermissions });
    }
    inspectProject(await Reflect.apply(get, client, ['/pages/projects/tiezheng']));
    inspectWorkerInventory(await Reflect.apply(get, client, ['/workers/scripts']));
    return Object.freeze({ status: 'ready' });
  } catch {
    fail();
  }
}
