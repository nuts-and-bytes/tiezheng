import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  SETUP_POLICY,
  assembleSetupWrites,
  generateSetupMaterials,
  parseSetupInputs,
  renderAccessCodesOnce,
  wipeSetupMaterials,
  wipeSetupWrites,
} from './text-ai-preview-setup-values.mjs';

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

function fixedRandom() {
  const calls = [];
  const buffers = [];
  let index = 0;
  const random = (length) => {
    calls.push(length);
    index += 1;
    const value = Buffer.alloc(length, index);
    buffers.push(value);
    return value;
  };
  return { random, calls, buffers };
}

function textMap(writes) {
  return new Map(writes.secrets.map(({ name, value }) => [name, value.toString('ascii')]));
}

function captureCodes(materials, { throwOnWrite = false } = {}) {
  let output = '';
  const stream = {
    write(value) {
      if (throwOnWrite) throw new Error('secret-sentinel');
      output += value;
      return true;
    },
  };
  const result = renderAccessCodesOnce(stream, materials);
  return { output, result };
}

test('publishes the exact 11-secret and one-existing-variable policy', () => {
  assert.deepEqual(SETUP_POLICY, {
    repository: 'nuts-and-bytes/tiezheng',
    environment: 'text-ai-preview',
    secretNames: SECRET_NAMES,
    variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID']),
  });
  assert.equal(Object.isFrozen(SETUP_POLICY), true);
  assert.equal(Object.isFrozen(SETUP_POLICY.secretNames), true);
});

test('accepts exactly the two operator secrets and rejects extra or inherited values', () => {
  assert.deepEqual(parseSetupInputs({
    cloudflareApiToken: 'cloudflare-token',
    arkApiKey: 'ark-key',
  }), {
    cloudflareApiToken: 'cloudflare-token',
    arkApiKey: 'ark-key',
  });
  assert.throws(
    () => parseSetupInputs({ cloudflareApiToken: 'x', arkApiKey: 'y', user1Email: 'nope' }),
    { message: FAILURE },
  );
  const inherited = Object.create({ cloudflareApiToken: 'x' });
  inherited.arkApiKey = 'y';
  assert.throws(() => parseSetupInputs(inherited), { message: FAILURE });
});

test('generates two codes and seven independent keys with exact randomness and HMAC digests', () => {
  const fixture = fixedRandom();
  const materials = generateSetupMaterials(fixture.random);
  assert.deepEqual(fixture.calls, [24, 24, 32, 32, 32, 32, 32, 32, 32]);
  assert.equal(fixture.buffers.every((buffer) => buffer.every((byte) => byte === 0)), true);

  const writes = assembleSetupWrites({
    inputs: { cloudflareApiToken: 'cloudflare-token', arkApiKey: 'ark-key' },
    materials,
  });
  assert.deepEqual(writes.secrets.map(({ name }) => name), SECRET_NAMES);
  const values = textMap(writes);

  const { output } = captureCodes(materials);
  const user1 = /^user-1: ([A-Za-z0-9_-]{32})$/mu.exec(output)?.[1];
  const user2 = /^user-2: ([A-Za-z0-9_-]{32})$/mu.exec(output)?.[1];
  assert.equal(typeof user1, 'string');
  assert.equal(typeof user2, 'string');
  assert.notEqual(user1, user2);
  assert.equal(output.match(new RegExp(user1, 'gu'))?.length, 1);
  assert.equal(output.match(new RegExp(user2, 'gu'))?.length, 1);

  const keyNames = [
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
    'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
    'TEXT_AI_SESSION_SIGNING_KEY',
    'TEXT_AI_RATE_LIMIT_HMAC_KEY',
    'TEXT_AI_ADMIN_SIGNING_KEY',
  ];
  assert.equal(new Set(keyNames.map((name) => values.get(name))).size, 7);
  for (const name of keyNames.slice(2)) assert.match(values.get(name), /^[A-Za-z0-9_-]{43}$/u);

  const expectedUser1 = createHmac(
    'sha256',
    Buffer.from(values.get('TEXT_AI_USER_1_ACCESS_CODE_PEPPER'), 'base64url'),
  ).update(user1, 'utf8').digest('hex');
  const expectedUser2 = createHmac(
    'sha256',
    Buffer.from(values.get('TEXT_AI_USER_2_ACCESS_CODE_PEPPER'), 'base64url'),
  ).update(user2, 'utf8').digest('hex');
  assert.equal(values.get('TEXT_AI_USER_1_ACCESS_CODE_DIGEST'), expectedUser1);
  assert.equal(values.get('TEXT_AI_USER_2_ACCESS_CODE_DIGEST'), expectedUser2);
  assert.equal([...values.values()].some((value) => value === user1 || value === user2), false);

  assert.throws(() => renderAccessCodesOnce({ write() {} }, materials), { message: FAILURE });
  wipeSetupWrites(writes);
  wipeSetupMaterials(materials);
  assert.equal(writes.secrets.every(({ value }) => value.every((byte) => byte === 0)), true);
});

test('wipes every random buffer and fails closed when generated keys repeat', () => {
  const buffers = [];
  const random = (length) => {
    const value = Buffer.alloc(length, length === 24 ? buffers.length + 1 : 7);
    buffers.push(value);
    return value;
  };
  assert.throws(() => generateSetupMaterials(random), { message: FAILURE });
  assert.equal(buffers.length, 9);
  assert.equal(buffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
});

test('render failure is fixed, never leaks the underlying error, and consumes both codes', () => {
  const fixture = fixedRandom();
  const materials = generateSetupMaterials(fixture.random);
  assert.throws(
    () => captureCodes(materials, { throwOnWrite: true }),
    (error) => error.message === FAILURE && !error.stack.includes('secret-sentinel'),
  );
  assert.throws(
    () => assembleSetupWrites({
      inputs: { cloudflareApiToken: 'cloudflare-token', arkApiKey: 'ark-key' },
      materials,
    }),
    { message: FAILURE },
  );
  wipeSetupMaterials(materials);

  const asyncFixture = fixedRandom();
  const asyncMaterials = generateSetupMaterials(asyncFixture.random);
  assert.throws(
    () => renderAccessCodesOnce({ write: () => Promise.resolve(true) }, asyncMaterials),
    { message: FAILURE },
  );
  wipeSetupMaterials(asyncMaterials);
});
