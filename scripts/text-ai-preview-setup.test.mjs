import assert from 'node:assert/strict';
import test from 'node:test';

import { TEXT_PREVIEW_SETUP_PERMISSION_NAMES } from './text-ai-preview-control.mjs';
import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';
import {
  runTextPreviewSetup,
  runTextPreviewSetupCli,
} from './text-ai-preview-setup.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const EXPECTED_SHA = 'b'.repeat(40);
const SERVICE_TOKEN_ID = 'created-token-id';
const INPUTS = Object.freeze({
  cloudflareApiToken: 'cf-token-sentinel',
  arkApiKey: 'ark-key-sentinel',
  user1Email: 'one@example.com',
  user2Email: 'two@example.com',
});
const CREDENTIAL = Object.freeze({
  id: SERVICE_TOKEN_ID,
  clientId: 'setup-client.access',
  clientSecret: 'service-secret-sentinel',
});
const SUCCESS_OUTPUT = 'SETUP COMPLETE\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\n';
const PREVIEW_OUTPUT = [
  'SETUP PREVIEW',
  `repo=${SETUP_POLICY.repo}`,
  `environment=${SETUP_POLICY.environment}`,
  `service_token=${SETUP_POLICY.serviceTokenName}`,
  `secrets=${SETUP_POLICY.secretNames.join(',')}`,
  'variable=TEXT_AI_TEAM_DOMAIN',
  '不会部署、不会启用、不会调用模型',
  '',
].join('\n');
const ALL_WRITES = Object.freeze([
  ...SETUP_POLICY.secretNames.map((name) => `github.secret:${name}`),
  'github.variable:TEXT_AI_TEAM_DOMAIN',
]);
const ALL_COMPENSATION = Object.freeze([
  'github.variable:TEXT_AI_TEAM_DOMAIN',
  ...SETUP_POLICY.secretNames.toReversed().map((name) => `github.secret:${name}`),
  'cloudflare.service-token',
]);
const TYPED_ARRAY_EVERY = Uint8Array.prototype.every;

function makeKeys({ hostileFill = false } = {}) {
  const aesKey = Buffer.from(Buffer.alloc(32, 0x11).toString('base64'), 'ascii');
  const hmacKey = Buffer.from(Buffer.alloc(32, 0x22).toString('hex'), 'ascii');
  if (hostileFill) {
    for (const value of [aesKey, hmacKey]) {
      Object.defineProperty(value, 'fill', {
        configurable: true,
        value() {
          throw new Error('hostile-fill-sentinel');
        },
      });
    }
  }
  return Object.freeze({ aesKey, hmacKey });
}

function isWiped(value) {
  return Buffer.isBuffer(value)
    && Reflect.apply(TYPED_ARRAY_EVERY, value, [(byte) => byte === 0]);
}

function assertKeysWiped(keys) {
  assert.equal(isWiped(keys.aesKey), true);
  assert.equal(isWiped(keys.hmacKey), true);
}

function makeOutput(kind, events, options) {
  return {
    text: '',
    write(value) {
      assert.equal(typeof value, 'string');
      if (kind === 'stdout' && value === PREVIEW_OUTPUT) {
        events.push('preview');
        if (options.failAt === 'preview-output') throw new Error('preview-output-sentinel');
      } else if (kind === 'stdout' && value === SUCCESS_OUTPUT) {
        events.push('success-output');
        if (options.failAt === 'success-output') throw new Error('success-output-sentinel');
      }
      if (kind === 'stderr' && options.failAt === 'stderr-output') {
        throw new Error('stderr-output-sentinel');
      }
      this.text += value;
      return true;
    },
  };
}

function setupDependencies(options = {}) {
  const events = [];
  const deleted = [];
  const passedWriteBuffers = [];
  const keys = options.keys ?? makeKeys({ hostileFill: options.hostileFill === true });
  const stdout = makeOutput('stdout', events, options);
  const stderr = makeOutput('stderr', events, options);
  let writeIndex = 0;
  let generated = false;
  let createArguments;

  function failAt(name) {
    if (options.failAt === name) {
      throw options.thrownValue ?? new Error(`${name}-sentinel`);
    }
  }

  async function deleteResource(resource) {
    deleted.push(resource);
    events.push(`delete:${resource}`);
    if (options.failDeleteResources?.has(resource)) {
      throw new Error(`delete-sentinel:${resource}:${SERVICE_TOKEN_ID}`);
    }
  }

  const github = Object.freeze({
    async inspectFirstRun() {
      events.push('github.inspect');
      failAt('github.inspect');
      return options.githubState ?? Object.freeze({ accountId: ACCOUNT_ID, expectedSha: EXPECTED_SHA });
    },
    async setSecret(name, value) {
      const resource = `github.secret:${name}`;
      events.push(resource);
      passedWriteBuffers.push(value);
      const current = writeIndex;
      writeIndex += 1;
      if (options.failWriteAt === current) throw new Error(`write-sentinel:${name}`);
    },
    async setVariable(name, value) {
      const resource = `github.variable:${name}`;
      events.push(resource);
      passedWriteBuffers.push(value);
      const current = writeIndex;
      writeIndex += 1;
      if (options.failWriteAt === current) throw new Error(`write-sentinel:${name}`);
    },
    async deleteSecret(name) {
      await deleteResource(`github.secret:${name}`);
    },
    async deleteVariable(name) {
      await deleteResource(`github.variable:${name}`);
    },
    async verifyNames() {
      events.push('github.verify-names');
      failAt('verify-names');
    },
    async runDisabledPreflight(expectedSha) {
      events.push('github.preflight');
      assert.equal(expectedSha, EXPECTED_SHA);
      failAt('preflight');
    },
  });

  const dependencies = Object.freeze({
    github,
    async promptInputs() {
      events.push('prompt');
      failAt('prompt');
      return options.promptResult ?? INPUTS;
    },
    async confirm() {
      events.push('confirm');
      failAt('confirm');
      return options.confirmResult ?? true;
    },
    createCloudflareClient(value) {
      events.push('cloudflare.client');
      failAt('cloudflare.client');
      createArguments = value;
      return options.cloudflareClient ?? Object.freeze({ kind: 'cloudflare-client' });
    },
    async inspectCloudflare(accountId, client) {
      events.push('cloudflare.inspect');
      assert.equal(accountId, ACCOUNT_ID);
      assert.equal(client, options.cloudflareClient ?? dependencies.createCloudflareClientResult ?? client);
      failAt('cloudflare.inspect');
      if (options.cloudflareState !== undefined) return options.cloudflareState;
      if (options.missingPermissions !== undefined) {
        return Object.freeze({
          status: 'missing-permissions',
          missingPermissions: options.missingPermissions,
        });
      }
      return Object.freeze({ status: 'ready', teamDomain: 'team' });
    },
    async createServiceToken(client) {
      events.push('cloudflare.create');
      if (options.failAt === 'create-blocked') {
        throw new Error('Text preview setup blocked: cloudflare.service-token');
      }
      failAt('create-token');
      return options.credentialResult ?? CREDENTIAL;
    },
    async deleteServiceToken(client, id) {
      assert.equal(id, SERVICE_TOKEN_ID);
      await deleteResource('cloudflare.service-token');
    },
    generateKeys() {
      events.push('keys.generate');
      failAt('keys.generate');
      generated = true;
      return keys;
    },
    stdout,
    stderr,
  });

  return {
    dependencies,
    events,
    deleted,
    passedWriteBuffers,
    keys,
    stdout,
    stderr,
    get generated() {
      return generated;
    },
    get createArguments() {
      return createArguments;
    },
  };
}

function assertNoSensitiveOutput(fake, extra = []) {
  const rendered = fake.stdout.text + fake.stderr.text;
  for (const value of [
    INPUTS.cloudflareApiToken,
    INPUTS.arkApiKey,
    INPUTS.user1Email,
    INPUTS.user2Email,
    ACCOUNT_ID,
    'team',
    SERVICE_TOKEN_ID,
    CREDENTIAL.clientId,
    CREDENTIAL.clientSecret,
    'https://github.com/nuts-and-bytes/tiezheng/actions/runs/123',
    ...extra,
  ]) {
    assert.equal(rendered.includes(value), false, value);
  }
}

test('success previews without values, writes nine plus one, verifies names, and runs one disabled preflight', async () => {
  const fake = setupDependencies();
  assert.equal(await runTextPreviewSetup(fake.dependencies), 0);
  assert.deepEqual(fake.events, [
    'github.inspect',
    'prompt',
    'cloudflare.client',
    'cloudflare.inspect',
    'keys.generate',
    'preview',
    'confirm',
    'cloudflare.create',
    ...ALL_WRITES,
    'github.verify-names',
    'github.preflight',
    'success-output',
  ]);
  assert.deepEqual(fake.createArguments, {
    accountId: ACCOUNT_ID,
    apiToken: INPUTS.cloudflareApiToken,
  });
  assert.equal(fake.stdout.text, PREVIEW_OUTPUT + SUCCESS_OUTPUT);
  assert.equal(fake.stderr.text, '');
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.passedWriteBuffers.length, 10);
  assert.equal(fake.passedWriteBuffers.every(isWiped), true);
  assertKeysWiped(fake.keys);
  assertNoSensitiveOutput(fake);
});

test('every set boundary registers the attempted name before calling and compensates in reverse order', async () => {
  for (let failWriteAt = 0; failWriteAt < ALL_WRITES.length; failWriteAt += 1) {
    const fake = setupDependencies({ failWriteAt });
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1, String(failWriteAt));
    assert.deepEqual(fake.deleted, [
      ...ALL_WRITES.slice(0, failWriteAt + 1).toReversed(),
      'cloudflare.service-token',
    ], String(failWriteAt));
    assert.equal(fake.events.includes('github.verify-names'), false);
    assert.equal(fake.events.includes('github.preflight'), false);
    assert.equal(fake.stderr.text, 'SETUP FAILED\n');
    assert.equal(fake.passedWriteBuffers.every(isWiped), true);
    assertKeysWiped(fake.keys);
    assertNoSensitiveOutput(fake);
  }
});

test('verify failure compensates the variable, all secrets, and service token in fixed reverse order', async () => {
  const fake = setupDependencies({ failAt: 'verify-names' });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, ALL_COMPENSATION);
  assert.equal(fake.events.includes('github.preflight'), false);
  assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  assert.equal(fake.passedWriteBuffers.every(isWiped), true);
});

test('preflight failure preserves complete remote credentials and reports the fixed blocked state', async () => {
  const fake = setupDependencies({ failAt: 'preflight' });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED preflight\n');
  assert.equal(fake.events.filter((event) => event === 'github.preflight').length, 1);
  assert.equal(fake.passedWriteBuffers.every(isWiped), true);
  assertNoSensitiveOutput(fake, ['preflight-sentinel']);
});

test('success-output failure preserves complete remote credentials and reports output blocked', async () => {
  const fake = setupDependencies({ failAt: 'success-output' });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED output\n');
  assert.equal(fake.stdout.text, PREVIEW_OUTPUT);
  assert.equal(fake.passedWriteBuffers.every(isWiped), true);
  assertNoSensitiveOutput(fake, ['success-output-sentinel']);
});

test('missing token permissions print only official names in official order before keys or writes', async () => {
  const requested = [
    TEXT_PREVIEW_SETUP_PERMISSION_NAMES[6],
    TEXT_PREVIEW_SETUP_PERMISSION_NAMES[1],
    TEXT_PREVIEW_SETUP_PERMISSION_NAMES[0],
  ];
  const fake = setupDependencies({ missingPermissions: requested });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.events, [
    'github.inspect', 'prompt', 'cloudflare.client', 'cloudflare.inspect',
  ]);
  assert.equal(fake.generated, false);
  assert.deepEqual(fake.deleted, []);
  assert.equal(
    fake.stderr.text,
    `SETUP FAILED missing_permissions=${[
      TEXT_PREVIEW_SETUP_PERMISSION_NAMES[0],
      TEXT_PREVIEW_SETUP_PERMISSION_NAMES[1],
      TEXT_PREVIEW_SETUP_PERMISSION_NAMES[6],
    ].join(',')}\n`,
  );
  assertNoSensitiveOutput(fake);
});

test('malformed missing-permission inventories fail closed without rendering attacker strings', async () => {
  const hostile = 'permission-attacker-sentinel';
  for (const missingPermissions of [
    [],
    [TEXT_PREVIEW_SETUP_PERMISSION_NAMES[0], TEXT_PREVIEW_SETUP_PERMISSION_NAMES[0]],
    [hostile],
    Object.assign([TEXT_PREVIEW_SETUP_PERMISSION_NAMES[0]], { extra: hostile }),
  ]) {
    const fake = setupDependencies({ missingPermissions });
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
    assert.equal(fake.stderr.text, 'SETUP FAILED\n');
    assert.deepEqual(fake.deleted, []);
    assertNoSensitiveOutput(fake, [hostile]);
  }
});

test('cancellation follows preview, performs no remote writes, and intrinsically wipes raw keys', async () => {
  const fake = setupDependencies({ confirmResult: false, hostileFill: true });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.events, [
    'github.inspect', 'prompt', 'cloudflare.client', 'cloudflare.inspect',
    'keys.generate', 'preview', 'confirm',
  ]);
  assert.equal(fake.stdout.text, PREVIEW_OUTPUT);
  assert.equal(fake.stderr.text, 'SETUP CANCELLED\n');
  assert.deepEqual(fake.deleted, []);
  assertKeysWiped(fake.keys);
});

test('a malformed confirmation result fails closed rather than treating truthy data as consent', async () => {
  for (const confirmResult of ['y', 1, Object.freeze({ value: true })]) {
    const fake = setupDependencies({ confirmResult });
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
    assert.equal(fake.events.includes('cloudflare.create'), false);
    assert.equal(fake.stderr.text, 'SETUP FAILED\n');
    assertKeysWiped(fake.keys);
  }
});

test('all failures before token creation perform no compensation and never continue to a later phase', async () => {
  for (const failAt of [
    'github.inspect',
    'prompt',
    'cloudflare.client',
    'cloudflare.inspect',
    'keys.generate',
    'preview-output',
    'confirm',
  ]) {
    const thrownValue = new Error(`${failAt}:cf-token-sentinel:created-token-id`);
    const fake = setupDependencies({ failAt, thrownValue });
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1, failAt);
    assert.deepEqual(fake.deleted, [], failAt);
    assert.equal(fake.events.includes('cloudflare.create'), false, failAt);
    assert.equal(fake.events.includes('github.preflight'), false, failAt);
    assert.equal(fake.stderr.text, 'SETUP FAILED\n', failAt);
    if (fake.generated) assertKeysWiped(fake.keys);
    assertNoSensitiveOutput(fake, [failAt]);
  }
});

test('input parsing failure stops before Cloudflare inspection, keys, preview, or writes', async () => {
  const promptResult = Object.freeze({
    ...INPUTS,
    user2Email: INPUTS.user1Email,
  });
  const fake = setupDependencies({ promptResult });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.events, ['github.inspect', 'prompt']);
  assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  assert.deepEqual(fake.deleted, []);
});

test('generic Cloudflare create failure relies on adapter self-compensation and reports fixed failure', async () => {
  const fake = setupDependencies({
    failAt: 'create-token',
    thrownValue: new Error('cf-token-sentinel:created-token-id'),
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  assertKeysWiped(fake.keys);
  assertNoSensitiveOutput(fake);
});

test('Cloudflare create self-compensation failure maps only its fixed blocked error', async () => {
  const fake = setupDependencies({ failAt: 'create-blocked' });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED cleanup=cloudflare.service-token\n');
  assertKeysWiped(fake.keys);
});

test('assemble failure after a safe token id deletes only that token and wipes hostile raw keys', async () => {
  const fake = setupDependencies({
    hostileFill: true,
    credentialResult: Object.freeze({
      ...CREDENTIAL,
      clientId: 'invalid-client-id',
    }),
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, ['cloudflare.service-token']);
  assert.equal(fake.events.some((event) => event.startsWith('github.secret:')), false);
  assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  assertKeysWiped(fake.keys);
  assertNoSensitiveOutput(fake);
});

test('malformed resolved token without a safe id blocks cleanup without guessing an id', async () => {
  const fake = setupDependencies({
    credentialResult: Object.freeze({
      clientId: CREDENTIAL.clientId,
      clientSecret: CREDENTIAL.clientSecret,
    }),
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED cleanup=cloudflare.service-token\n');
  assert.equal(fake.events.some((event) => event.startsWith('github.secret:')), false);
  assertKeysWiped(fake.keys);
});

test('credential accessors are never invoked and an uninspectable resolved token blocks cleanup', async () => {
  let accesses = 0;
  const credentialResult = {};
  for (const name of ['id', 'clientId', 'clientSecret']) {
    Object.defineProperty(credentialResult, name, {
      enumerable: true,
      get() {
        accesses += 1;
        throw new Error('credential-getter-sentinel');
      },
    });
  }
  const fake = setupDependencies({ credentialResult });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.equal(accesses, 0);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED cleanup=cloudflare.service-token\n');
  assertNoSensitiveOutput(fake, ['credential-getter-sentinel']);
});

test('compensation continues after every delete failure and reports only fixed resource names', async () => {
  const failed = new Set([
    'github.variable:TEXT_AI_TEAM_DOMAIN',
    'github.secret:TEXT_AI_CF_ACCESS_CLIENT_SECRET',
    'github.secret:CLOUDFLARE_API_TOKEN',
    'cloudflare.service-token',
  ]);
  const fake = setupDependencies({
    failAt: 'verify-names',
    failDeleteResources: failed,
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, ALL_COMPENSATION);
  assert.equal(
    fake.stderr.text,
    `SETUP BLOCKED cleanup=${ALL_COMPENSATION.filter((name) => failed.has(name)).join(',')}\n`,
  );
  assertNoSensitiveOutput(fake, ['delete-sentinel']);
});

test('a failing first set plus failing cleanup never renders values, ids, or exception text', async () => {
  const fake = setupDependencies({
    failWriteAt: 0,
    failDeleteResources: new Set([
      'github.secret:CLOUDFLARE_API_TOKEN',
      'cloudflare.service-token',
    ]),
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, [
    'github.secret:CLOUDFLARE_API_TOKEN',
    'cloudflare.service-token',
  ]);
  assert.equal(
    fake.stderr.text,
    'SETUP BLOCKED cleanup=github.secret:CLOUDFLARE_API_TOKEN,cloudflare.service-token\n',
  );
  assertNoSensitiveOutput(fake, ['write-sentinel', 'delete-sentinel']);
});

test('malformed dependency records and result accessors fail closed without invoking accessors', async () => {
  const base = setupDependencies();
  let dependencyAccesses = 0;
  const malformedDependencies = { ...base.dependencies, extra: true };
  Object.defineProperty(malformedDependencies, 'confirm', {
    enumerable: true,
    get() {
      dependencyAccesses += 1;
      return async () => true;
    },
  });
  assert.equal(await runTextPreviewSetup(malformedDependencies), 1);
  assert.equal(dependencyAccesses, 0);
  assert.equal(base.stderr.text, 'SETUP FAILED\n');

  let resultAccesses = 0;
  const githubState = {};
  Object.defineProperty(githubState, 'accountId', {
    enumerable: true,
    get() {
      resultAccesses += 1;
      return ACCOUNT_ID;
    },
  });
  Object.defineProperty(githubState, 'expectedSha', {
    enumerable: true,
    value: EXPECTED_SHA,
  });
  const resultFake = setupDependencies({ githubState });
  assert.equal(await runTextPreviewSetup(resultFake.dependencies), 1);
  assert.equal(resultAccesses, 0);
  assert.deepEqual(resultFake.events, ['github.inspect']);
  assert.equal(resultFake.stderr.text, 'SETUP FAILED\n');
});

test('malformed generated-key containers still wipe discoverable buffers in finally', async () => {
  const aesKey = Buffer.from('malformed-key-a');
  const hmacKey = Buffer.from('malformed-key-b');
  for (const value of [aesKey, hmacKey]) {
    Object.defineProperty(value, 'fill', {
      configurable: true,
      value() {
        throw new Error('malformed-fill-sentinel');
      },
    });
  }
  const keys = Object.freeze({ aesKey, hmacKey, extra: 'invalid' });
  const fake = setupDependencies({ keys });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, ['cloudflare.service-token']);
  assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  assert.equal(isWiped(aesKey), true);
  assert.equal(isWiped(hmacKey), true);
});

test('stderr failure never escapes or changes the no-write boundary', async () => {
  const fake = setupDependencies({ failAt: 'stderr-output', confirmResult: false });
  await assert.doesNotReject(async () => {
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  });
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.events.includes('cloudflare.create'), false);
  assertKeysWiped(fake.keys);
});

test('CLI rejects arguments and non-TTY input before constructing any external dependency', async () => {
  let runnerCalls = 0;
  const makeIo = (stdinTty, stdoutTty) => ({
    stdin: { isTTY: stdinTty },
    stdout: { isTTY: stdoutTty, write() {} },
    stderr: { text: '', write(value) { this.text += value; } },
  });

  for (const [argv, stdinTty, stdoutTty] of [
    [['--token=secret'], true, true],
    [[], false, true],
    [[], true, false],
    ['not-an-array', true, true],
  ]) {
    const io = makeIo(stdinTty, stdoutTty);
    assert.equal(await runTextPreviewSetupCli(argv, io, {
      githubRunner: async () => {
        runnerCalls += 1;
      },
    }), 1);
    assert.equal(io.stderr.text, 'SETUP FAILED\n');
  }
  assert.equal(runnerCalls, 0);
});

test('CLI assembles the real fixed GitHub adapter while allowing only its low-level test runner boundary', async () => {
  const calls = [];
  const io = {
    stdin: { isTTY: true },
    stdout: { isTTY: true, text: '', write(value) { this.text += value; } },
    stderr: { text: '', write(value) { this.text += value; } },
  };
  const code = await runTextPreviewSetupCli([], io, {
    githubRunner: async (command, args) => {
      calls.push({ command, args });
      return Object.freeze({ code: 1, stdout: '', stderr: 'auth-sentinel' });
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [{
    command: 'gh',
    args: ['auth', 'status', '--hostname', 'github.com'],
  }]);
  assert.equal(io.stdout.text, '');
  assert.equal(io.stderr.text, 'SETUP FAILED\n');

  const rejectedIo = {
    stdin: { isTTY: true },
    stdout: { isTTY: true, write() {} },
    stderr: { text: '', write(value) { this.text += value; } },
  };
  assert.equal(await runTextPreviewSetupCli([], rejectedIo, {
    github: Object.freeze({ inspectFirstRun() {} }),
  }), 1);
  assert.equal(rejectedIo.stderr.text, 'SETUP FAILED\n');
});
