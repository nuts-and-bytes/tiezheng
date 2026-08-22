import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  parseTextAiEstimateRequest,
  parseTextAiEstimateResponse,
  parseTextAiSessionResponse,
  type TextAiErrorCode,
  type TextAiEstimateResponse,
  type TextAiFailure,
  type TextAiSessionResponse,
  type TextMealDraft,
} from './textAiContract';

export interface TextAiEstimateInput extends TextMealDraft {
  requestId: string;
  idempotencyKey: string;
}

export interface TextAiClient {
  session(): Promise<TextAiSessionResponse>;
  estimate(input: TextAiEstimateInput): Promise<TextAiEstimateResponse>;
}

const SESSION_URL = '/api/nutrition/text/session';
const ESTIMATE_URL = '/api/nutrition/text/estimate';
const MAX_RETRY_DELAY_MS = 2_000;
const ESTIMATE_INPUT_KEYS = [
  'requestId',
  'idempotencyKey',
  'description',
  'amount',
] as const;

const FAILURE_STATUS = Object.freeze({
  offline: 503,
  'auth-required': 401,
  'auth-expired': 401,
  'quota-exceeded': 429,
  'rate-limited': 429,
  'service-disabled': 503,
  'budget-exceeded': 429,
  'provider-timeout': 504,
  'provider-unavailable': 503,
  'invalid-estimate': 502,
  'uncertain-food': 422,
  'idempotency-conflict': 409,
} satisfies Readonly<Record<TextAiErrorCode, number>>);

type Delay = (milliseconds: number) => Promise<void>;
type Route = 'session' | 'estimate';

class InvalidTextAiResponse extends Error {}

function invalidRequest(): never {
  throw new TypeError('Invalid text AI request');
}

function invalidResponse(): never {
  throw new InvalidTextAiResponse('Invalid text AI response');
}

function failure(code: TextAiErrorCode): TextAiFailure {
  return { ok: false, code, retryAt: null, resetAt: null };
}

function snapshotTextAiRequest(rawInput: TextAiEstimateInput) {
  try {
    if (
      typeof rawInput !== 'object' ||
      rawInput === null ||
      Array.isArray(rawInput)
    ) {
      return invalidRequest();
    }
    const prototype = Object.getPrototypeOf(rawInput);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidRequest();
    }
    const keys = Reflect.ownKeys(rawInput);
    if (
      keys.length !== ESTIMATE_INPUT_KEYS.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !ESTIMATE_INPUT_KEYS.includes(key as (typeof ESTIMATE_INPUT_KEYS)[number]),
      )
    ) {
      return invalidRequest();
    }

    const fields = new Map<string, unknown>();
    for (const key of ESTIMATE_INPUT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(rawInput, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalidRequest();
      }
      fields.set(key, descriptor.value);
    }

    const parsed = parseTextAiEstimateRequest({
      requestId: fields.get('requestId'),
      idempotencyKey: fields.get('idempotencyKey'),
      description: fields.get('description'),
      amount: fields.get('amount'),
      modelVersion: TEXT_AI_VERSIONS.model,
      promptVersion: TEXT_AI_VERSIONS.prompt,
      schemaVersion: TEXT_AI_VERSIONS.schema,
      catalogVersion: TEXT_AI_VERSIONS.catalog,
      uncertaintyVersion: TEXT_AI_VERSIONS.uncertainty,
      providerPolicyVersion: TEXT_AI_VERSIONS.providerPolicy,
      locale: 'zh-CN',
    });
    return structuredClone(parsed);
  } catch {
    return invalidRequest();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('Text AI request aborted', 'AbortError');
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // The response remains invalid even when its source refuses cancellation.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the validation or read failure that required cancellation.
  }
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType === null || !/^application\/json(?:;|$)/i.test(contentType)) {
      await cancelBody(response.body);
      return invalidResponse();
    }

    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (
        !/^(0|[1-9]\d*)$/.test(declaredLength) ||
        Number(declaredLength) > TEXT_AI_LIMITS.requestBytes
      )
    ) {
      await cancelBody(response.body);
      return invalidResponse();
    }
    if (response.body === null) return invalidResponse();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        void reader.cancel().catch(() => undefined);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      if (signal.aborted) throw abortError();
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        length += value.byteLength;
        if (length > TEXT_AI_LIMITS.requestBytes) {
          await cancelReader(reader);
          return invalidResponse();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (!signal.aborted && !(error instanceof InvalidTextAiResponse)) {
        await cancelReader(reader);
      }
      throw error;
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        if (!signal.aborted) return invalidResponse();
      }
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    if (error instanceof InvalidTextAiResponse) throw error;
    return invalidResponse();
  }
}

function expectedStatus(
  route: Route,
  body: TextAiSessionResponse | TextAiEstimateResponse,
): number {
  if (!body.ok) return FAILURE_STATUS[body.code];
  if (route === 'session') return 200;
  if (!('status' in body)) return invalidResponse();
  return body.status === 'in-flight' ? 202 : 200;
}

async function sendJson(
  fetcher: typeof fetch,
  route: 'session',
  signal: AbortSignal,
): Promise<TextAiSessionResponse>;
async function sendJson(
  fetcher: typeof fetch,
  route: 'estimate',
  signal: AbortSignal,
  body: string,
  expectedRequestId: string,
): Promise<TextAiEstimateResponse>;
async function sendJson(
  fetcher: typeof fetch,
  route: Route,
  signal: AbortSignal,
  body?: string,
  expectedRequestId?: string,
): Promise<TextAiSessionResponse | TextAiEstimateResponse> {
  const response = await fetcher(
    route === 'session' ? SESSION_URL : ESTIMATE_URL,
    route === 'session'
      ? {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal,
        }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body,
          signal,
        },
  );
  const raw = await boundedJson(response, signal);
  let parsed: TextAiSessionResponse | TextAiEstimateResponse;
  try {
    parsed = route === 'session'
      ? parseTextAiSessionResponse(raw)
      : parseTextAiEstimateResponse(raw);
  } catch {
    return invalidResponse();
  }
  if (
    route === 'estimate' &&
    parsed.ok &&
    (!('requestId' in parsed) || parsed.requestId !== expectedRequestId)
  ) {
    return invalidResponse();
  }
  if (response.status !== expectedStatus(route, parsed)) return invalidResponse();
  return parsed;
}

async function defaultDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function abortableDefaultDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    timer = setTimeout(resolve, milliseconds);
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  }).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  });
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T | TextAiFailure> {
  const controller = new AbortController();
  const timedOut = Symbol('text-ai-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, TEXT_AI_LIMITS.timeoutMs);
  });
  const pending = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value) => ({ value } as const),
      (error: unknown) => ({ error } as const),
    );

  const result = await Promise.race([pending, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (result === timedOut) return failure('provider-timeout');
  if ('error' in result) {
    if (controller.signal.aborted || isAbortError(result.error)) {
      return failure('provider-timeout');
    }
    if (result.error instanceof InvalidTextAiResponse) {
      return failure('invalid-estimate');
    }
    return failure('offline');
  }
  return result.value;
}

export function createTextAiClient(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  delay: Delay = defaultDelay,
): TextAiClient {
  return {
    async session() {
      return withTimeout((signal) => sendJson(fetcher, 'session', signal));
    },

    async estimate(rawInput) {
      const request = snapshotTextAiRequest(rawInput);
      const body = JSON.stringify(request);
      return withTimeout(async (signal) => {
        const first = await sendJson(
          fetcher,
          'estimate',
          signal,
          body,
          request.requestId,
        );
        if (!first.ok || first.status !== 'in-flight') return first;

        const waitMs = Math.min(first.retryAfterMs, MAX_RETRY_DELAY_MS);
        if (delay === defaultDelay) {
          await abortableDefaultDelay(waitMs, signal);
        } else {
          await raceWithAbort(Promise.resolve().then(() => delay(waitMs)), signal);
        }
        return sendJson(
          fetcher,
          'estimate',
          signal,
          body,
          request.requestId,
        );
      });
    },
  };
}
