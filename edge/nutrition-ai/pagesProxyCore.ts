const INTERNAL_ORIGIN = 'https://photo-ai-gateway.internal';
const MAX_RESPONSE_BYTES = 256_000;
const MAX_STREAM_CHUNKS = 1_024;
const ACCOUNT_KEY = /^[a-f0-9]{64}$/;
const SAFE_DOWNSTREAM_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_LENGTH = /^(0|[1-9]\d*)$/;
const MULTIPART_CONTENT_TYPE = /^multipart\/form-data;\s*boundary=(?:[0-9A-Za-z'()+_,.\/:=?\-]{1,70}|"[0-9A-Za-z'()+_,.\/:=? \-]{1,70}")$/i;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = typedArrayGetter('byteLength');
const TYPED_ARRAY_LENGTH = typedArrayGetter('length');
const TYPED_ARRAY_TAG = typedArrayGetter(Symbol.toStringTag);
const UINT8_ARRAY_SET = Uint8Array.prototype.set;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;

export interface JsonProxyDefinition<T> {
  downstreamPath: string;
  method: 'GET' | 'POST';
  parse(value: unknown): T;
  expectedStatus(value: T): number;
  requestBodyLimit: number | null;
}

export async function proxyBoundedJson<T>(
  request: Request,
  binding: Fetcher,
  accountKey: string,
  definition: JsonProxyDefinition<T>,
): Promise<{ body: T; status: number }> {
  try {
    validateDefinition(definition);
    if (!ACCOUNT_KEY.test(accountKey)) throw new TypeError();
    if (typeof binding !== 'object' || binding === null || typeof binding.fetch !== 'function') {
      throw new TypeError();
    }

    const headers = new Headers({ 'x-tiezheng-account-key': accountKey });
    const init: RequestInit = {
      method: definition.method,
      headers,
      redirect: 'manual',
    };
    if (definition.requestBodyLimit !== null) {
      let contentType: string;
      try {
        contentType = validatedRequestContentType(request, definition.downstreamPath);
      } catch {
        cancelSilently(request.body);
        throw new TypeError();
      }
      const bytes = await readBoundedRequest(request, definition.requestBodyLimit);
      headers.set('content-type', contentType);
      headers.set('content-length', String(bytes.byteLength));
      init.body = bytes;
    }

    const downstream = await binding.fetch(
      `${INTERNAL_ORIGIN}${definition.downstreamPath}`,
      init,
    );
    const raw = await readBoundedResponseJson(downstream);
    const body = definition.parse(raw);
    const status = definition.expectedStatus(body);
    if (!Number.isInteger(status) || status < 100 || status > 599 || downstream.status !== status) {
      throw new TypeError();
    }
    return { body, status };
  } catch {
    throw new TypeError('Invalid service response');
  }
}

function validateDefinition<T>(definition: JsonProxyDefinition<T>): void {
  if (
    typeof definition !== 'object' ||
    definition === null ||
    !SAFE_DOWNSTREAM_PATH.test(definition.downstreamPath) ||
    (definition.method !== 'GET' && definition.method !== 'POST') ||
    typeof definition.parse !== 'function' ||
    typeof definition.expectedStatus !== 'function'
  ) {
    throw new TypeError();
  }

  if (definition.requestBodyLimit === null) {
    if (definition.method !== 'GET') throw new TypeError();
    return;
  }
  if (
    definition.method !== 'POST' ||
    !Number.isSafeInteger(definition.requestBodyLimit) ||
    definition.requestBodyLimit < 1
  ) {
    throw new TypeError();
  }
}

function validatedRequestContentType(request: Request, downstreamPath: string): string {
  const contentType = request.headers.get('content-type');
  if (downstreamPath === '/estimate') {
    if (contentType === null || !MULTIPART_CONTENT_TYPE.test(contentType)) throw new TypeError();
    return contentType;
  }
  if (downstreamPath === '/text/estimate') {
    if (contentType !== 'application/json') throw new TypeError();
    return 'application/json';
  }
  throw new TypeError();
}

async function readBoundedRequest(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = request.body;
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!CANONICAL_LENGTH.test(declaredLength)) {
      cancelSilently(body);
      throw new TypeError();
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 1 || length > maximumBytes) {
      cancelSilently(body);
      throw new TypeError();
    }
  }
  if (body === null) throw new TypeError();
  return readBoundedStream(body, maximumBytes);
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (response.status >= 300 && response.status <= 399) {
    cancelSilently(body);
    throw new TypeError();
  }
  if (!isJsonContentType(response.headers.get('content-type'))) {
    cancelSilently(body);
    throw new TypeError();
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!CANONICAL_LENGTH.test(declaredLength)) {
      cancelSilently(body);
      throw new TypeError();
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > MAX_RESPONSE_BYTES) {
      cancelSilently(body);
      throw new TypeError();
    }
  }
  if (body === null) throw new TypeError();
  const bytes = await readBoundedStream(body, MAX_RESPONSE_BYTES);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const parts = value.split(';').map((part) => part.trim());
  if (parts[0]?.toLowerCase() !== 'application/json') return false;
  if (parts.length === 1) return true;
  return parts.length === 2 && /^charset=utf-8$/i.test(parts[1] ?? '');
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  let byteLength = 0;
  let chunkCount = 0;
  try {
    const buffer = new Uint8Array(maximumBytes);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount > MAX_STREAM_CHUNKS) throw new TypeError();
      const chunkLength = uint8ArrayLength(value);
      if (chunkLength === 0 || chunkLength > maximumBytes - byteLength) throw new TypeError();
      Reflect.apply(UINT8_ARRAY_SET, buffer, [value, byteLength]);
      byteLength += chunkLength;
    }
    if (byteLength === 0) throw new TypeError();

    const bytes = new Uint8Array(byteLength);
    const filledBuffer = Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      buffer,
      [0, byteLength],
    ) as Uint8Array;
    Reflect.apply(UINT8_ARRAY_SET, bytes, [filledBuffer]);
    return bytes;
  } catch {
    cancelSilently(reader);
    throw new TypeError();
  } finally {
    reader.releaseLock();
  }
}

function typedArrayGetter(property: PropertyKey): (this: unknown) => unknown {
  const getter = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, property)?.get;
  if (typeof getter !== 'function') throw new TypeError('Missing typed array intrinsic');
  return getter;
}

function uint8ArrayLength(value: unknown): number {
  let byteLength: unknown;
  let length: unknown;
  let tag: unknown;
  try {
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, []);
    length = Reflect.apply(TYPED_ARRAY_LENGTH, value, []);
    tag = Reflect.apply(TYPED_ARRAY_TAG, value, []);
  } catch {
    throw new TypeError();
  }
  if (
    tag !== 'Uint8Array' ||
    !Number.isSafeInteger(byteLength) ||
    !Number.isSafeInteger(length) ||
    byteLength !== length
  ) {
    throw new TypeError();
  }
  return length as number;
}

function cancelSilently(
  target: { cancel(reason?: unknown): unknown } | null,
): void {
  if (target === null) return;
  try {
    const cancellation = target.cancel();
    void Promise.resolve(cancellation).catch(() => undefined);
  } catch {
    // Cancellation is best-effort; the caller still receives the fixed failure.
  }
}
