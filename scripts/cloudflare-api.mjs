const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
const FAILURE_MESSAGE = 'Cloudflare request failed';
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_SECRET_LENGTH = 4_096;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function isValidSecret(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SECRET_LENGTH
    && !/\s|[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isValidPath(path) {
  if (typeof path !== 'string' || !PATH_PATTERN.test(path)) {
    return false;
  }

  const segments = path.slice(1).split('/');
  return !segments.some((segment) => segment === '.' || segment === '..' || segment.includes('..'));
}

function isOrdinaryObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asUint8Array(value) {
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]') {
    fail();
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // The original bounded-read failure remains the only externally visible error.
  }
}

function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch {
    // Cleanup errors are deliberately hidden behind the fixed public failure.
  }
}

async function readBoundedJson(response) {
  if (!response || typeof response !== 'object' || !response.body || typeof response.body.getReader !== 'function') {
    fail();
  }

  const reader = response.body.getReader();
  if (!reader || typeof reader.read !== 'function' || typeof reader.cancel !== 'function' || typeof reader.releaseLock !== 'function') {
    fail();
  }

  const chunks = [];
  let totalBytes = 0;
  let complete = false;

  try {
    while (true) {
      const item = await reader.read();
      if (!item || typeof item !== 'object' || typeof item.done !== 'boolean') {
        fail();
      }
      if (item.done) {
        complete = true;
        break;
      }
      const chunk = asUint8Array(item.value);

      totalBytes += chunk.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_RESPONSE_BYTES) {
        fail();
      }
      chunks.push(chunk);
    }
  } catch {
    if (!complete) {
      await cancelReader(reader);
    }
    throw new Error(FAILURE_MESSAGE);
  } finally {
    releaseReader(reader);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const envelope = JSON.parse(text);
  if (!isOrdinaryObject(envelope)) {
    fail();
  }
  return envelope;
}

export function createCloudflareClient(options) {
  let accountId;
  let apiToken;
  let fetcher;

  try {
    if (!isOrdinaryObject(options)) {
      fail();
    }
    const candidateAccountId = options.accountId;
    apiToken = options.apiToken;
    fetcher = options.fetcher === undefined ? globalThis.fetch : options.fetcher;

    if (
      typeof candidateAccountId !== 'string'
      || !ACCOUNT_ID_PATTERN.test(candidateAccountId)
      || !isValidSecret(apiToken)
      || typeof fetcher !== 'function'
    ) {
      fail();
    }
    accountId = candidateAccountId;
  } catch {
    fail();
  }

  const request = async (method, path, body) => {
    try {
      if (!isValidPath(path)) {
        fail();
      }

      let serializedBody;
      if (body !== undefined) {
        serializedBody = JSON.stringify(body);
        if (serializedBody === undefined) {
          fail();
        }
      }

      const response = await fetcher(`${CLOUDFLARE_API_ROOT}/${accountId}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiToken}`,
          ...(serializedBody === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: serializedBody,
      });
      const envelope = await readBoundedJson(response);

      if (response.ok !== true || envelope.success !== true || !Object.hasOwn(envelope, 'result')) {
        fail();
      }
      return envelope.result;
    } catch {
      fail();
    }
  };

  return Object.freeze({
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  });
}
