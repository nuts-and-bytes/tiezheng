import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETUP_POLICY,
  assembleSetupWrites,
  generateSetupKeys,
  parseSetupInputs,
  parseTeamDomain,
  wipeSetupWrites,
} from './text-ai-preview-setup-values.mjs';

const INPUTS = Object.freeze({
  cloudflareApiToken: 'cf-token-sentinel',
  arkApiKey: 'ark-key-sentinel',
  user1Email: 'owner@example.com',
  user2Email: 'tester@example.com',
});
const FAILURE = 'Text preview setup failed';
const expectFailure = (action) => assert.throws(action, { name: 'Error', message: FAILURE });

function expectDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) assert.equal(Object.isFrozen(item), true);
  }
}

function validKeys() {
  return {
    aesKey: Buffer.from('A'.repeat(43) + '='),
    hmacKey: Buffer.from('b'.repeat(64)),
  };
}

test('accepts exactly four canonical data inputs and returns a frozen value snapshot', () => {
  const parsed = parseSetupInputs(INPUTS);
  assert.deepEqual(parsed, INPUTS);
  assert.notEqual(parsed, INPUTS);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.isFrozen(parsed), true);
  const nullPrototype = Object.assign(Object.create(null), INPUTS);
  assert.deepEqual(parseSetupInputs(nullPrototype), INPUTS);
});

test('rejects input normalization, shape, accessor, prototype, symbol, and non-primitive cases', () => {
  const cases = [
    { ...INPUTS, user1Email: 'Owner@example.com' },
    { ...INPUTS, user2Email: INPUTS.user1Email },
    { ...INPUTS, arkApiKey: ' ark-key-sentinel' },
    { ...INPUTS, cloudflareApiToken: 'cf-token-sentinel\n' },
    { ...INPUTS, cloudflareApiToken: '\u0001' },
    { ...INPUTS, extra: 'field' },
    { cloudflareApiToken: INPUTS.cloudflareApiToken, arkApiKey: INPUTS.arkApiKey, user1Email: INPUTS.user1Email },
    Object.assign(Object.create({ inherited: true }), INPUTS),
    ['cf-token-sentinel', 'ark-key-sentinel', 'owner@example.com', 'tester@example.com'],
    null,
    'not an object',
    { ...INPUTS, user1Email: new String(INPUTS.user1Email) },
    { ...INPUTS, arkApiKey: 42 },
  ];
  const accessor = { ...INPUTS };
  delete accessor.cloudflareApiToken;
  Object.defineProperty(accessor, 'cloudflareApiToken', { get() { return INPUTS.cloudflareApiToken; }, enumerable: true });
  cases.push(accessor);
  const symbolCase = { ...INPUTS, [Symbol('unexpected')]: true };
  cases.push(symbolCase);
  for (const value of cases) expectFailure(() => parseSetupInputs(value));
});

test('rejects secret length and whitespace/control boundaries', () => {
  for (const value of ['', ' '.repeat(4096), 'a'.repeat(4097), 'a\tb', 'a\rb', 'a\u007fb']) {
    expectFailure(() => parseSetupInputs({ ...INPUTS, arkApiKey: value }));
  }
  expectFailure(() => parseSetupInputs({ ...INPUTS, cloudflareApiToken: 'a'.repeat(4097) }));
});

test('parses only an exact lowercase Cloudflare Access team domain', () => {
  assert.equal(parseTeamDomain('team-name.cloudflareaccess.com'), 'team-name');
  assert.equal(parseTeamDomain('a.cloudflareaccess.com'), 'a');
  assert.equal(parseTeamDomain(`${'a'.repeat(63)}.cloudflareaccess.com`), 'a'.repeat(63));
  for (const value of [
    'https://team.cloudflareaccess.com',
    'team.cloudflareaccess.com/path',
    'team.cloudflareaccess.com:443',
    'Team.cloudflareaccess.com',
    'team.Cloudflareaccess.com',
    'evil.example.com',
    '.cloudflareaccess.com',
    `${'a'.repeat(64)}.cloudflareaccess.com`,
    'a-.cloudflareaccess.com',
    '-a.cloudflareaccess.com',
    'a..cloudflareaccess.com',
  ]) expectFailure(() => parseTeamDomain(value));
});

test('policy contains exact fixed values and frozen arrays', () => {
  assert.deepEqual(SETUP_POLICY, {
    repo: 'nuts-and-bytes/tiezheng',
    environment: 'text-ai-preview',
    serviceTokenName: 'tiezheng-text-ai-preview-github-actions',
    serviceTokenDuration: '8760h',
    secretNames: [
      'CLOUDFLARE_API_TOKEN', 'ARK_API_KEY', 'PHOTO_AI_CACHE_AES_KEY',
      'PHOTO_AI_ACCOUNT_HMAC_KEY', 'TEXT_AI_USER_1_EMAIL', 'TEXT_AI_USER_2_EMAIL',
      'TEXT_AI_ADMIN_EMAIL', 'TEXT_AI_CF_ACCESS_CLIENT_ID', 'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
    ],
    variableNames: ['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN'],
  });
  expectDeepFrozen(SETUP_POLICY);
  assert.equal(Object.isFrozen(SETUP_POLICY.secretNames), true);
  assert.equal(Object.isFrozen(SETUP_POLICY.variableNames), true);
});

test('generates deterministic encoded keys and wipes raw random buffers', () => {
  const raw = [];
  const random = (size) => {
    const value = Buffer.alloc(size, raw.length === 0 ? 0x41 : 0x42);
    raw.push(value);
    return value;
  };
  const keys = generateSetupKeys(random);
  assert.equal(raw.length, 2);
  assert.ok(raw.every((value) => value.every((byte) => byte === 0)));
  assert.equal(keys.aesKey.toString('ascii'), `${Buffer.alloc(32, 0x41).toString('base64')}`);
  assert.equal(keys.hmacKey.toString('ascii'), Buffer.alloc(32, 0x42).toString('hex'));
  assert.equal(keys.aesKey.length, 44);
  assert.equal(keys.hmacKey.length, 64);
  assert.equal(Object.isFrozen(keys), true);
  assert.equal(Object.isFrozen(keys.aesKey), false);
});

test('fails closed and wipes valid raw buffers when random throws or returns malformed values', () => {
  const first = Buffer.alloc(32, 0x41);
  expectFailure(() => generateSetupKeys(() => { throw new Error('sensitive random failure'); }));
  assert.ok(first.every((byte) => byte === 0) === false);
  const malformed = Buffer.alloc(31, 0x41);
  const malformedSecond = Buffer.alloc(31, 0x42);
  let malformedCalls = 0;
  expectFailure(() => generateSetupKeys(() => {
    malformedCalls += 1;
    return malformedCalls === 1 ? malformed : malformedSecond;
  }));
  assert.equal(malformedCalls, 2);
  assert.ok(malformed.every((byte) => byte === 0));
  assert.ok(malformedSecond.every((byte) => byte === 0));
  const validThenThrow = Buffer.alloc(32, 0x41);
  let calls = 0;
  expectFailure(() => generateSetupKeys(() => {
    calls += 1;
    if (calls === 1) return validThenThrow;
    throw new Error('sensitive');
  }));
  assert.ok(validThenThrow.every((byte) => byte === 0));
});

test('assembles exact nine secrets and one variable with copied buffers and frozen entries', () => {
  const keys = validKeys();
  const aesSource = keys.aesKey;
  const hmacSource = keys.hmacKey;
  const aesText = aesSource.toString();
  const hmacText = hmacSource.toString();
  const writes = assembleSetupWrites({
    inputs: INPUTS,
    teamDomain: 'team-name',
    serviceClientId: 'client-id.access',
    serviceClientSecret: 'service-secret-sentinel',
    keys,
  });
  assert.deepEqual(writes.secrets.map(({ name }) => name), SETUP_POLICY.secretNames);
  assert.deepEqual(writes.variables.map(({ name }) => name), ['TEXT_AI_TEAM_DOMAIN']);
  assert.deepEqual(writes.secrets.map(({ value }) => value.toString()), [
    INPUTS.cloudflareApiToken, INPUTS.arkApiKey, aesText, hmacText,
    INPUTS.user1Email, INPUTS.user2Email, INPUTS.user1Email, 'client-id.access', 'service-secret-sentinel',
  ]);
  assert.equal(writes.variables[0].value.toString(), 'team-name');
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(Object.isFrozen(writes.secrets), true);
  assert.equal(Object.isFrozen(writes.variables), true);
  assert.ok(writes.secrets.every((item) => Object.isFrozen(item) && Buffer.isBuffer(item.value)));
  assert.ok(writes.variables.every((item) => Object.isFrozen(item) && Buffer.isBuffer(item.value)));
  assert.notEqual(writes.secrets[2].value, aesSource);
  assert.notEqual(writes.secrets[3].value, hmacSource);
  assert.ok(aesSource.every((byte) => byte === 0));
  assert.ok(hmacSource.every((byte) => byte === 0));
});

test('assembles no writes on invalid service values and always wipes source key buffers', () => {
  for (const overrides of [
    { serviceClientId: 'CLIENT.access' },
    { serviceClientId: '@client.access' },
    { serviceClientId: new String('client-id.access') },
    { serviceClientId: 'client-id.accessx' },
    { serviceClientSecret: ' bad' },
    { teamDomain: 'team-name.cloudflareaccess.com' },
    { keys: { aesKey: Buffer.from('not-base64'), hmacKey: Buffer.from('c'.repeat(64)) } },
  ]) {
    const keys = validKeys();
    expectFailure(() => assembleSetupWrites({
      inputs: INPUTS,
      teamDomain: 'team-name',
      serviceClientId: 'client-id.access',
      serviceClientSecret: 'service-secret-sentinel',
      keys,
      ...overrides,
    }));
    const passedKeys = overrides.keys ?? keys;
    assert.ok(passedKeys.aesKey.every((byte) => byte === 0));
    assert.ok(passedKeys.hmacKey.every((byte) => byte === 0));
  }
});

test('wipeSetupWrites clears all values and fails closed for malformed structures after clearing known values', () => {
  const writes = assembleSetupWrites({
    inputs: INPUTS,
    teamDomain: 'team-name',
    serviceClientId: 'client-id.access',
    serviceClientSecret: 'service-secret-sentinel',
    keys: validKeys(),
  });
  wipeSetupWrites(writes);
  assert.ok([...writes.secrets, ...writes.variables].every(({ value }) => value.every((byte) => byte === 0)));

  const known = Buffer.from('known-secret');
  const malformed = { secrets: [{ value: known }, { value: 'not-a-buffer' }], variables: [] };
  expectFailure(() => wipeSetupWrites(malformed));
  assert.ok(known.every((byte) => byte === 0));

  const valid = assembleSetupWrites({
    inputs: INPUTS,
    teamDomain: 'team-name',
    serviceClientId: 'client-id.access',
    serviceClientSecret: 'service-secret-sentinel',
    keys: validKeys(),
  });
  const withExtra = { ...valid, extra: true };
  expectFailure(() => wipeSetupWrites(withExtra));
  assert.ok([...valid.secrets, ...valid.variables].every(({ value }) => value.every((byte) => byte === 0)));
});
