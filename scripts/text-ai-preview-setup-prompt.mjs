const FAILURE = 'Text preview setup failed';
const PROMPT_LABELS = new Set([
  'Cloudflare API Token',
  'DEEPSEEK_API_KEY',
  'Continue? [y/N]',
  'Saved user-1 code? [y/N]',
  'Saved user-2 code? [y/N]',
]);

function failure() {
  return new Error(FAILURE);
}

function dataProperty(object, name) {
  let current = object;
  while (current !== null && current !== undefined) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, name);
    } catch {
      return { ok: false };
    }
    if (descriptor) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false };
      return { ok: true, value: descriptor.value };
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: undefined };
}

function validateAndGetMethods(input, output, label, hidden, maxBytes) {
  if ((typeof input !== 'object' && typeof input !== 'function') || input === null
    || (typeof output !== 'object' && typeof output !== 'function') || output === null
    || !PROMPT_LABELS.has(label)
    || typeof hidden !== 'boolean'
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 4096) {
    throw failure();
  }

  const inputTTY = dataProperty(input, 'isTTY');
  const outputTTY = dataProperty(output, 'isTTY');
  if (!inputTTY.ok || inputTTY.value !== true || !outputTTY.ok || outputTTY.value !== true) throw failure();

  const names = ['setRawMode', 'on', 'once', 'off', 'resume', 'pause'];
  const methods = {};
  for (const name of names) {
    const property = dataProperty(input, name);
    if (!property.ok || typeof property.value !== 'function') throw failure();
    methods[name] = property.value;
  }
  const write = dataProperty(output, 'write');
  if (!write.ok || typeof write.value !== 'function') throw failure();
  const raw = dataProperty(input, 'isRaw');
  if (!raw.ok) throw failure();
  return { methods, write: write.value, wasRaw: raw.value === true };
}

function readPromptOptions(options) {
  if ((typeof options !== 'object' && typeof options !== 'function') || options === null) throw failure();
  const values = {};
  for (const name of ['input', 'output', 'label', 'hidden', 'maxBytes']) {
    const property = dataProperty(options, name);
    if (!property.ok) throw failure();
    values[name] = property.value;
  }
  if (values.maxBytes === undefined) values.maxBytes = 4096;
  return values;
}

function safeCall(fn, receiver, ...args) {
  try {
    fn.call(receiver, ...args);
    return true;
  } catch {
    return false;
  }
}

export async function readTtyLine(options = {}) {
  let validated;
  let input;
  let output;
  let label;
  let hidden;
  let maxBytes;
  try {
    ({ input, output, label, hidden, maxBytes } = readPromptOptions(options));
    validated = validateAndGetMethods(input, output, label, hidden, maxBytes);
  } catch {
    throw failure();
  }

  const { methods, write, wasRaw } = validated;
  try {
    write.call(output, `${label}: `);
  } catch {
    throw failure();
  }

  const bytes = [];
  return await new Promise((resolve, reject) => {
    let settled = false;
    let dataRegistered = false;
    let errorRegistered = false;
    let endRegistered = false;
    let externalDepth = 0;
    let externalFailure = false;
    let pendingOutcome;

    const cleanupAndFinish = (outcome) => {
      if (settled) return;
      settled = true;
      pendingOutcome = undefined;
      let cleanupOk = true;
      if (dataRegistered && !safeCall(methods.off, input, 'data', onData)) cleanupOk = false;
      if (errorRegistered && !safeCall(methods.off, input, 'error', onError)) cleanupOk = false;
      if (endRegistered && !safeCall(methods.off, input, 'end', onEnd)) cleanupOk = false;

      const restoreOk = safeCall(methods.setRawMode, input, wasRaw);
      const pauseOk = safeCall(methods.pause, input);
      if (!cleanupOk || !restoreOk || !pauseOk || outcome.kind === 'failure') {
        bytes.fill(0);
        reject(failure());
      } else {
        let value;
        try {
          value = Buffer.from(bytes);
        } catch {
          bytes.fill(0);
          reject(failure());
          return;
        }
        bytes.fill(0);
        resolve(value);
      }
    };

    const settleWhenReady = (outcome) => {
      if (settled) return;
      if (externalDepth > 0) {
        if (!pendingOutcome || outcome.kind === 'failure') pendingOutcome = outcome;
        return;
      }
      cleanupAndFinish(outcome);
    };

    const drainPending = () => {
      if (externalDepth !== 0 || settled) return;
      const outcome = externalFailure ? { kind: 'failure' } : pendingOutcome;
      externalFailure = false;
      pendingOutcome = undefined;
      if (outcome) cleanupAndFinish(outcome);
    };

    const invokeExternal = (fn, receiver, ...args) => {
      externalDepth += 1;
      let threw = false;
      try {
        fn.call(receiver, ...args);
      } catch {
        threw = true;
        externalFailure = true;
      }
      externalDepth -= 1;
      drainPending();
      return !threw;
    };

    const onError = () => settleWhenReady({ kind: 'failure' });
    const onEnd = () => settleWhenReady({ kind: 'failure' });
    const onData = (chunk) => {
      if (settled) return;
      externalDepth += 1;
      try {
        if (!Buffer.isBuffer(chunk)) return settleWhenReady({ kind: 'failure' });
        for (const byte of chunk) {
          if (byte === 0x03) return settleWhenReady({ kind: 'failure' });
          if (byte === 0x0d || byte === 0x0a) {
            try {
              write.call(output, '\n');
            } catch {
              return settleWhenReady({ kind: 'failure' });
            }
            return settleWhenReady({ kind: 'success' });
          }
          if (byte === 0x08 || byte === 0x7f) {
            if (bytes.length > 0) {
              bytes.pop();
              if (!hidden) {
                try {
                  write.call(output, '\b \b');
                } catch {
                  return settleWhenReady({ kind: 'failure' });
                }
              }
            }
            continue;
          }
          if (byte < 0x20 || byte > 0x7e || bytes.length >= maxBytes) {
            return settleWhenReady({ kind: 'failure' });
          }
          bytes.push(byte);
          if (!hidden) {
            try {
              write.call(output, Buffer.from([byte]));
            } catch {
              return settleWhenReady({ kind: 'failure' });
            }
          }
        }
      } catch {
        settleWhenReady({ kind: 'failure' });
      } finally {
        externalDepth -= 1;
        drainPending();
      }
    };

    try {
      dataRegistered = true;
      if (!invokeExternal(methods.on, input, 'data', onData) || settled) return;
      errorRegistered = true;
      if (!invokeExternal(methods.once, input, 'error', onError) || settled) return;
      endRegistered = true;
      if (!invokeExternal(methods.once, input, 'end', onEnd) || settled) return;
      if (!invokeExternal(methods.setRawMode, input, true) || settled) return;
      invokeExternal(methods.resume, input);
    } catch {
      externalFailure = true;
      if (externalDepth === 0) cleanupAndFinish({ kind: 'failure' });
    }
  });
}

export async function promptSetupInputs(input, output) {
  const buffers = [];
  try {
    for (const label of ['Cloudflare API Token', 'DEEPSEEK_API_KEY']) {
      const hidden = true;
      buffers.push(await readTtyLine({ input, output, label, hidden }));
    }
    const result = Object.freeze({
      cloudflareApiToken: buffers[0].toString('utf8'),
      deepseekApiKey: buffers[1].toString('utf8'),
    });
    return result;
  } finally {
    for (const buffer of buffers) {
      if (Buffer.isBuffer(buffer)) buffer.fill(0);
    }
  }
}

export async function confirmSetup(input, output) {
  const answer = await readTtyLine({
    input,
    output,
    label: 'Continue? [y/N]',
    hidden: false,
    maxBytes: 1,
  });
  try {
    return answer.toString('utf8') === 'y';
  } finally {
    answer.fill(0);
  }
}

export async function confirmAccessCodeSaved(input, output, target) {
  if (target !== 'user-1' && target !== 'user-2') throw failure();
  const answer = await readTtyLine({
    input,
    output,
    label: `Saved ${target} code? [y/N]`,
    hidden: false,
    maxBytes: 1,
  });
  try {
    return answer.toString('utf8') === 'y';
  } finally {
    answer.fill(0);
  }
}
