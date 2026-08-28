import { createHmac, randomBytes } from 'node:crypto';

const FAILURE = 'Text preview setup failed';
const SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'ARK_API_KEY',
  'PHOTO_AI_CACHE_AES_KEY',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  'TEXT_AI_SESSION_SIGNING_KEY',
  'TEXT_AI_RATE_LIMIT_HMAC_KEY',
  'TEXT_AI_ADMIN_SIGNING_KEY',
]);
const MATERIAL_NAMES = Object.freeze([
  'user1Code',
  'user2Code',
  'cacheAesKey',
  'accountHmacKey',
  'user1AccessCodePepper',
  'user2AccessCodePepper',
  'sessionSigningKey',
  'rateLimitHmacKey',
  'adminSigningKey',
]);
const INPUT_NAMES = Object.freeze(['cloudflareApiToken', 'arkApiKey']);
const RANDOM_LENGTHS = Object.freeze([24, 24, 32, 32, 32, 32, 32, 32, 32]);
const ACCESS_CODE = /^[A-Za-z0-9_-]{32}$/u;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/u;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/u;
const HEX_32 = /^[a-f0-9]{64}$/u;
const MATERIALS = new WeakSet();
const RENDERED = new WeakSet();
const WRITES = new WeakSet();
const TYPED_ARRAY_FILL = Uint8Array.prototype.fill;

export const SETUP_POLICY = Object.freeze({
  repository: 'nuts-and-bytes/tiezheng',
  environment: 'text-ai-preview',
  secretNames: SECRET_NAMES,
  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID']),
});

function fail() {
  throw new Error(FAILURE);
}

function exactDataRecord(value, names) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== names.length
      || keys.some((key) => typeof key !== 'string' || !names.includes(key))
    ) fail();
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

function dataMethod(value, name) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) fail();
    let current = value;
    for (let depth = 0; current !== null && depth < 32; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined) {
        if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current);
    }
    fail();
  } catch {
    fail();
  }
}

function validSecret(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 4_096
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function parseSetupInputs(value) {
  const input = exactDataRecord(value, INPUT_NAMES);
  if (!validSecret(input.cloudflareApiToken) || !validSecret(input.arkApiKey)) fail();
  return Object.freeze({
    cloudflareApiToken: input.cloudflareApiToken,
    arkApiKey: input.arkApiKey,
  });
}

function wipeBuffer(value) {
  try {
    if (!Buffer.isBuffer(value)) return false;
    Reflect.apply(TYPED_ARRAY_FILL, value, [0]);
    return true;
  } catch {
    return false;
  }
}

function wipeAll(values) {
  let ok = true;
  for (const value of values) {
    if (value !== undefined && !wipeBuffer(value)) ok = false;
  }
  return ok;
}

function encodedBuffer(value, encoding) {
  if (!Buffer.isBuffer(value)) fail();
  return Buffer.from(value.toString(encoding), 'ascii');
}

function bufferText(value, pattern) {
  if (!Buffer.isBuffer(value)) fail();
  for (const byte of value) if (byte > 0x7f) fail();
  const text = value.toString('ascii');
  if (!pattern.test(text) || Buffer.byteLength(text, 'ascii') !== value.byteLength) fail();
  return text;
}

function materialRecord(value, { requireCodes = true } = {}) {
  if (!MATERIALS.has(value)) fail();
  const record = exactDataRecord(value, MATERIAL_NAMES);
  const patterns = [
    ACCESS_CODE,
    ACCESS_CODE,
    BASE64_32,
    HEX_32,
    BASE64URL_32,
    BASE64URL_32,
    BASE64URL_32,
    BASE64URL_32,
    BASE64URL_32,
  ];
  const result = {};
  for (let index = 0; index < MATERIAL_NAMES.length; index += 1) {
    const name = MATERIAL_NAMES[index];
    if (!Buffer.isBuffer(record[name])) fail();
    if (requireCodes || index > 1) result[name] = bufferText(record[name], patterns[index]);
  }
  return Object.freeze(result);
}

export function generateSetupMaterials(random = randomBytes) {
  const raw = [];
  const encoded = [];
  let complete = false;
  try {
    if (typeof random !== 'function') fail();
    for (const length of RANDOM_LENGTHS) {
      const value = random(length);
      raw.push(value);
      if (!Buffer.isBuffer(value) || value.byteLength !== length) fail();
    }
    if (raw[0].equals(raw[1])) fail();
    const keyFingerprints = raw.slice(2).map((value) => value.toString('hex'));
    if (new Set(keyFingerprints).size !== 7) fail();

    encoded.push(
      encodedBuffer(raw[0], 'base64url'),
      encodedBuffer(raw[1], 'base64url'),
      encodedBuffer(raw[2], 'base64'),
      encodedBuffer(raw[3], 'hex'),
      encodedBuffer(raw[4], 'base64url'),
      encodedBuffer(raw[5], 'base64url'),
      encodedBuffer(raw[6], 'base64url'),
      encodedBuffer(raw[7], 'base64url'),
      encodedBuffer(raw[8], 'base64url'),
    );
    const materials = Object.freeze(Object.fromEntries(
      MATERIAL_NAMES.map((name, index) => [name, encoded[index]]),
    ));
    MATERIALS.add(materials);
    materialRecord(materials);
    complete = true;
    return materials;
  } catch {
    fail();
  } finally {
    wipeAll(raw);
    if (!complete) wipeAll(encoded);
  }
}

function entry(name, value) {
  const buffer = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  return Object.freeze({ name, value: buffer });
}

function accessCodeDigest(code, pepper) {
  const key = Buffer.from(pepper, 'base64url');
  try {
    if (key.byteLength !== 32 || key.toString('base64url') !== pepper) fail();
    return createHmac('sha256', key).update(code, 'utf8').digest('hex');
  } finally {
    wipeBuffer(key);
  }
}

export function assembleSetupWrites(value) {
  const created = [];
  let complete = false;
  try {
    const record = exactDataRecord(value, ['inputs', 'materials']);
    const inputs = parseSetupInputs(record.inputs);
    if (RENDERED.has(record.materials)) fail();
    const materials = materialRecord(record.materials);
    const values = new Map([
      ['CLOUDFLARE_API_TOKEN', inputs.cloudflareApiToken],
      ['ARK_API_KEY', inputs.arkApiKey],
      ['PHOTO_AI_CACHE_AES_KEY', materials.cacheAesKey],
      ['PHOTO_AI_ACCOUNT_HMAC_KEY', materials.accountHmacKey],
      ['TEXT_AI_USER_1_ACCESS_CODE_PEPPER', materials.user1AccessCodePepper],
      [
        'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
        accessCodeDigest(materials.user1Code, materials.user1AccessCodePepper),
      ],
      ['TEXT_AI_USER_2_ACCESS_CODE_PEPPER', materials.user2AccessCodePepper],
      [
        'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
        accessCodeDigest(materials.user2Code, materials.user2AccessCodePepper),
      ],
      ['TEXT_AI_SESSION_SIGNING_KEY', materials.sessionSigningKey],
      ['TEXT_AI_RATE_LIMIT_HMAC_KEY', materials.rateLimitHmacKey],
      ['TEXT_AI_ADMIN_SIGNING_KEY', materials.adminSigningKey],
    ]);
    const secrets = Object.freeze(SECRET_NAMES.map((name) => {
      const item = entry(name, values.get(name));
      created.push(item.value);
      return item;
    }));
    const writes = Object.freeze({ secrets });
    WRITES.add(writes);
    complete = true;
    return writes;
  } catch {
    fail();
  } finally {
    if (!complete) wipeAll(created);
  }
}

export function renderAccessCodesOnce(output, materials) {
  let record;
  try {
    if (RENDERED.has(materials)) fail();
    record = materialRecord(materials);
    RENDERED.add(materials);
    const write = dataMethod(output, 'write');
    const result = Reflect.apply(write, output, [
      `TEXT AI ACCESS CODES - save now\nuser-1: ${record.user1Code}\nuser-2: ${record.user2Code}\n`,
    ]);
    if (result !== undefined && typeof result !== 'boolean') fail();
  } catch {
    fail();
  } finally {
    if (MATERIALS.has(materials)) {
      let raw;
      try {
        raw = exactDataRecord(materials, MATERIAL_NAMES);
      } catch {
        raw = {};
      }
      wipeAll([raw.user1Code, raw.user2Code]);
    }
  }
}

export function wipeSetupMaterials(materials) {
  let record;
  try {
    if (!MATERIALS.has(materials)) fail();
    record = exactDataRecord(materials, MATERIAL_NAMES);
  } catch {
    fail();
  }
  if (!wipeAll(MATERIAL_NAMES.map((name) => record[name]))) fail();
}

export function wipeSetupWrites(writes) {
  try {
    if (!WRITES.has(writes)) fail();
    const record = exactDataRecord(writes, ['secrets']);
    if (!Array.isArray(record.secrets) || record.secrets.length !== SECRET_NAMES.length) fail();
    const buffers = [];
    for (let index = 0; index < SECRET_NAMES.length; index += 1) {
      const item = exactDataRecord(record.secrets[index], ['name', 'value']);
      if (item.name !== SECRET_NAMES[index] || !Buffer.isBuffer(item.value)) fail();
      buffers.push(item.value);
    }
    if (!wipeAll(buffers)) fail();
  } catch {
    fail();
  }
}
