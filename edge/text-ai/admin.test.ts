import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import { onRequestPost as textAdminAccountRoute } from '../../functions/api/nutrition/text-admin/account';
import type {
  TextAiAdminResponse,
  TextAiAdminWorkerRequest,
} from '../../src/lib/textAiAdminContract';
import {
  authorizeTextAdminPagesRequest,
  proxyTextAdminRequest,
} from './admin';
import { TEXT_ADMIN_SIGNATURE_HEADERS } from './adminSignature';
import type { TextAiPagesEnv } from './pagesProxy';

const ORIGIN = 'https://app.example.test';
const ADMIN_PATH = '/api/nutrition/text-admin/account';
const ADMIN_URL = `${ORIGIN}${ADMIN_PATH}`;
const INTERNAL_URL = 'https://photo-ai-gateway.internal/internal/text-admin';
const HMAC_SECRET = '0123456789abcdef0123456789abcdef';
const ADMIN_KEY = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';
const OTHER_ADMIN_KEY = 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU';
const OPERATION_ID = '1'.repeat(32);
const USER_1_ACCOUNT_KEY = '61a577e73e6ec30fff580f73bec071870eff1db204a68e423781087ebdddad24';
const USER_2_ACCOUNT_KEY = '6b73711dc5be1a149c072086367fac8a9547feea771d682ef6974853af44de3c';
const ADMIN_DEADLINE_MS = 18_000;

const adminBody = Object.freeze({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  operation: 'status',
  target: 'user-1',
});

const successBody: TextAiAdminResponse = Object.freeze({
  ok: true,
  operationId: OPERATION_ID,
  status: Object.freeze({
    textGlobalEnabled: false,
    accountEnabled: false,
    accountRemaining: 10,
    globalRemaining: 30,
    budgetSpentMicros: 0,
    budgetReservedMicros: 0,
    resetAt: '2026-08-25T00:00:00.000Z',
  }),
});

function env(gatewayFetch?: Fetcher['fetch']): TextAiPagesEnv {
  return {
    PHOTO_AI_ACCOUNT_HMAC_KEY: HMAC_SECRET,
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    TEXT_AI_ADMIN_SIGNING_KEY: ADMIN_KEY,
    TEXT_AI_USER_1_ACCESS_CODE_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    TEXT_AI_USER_1_ACCESS_CODE_DIGEST: '36beb527ff694b5a0e5d86f3e2c987a2b44ba8c7153fd6fd04107a2260bec302',
    TEXT_AI_USER_2_ACCESS_CODE_PEPPER: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
    TEXT_AI_USER_2_ACCESS_CODE_DIGEST: 'ab3efc3483e04a785d3bddc5d796c2508630e095bfad4de07f9fc345e5577dae',
    TEXT_AI_SESSION_SIGNING_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    TEXT_AI_RATE_LIMIT_HMAC_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
    PHOTO_AI_GATEWAY: gatewayFetch === undefined
      ? undefined
      : { fetch: gatewayFetch } as Fetcher,
  };
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function signatureHeaders(input: {
  body: string | Uint8Array;
  timestamp: string;
  operationId?: string;
  key?: string;
}): Record<string, string> {
  const bodyHash = createHash('sha256').update(bytes(input.body)).digest('hex');
  const material = [
    'v1',
    'POST',
    ADMIN_PATH,
    input.timestamp,
    input.operationId ?? OPERATION_ID,
    bodyHash,
  ].join('\n');
  const signature = createHmac(
    'sha256',
    Buffer.from(input.key ?? ADMIN_KEY, 'base64url'),
  ).update(material, 'utf8').digest('hex');
  return {
    [TEXT_ADMIN_SIGNATURE_HEADERS.version]: 'v1',
    [TEXT_ADMIN_SIGNATURE_HEADERS.timestamp]: input.timestamp,
    [TEXT_ADMIN_SIGNATURE_HEADERS.signature]: signature,
  };
}

function request(options: {
  url?: string;
  method?: string;
  origin?: string | null;
  site?: string | null;
  contentType?: string | null;
  body?: BodyInit | null;
  signatureBody?: string | Uint8Array;
  timestamp?: string;
  signingKey?: string;
  signatureOperationId?: string;
  signatureHeaders?: boolean;
  headers?: HeadersInit;
} = {}): Request {
  const serialized = JSON.stringify(adminBody);
  const body = options.body === undefined ? serialized : options.body;
  const signedBody = options.signatureBody
    ?? (typeof body === 'string' || body instanceof Uint8Array ? body : serialized);
  const timestamp = options.timestamp ?? String(Date.now());
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const site = options.site === undefined ? 'same-origin' : options.site;
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (origin !== null) headers.set('origin', origin);
  if (site !== null) headers.set('sec-fetch-site', site);
  if (contentType !== null) headers.set('content-type', contentType);
  if (options.signatureHeaders !== false) {
    const signed = signatureHeaders({
      body: signedBody,
      timestamp,
      operationId: options.signatureOperationId,
      key: options.signingKey,
    });
    for (const [name, value] of Object.entries(signed)) headers.set(name, value);
  }
  return new Request(options.url ?? ADMIN_URL, {
    method: options.method ?? 'POST',
    headers,
    body,
  });
}

function context(
  source: Request,
  routeEnv: TextAiPagesEnv,
): Parameters<typeof textAdminAccountRoute>[0] {
  return {
    request: source,
    env: routeEnv,
    params: {},
    data: {},
    functionPath: '',
    waitUntil: vi.fn(),
    next: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as Parameters<typeof textAdminAccountRoute>[0];
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function expectSecure(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('text admin Pages HMAC authorization firewall', () => {
  test('returns only the user-1 account key and strict Worker request', async () => {
    const authorized = await authorizeTextAdminPagesRequest(request(), env());

    expectTypeOf(authorized).toEqualTypeOf<{
      accountKey: string;
      request: TextAiAdminWorkerRequest;
    }>();
    expect(authorized).toEqual({
      accountKey: USER_1_ACCOUNT_KEY,
      request: {
        schemaVersion: 1,
        operationId: OPERATION_ID,
        operation: 'status',
        accountKey: USER_1_ACCOUNT_KEY,
      },
    });
    expect(JSON.stringify(authorized)).not.toMatch(/user-[12]|@|signature/i);
  });

  test('derives an independent account key for the exact user-2 slot', async () => {
    const body = JSON.stringify({ ...adminBody, target: 'user-2' });
    const authorized = await authorizeTextAdminPagesRequest(request({ body }), env());

    expect(authorized.accountKey).toBe(USER_2_ACCOUNT_KEY);
    expect(authorized.request.accountKey).toBe(USER_2_ACCOUNT_KEY);
  });

  test('does not read access-code digests, session key, rate-limit key, or Cookie', async () => {
    const routeEnv = env();
    for (const name of [
      'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
      'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
      'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
      'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
      'TEXT_AI_SESSION_SIGNING_KEY',
      'TEXT_AI_RATE_LIMIT_HMAC_KEY',
    ] as const) {
      Object.defineProperty(routeEnv, name, {
        configurable: true,
        get() {
          throw new Error(`must not read ${name}`);
        },
      });
    }

    await expect(authorizeTextAdminPagesRequest(request({
      headers: { cookie: '__Host-tiezheng-text-ai-session=private-jwt' },
    }), routeEnv)).resolves.toMatchObject({ accountKey: USER_1_ACCOUNT_KEY });
  });

  test.each([
    ['wrong method', { method: 'PUT' }],
    ['wrong path', { url: `${ORIGIN}/api/nutrition/text-admin/other` }],
    ['query', { url: `${ADMIN_URL}?target=user-1` }],
    ['bare query delimiter', { url: `${ADMIN_URL}?` }],
    ['wrong content type', { contentType: 'application/json; charset=utf-8' }],
    ['missing content type', { contentType: null }],
    ['cross origin', { origin: 'https://evil.example' }],
    ['missing origin', { origin: null }],
    ['cross site', { site: 'cross-site' }],
    ['missing fetch site', { site: null }],
  ] as const)('rejects %s before the private binding', async (_case, options) => {
    const gatewayFetch = vi.fn();
    const response = await textAdminAccountRoute(context(request(options), env(gatewayFetch)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: 'auth-required' });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('ignores a lying Content-Length and rejects a streaming body over 2048 bytes', async () => {
    const gatewayFetch = vi.fn();
    const serialized = JSON.stringify(adminBody);
    const oversized = `${serialized}${' '.repeat(2_049 - serialized.length)}`;
    const response = await textAdminAccountRoute(context(request({
      body: oversized,
      headers: { 'content-length': '1' },
    }), env(gatewayFetch)));

    expect(response.status).toBe(401);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('rejects a canonical but mismatched Content-Length before signature or binding', async () => {
    const gatewayFetch = vi.fn();
    const response = await textAdminAccountRoute(context(request({
      headers: { 'content-length': '1' },
    }), env(gatewayFetch)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: 'auth-required' });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('rejects fatal UTF-8, malformed JSON, extra fields, invalid slots, and encodings', async () => {
    const gatewayFetch = vi.fn();
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    const invalidBodies = [
      invalidUtf8,
      '{',
      JSON.stringify({ ...adminBody, private: 'secret' }),
      JSON.stringify({ ...adminBody, target: 'user-3' }),
    ];
    const sources = invalidBodies.map((body) => request({ body }));
    sources.push(request({ headers: { 'content-encoding': 'gzip' } }));
    sources.push(request({ headers: { 'transfer-encoding': 'chunked' } }));

    for (const source of sources) {
      const response = await textAdminAccountRoute(context(source, env(gatewayFetch)));
      expect(response.status).toBe(401);
      expectSecure(response);
    }
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  test.each([
    ['body byte', { body: JSON.stringify({ ...adminBody, target: 'user-2' }), signatureBody: JSON.stringify(adminBody) }],
    ['operation id', { signatureOperationId: '2'.repeat(32) }],
    ['clock future', { timestamp: String(Date.now() + 600_000) }],
    ['clock past', { timestamp: String(Date.now() - 600_000) }],
    ['wrong key', { signingKey: OTHER_ADMIN_KEY }],
    ['missing headers', { signatureHeaders: false }],
  ] as const)('maps invalid %s signatures to one non-leaking 401', async (_case, options) => {
    const gatewayFetch = vi.fn();
    const source = request(options);
    const signature = source.headers.get(TEXT_ADMIN_SIGNATURE_HEADERS.signature) ?? 'missing';
    const response = await textAdminAccountRoute(context(source, env(gatewayFetch)));
    const serialized = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'auth-required' });
    expect(serialized).not.toMatch(/user-[12]|@|private|account/i);
    expect(serialized).not.toContain(signature);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });
});

describe('text admin Pages private proxy', () => {
  const workerRequest: TextAiAdminWorkerRequest = {
    schemaVersion: 1,
    operationId: OPERATION_ID,
    operation: 'status',
    accountKey: USER_1_ACCOUNT_KEY,
  };

  test.each([undefined, true, {}, { fetch: 'not-a-function' }])(
    'fails closed for invalid binding %# without invoking a service',
    async (binding) => {
      const routeEnv = env();
      routeEnv.PHOTO_AI_GATEWAY = binding as Fetcher | undefined;

      const response = await proxyTextAdminRequest(routeEnv, USER_1_ACCOUNT_KEY, workerRequest);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: 'service-disabled' });
      expectSecure(response);
    },
  );

  test('uses the fixed internal URL, account header, and slot-free Worker body', async () => {
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(INTERNAL_URL);
      expect(init?.method).toBe('POST');
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': String(JSON.stringify(workerRequest).length),
        'content-type': 'application/json',
        'x-tiezheng-account-key': USER_1_ACCOUNT_KEY,
      });
      const serialized = await new Response(init?.body).text();
      expect(JSON.parse(serialized)).toEqual(workerRequest);
      expect(serialized).not.toMatch(/user-[12]|@|signature/i);
      return json(successBody);
    });

    const response = await proxyTextAdminRequest(
      env(gatewayFetch),
      USER_1_ACCOUNT_KEY,
      workerRequest,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(successBody);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('preserves only a strict operation conflict as 409', async () => {
    const gatewayFetch = vi.fn(async () => json({ ok: false, code: 'operation-conflict' }, 409));
    const response = await proxyTextAdminRequest(
      env(gatewayFetch),
      USER_1_ACCOUNT_KEY,
      workerRequest,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: 'operation-conflict' });
    expectSecure(response);
  });

  test.each([
    ['throw', () => Promise.reject(new Error('private stack'))],
    ['HTML', () => Promise.resolve(new Response('<p>private user-1</p>', { status: 500 }))],
    ['invalid schema', () => Promise.resolve(json({ ok: true, private: 'user-1' }))],
    ['mismatched operation', () => Promise.resolve(json({ ...successBody, operationId: '2'.repeat(32) }))],
    ['status mismatch', () => Promise.resolve(json(successBody, 201))],
    ['invalid failure status', () => Promise.resolve(json({ ok: false, code: 'operation-conflict' }, 200))],
    ['oversized response', () => Promise.resolve(json({ private: 'x'.repeat(70_000) }))],
  ])('maps downstream %s to a fixed private 503 response', async (_case, implementation) => {
    const gatewayFetch = vi.fn(implementation);
    const response = await proxyTextAdminRequest(
      env(gatewayFetch),
      USER_1_ACCOUNT_KEY,
      workerRequest,
    );
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'service-disabled' });
    expect(serialized).not.toMatch(/user-[12]|private stack/);
    expectSecure(response);
  });
});

describe('text admin Pages Function route', () => {
  test('maps a valid signed request through the firewall', async () => {
    const gatewayFetch = vi.fn(async () => json(successBody));
    const response = await textAdminAccountRoute(context(request(), env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(successBody);
    expectSecure(response);
  });

  test('maps missing binding and invalid downstream to fixed service-disabled', async () => {
    for (const routeEnv of [env(), env(async () => json({ private: 'user-1' }))]) {
      const response = await textAdminAccountRoute(context(request(), routeEnv));
      const serialized = await response.text();
      expect(response.status).toBe(503);
      expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'service-disabled' });
      expect(serialized).not.toMatch(/user-[12]|signature/i);
      expectSecure(response);
    }
  });

  test('derives user-2 account key without forwarding the slot or signature', async () => {
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(INTERNAL_URL);
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': expect.any(String),
        'content-type': 'application/json',
        'x-tiezheng-account-key': USER_2_ACCOUNT_KEY,
      });
      const serialized = await new Response(init?.body).text();
      expect(JSON.parse(serialized)).toEqual({
        schemaVersion: 1,
        operationId: OPERATION_ID,
        operation: 'status',
        accountKey: USER_2_ACCOUNT_KEY,
      });
      expect(serialized).not.toMatch(/user-[12]|signature/i);
      return json(successBody);
    });
    const body = JSON.stringify({ ...adminBody, target: 'user-2' });

    const response = await textAdminAccountRoute(context(
      request({ body }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('times out and cancels a stalled request body before signature or binding', async () => {
    vi.useFakeTimers();
    const gatewayFetch = vi.fn();
    const cancel = vi.fn();
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => controller.close();
      },
      cancel,
    });
    let response: Response | undefined;
    const pending = Promise.resolve(textAdminAccountRoute(context(
      request({ body: stream }),
      env(gatewayFetch),
    )));
    void pending.then((value) => { response = value; });

    try {
      await vi.advanceTimersByTimeAsync(ADMIN_DEADLINE_MS);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ ok: false, code: 'service-disabled' });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(gatewayFetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (response === undefined) close();
      await vi.runAllTimersAsync();
      await pending;
    }
  });

  test('aborts and returns fixed 503 when the private binding never resolves', async () => {
    vi.useFakeTimers();
    let forwardedSignal: AbortSignal | undefined;
    let resolveBinding!: (response: Response) => void;
    const gatewayFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      forwardedSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveBinding = resolve;
      });
    });
    let response: Response | undefined;
    const pending = Promise.resolve(textAdminAccountRoute(context(request(), env(gatewayFetch))));
    void pending.then((value) => { response = value; });

    try {
      await vi.advanceTimersByTimeAsync(ADMIN_DEADLINE_MS - 1);
      expect(gatewayFetch).toHaveBeenCalledTimes(1);
      expect(response).toBeUndefined();
      expect(forwardedSignal).toBeInstanceOf(AbortSignal);
      expect(forwardedSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ ok: false, code: 'service-disabled' });
      expect(forwardedSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      resolveBinding(json(successBody));
      await vi.runAllTimersAsync();
      await pending;
    }
  });

  test('cancels a stalled downstream response stream at the fixed deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => controller.close();
      },
      cancel,
    });
    const gatewayFetch = vi.fn(async () => new Response(stream, {
      headers: { 'content-type': 'application/json' },
    }));
    let response: Response | undefined;
    const pending = Promise.resolve(textAdminAccountRoute(context(request(), env(gatewayFetch))));
    void pending.then((value) => { response = value; });

    try {
      await vi.advanceTimersByTimeAsync(ADMIN_DEADLINE_MS);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ ok: false, code: 'service-disabled' });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (response === undefined) close();
      await vi.runAllTimersAsync();
      await pending;
    }
  });
});
