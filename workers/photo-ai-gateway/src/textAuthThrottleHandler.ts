import type {
  TextAuthAttemptResult,
} from './coordinator';
import type { GatewayEnv } from './env';

export interface TextAuthThrottleDependencies {
  now(): number;
}

export const TEXT_AUTH_THROTTLE_RUNTIME: TextAuthThrottleDependencies = Object.freeze({
  now: Date.now,
});

const THROTTLE_ORIGIN = 'https://photo-ai-gateway.internal';
const THROTTLE_PATH = '/internal/text-auth-attempt';
const OPAQUE_KEY = /^[a-f0-9]{64}$/;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_RETRY_AFTER_MS = 1_800_000;
const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;
const EMPTY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

function hasQueryDelimiter(rawUrl: string): boolean {
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) return false;
  const fragmentIndex = rawUrl.indexOf('#');
  return fragmentIndex === -1 || queryIndex < fragmentIndex;
}

export function isExactTextAuthThrottleRoute(request: Request, url: URL): boolean {
  return request.method === 'POST'
    && request.redirect === 'manual'
    && url.origin === THROTTLE_ORIGIN
    && url.pathname === THROTTLE_PATH
    && url.search === ''
    && url.hash === ''
    && !hasQueryDelimiter(request.url);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function invalidRequest(): Response {
  return jsonResponse({ kind: 'invalid' }, 400);
}

function unavailable(): Response {
  return jsonResponse({ kind: 'unavailable' }, 503);
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

function parseAttemptResult(value: unknown): TextAuthAttemptResult {
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
  throw new TypeError('Invalid text authentication throttle result');
}

function runtimeNow(dependencies: TextAuthThrottleDependencies): number {
  const descriptor = Object.getOwnPropertyDescriptor(dependencies, 'now');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError('Invalid text authentication throttle clock');
  }
  const now = Reflect.apply(descriptor.value, dependencies, []) as unknown;
  if (!Number.isSafeInteger(now)
    || (now as number) < 0
    || Object.is(now, -0)
    || (now as number) > MAX_DATE_MS - MAX_RETRY_AFTER_MS) {
    throw new TypeError('Invalid text authentication throttle clock');
  }
  return now as number;
}

export async function handleTextAuthThrottleRequest(
  request: Request,
  env: GatewayEnv,
  dependencies: TextAuthThrottleDependencies = TEXT_AUTH_THROTTLE_RUNTIME,
): Promise<Response> {
  let action: 'consume' | 'clear';
  let anonymous: boolean;
  let attemptKey: string;
  try {
    const url = new URL(request.url);
    if (!isExactTextAuthThrottleRoute(request, url)
      || request.body !== null
      || request.headers.has('content-length')
      || request.headers.has('content-type')
      || request.headers.has('content-encoding')
      || request.headers.has('transfer-encoding')) {
      return invalidRequest();
    }
    const actionHeader = request.headers.get('x-tiezheng-auth-action');
    const attemptKeyHeader = request.headers.get('x-tiezheng-auth-attempt-key');
    const anonymousHeader = request.headers.get('x-tiezheng-auth-anonymous');
    if ((actionHeader !== 'consume' && actionHeader !== 'clear')
      || attemptKeyHeader === null
      || !OPAQUE_KEY.test(attemptKeyHeader)
      || (anonymousHeader !== 'true' && anonymousHeader !== 'false')) {
      return invalidRequest();
    }
    action = actionHeader;
    attemptKey = attemptKeyHeader;
    anonymous = anonymousHeader === 'true';
  } catch {
    return invalidRequest();
  }

  let now: number;
  try {
    now = runtimeNow(dependencies);
  } catch {
    return unavailable();
  }

  try {
    const coordinator = env.PHOTO_AI_COORDINATOR.getByName('stage2');
    if (typeof coordinator !== 'object' || coordinator === null) return unavailable();
    if (action === 'clear') {
      if (typeof coordinator.clearTextAuthAttempts !== 'function') return unavailable();
      const result: unknown = await coordinator.clearTextAuthAttempts(attemptKey);
      if (result !== undefined) return unavailable();
      return new Response(null, { status: 204, headers: EMPTY_HEADERS });
    }
    if (typeof coordinator.consumeTextAuthAttempt !== 'function') return unavailable();
    const result: unknown = await coordinator.consumeTextAuthAttempt({
      attemptKey,
      anonymous,
      now,
    });
    return jsonResponse(parseAttemptResult(result), 200);
  } catch {
    return unavailable();
  }
}
