import {
  parseTextAiAdminResponse,
  parseTextAiAdminWorkerRequest,
  type TextAiAdminResponse,
  type TextAiAdminWorkerRequest,
} from '../../../src/lib/textAiAdminContract';
import { stableJson } from '../../../src/lib/stableJson';
import type { GatewayEnv } from './env';

export interface TextAdminDependencies {
  now(): number;
}

export const TEXT_ADMIN_RUNTIME: TextAdminDependencies = Object.freeze({
  now: Date.now,
});

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
} as const;
const ADMIN_PATH = '/internal/text-admin';
const ACCOUNT_KEY = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 2_048;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_DERIVED_DATE_WINDOW_MS = 32 * 86_400_000 + 8 * 60 * 60_000;

function hasQueryDelimiter(rawUrl: string): boolean {
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) return false;
  const fragmentIndex = rawUrl.indexOf('#');
  return fragmentIndex === -1 || queryIndex < fragmentIndex;
}

export function isExactTextAdminRoute(request: Request, url: URL): boolean {
  return request.method === 'POST'
    && url.pathname === ADMIN_PATH
    && url.search === ''
    && !hasQueryDelimiter(request.url);
}

function jsonResponse(body: TextAiAdminResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: SECURITY_HEADERS,
  });
}

function invalidRequest(): Response {
  return jsonResponse({ ok: false, code: 'invalid-request' }, 400);
}

function serviceDisabled(): Response {
  return jsonResponse({ ok: false, code: 'service-disabled' }, 503);
}

function isAdminBindingConfigured(env: GatewayEnv): boolean {
  try {
    if (env.TEXT_AI_ADMIN_ENABLED !== 'true') return false;
    return typeof env.PHOTO_AI_COORDINATOR === 'object'
      && env.PHOTO_AI_COORDINATOR !== null
      && typeof env.PHOTO_AI_COORDINATOR.getByName === 'function';
  } catch {
    return false;
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const body = request.body;
  if (body === null) throw new TypeError('Invalid admin request body');

  const reader = body.getReader();
  const buffer = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  let cancel = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_BODY_BYTES - length) {
        cancel = true;
        throw new TypeError('Invalid admin request body');
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
  } catch {
    cancel = true;
    throw new TypeError('Invalid admin request body');
  } finally {
    if (cancel) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Cancellation is best-effort and cannot change the fixed response.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Releasing a hostile stream cannot change the fixed response.
    }
  }

  if (length === 0) throw new TypeError('Invalid admin request body');
  const serialized = new TextDecoder('utf-8', { fatal: true })
    .decode(buffer.subarray(0, length));
  return JSON.parse(serialized) as unknown;
}

async function operationFingerprint(
  request: TextAiAdminWorkerRequest,
): Promise<string> {
  const serialized = stableJson({
    operation: request.operation,
    accountKey: request.accountKey,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function runtimeNow(dependencies: TextAdminDependencies): number {
  const value = dependencies.now();
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || Object.is(value, -0)
    || value > MAX_DATE_MS - MAX_DERIVED_DATE_WINDOW_MS
  ) {
    throw new TypeError('Invalid admin runtime');
  }
  return value;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expected.includes(key));
}

export async function handleTextAdminRequest(
  request: Request,
  env: GatewayEnv,
  dependencies: TextAdminDependencies = TEXT_ADMIN_RUNTIME,
): Promise<Response> {
  if (!isAdminBindingConfigured(env)) return serviceDisabled();

  let accountKey: string;
  try {
    const url = new URL(request.url);
    if (
      !isExactTextAdminRoute(request, url)
      || request.headers.get('content-type') !== 'application/json'
      || request.headers.has('content-encoding')
      || request.headers.has('transfer-encoding')
    ) {
      return invalidRequest();
    }
    const header = request.headers.get('x-tiezheng-account-key');
    if (header === null || !ACCOUNT_KEY.test(header)) return invalidRequest();
    accountKey = header;
  } catch {
    return invalidRequest();
  }

  let adminRequest: TextAiAdminWorkerRequest;
  try {
    adminRequest = parseTextAiAdminWorkerRequest(await readBoundedJson(request));
  } catch {
    return invalidRequest();
  }
  if (adminRequest.accountKey !== accountKey) return invalidRequest();

  let fingerprint: string;
  let now: number;
  try {
    fingerprint = await operationFingerprint(adminRequest);
    now = runtimeNow(dependencies);
  } catch {
    return serviceDisabled();
  }

  try {
    const coordinator = env.PHOTO_AI_COORDINATOR.getByName('stage2');
    if (
      typeof coordinator !== 'object'
      || coordinator === null
      || typeof coordinator.applyTextAdminOperation !== 'function'
    ) {
      return serviceDisabled();
    }
    const result: unknown = await coordinator.applyTextAdminOperation({
      operationId: adminRequest.operationId,
      operation: adminRequest.operation,
      accountKey: adminRequest.accountKey,
      fingerprint,
      now,
    });

    if (hasExactKeys(result, ['kind']) && result.kind === 'conflict') {
      return jsonResponse({ ok: false, code: 'operation-conflict' }, 409);
    }
    if (!hasExactKeys(result, ['kind', 'status']) || result.kind !== 'applied') {
      return serviceDisabled();
    }
    const response = parseTextAiAdminResponse({
      ok: true,
      operationId: adminRequest.operationId,
      status: result.status,
    });
    if (!response.ok) return serviceDisabled();
    return jsonResponse(response, 200);
  } catch {
    return serviceDisabled();
  }
}
