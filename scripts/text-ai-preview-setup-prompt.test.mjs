import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  confirmAccessCodeSaved,
  confirmSetup,
  promptSetupInputs,
  readTtyLine,
} from './text-ai-preview-setup-prompt.mjs';

const FAILURE = 'Text preview setup failed';

class FakeTTY extends EventEmitter {
  constructor({ isTTY = true, isRaw = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.isRaw = isRaw;
    this.rawTransitions = [];
    this.paused = 0;
    this.values = [];
  }

  setRawMode(value) {
    this.rawTransitions.push(value);
    this.isRaw = value;
    return this;
  }

  resume() {
    if (this.values.length > 0) this.emit('data', this.values.shift());
    return this;
  }

  pause() {
    this.paused += 1;
    return this;
  }
}

function fakeOutput({ isTTY = true, throwOnWrite = false } = {}) {
  return {
    isTTY,
    chunks: [],
    write(value) {
      if (throwOnWrite) throw new Error('secret-sentinel');
      this.chunks.push(value);
      return true;
    },
    get text() {
      return this.chunks.map((value) => Buffer.isBuffer(value) ? value.toString() : value).join('');
    },
  };
}

function fixedFailure(promise) {
  return assert.rejects(promise, (error) => (
    error.message === FAILURE
    && error.cause === undefined
    && !error.stack.includes('secret-sentinel')
  ));
}

test('both setup inputs are hidden and never echo their bytes', async () => {
  for (const label of ['Cloudflare API Token', 'ARK_API_KEY']) {
    const input = new FakeTTY();
    const output = fakeOutput();
    const pending = readTtyLine({ input, output, label, hidden: true });
    input.emit('data', Buffer.from('secret-sentinel\r'));
    const value = await pending;
    assert.equal(value.toString(), 'secret-sentinel');
    value.fill(0);
    assert.equal(output.text.includes('secret-sentinel'), false);
    assert.deepEqual(input.rawTransitions, [true, false]);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.paused, 1);
  }
});

test('promptSetupInputs reads exactly two hidden values and returns a frozen record', async () => {
  const input = new FakeTTY();
  input.values.push(Buffer.from('cloudflare-token\r'), Buffer.from('ark-key\r'));
  const output = fakeOutput();
  const result = await promptSetupInputs(input, output);
  assert.deepEqual(result, { cloudflareApiToken: 'cloudflare-token', arkApiKey: 'ark-key' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(output.text, 'Cloudflare API Token: \nARK_API_KEY: \n');
  assert.equal(output.text.includes('cloudflare-token'), false);
  assert.equal(output.text.includes('ark-key'), false);
});

test('setup confirmation accepts only lowercase y', async () => {
  for (const [answer, expected] of [['y', true], ['n', false], ['N', false], ['', false]]) {
    const input = new FakeTTY();
    input.values.push(Buffer.from(`${answer}\r`));
    assert.equal(await confirmSetup(input, fakeOutput()), expected);
  }
});

test('rotation confirmation is target-bound and accepts only lowercase y', async () => {
  for (const target of ['user-1', 'user-2']) {
    const input = new FakeTTY();
    input.values.push(Buffer.from('y\r'));
    const output = fakeOutput();
    assert.equal(await confirmAccessCodeSaved(input, output, target), true);
    assert.equal(output.text, `Saved ${target} code? [y/N]: y\n`);
  }
  await fixedFailure(confirmAccessCodeSaved(new FakeTTY(), fakeOutput(), 'user-3'));
});

test('readTtyLine rejects non-TTY, unknown labels, controls, and oversized input', async () => {
  await fixedFailure(readTtyLine({
    input: new FakeTTY({ isTTY: false }),
    output: fakeOutput(),
    label: 'Cloudflare API Token',
    hidden: true,
  }));
  await fixedFailure(readTtyLine({
    input: new FakeTTY(),
    output: fakeOutput({ isTTY: false }),
    label: 'Cloudflare API Token',
    hidden: true,
  }));
  await fixedFailure(readTtyLine({
    input: new FakeTTY(),
    output: fakeOutput(),
    label: 'email',
    hidden: false,
  }));

  for (const bytes of [Buffer.from([0x03]), Buffer.from([0x01]), Buffer.from('ab\r')]) {
    const input = new FakeTTY();
    const pending = readTtyLine({
      input,
      output: fakeOutput(),
      label: 'Continue? [y/N]',
      hidden: false,
      maxBytes: 1,
    });
    input.emit('data', bytes);
    await fixedFailure(pending);
  }
});

test('output failures are redacted and input state is restored', async () => {
  const input = new FakeTTY();
  await fixedFailure(readTtyLine({
    input,
    output: fakeOutput({ throwOnWrite: true }),
    label: 'Cloudflare API Token',
    hidden: true,
  }));
  assert.deepEqual(input.rawTransitions, []);
});
