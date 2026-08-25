import {
  parseTextAiAdminRequest,
  parseTextAiAdminResponse,
  parseTextAiAdminWorkerRequest,
  type TextAiAdminResponse,
  type TextAiAdminWorkerRequest,
} from '../../src/lib/textAiAdminContract';
import {
  AccessDeniedError,
  deriveAccountKey,
} from '../photo-ai/access';
import {
  parseTextAdminAccessConfig,
  parseTextUserAccessConfig,
  verifyTextAdminAccess,
} from './access';
import { parseTextPagesRequestConfig } from './pagesRequest';
import type { TextAiPagesEnv } from './pagesProxy';

const ADMIN_PATH = '/api/nutrition/text-admin/account';
const INTERNAL_URL = 'https://photo-ai-gateway.internal/internal/text-admin';
const MAX_REQUEST_BYTES = 2_048;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_STREAM_CHUNKS = 1_024;
const ACCOUNT_KEY = /^[0-9a-f]{64}$/;
const CANONICAL_POSITIVE_LENGTH = /^[1-9]\d*$/;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function hasQueryDelimiter(rawUrl: string): boolean {
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) return false;
  const fragmentIndex = rawUrl.indexOf('#');
  return fragmentIndex === -1 || queryIndex < fragmentIndex;
}

function validateAdminRequest(request: Request, origin: string): void {
  const url = new URL(request.url);
  if (
    request.method !== 'POST'
    || url.origin !== origin
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.pathname !== ADMIN_PATH
    || url.search !== ''
    || url.hash !== ''
    || hasQueryDelimiter(request.url)
    || request.headers.get('origin') !== origin
    || request.headers.get('sec-fetch-site') !== 'same-origin'
    || request.headers.get('content-type') !== 'application/json'
    || request.headers.has('content-encoding')
    || request.headers.has('transfer-encoding')
  ) {
    throw new TypeError('Invalid text admin request');
  }

  const host = request.headers.get('host');
  if (host !== null && host !== new URL(origin).hostname) {
    throw new TypeError('Invalid text admin request');
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!CANONICAL_POSITIVE_LENGTH.test(contentLength)) {
      throw new TypeError('Invalid text admin request');
    }
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed > MAX_REQUEST_BYTES) {
      throw new TypeError('Invalid text admin request');
    }
  }
}

function cancelSilently(value: ReadableStreamDefaultReader<Uint8Array> | ReadableStream<Uint8Array>): void {
  try {
    const result = 'cancel' in value ? value.cancel() : undefined;
    void result?.catch(() => undefined);
  } catch {
    // Cancellation is best-effort and never changes the fixed response.
  }
}

async function readBoundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (stream === null) throw new TypeError('Invalid text admin body');
  const reader = stream.getReader();
  const buffer = new Uint8Array(maximumBytes);
  let length = 0;
  let chunks = 0;
  let failed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      if (
        chunks > MAX_STREAM_CHUNKS
        || !(value instanceof Uint8Array)
        || value.byteLength === 0
        || value.byteLength > maximumBytes - length
      ) {
        failed = true;
        throw new TypeError('Invalid text admin body');
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
    if (length === 0) throw new TypeError('Invalid text admin body');
    return buffer.slice(0, length);
  } catch {
    failed = true;
    throw new TypeError('Invalid text admin body');
  } finally {
    if (failed) cancelSilently(reader);
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream cannot change the fixed response.
    }
  }
}

async function readRequestJson(request: Request): Promise<unknown> {
  const bytes = await readBoundedBytes(request.body, MAX_REQUEST_BYTES);
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(serialized) as unknown;
}

function jsonResponse(body: TextAiAdminResponse, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function serviceDisabled(): Response {
  return jsonResponse({ ok: false, code: 'service-disabled' }, 503);
}

function validBinding(env: TextAiPagesEnv): env is TextAiPagesEnv & { PHOTO_AI_GATEWAY: Fetcher } {
  try {
    return typeof env.PHOTO_AI_GATEWAY === 'object'
      && env.PHOTO_AI_GATEWAY !== null
      && typeof env.PHOTO_AI_GATEWAY.fetch === 'function';
  } catch {
    return false;
  }
}

async function readDownstream(response: Response): Promise<TextAiAdminResponse> {
  if (
    response.status >= 300
    && response.status <= 399
  ) {
    if (response.body !== null) cancelSilently(response.body);
    throw new TypeError('Invalid text admin response');
  }
  if (response.headers.get('content-type') !== 'application/json') {
    if (response.body !== null) cancelSilently(response.body);
    throw new TypeError('Invalid text admin response');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      if (response.body !== null) cancelSilently(response.body);
      throw new TypeError('Invalid text admin response');
    }
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_RESPONSE_BYTES) {
      if (response.body !== null) cancelSilently(response.body);
      throw new TypeError('Invalid text admin response');
    }
  }
  const bytes = await readBoundedBytes(response.body, MAX_RESPONSE_BYTES);
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return parseTextAiAdminResponse(JSON.parse(serialized) as unknown);
}

export async function authorizeTextAdminPagesRequest(
  request: Request,
  env: TextAiPagesEnv,
): Promise<{ accountKey: string; request: TextAiAdminWorkerRequest }> {
  const pagesConfig = parseTextPagesRequestConfig({
    PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
  });
  validateAdminRequest(request, pagesConfig.origin);
  const parsed = parseTextAiAdminRequest(await readRequestJson(request));
  const adminConfig = parseTextAdminAccessConfig(env);
  await verifyTextAdminAccess(request, adminConfig);
  const userConfig = parseTextUserAccessConfig(env);
  if (!userConfig.allowedEmails.has(parsed.targetEmail)) throw new AccessDeniedError();
  const accountKey = await deriveAccountKey(
    parsed.targetEmail,
    userConfig.accountHmacSecret,
  );
  const workerRequest = parseTextAiAdminWorkerRequest({
    schemaVersion: parsed.schemaVersion,
    operationId: parsed.operationId,
    operation: parsed.operation,
    accountKey,
  });
  return { accountKey, request: workerRequest };
}

export async function proxyTextAdminRequest(
  env: TextAiPagesEnv,
  accountKey: string,
  body: TextAiAdminWorkerRequest,
): Promise<Response> {
  if (!validBinding(env)) return serviceDisabled();

  try {
    if (!ACCOUNT_KEY.test(accountKey)) throw new TypeError('Invalid account key');
    const parsedBody = parseTextAiAdminWorkerRequest(body);
    if (parsedBody.accountKey !== accountKey) throw new TypeError('Invalid account key');
    const serialized = JSON.stringify(parsedBody);
    const bytes = new TextEncoder().encode(serialized);
    const downstream = await env.PHOTO_AI_GATEWAY.fetch(INTERNAL_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-length': String(bytes.byteLength),
        'content-type': 'application/json',
        'x-tiezheng-account-key': accountKey,
      },
      body: bytes,
    });
    const response = await readDownstream(downstream);
    if (response.ok) {
      if (
        downstream.status !== 200
        || response.operationId !== parsedBody.operationId
      ) {
        throw new TypeError('Invalid text admin response');
      }
      return jsonResponse(response, 200);
    }
    if (response.code === 'operation-conflict' && downstream.status === 409) {
      return jsonResponse(response, 409);
    }
    if (response.code === 'service-disabled' && downstream.status === 503) {
      return serviceDisabled();
    }
    throw new TypeError('Invalid text admin response');
  } catch {
    return serviceDisabled();
  }
}
