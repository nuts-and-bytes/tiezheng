import { randomBytes } from 'node:crypto';

const FAILURE = 'Text preview setup failed';
const EMAIL_PATTERN = /^(?=.{3,254}$)(?=.{1,64}@)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const TEAM_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const CLIENT_ID_PATTERN = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/u;
const BASE64_32_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
const HEX_32_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_WIPE_NODES = 10_000;
const MAX_WIPE_PROPERTIES = 100_000;
const SETUP_INPUT_NAMES = Object.freeze([
  'cloudflareApiToken',
  'arkApiKey',
  'user1Email',
  'user2Email',
]);
const SETUP_WRITE_NAMES = Object.freeze(['inputs', 'teamDomain', 'serviceClientId', 'serviceClientSecret', 'keys']);

export const SETUP_POLICY = Object.freeze({
  repo: 'nuts-and-bytes/tiezheng',
  environment: 'text-ai-preview',
  serviceTokenName: 'tiezheng-text-ai-preview-github-actions',
  serviceTokenDuration: '8760h',
  secretNames: Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ]),
  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),
});

function fail() {
  throw new Error(FAILURE);
}

function exactDataRecord(value, names) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== names.length || ownKeys.some((key) => typeof key !== 'string' || !names.includes(key))) fail();
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      result[name] = descriptor.value;
    }
    return result;
  } catch {
    fail();
  }
}

function peekDataProperty(value, name) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function validSecret(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 4_096
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function parseTeamSlug(value) {
  if (typeof value !== 'string' || !TEAM_SLUG_PATTERN.test(value)) fail();
  return value;
}

export function parseSetupInputs(value) {
  const input = exactDataRecord(value, SETUP_INPUT_NAMES);
  if (!validSecret(input.cloudflareApiToken) || !validSecret(input.arkApiKey)) fail();
  if (typeof input.user1Email !== 'string' || typeof input.user2Email !== 'string') fail();
  if (!EMAIL_PATTERN.test(input.user1Email) || !EMAIL_PATTERN.test(input.user2Email)) fail();
  if (input.user1Email === input.user2Email) fail();
  return Object.freeze({
    cloudflareApiToken: input.cloudflareApiToken,
    arkApiKey: input.arkApiKey,
    user1Email: input.user1Email,
    user2Email: input.user2Email,
  });
}

export function parseTeamDomain(authDomain) {
  const suffix = '.cloudflareaccess.com';
  if (typeof authDomain !== 'string' || !authDomain.endsWith(suffix)) fail();
  return parseTeamSlug(authDomain.slice(0, -suffix.length));
}

function zeroBuffer(value) {
  if (!Buffer.isBuffer(value)) return;
  try {
    value.fill(0);
  } catch {
    // A hostile Buffer-like object must not replace the fixed failure path.
  }
}

export function generateSetupKeys(random = randomBytes) {
  let aes;
  let hmac;
  try {
    if (typeof random !== 'function') fail();
    aes = random(32);
    hmac = random(32);
    if (!Buffer.isBuffer(hmac) || hmac.length !== 32) fail();
    if (!Buffer.isBuffer(aes) || aes.length !== 32) fail();
    return Object.freeze({
      aesKey: Buffer.from(aes.toString('base64'), 'ascii'),
      hmacKey: Buffer.from(hmac.toString('hex'), 'ascii'),
    });
  } catch {
    fail();
  } finally {
    zeroBuffer(aes);
    zeroBuffer(hmac);
  }
}

function asciiBufferText(value, pattern) {
  if (!Buffer.isBuffer(value) || value.some((byte) => byte > 0x7f)) fail();
  const text = value.toString('ascii');
  if (!pattern.test(text)) fail();
  return text;
}

function validEncodedKeys(keys) {
  const parsed = exactDataRecord(keys, ['aesKey', 'hmacKey']);
  const aesText = asciiBufferText(parsed.aesKey, BASE64_32_PATTERN);
  const decoded = Buffer.from(aesText, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== aesText) fail();
  asciiBufferText(parsed.hmacKey, HEX_32_PATTERN);
  return parsed;
}

function entry(name, value) {
  return Object.freeze({ name, value: Buffer.from(value) });
}

export function assembleSetupWrites(value) {
  let sourceKeys;
  try {
    sourceKeys = peekDataProperty(value, 'keys');
    const args = exactDataRecord(value, SETUP_WRITE_NAMES);
    const inputs = parseSetupInputs(args.inputs);
    const keys = validEncodedKeys(args.keys);
    if (typeof args.serviceClientId !== 'string' || !CLIENT_ID_PATTERN.test(args.serviceClientId)) fail();
    if (!validSecret(args.serviceClientSecret)) fail();
    const teamDomain = parseTeamSlug(args.teamDomain);
    const secrets = Object.freeze([
      entry('CLOUDFLARE_API_TOKEN', inputs.cloudflareApiToken),
      entry('ARK_API_KEY', inputs.arkApiKey),
      entry('PHOTO_AI_CACHE_AES_KEY', keys.aesKey),
      entry('PHOTO_AI_ACCOUNT_HMAC_KEY', keys.hmacKey),
      entry('TEXT_AI_USER_1_EMAIL', inputs.user1Email),
      entry('TEXT_AI_USER_2_EMAIL', inputs.user2Email),
      entry('TEXT_AI_ADMIN_EMAIL', inputs.user1Email),
      entry('TEXT_AI_CF_ACCESS_CLIENT_ID', args.serviceClientId),
      entry('TEXT_AI_CF_ACCESS_CLIENT_SECRET', args.serviceClientSecret),
    ]);
    return Object.freeze({
      secrets,
      variables: Object.freeze([entry('TEXT_AI_TEAM_DOMAIN', teamDomain)]),
    });
  } catch {
    fail();
  } finally {
    const keys = sourceKeys;
    if (keys !== null && typeof keys === 'object') {
      zeroBuffer(peekDataProperty(keys, 'aesKey'));
      zeroBuffer(peekDataProperty(keys, 'hmacKey'));
    }
  }
}

function collectBufferProperty(value, buffers) {
  const pending = [value];
  const seen = new WeakSet();
  let nodes = 0;
  let properties = 0;
  let complete = true;
  while (pending.length > 0) {
    const current = pending.pop();
    if (Buffer.isBuffer(current)) {
      buffers.add(current);
      continue;
    }
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    nodes += 1;
    if (nodes > MAX_WIPE_NODES) {
      complete = false;
      continue;
    }
    let keys;
    try {
      keys = Reflect.ownKeys(current);
    } catch {
      complete = false;
      continue;
    }
    for (const key of keys) {
      properties += 1;
      if (properties > MAX_WIPE_PROPERTIES) {
        complete = false;
        break;
      }
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        complete = false;
        continue;
      }
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) continue;
      const child = descriptor.value;
      if (Buffer.isBuffer(child)) buffers.add(child);
      else if (child !== null && (typeof child === 'object' || typeof child === 'function')) pending.push(child);
    }
  }
  return complete;
}

function inspectWriteGroup(group, buffers) {
  if (!Array.isArray(group)) {
    collectBufferProperty(group, buffers);
    return false;
  }
  let valid = true;
  let keys;
  try {
    keys = Reflect.ownKeys(group);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(group, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) valid = false;
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= group.length) {
        valid = false;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(group, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        valid = false;
        continue;
      }
      const item = descriptor.value;
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        collectBufferProperty(item, buffers);
        valid = false;
        continue;
      }
      collectBufferProperty(item, buffers);
      const itemKeys = Reflect.ownKeys(item);
      if (itemKeys.length !== 2 || itemKeys.some((itemKey) => typeof itemKey !== 'string' || !['name', 'value'].includes(itemKey))) {
        valid = false;
        continue;
      }
      const nameDescriptor = Object.getOwnPropertyDescriptor(item, 'name');
      const valueDescriptor = Object.getOwnPropertyDescriptor(item, 'value');
      if (nameDescriptor === undefined || !Object.hasOwn(nameDescriptor, 'value')
        || valueDescriptor === undefined || !Object.hasOwn(valueDescriptor, 'value')
        || typeof nameDescriptor.value !== 'string' || !Buffer.isBuffer(valueDescriptor.value)) valid = false;
    }
    if (group.length !== keys.filter((key) => typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key)).length) valid = false;
  } catch {
    valid = false;
  }
  return valid;
}

export function wipeSetupWrites(writes) {
  const buffers = new Set();
  let valid = collectBufferProperty(writes, buffers);
  try {
    if (writes === null || typeof writes !== 'object' || Array.isArray(writes)) fail();
    const prototype = Object.getPrototypeOf(writes);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const ownKeys = Reflect.ownKeys(writes);
    if (ownKeys.length !== 2 || ownKeys.some((key) => typeof key !== 'string' || !['secrets', 'variables'].includes(key))) fail();
    const secretDescriptor = Object.getOwnPropertyDescriptor(writes, 'secrets');
    const variableDescriptor = Object.getOwnPropertyDescriptor(writes, 'variables');
    if (secretDescriptor === undefined || !Object.hasOwn(secretDescriptor, 'value')
      || variableDescriptor === undefined || !Object.hasOwn(variableDescriptor, 'value')) fail();
    const secretsValid = inspectWriteGroup(secretDescriptor.value, buffers);
    const variablesValid = inspectWriteGroup(variableDescriptor.value, buffers);
    valid = valid && secretsValid && variablesValid;
  } catch {
    valid = false;
    const secrets = peekDataProperty(writes, 'secrets');
    const variables = peekDataProperty(writes, 'variables');
    const secretsValid = inspectWriteGroup(secrets, buffers);
    const variablesValid = inspectWriteGroup(variables, buffers);
    if (!secretsValid) collectBufferProperty(secrets, buffers);
    if (!variablesValid) collectBufferProperty(variables, buffers);
  } finally {
    for (const buffer of buffers) zeroBuffer(buffer);
  }
  if (!valid) fail();
}
