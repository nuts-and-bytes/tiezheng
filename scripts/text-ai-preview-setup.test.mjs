import test from 'node:test';
import assert from 'node:assert/strict';

import { SETUP_POLICY, generateSetupMaterials } from './text-ai-preview-setup-values.mjs';
import { runTextPreviewSetup, runTextPreviewSetupCli } from './text-ai-preview-setup.mjs';

const SHA = 'a'.repeat(40);
const ACCOUNT_ID = 'b'.repeat(32);
const FAILURE_LINE = 'SETUP FAILED\n';

function deterministicMaterialsFixture() {
  let index = 0;
  const raw = [];
  const materials = generateSetupMaterials((length) => {
    index += 1;
    const value = Buffer.alloc(length, index);
    raw.push(value);
    return value;
  });
  return { materials, raw, encoded: Object.values(materials) };
}

function writer({ throwOn = null } = {}) {
  return {
    chunks: [],
    write(value) {
      if (throwOn !== null && String(value).includes(throwOn)) throw new Error('secret-sentinel');
      this.chunks.push(String(value));
      return true;
    },
    get text() {
      return this.chunks.join('');
    },
  };
}

function harness({
  confirm = true,
  cloudflareState = Object.freeze({ status: 'ready' }),
  failSecretIndex = null,
  failPreflight = false,
  stdout = writer(),
} = {}) {
  const fixture = deterministicMaterialsFixture();
  const events = [];
  const secretValues = new Map();
  const deleted = [];
  let secretIndex = 0;
  const stderr = writer();
  const github = Object.freeze({
    async inspectFirstRun() {
      events.push('inspect-github');
      return { accountId: ACCOUNT_ID, expectedSha: SHA };
    },
    async setSecret(name, value) {
      events.push(`set:${name}`);
      secretIndex += 1;
      secretValues.set(name, value.toString('utf8'));
      value.fill(0);
      if (secretIndex === failSecretIndex) throw new Error('secret-sentinel');
    },
    async deleteSecret(name) {
      events.push(`delete:${name}`);
      deleted.push(name);
    },
    async verifyNames() {
      events.push('verify-names');
    },
    async runDisabledPreflight(expectedSha) {
      events.push(`preflight:${expectedSha}`);
      if (failPreflight) throw new Error('secret-sentinel');
    },
  });
  const dependencies = Object.freeze({
    github,
    async promptInputs() {
      events.push('prompt');
      return { cloudflareApiToken: 'cloudflare-token', arkApiKey: 'ark-key' };
    },
    async confirm() {
      events.push('confirm');
      return confirm;
    },
    async createCloudflareClient(value) {
      events.push('create-cloudflare');
      assert.deepEqual(value, { accountId: ACCOUNT_ID, apiToken: 'cloudflare-token' });
      return Object.freeze({ get() {} });
    },
    async inspectCloudflare(accountId) {
      events.push(`inspect-cloudflare:${accountId}`);
      return cloudflareState;
    },
    generateMaterials() {
      events.push('generate');
      return fixture.materials;
    },
    stdout,
    stderr,
  });
  return {
    dependencies,
    events,
    secretValues,
    deleted,
    stdout,
    stderr,
    ...fixture,
  };
}

function assertWiped(fixture) {
  assert.equal(fixture.raw.every((value) => value.every((byte) => byte === 0)), true);
  assert.equal(fixture.encoded.every((value) => value.every((byte) => byte === 0)), true);
}

function extractCodes(output) {
  return [
    /^user-1: ([A-Za-z0-9_-]{32})$/mu.exec(output)?.[1],
    /^user-2: ([A-Za-z0-9_-]{32})$/mu.exec(output)?.[1],
  ];
}

test('success writes 11 secrets, shows each code once, verifies names, and runs only closed preflight', async () => {
  const fixture = harness();
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 0);
  assert.deepEqual([...fixture.secretValues.keys()], SETUP_POLICY.secretNames);
  const [user1, user2] = extractCodes(fixture.stdout.text);
  assert.equal(typeof user1, 'string');
  assert.equal(typeof user2, 'string');
  assert.equal(fixture.stdout.text.match(new RegExp(user1, 'gu'))?.length, 1);
  assert.equal(fixture.stdout.text.match(new RegExp(user2, 'gu'))?.length, 1);
  assert.equal([...fixture.secretValues.values()].some((value) => value === user1 || value === user2), false);
  assert.equal(fixture.stdout.text.endsWith(
    'SETUP COMPLETE\nsecrets=11 variables=1 preflight=pass workerTextEnabled=false photoEnabled=false\n',
  ), true);
  assert.deepEqual(fixture.deleted, []);
  assert.equal(fixture.events.indexOf('verify-names') < fixture.events.findIndex((x) => x.startsWith('preflight:')), true);
  assertWiped(fixture);
});

test('cancellation performs no writes and wipes every generated material buffer', async () => {
  const fixture = harness({ confirm: false });
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 1);
  assert.deepEqual([...fixture.secretValues], []);
  assert.equal(fixture.stderr.text, 'SETUP CANCELLED\n');
  assert.equal(fixture.stdout.text.includes('user-1:'), false);
  assertWiped(fixture);
});

test('missing permissions stops before generation and renders only canonical permission names', async () => {
  const fixture = harness({
    cloudflareState: Object.freeze({
      status: 'missing-permissions',
      missingPermissions: Object.freeze(['Cloudflare Pages Edit']),
    }),
  });
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 1);
  assert.equal(fixture.events.includes('generate'), false);
  assert.equal(fixture.stderr.text, 'SETUP FAILED missing_permissions=Cloudflare Pages Edit\n');
});

test('partial GitHub failure deletes attempted secrets in reverse and wipes all buffers', async () => {
  const fixture = harness({ failSecretIndex: 4 });
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 1);
  assert.deepEqual(fixture.deleted, SETUP_POLICY.secretNames.slice(0, 4).reverse());
  assert.equal(fixture.stderr.text, FAILURE_LINE);
  assert.equal(fixture.stdout.text.includes('user-1:'), false);
  assertWiped(fixture);
});

test('access-code output failure removes all newly written secrets and never runs preflight', async () => {
  const fixture = harness({ stdout: writer({ throwOn: 'TEXT AI ACCESS CODES' }) });
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 1);
  assert.deepEqual(fixture.deleted, [...SETUP_POLICY.secretNames].reverse());
  assert.equal(fixture.events.some((value) => value.startsWith('preflight:')), false);
  assert.equal(fixture.stderr.text, FAILURE_LINE);
  assertWiped(fixture);
});

test('preflight failure compensates all writes after codes are consumed and reports no secret', async () => {
  const fixture = harness({ failPreflight: true });
  assert.equal(await runTextPreviewSetup(fixture.dependencies), 1);
  assert.deepEqual(fixture.deleted, [...SETUP_POLICY.secretNames].reverse());
  assert.equal(fixture.stderr.text, 'SETUP BLOCKED preflight\n');
  for (const value of fixture.secretValues.values()) {
    assert.equal(fixture.stderr.text.includes(value), false);
  }
  assertWiped(fixture);
});

test('CLI rejects arguments and non-TTY execution before any remote action', async () => {
  const stderr = writer();
  const io = {
    stdin: { isTTY: false },
    stdout: { ...writer(), isTTY: false },
    stderr,
  };
  assert.equal(await runTextPreviewSetupCli([], io), 1);
  assert.equal(stderr.text, FAILURE_LINE);
  assert.equal(await runTextPreviewSetupCli(['extra'], io), 1);
});
