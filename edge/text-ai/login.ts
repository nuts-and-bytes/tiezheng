import {
  authenticateTextAccessCode,
  deriveTextAttemptKey,
  issueTextSession,
  parseTextAuthConfig,
  textSessionCookie,
  type TextIdentity,
} from './auth';
import {
  parseTextPagesRequestConfig,
  validateTextPagesRequest,
} from './pagesRequest';
import {
  textAiPagesFailure,
  textAiPagesJson,
  type TextAiPagesEnv,
} from './pagesProxy';

type TextAuthThrottleAction = 'consume' | 'clear';
type TextAuthThrottleResult =
  | { kind: 'allowed' }
  | { kind: 'blocked'; retryAfterMs: number };

interface BlindedAttempt {
  attemptKey: string;
  anonymous: boolean;
}

const THROTTLE_URL = 'https://photo-ai-gateway.internal/internal/text-auth-attempt';
const ACCESS_CODE = /^[A-Za-z0-9_-]{32}$/;
const OPAQUE_KEY = /^[a-f0-9]{64}$/;
const MAX_LOGIN_BYTES = 512;
const MAX_THROTTLE_BYTES = 256;
const MAX_STREAM_CHUNKS = 64;
const MAX_RETRY_AFTER_MS = 1_800_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const THROTTLE_DEADLINE_MS = 5_000;
const THROTTLE_CONTENT_TYPE = 'application/json; charset=utf-8';

interface Deadline {
  signal: AbortSignal;
  dispose(): void;
}

function createDeadline(callerSignal?: AbortSignal): Deadline {
  const controller = new AbortController();
  let settled = false;
  const abortOnce = () => {
    if (settled) return;
    settled = true;
    controller.abort();
  };
  const onCallerAbort = () => abortOnce();
  let callerListenerAdded = false;
  if (callerSignal?.aborted) {
    abortOnce();
  } else if (callerSignal !== undefined) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    callerListenerAdded = true;
    if (callerSignal.aborted) abortOnce();
  }
  const timer = setTimeout(abortOnce, THROTTLE_DEADLINE_MS);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (callerListenerAdded && callerSignal !== undefined) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

async function raceWithAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new TypeError('Text authentication throttle unavailable');
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new TypeError('Text authentication throttle unavailable'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

function hasExactDataKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length
    || !keys.every((key) => typeof key === 'string' && expected.includes(key))) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

function parseExactLoginBody(value: unknown): { accessCode: string } {
  if (!hasExactDataKeys(value, ['accessCode'])
    || typeof value.accessCode !== 'string'
    || !ACCESS_CODE.test(value.accessCode)) {
    throw new TypeError('Invalid text login body');
  }
  return { accessCode: value.accessCode };
}

async function readBoundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (stream === null) throw new TypeError('Missing body');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let count = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new TypeError('Read aborted');
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new TypeError('Invalid body chunk');
      count += 1;
      total += next.value.byteLength;
      if (count > MAX_STREAM_CHUNKS || total > maximumBytes) {
        throw new TypeError('Body exceeds limit');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function readBoundedJson(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const bytes = await readBoundedBytes(stream, maximumBytes, signal);
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(serialized) as unknown;
}

function parseThrottleResult(value: unknown): TextAuthThrottleResult {
  if (hasExactDataKeys(value, ['kind']) && value.kind === 'allowed') {
    return { kind: 'allowed' };
  }
  if (hasExactDataKeys(value, ['kind', 'retryAfterMs'])
    && value.kind === 'blocked'
    && Number.isSafeInteger(value.retryAfterMs)
    && (value.retryAfterMs as number) > 0
    && (value.retryAfterMs as number) <= MAX_RETRY_AFTER_MS) {
    return { kind: 'blocked', retryAfterMs: value.retryAfterMs as number };
  }
  throw new TypeError('Invalid text authentication throttle response');
}

function validBinding(value: unknown): value is Fetcher {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { fetch?: unknown }).fetch === 'function';
}

export async function callTextAuthThrottle(
  binding: Fetcher | undefined,
  action: TextAuthThrottleAction,
  attempt: BlindedAttempt,
  nowMs: number,
  callerSignal?: AbortSignal,
): Promise<TextAuthThrottleResult> {
  if (!validBinding(binding)
    || (action !== 'consume' && action !== 'clear')
    || typeof attempt !== 'object'
    || attempt === null
    || !OPAQUE_KEY.test(attempt.attemptKey)
    || typeof attempt.anonymous !== 'boolean'
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
    || nowMs > MAX_DATE_MS - MAX_RETRY_AFTER_MS) {
    throw new TypeError('Text authentication throttle unavailable');
  }

  const request = new Request(THROTTLE_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'x-tiezheng-auth-action': action,
      'x-tiezheng-auth-anonymous': String(attempt.anonymous),
      'x-tiezheng-auth-attempt-key': attempt.attemptKey,
    },
  });
  const deadline = createDeadline(callerSignal);
  try {
    const response = await raceWithAbort(() => binding.fetch(request), deadline.signal);
    if (!(response instanceof Response) || response.redirected) {
      throw new TypeError('Invalid text authentication throttle response');
    }
    if (action === 'clear') {
      if (response.status !== 204
        || response.body !== null
        || response.headers.has('content-type')
        || response.headers.has('content-length')) {
        if (response.body !== null) void response.body.cancel().catch(() => undefined);
        throw new TypeError('Invalid text authentication throttle response');
      }
      return { kind: 'allowed' };
    }
    if (response.status !== 200
      || response.headers.get('content-type') !== THROTTLE_CONTENT_TYPE) {
      if (response.body !== null) void response.body.cancel().catch(() => undefined);
      throw new TypeError('Invalid text authentication throttle response');
    }
    const value = await raceWithAbort(
      () => readBoundedJson(response.body, MAX_THROTTLE_BYTES, deadline.signal),
      deadline.signal,
    );
    return parseThrottleResult(value);
  } finally {
    deadline.dispose();
  }
}

export async function handleTextLoginRequest(
  request: Request,
  env: TextAiPagesEnv,
  nowMs = Date.now(),
): Promise<Response> {
  try {
    const pages = parseTextPagesRequestConfig({
      PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
    });
    const validated = validateTextPagesRequest(request, pages);
    if (validated.route !== 'login') throw new TypeError('Invalid Pages route');
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }

  let config;
  try {
    config = parseTextAuthConfig(env);
  } catch {
    return textAiPagesFailure('service-disabled', 503);
  }

  let accessCode: string;
  try {
    ({ accessCode } = parseExactLoginBody(await readBoundedJson(request.body, MAX_LOGIN_BYTES)));
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }

  let attempt: BlindedAttempt;
  let gate: TextAuthThrottleResult;
  try {
    attempt = await deriveTextAttemptKey(request.headers.get('cf-connecting-ip'), config);
    gate = await callTextAuthThrottle(
      env.PHOTO_AI_GATEWAY,
      'consume',
      attempt,
      nowMs,
      request.signal,
    );
  } catch {
    return textAiPagesFailure('service-disabled', 503);
  }

  if (gate.kind === 'blocked') {
    return textAiPagesJson({
      ok: false,
      code: 'rate-limited',
      retryAt: new Date(nowMs + gate.retryAfterMs).toISOString(),
      resetAt: null,
    }, 429);
  }

  let identity: TextIdentity;
  try {
    identity = await authenticateTextAccessCode(accessCode, config);
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }

  try {
    await callTextAuthThrottle(
      env.PHOTO_AI_GATEWAY,
      'clear',
      attempt,
      nowMs,
      request.signal,
    );
    const token = await issueTextSession(identity, config, nowMs);
    const response = textAiPagesJson({ ok: true }, 200);
    response.headers.set('set-cookie', textSessionCookie(token));
    return response;
  } catch {
    return textAiPagesFailure('service-disabled', 503);
  }
}
