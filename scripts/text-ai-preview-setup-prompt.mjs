const FAILURE = 'Text preview setup failed';
const PROMPT_LABELS = new Set([
  'Cloudflare API Token',
  'ARK_API_KEY',
  'user-1 email',
  'user-2 email',
  'Continue? [y/N]',
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

function safeCall(fn, receiver, ...args) {
  try {
    fn.call(receiver, ...args);
    return true;
  } catch {
    return false;
  }
}

export async function readTtyLine(options = {}) {
  const { input, output, label, hidden, maxBytes = 4096 } = options ?? {};
  let validated;
  try {
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

    const cleanupAndFinish = (error, value) => {
      if (settled) return;
      settled = true;
      let cleanupOk = true;
      if (dataRegistered && !safeCall(methods.off, input, 'data', onData)) cleanupOk = false;
      if (errorRegistered && !safeCall(methods.off, input, 'error', onError)) cleanupOk = false;
      if (endRegistered && !safeCall(methods.off, input, 'end', onEnd)) cleanupOk = false;

      let restoreOk = safeCall(methods.setRawMode, input, wasRaw);
      const pauseOk = safeCall(methods.pause, input);
      bytes.fill(0);
      if (!cleanupOk || !restoreOk || !pauseOk || error) {
        reject(failure());
      } else {
        resolve(value);
      }
    };

    const onError = () => cleanupAndFinish(failure());
    const onEnd = () => cleanupAndFinish(failure());
    const onData = (chunk) => {
      if (settled || !Buffer.isBuffer(chunk)) return cleanupAndFinish(failure());
      for (const byte of chunk) {
        if (byte === 0x03) return cleanupAndFinish(failure());
        if (byte === 0x0d || byte === 0x0a) {
          let writeOk = true;
          try {
            write.call(output, '\n');
          } catch {
            writeOk = false;
          }
          return cleanupAndFinish(writeOk ? undefined : failure(), Buffer.from(bytes));
        }
        if (byte === 0x08 || byte === 0x7f) {
          if (bytes.length > 0) {
            bytes.pop();
            if (!hidden) {
              try {
                write.call(output, '\b \b');
              } catch {
                return cleanupAndFinish(failure());
              }
            }
          }
          continue;
        }
        if (byte < 0x20 || byte > 0x7e || bytes.length >= maxBytes) {
          return cleanupAndFinish(failure());
        }
        bytes.push(byte);
        if (!hidden) {
          try {
            write.call(output, Buffer.from([byte]));
          } catch {
            return cleanupAndFinish(failure());
          }
        }
      }
    };

    try {
      dataRegistered = true;
      methods.on.call(input, 'data', onData);
      if (settled) return;
      errorRegistered = true;
      methods.once.call(input, 'error', onError);
      if (settled) return;
      endRegistered = true;
      methods.once.call(input, 'end', onEnd);
      if (settled) return;
      methods.setRawMode.call(input, true);
      if (settled) return;
      methods.resume.call(input);
    } catch {
      cleanupAndFinish(failure());
    }
  });
}

export async function promptSetupInputs(input, output) {
  const buffers = [];
  try {
    for (const [label, hidden] of [
      ['Cloudflare API Token', true],
      ['ARK_API_KEY', true],
      ['user-1 email', false],
      ['user-2 email', false],
    ]) {
      buffers.push(await readTtyLine({ input, output, label, hidden }));
    }
    const result = Object.freeze({
      cloudflareApiToken: buffers[0].toString('utf8'),
      arkApiKey: buffers[1].toString('utf8'),
      user1Email: buffers[2].toString('utf8'),
      user2Email: buffers[3].toString('utf8'),
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
