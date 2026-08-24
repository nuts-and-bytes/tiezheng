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
const TEXT_BINDING_DEADLINE_MS = 18_000;

class IndeterminateServiceResponse extends TypeError {
  constructor() {
    super('Invalid service response');
  }
}

export function isIndeterminateServiceResponse(error: unknown): boolean {
  return error instanceof IndeterminateServiceResponse;
}

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
  let bindingStarted = false;
  let textRoute = false;
  try {
    validateDefinition(definition);
    textRoute = definition.downstreamPath.startsWith('/text/');
    if (!ACCOUNT_KEY.test(accountKey)) throw new TypeError();
    if (typeof binding !== 'object' || binding === null || typeof binding.fetch !== 'function') {
      throw new TypeError();
    }

    const textDeadline = textRoute
      ? createTextBindingDeadline(request.signal)
      : null;
    try {
      const headers = new Headers({ 'x-tiezheng-account-key': accountKey });
      const init: RequestInit = {
        method: definition.method,
        headers,
        redirect: 'manual',
      };
      if (textDeadline !== null) init.signal = textDeadline.signal;
      if (definition.requestBodyLimit !== null) {
        let contentType: string;
        try {
          contentType = validatedRequestContentType(request, definition.downstreamPath);
        } catch {
          cancelSilently(request.body);
          throw new TypeError();
        }
        const bytes = await readBoundedRequest(
          request,
          definition.requestBodyLimit,
          textDeadline?.signal,
        );
        headers.set('content-type', contentType);
        headers.set('content-length', String(bytes.byteLength));
        init.body = bytes;
      }

      const operation = async () => {
        bindingStarted = true;
        const downstream = await binding.fetch(
          `${INTERNAL_ORIGIN}${definition.downstreamPath}`,
          init,
        );
        const raw = await readBoundedResponseJson(downstream, textDeadline?.signal);
        const body = definition.parse(raw);
        const status = definition.expectedStatus(body);
        if (
          !Number.isInteger(status) ||
          status < 100 ||
          status > 599 ||
          downstream.status !== status
        ) {
          throw new TypeError();
        }
        return { body, status };
      };
      return textDeadline === null
        ? await operation()
        : await raceWithAbort(operation, textDeadline.signal);
    } finally {
      textDeadline?.dispose();
    }
  } catch {
    if (textRoute && bindingStarted) throw new IndeterminateServiceResponse();
    throw new TypeError('Invalid service response');
  }
}

function createTextBindingDeadline(callerSignal: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  let reason: 'caller' | 'deadline' | null = null;
  let listenerAdded = false;
  const abortOnce = (nextReason: 'caller' | 'deadline') => {
    if (reason !== null) return;
    reason = nextReason;
    controller.abort();
  };
  const onCallerAbort = () => abortOnce('caller');
  if (callerSignal.aborted) {
    onCallerAbort();
  } else {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    listenerAdded = true;
    if (callerSignal.aborted) onCallerAbort();
  }
  const timer = setTimeout(() => abortOnce('deadline'), TEXT_BINDING_DEADLINE_MS);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (listenerAdded) callerSignal.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function raceWithAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new TypeError();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new TypeError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
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
  signal?: AbortSignal,
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
  return readBoundedStream(body, maximumBytes, signal);
}

async function readBoundedResponseJson(
  response: Response,
  signal?: AbortSignal,
): Promise<unknown> {
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
  const bytes = await readBoundedStream(body, MAX_RESPONSE_BYTES, signal);
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
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  let byteLength = 0;
  let chunkCount = 0;
  let cancelled = false;
  let onAbort: (() => void) | undefined;
  const cancelOnce = () => {
    if (cancelled) return;
    cancelled = true;
    cancelSilently(reader);
  };
  let aborted: Promise<never> | undefined;
  if (signal !== undefined) {
    aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        cancelOnce();
        reject(new TypeError());
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
    });
  }
  try {
    const buffer = new Uint8Array(maximumBytes);
    while (true) {
      const read = Promise.resolve().then(() => reader.read());
      const { done, value } = aborted === undefined
        ? await read
        : await Promise.race([read, aborted]);
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
    cancelOnce();
    throw new TypeError();
  } finally {
    if (signal !== undefined && onAbort !== undefined) {
      signal.removeEventListener('abort', onAbort);
    }
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
