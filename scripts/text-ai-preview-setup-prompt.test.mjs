import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  readTtyLine,
  promptSetupInputs,
  confirmSetup,
} from './text-ai-preview-setup-prompt.mjs';

const FAILURE = 'Text preview setup failed';

class FakeTTY extends EventEmitter {
  constructor({ isTTY = true, isRaw = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.isRaw = isRaw;
    this.rawTransitions = [];
    this.paused = 0;
    this.resumeCalls = 0;
    this.emitOnResume = null;
    this.throwOn = new Set();
    this.emittedBuffers = [];
  }

  setRawMode(value) {
    if (this.throwOn.has('setRawMode')) throw new Error('underlying setRawMode secret-sentinel');
    this.rawTransitions.push(value);
    this.isRaw = value;
    return this;
  }

  resume() {
    if (this.throwOn.has('resume')) throw new Error('underlying resume secret-sentinel');
    this.resumeCalls += 1;
    if (this.emitOnResume) this.emit('data', this.emitOnResume);
    return this;
  }

  pause() {
    if (this.throwOn.has('pause')) throw new Error('underlying pause secret-sentinel');
    this.paused += 1;
    return this;
  }

  emit(type, value, ...rest) {
    if (type === 'data' && Buffer.isBuffer(value)) this.emittedBuffers.push(value);
    return super.emit(type, value, ...rest);
  }
}

function fakeOutput({ isTTY = true } = {}) {
  return {
    isTTY,
    writes: [],
    write(value) {
      this.writes.push(value);
      return true;
    },
    get text() {
      return this.writes.map((part) => Buffer.isBuffer(part) ? part.toString('latin1') : part).join('');
    },
  };
}

function assertFixedFailure(promise) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.message, FAILURE);
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes('secret-sentinel'), false);
    return true;
  });
}

async function assertNoSecretBufferOnFailure(run) {
  const originalFrom = Buffer.from;
  const secretBuffers = [];
  Buffer.from = function probedBufferFrom(...args) {
    const value = originalFrom.apply(Buffer, args);
    if (value.toString('utf8').includes('secret-sentinel')) secretBuffers.push(value);
    return value;
  };
  try {
    await run(secretBuffers);
  } finally {
    Buffer.from = originalFrom;
  }
  assert.equal(secretBuffers.length, 0);
}

test('hidden prompts never echo secret bytes and restore raw mode', async () => {
  const input = new FakeTTY();
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
  input.emit('data', Buffer.from('secret-sentinel\r'));
  const value = await pending;

  assert.equal(value.toString(), 'secret-sentinel');
  assert.equal(output.text.includes('secret-sentinel'), false);
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('error'), 0);
  assert.equal(input.listenerCount('end'), 0);
  assert.equal(input.paused, 1);
});

test('both hidden token labels suppress input, including deletion traces', async () => {
  for (const label of ['Cloudflare API Token', 'ARK_API_KEY']) {
    const input = new FakeTTY();
    const output = fakeOutput();
    const pending = readTtyLine({ input, output, label, hidden: true });
    input.emit('data', Buffer.from('s3cr\x7fet\r'));
    const value = await pending;
    assert.equal(value.toString(), 's3cet');
    assert.equal(output.text.includes('s3cr'), false);
    assert.equal(output.text.includes('\b \b'), false);
  }
});

test('visible email echoes printable bytes and handles both backspaces', async () => {
  const input = new FakeTTY();
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
  input.emit('data', Buffer.from('owner@examplx\x7fe.com\r'));
  const value = await pending;

  assert.equal(value.toString(), 'owner@example.com');
  assert.equal(output.text, 'user-1 email: owner@examplx\b \be.com\n');

  const emptyBackspaceInput = new FakeTTY();
  const emptyBackspaceOutput = fakeOutput();
  const emptyBackspace = readTtyLine({
    input: emptyBackspaceInput,
    output: emptyBackspaceOutput,
    label: 'user-2 email',
    hidden: false,
  });
  emptyBackspaceInput.emit('data', Buffer.from([0x08, 0x7f, 0x0a]));
  await emptyBackspace;
  assert.equal(emptyBackspaceOutput.text, 'user-2 email: \n');
});

test('CR and LF complete across chunks and preserve an originally raw input', async () => {
  const input = new FakeTTY({ isRaw: true });
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
  input.emit('data', Buffer.from('part'));
  input.emit('data', Buffer.from('ial\nignored'));
  const value = await pending;

  assert.equal(value.toString(), 'partial');
  assert.equal(output.text, 'user-1 email: partial\n');
  assert.deepEqual(input.rawTransitions, [true, true]);
  assert.equal(input.isRaw, true);
});

test('resume synchronous data emission is not lost', async () => {
  const input = new FakeTTY();
  input.emitOnResume = Buffer.from('sync-value\r');
  const output = fakeOutput();
  const value = await readTtyLine({ input, output, label: 'user-1 email', hidden: false });
  assert.equal(value.toString(), 'sync-value');
  assert.equal(input.resumeCalls, 1);
});

test('synchronous newListener data completion waits until on returns and removes the listener', async () => {
  const input = new FakeTTY();
  input.on('newListener', (event, listener) => {
    if (event === 'data') listener(Buffer.from('newlistener-secret-sentinel\r'));
  });
  const output = fakeOutput();
  const value = await readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });

  assert.equal(value.toString(), 'newlistener-secret-sentinel');
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.paused, 1);
  assert.equal(output.text.includes('newlistener-secret-sentinel'), false);
});

test('setRawMode and resume failures override synchronous successful data outcomes', async () => {
  for (const operation of ['setRawMode', 'resume']) {
    const input = new FakeTTY();
    const original = input[operation];
    input[operation] = function reentrantOperation(value) {
      if (operation === 'setRawMode' && value === true) {
        this.emit('data', Buffer.from('pending-secret-sentinel\r'));
        throw new Error('setRawMode secret-sentinel');
      }
      if (operation === 'resume') {
        this.emit('data', Buffer.from('pending-secret-sentinel\r'));
        throw new Error('resume secret-sentinel');
      }
      return original.call(this, value);
    };
    const pending = readTtyLine({ input, output: fakeOutput(), label: 'Cloudflare API Token', hidden: true });
    await assertFixedFailure(pending);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('error'), 0);
    assert.equal(input.listenerCount('end'), 0);
    assert.equal(input.paused, 1);
  }
});

test('outer newline write failure overrides a nested completion', async () => {
  const input = new FakeTTY();
  const nestedChunk = Buffer.from('nested-write-secret-sentinel\r');
  const output = fakeOutput();
  let nestedEmitted = false;
  output.write = function write(value) {
    this.writes.push(value);
    if (value === '\n' && !nestedEmitted) {
      nestedEmitted = true;
      input.emit('data', nestedChunk);
      throw new Error('outer newline secret-sentinel');
    }
    return true;
  };
  const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
  input.emit('data', Buffer.from('\r'));

  await assertFixedFailure(pending);
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.paused, 1);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('error'), 0);
  assert.equal(input.listenerCount('end'), 0);
  assert.equal(output.text.includes('nested-write-secret-sentinel'), false);
});

test('iterator failure overrides a nested completion from the same data handler', async () => {
  const input = new FakeTTY();
  const nestedChunk = Buffer.from('nested-iterator-secret-sentinel\r');
  const outerChunk = Buffer.from('a');
  let step = 0;
  Object.defineProperty(outerChunk, Symbol.iterator, {
    configurable: true,
    value() {
      return {
        next() {
          if (step === 0) {
            step += 1;
            return { value: 0x61, done: false };
          }
          if (step === 1) {
            step += 1;
            input.emit('data', nestedChunk);
          }
          throw new Error('iterator-after-nested secret-sentinel');
        },
      };
    },
  });
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
  input.emit('data', outerChunk);

  await assertFixedFailure(pending);
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.paused, 1);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('error'), 0);
  assert.equal(input.listenerCount('end'), 0);
  assert.equal(output.text.includes('nested-iterator-secret-sentinel'), false);
});

test('rejects control, high-bit, non-Buffer, and overflow input with fixed failure', async () => {
  const chunks = [
    Buffer.from([0x03]),
    Buffer.from([0x01]),
    Buffer.from([0x80]),
    'not-a-buffer',
    Buffer.alloc(4097, 0x61),
  ];
  for (const chunk of chunks) {
    const input = new FakeTTY();
    const output = fakeOutput();
    const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
    input.emit('data', chunk);
    await assertFixedFailure(pending);
    assert.deepEqual(input.rawTransitions, [true, false]);
    assert.equal(input.paused, 1);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('error'), 0);
    assert.equal(input.listenerCount('end'), 0);
  }
});

test('error and end events reject and clean up', async () => {
  for (const event of ['error', 'end']) {
    const input = new FakeTTY();
    const output = fakeOutput();
    const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
    if (event === 'error') input.emit(event, new Error('secret-sentinel'));
    else input.emit(event);
    await assertFixedFailure(pending);
    assert.deepEqual(input.rawTransitions, [true, false]);
    assert.equal(input.paused, 1);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('error'), 0);
    assert.equal(input.listenerCount('end'), 0);
  }
});

test('rejects non-TTY, illegal labels/options, and missing methods before prompt/raw changes', async () => {
  const cases = [
    () => readTtyLine({ input: new FakeTTY({ isTTY: false }), output: fakeOutput(), label: 'user-1 email', hidden: false }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput({ isTTY: false }), label: 'user-1 email', hidden: false }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput(), label: 'nope', hidden: false }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput(), label: 'user-1 email', hidden: 'false' }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput(), label: 'user-1 email', hidden: false, maxBytes: 0 }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput(), label: 'user-1 email', hidden: false, maxBytes: 4097 }),
    () => readTtyLine({ input: new FakeTTY(), output: fakeOutput(), label: 'user-1 email', hidden: false, maxBytes: 1.5 }),
    () => readTtyLine(),
    () => readTtyLine(null),
  ];
  const missing = [
    ['setRawMode', new FakeTTY()],
    ['on', new FakeTTY()],
    ['once', new FakeTTY()],
    ['off', new FakeTTY()],
    ['resume', new FakeTTY()],
    ['pause', new FakeTTY()],
  ];
  for (const [method, input] of missing) {
    input[method] = undefined;
    cases.push(() => readTtyLine({ input, output: fakeOutput(), label: 'user-1 email', hidden: false }));
  }
  const missingWriteOutput = fakeOutput();
  missingWriteOutput.write = undefined;
  cases.push(() => readTtyLine({ input: new FakeTTY(), output: missingWriteOutput, label: 'user-1 email', hidden: false }));
  for (const make of cases) {
    const promise = make();
    await assertFixedFailure(promise);
  }
});

test('rejects accessor methods without invoking their getters', async () => {
  let accessed = 0;
  const input = new FakeTTY();
  Object.defineProperty(input, 'setRawMode', {
    configurable: true,
    get() {
      accessed += 1;
      throw new Error('secret-sentinel');
    },
  });
  const promise = readTtyLine({ input, output: fakeOutput(), label: 'user-1 email', hidden: false });
  await assertFixedFailure(promise);
  assert.equal(accessed, 0);
});

test('all setup failures restore and pause even when operations throw', async () => {
  for (const operation of ['setRawMode', 'resume', 'pause']) {
    const input = new FakeTTY();
    input.throwOn.add(operation);
    const output = fakeOutput();
    const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
    if (operation === 'setRawMode' || operation === 'resume') {
      await assertFixedFailure(pending);
    } else {
      input.emit('data', Buffer.from('secret-sentinel\r'));
      await assertFixedFailure(pending);
    }
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('error'), 0);
    assert.equal(input.listenerCount('end'), 0);
  }

  const output = fakeOutput();
  output.write = () => { throw new Error('write secret-sentinel'); };
  await assertFixedFailure(readTtyLine({ input: new FakeTTY(), output, label: 'user-1 email', hidden: false }));
});

test('newline failures do not allocate an orphan hidden secret Buffer', async () => {
  const scenarios = [
    () => {
      const input = new FakeTTY();
      const output = fakeOutput();
      output.write = function write(value) {
        if (value === '\n') throw new Error('newline secret-sentinel');
        this.writes.push(value);
        return true;
      };
      return { input, output };
    },
    () => {
      const input = new FakeTTY();
      const originalOff = input.off;
      input.off = function off(...args) {
        if (args[0] === 'data') throw new Error('off secret-sentinel');
        return originalOff.call(this, ...args);
      };
      return { input, output: fakeOutput() };
    },
    () => {
      const input = new FakeTTY();
      const originalSetRawMode = input.setRawMode;
      input.setRawMode = function setRawMode(value) {
        if (value === false) throw new Error('restore secret-sentinel');
        return originalSetRawMode.call(this, value);
      };
      return { input, output: fakeOutput() };
    },
    () => {
      const input = new FakeTTY();
      input.pause = () => { throw new Error('pause secret-sentinel'); };
      return { input, output: fakeOutput() };
    },
  ];

  for (const makeScenario of scenarios) {
    const { input, output } = makeScenario();
    const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
    const secretChunk = Buffer.from('secret-sentinel\r');
    await assertNoSecretBufferOnFailure(async () => {
      input.emit('data', secretChunk);
      await assertFixedFailure(pending);
    });
  }
});

test('restore and listener cleanup failures stay fixed while remaining cleanup runs', async () => {
  const input = new FakeTTY();
  const originalSetRawMode = input.setRawMode;
  let setRawModeCalls = 0;
  input.setRawMode = function setRawMode(value) {
    setRawModeCalls += 1;
    if (setRawModeCalls === 2) throw new Error('restore secret-sentinel');
    return originalSetRawMode.call(this, value);
  };
  const originalOff = input.off;
  let offCalls = 0;
  input.off = function off(...args) {
    offCalls += 1;
    if (offCalls === 1) throw new Error('cleanup secret-sentinel');
    return originalOff.call(this, ...args);
  };
  const pending = readTtyLine({ input, output: fakeOutput(), label: 'user-1 email', hidden: false });
  input.emit('data', Buffer.from('x\r'));
  await assertFixedFailure(pending);
  assert.equal(setRawModeCalls, 2);
  assert.equal(offCalls, 3);
  assert.equal(input.paused, 1);
});

test('Buffer iterator failures are fixed and still clean up the TTY', async () => {
  const input = new FakeTTY();
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
  const chunk = Buffer.from('iterator-secret-sentinel');
  Object.defineProperty(chunk, Symbol.iterator, {
    configurable: true,
    value() {
      throw new Error('iterator secret-sentinel');
    },
  });

  assert.doesNotThrow(() => input.emit('data', chunk));
  await assertFixedFailure(pending);
  assert.deepEqual(input.rawTransitions, [true, false]);
  assert.equal(input.paused, 1);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('error'), 0);
  assert.equal(input.listenerCount('end'), 0);
});

test('promptSetupInputs reads in order, returns a frozen object, and never echoes secrets', async () => {
  const input = new FakeTTY();
  const output = fakeOutput();
  const values = [
    Buffer.from('secret-sentinel-token\r'),
    Buffer.from('secret-sentinel-ark\r'),
    Buffer.from('one@example.com\r'),
    Buffer.from('two@example.com\r'),
  ];
  input.resume = function resume() {
    this.resumeCalls += 1;
    this.emit('data', values.shift());
    return this;
  };
  const result = await promptSetupInputs(input, output);
  assert.deepEqual(result, {
    cloudflareApiToken: 'secret-sentinel-token',
    arkApiKey: 'secret-sentinel-ark',
    user1Email: 'one@example.com',
    user2Email: 'two@example.com',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(output.text.includes('secret-sentinel'), false);
  assert.equal(output.text, 'Cloudflare API Token: \nARK_API_KEY: \nuser-1 email: one@example.com\nuser-2 email: two@example.com\n');
});

test('options accessors fail with the fixed error without invoking getters', async () => {
  const options = {};
  let accessed = 0;
  Object.defineProperty(options, 'input', {
    configurable: true,
    get() {
      accessed += 1;
      throw new Error('options secret-sentinel');
    },
  });
  await assertFixedFailure(readTtyLine(options));
  assert.equal(accessed, 0);
});

test('promptSetupInputs clears earlier returned buffers after a later failure', async () => {
  const input = new FakeTTY();
  const output = fakeOutput();
  const values = [Buffer.from('token\r'), Buffer.from([0x03])];
  input.resume = function resume() {
    this.resumeCalls += 1;
    this.emit('data', values.shift());
    return this;
  };
  await assertFixedFailure(promptSetupInputs(input, output));
  assert.equal(input.emittedBuffers[0].toString(), 'token\r');
  assert.equal(output.text.includes('token'), false);
});

test('confirmSetup accepts only lowercase y and treats empty/n/N as false', async () => {
  for (const [chunk, expected] of [
    [Buffer.from('y\r'), true],
    [Buffer.from('\r'), false],
    [Buffer.from('n\r'), false],
    [Buffer.from('N\r'), false],
  ]) {
    const input = new FakeTTY();
    input.resume = function resume() {
      this.resumeCalls += 1;
      this.emit('data', chunk);
      return this;
    };
    assert.equal(await confirmSetup(input, fakeOutput()), expected);
  }
});

test('confirmSetup rejects an answer longer than one byte', async () => {
  const input = new FakeTTY();
  const pending = confirmSetup(input, fakeOutput());
  input.emit('data', Buffer.from('yy'));
  await assertFixedFailure(pending);
});
