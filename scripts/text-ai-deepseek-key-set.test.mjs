import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runDeepSeekKeySetup,
  runDeepSeekKeySetupCli,
} from './text-ai-deepseek-key-set.mjs';

function stream() {
  return {
    value: '',
    write(chunk) {
      this.value += String(chunk);
      return true;
    },
  };
}

test('writes only the DeepSeek preview secret, reports success, and wipes the input buffer', async () => {
  const key = Buffer.from('private-deepseek-key');
  const calls = [];
  const stdout = stream();
  const stderr = stream();

  const status = await runDeepSeekKeySetup({
    async promptKey() { return key; },
    github: {
      async setSecret(name, value) {
        calls.push({ name, value: Buffer.from(value) });
      },
    },
    stdout,
    stderr,
  });

  assert.equal(status, 0);
  assert.deepEqual(calls, [{
    name: 'DEEPSEEK_API_KEY',
    value: Buffer.from('private-deepseek-key'),
  }]);
  assert.equal(key.every((byte) => byte === 0), true);
  assert.equal(stdout.value, 'DEEPSEEK KEY SAVED\n');
  assert.equal(stderr.value, '');
});

test('rejects malformed key bytes before GitHub and exposes no private value', async () => {
  for (const value of ['', 'private key', 'private\nkey', '密钥']) {
    const key = Buffer.from(value);
    let calls = 0;
    const stdout = stream();
    const stderr = stream();
    const status = await runDeepSeekKeySetup({
      async promptKey() { return key; },
      github: { async setSecret() { calls += 1; } },
      stdout,
      stderr,
    });
    assert.equal(status, 1);
    assert.equal(calls, 0);
    assert.equal(key.every((byte) => byte === 0), true);
    assert.equal(stdout.value, '');
    assert.equal(stderr.value, 'DEEPSEEK KEY SETUP FAILED\n');
    if (value.length > 0) assert.equal(stderr.value.includes(value), false);
  }
});

test('remote failure stays fixed and still wipes the key', async () => {
  const key = Buffer.from('private-deepseek-key');
  const stderr = stream();
  const status = await runDeepSeekKeySetup({
    async promptKey() { return key; },
    github: { async setSecret() { throw new Error('private remote detail'); } },
    stdout: stream(),
    stderr,
  });
  assert.equal(status, 1);
  assert.equal(key.every((byte) => byte === 0), true);
  assert.equal(stderr.value, 'DEEPSEEK KEY SETUP FAILED\n');
});

test('CLI rejects arguments and non-TTY execution before prompting', async () => {
  let prompts = 0;
  const io = {
    stdin: { isTTY: false },
    stdout: { ...stream(), isTTY: true },
    stderr: stream(),
  };
  assert.equal(await runDeepSeekKeySetupCli([], io, {
    async promptKey() { prompts += 1; },
    github: { async setSecret() {} },
  }), 1);
  assert.equal(prompts, 0);
  assert.equal(io.stderr.value, 'DEEPSEEK KEY SETUP FAILED\n');

  const ttyIo = {
    stdin: { isTTY: true },
    stdout: { ...stream(), isTTY: true },
    stderr: stream(),
  };
  assert.equal(await runDeepSeekKeySetupCli(['unexpected'], ttyIo, {
    async promptKey() { prompts += 1; },
    github: { async setSecret() {} },
  }), 1);
  assert.equal(prompts, 0);
});
