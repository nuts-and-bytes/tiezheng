import { createSign, generateKeyPairSync } from 'node:crypto';
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
import type { TextAiPagesEnv } from './pagesProxy';

const ORIGIN = 'https://app.example.test';
const ADMIN_URL = `${ORIGIN}/api/nutrition/text-admin/account`;
const INTERNAL_URL = 'https://photo-ai-gateway.internal/internal/text-admin';
const ISSUER = 'https://team-alpha.cloudflareaccess.com';
const USER_AUDIENCE = 'text-user-audience';
const ADMIN_AUDIENCE = 'text-admin-audience';
const SERVICE_CLIENT_ID = 'text-preview-admin.access';
const HMAC_SECRET = '0123456789abcdef0123456789abcdef';
const OPERATION_ID = '1'.repeat(32);
const ACCOUNT_KEY = 'a'.repeat(64);
const BOB_ACCOUNT_KEY = '0f03a80a5bb45cb698165b3a48abad4fe7183d604b79e6bb198aa8b354f296e9';
const ADMIN_DEADLINE_MS = 18_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'text-admin-pages-test-key';

const adminBody = Object.freeze({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  operation: 'status',
  targetEmail: 'alice@example.com',
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
    PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
    PHOTO_AI_ACCOUNT_HMAC_KEY: HMAC_SECRET,
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    TEXT_AI_ACCESS_AUD: USER_AUDIENCE,
    TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
    TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
    TEXT_AI_ADMIN_ACCESS_AUD: ADMIN_AUDIENCE,
    TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
    TEXT_AI_ADMIN_SERVICE_CLIENT_ID: SERVICE_CLIENT_ID,
    PHOTO_AI_GATEWAY: gatewayFetch === undefined
      ? undefined
      : { fetch: gatewayFetch } as Fetcher,
  };
}

function base64Url(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function token(
  claims: Record<string, unknown> = { sub: 'admin-subject', email: 'alice@example.com' },
  audience = ADMIN_AUDIENCE,
): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = base64Url({ alg: 'RS256', kid: jwk.kid });
  const payload = base64Url({
    ...claims,
    aud: audience,
    exp: now + 300,
    iat: now,
    iss: ISSUER,
    nbf: now - 1,
  });
  const input = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  return `${input}.${base64UrlBytes(signer.sign(privateKey))}`;
}

function serviceToken(clientId = SERVICE_CLIENT_ID): string {
  return token({ sub: '', common_name: clientId });
}

function installJwks(): ReturnType<typeof vi.fn<typeof fetch>> {
  const authFetch = vi.fn<typeof fetch>(async () => json({ keys: [jwk] }));
  vi.stubGlobal('fetch', authFetch);
  return authFetch;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function request(options: {
  url?: string;
  method?: string;
  origin?: string | null;
  site?: string | null;
  contentType?: string | null;
  accessToken?: string | null;
  body?: BodyInit | null;
  headers?: HeadersInit;
} = {}): Request {
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const site = options.site === undefined ? 'same-origin' : options.site;
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  const accessToken = options.accessToken === undefined ? token() : options.accessToken;
  if (origin !== null) headers.set('origin', origin);
  if (site !== null) headers.set('sec-fetch-site', site);
  if (contentType !== null) headers.set('content-type', contentType);
  if (accessToken !== null) headers.set('cf-access-jwt-assertion', accessToken);
  return new Request(options.url ?? ADMIN_URL, {
    method: options.method ?? 'POST',
    headers,
    body: options.body === undefined ? JSON.stringify(adminBody) : options.body,
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

describe('text admin Pages authorization firewall', () => {
  test('keeps the exported authorization result to an account key and strict Worker request', async () => {
    installJwks();

    const authorized = await authorizeTextAdminPagesRequest(request(), env());

    expectTypeOf(authorized).toEqualTypeOf<{
      accountKey: string;
      request: TextAiAdminWorkerRequest;
    }>();
    expect(authorized).toEqual({
      accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      request: {
        schemaVersion: 1,
        operationId: OPERATION_ID,
        operation: 'status',
        accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(authorized.request.accountKey).toBe(authorized.accountKey);
    expect(JSON.stringify(authorized)).not.toContain('@');
  });

  test('accepts the configured administrator and exact service principal but rejects the second user', async () => {
    installJwks();
    const administrator = await authorizeTextAdminPagesRequest(request(), env());
    const service = await authorizeTextAdminPagesRequest(
      request({ accessToken: serviceToken() }),
      env(),
    );

    expect(administrator.accountKey).toMatch(/^[a-f0-9]{64}$/);
    expect(service.accountKey).toBe(administrator.accountKey);
    await expect(authorizeTextAdminPagesRequest(
      request({ accessToken: token({ sub: 'ordinary-subject', email: 'bob@example.com' }) }),
      env(),
    )).rejects.toThrow('Access denied');
  });

  test.each([
    ['wrong method', { method: 'PUT' }],
    ['wrong path', { url: `${ORIGIN}/api/nutrition/text-admin/other` }],
    ['query', { url: `${ADMIN_URL}?target=alice` }],
    ['bare query delimiter', { url: `${ADMIN_URL}?` }],
    ['wrong content type', { contentType: 'application/json; charset=utf-8' }],
    ['missing content type', { contentType: null }],
    ['cross origin', { origin: 'https://evil.example' }],
    ['missing origin', { origin: null }],
    ['cross site', { site: 'cross-site' }],
    ['missing fetch site', { site: null }],
  ] as const)('rejects %s before Access lookup or private binding', async (_case, options) => {
    const authFetch = installJwks();
    const gatewayFetch = vi.fn();

    const response = await textAdminAccountRoute(context(request(options), env(gatewayFetch)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: 'auth-required' });
    expect(authFetch).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('ignores a lying Content-Length and rejects a streaming body larger than 2048 bytes', async () => {
    const authFetch = installJwks();
    const gatewayFetch = vi.fn();
    const serialized = JSON.stringify(adminBody);
    const response = await textAdminAccountRoute(context(request({
      body: `${serialized}${' '.repeat(2_049 - serialized.length)}`,
      headers: { 'content-length': '1' },
    }), env(gatewayFetch)));

    expect(response.status).toBe(401);
    expect(authFetch).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('rejects fatal UTF-8, malformed JSON, extra fields, and ambiguous body encoding', async () => {
    const authFetch = installJwks();
    const gatewayFetch = vi.fn();
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    const requests = [
      request({ body: invalidUtf8 }),
      request({ body: '{' }),
      request({ body: JSON.stringify({ ...adminBody, email: 'private@example.com' }) }),
      request({ headers: { 'content-encoding': 'gzip' } }),
      request({ headers: { 'transfer-encoding': 'chunked' } }),
    ];

    for (const source of requests) {
      const response = await textAdminAccountRoute(context(source, env(gatewayFetch)));
      expect(response.status).toBe(401);
      expectSecure(response);
    }
    expect(authFetch).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  test.each([
    ['invalid JWT', 'private-invalid-jwt', 'alice@example.com'],
    ['wrong audience', token(undefined, USER_AUDIENCE), 'alice@example.com'],
    ['wrong service principal', serviceToken('other-client.access'), 'alice@example.com'],
    ['target outside two-user list', token(), 'carol@example.com'],
  ])('rejects %s without exposing identity or touching the gateway', async (
    _case,
    accessToken,
    targetEmail,
  ) => {
    installJwks();
    const gatewayFetch = vi.fn();
    const source = request({
      accessToken,
      body: JSON.stringify({ ...adminBody, targetEmail }),
    });

    const response = await textAdminAccountRoute(context(source, env(gatewayFetch)));
    const serialized = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'auth-required' });
    expect(serialized).not.toMatch(/@|private-invalid-jwt|other-client|carol/);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });
});

describe('text admin Pages private proxy', () => {
  const workerRequest: TextAiAdminWorkerRequest = {
    schemaVersion: 1,
    operationId: OPERATION_ID,
    operation: 'status',
    accountKey: ACCOUNT_KEY,
  };

  test.each([undefined, true, {}, { fetch: 'not-a-function' }])(
    'fails closed for invalid binding %# without invoking a service',
    async (binding) => {
      const routeEnv = env();
      routeEnv.PHOTO_AI_GATEWAY = binding as Fetcher | undefined;

      const response = await proxyTextAdminRequest(routeEnv, ACCOUNT_KEY, workerRequest);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: 'service-disabled' });
      expectSecure(response);
    },
  );

  test('uses only the fixed internal URL, account header, and email-free Worker body', async () => {
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(INTERNAL_URL);
      expect(init?.method).toBe('POST');
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': String(JSON.stringify(workerRequest).length),
        'content-type': 'application/json',
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      const serialized = await new Response(init?.body).text();
      expect(JSON.parse(serialized)).toEqual(workerRequest);
      expect(serialized).not.toContain('@');
      return json(successBody);
    });

    const response = await proxyTextAdminRequest(env(gatewayFetch), ACCOUNT_KEY, workerRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(successBody);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('preserves only a strict operation conflict as 409', async () => {
    const gatewayFetch = vi.fn(async () => json({ ok: false, code: 'operation-conflict' }, 409));

    const response = await proxyTextAdminRequest(env(gatewayFetch), ACCOUNT_KEY, workerRequest);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: 'operation-conflict' });
    expectSecure(response);
  });

  test.each([
    ['throw', () => Promise.reject(new Error('private stack'))],
    ['HTML', () => Promise.resolve(new Response('<p>private email@example.com</p>', { status: 500 }))],
    ['invalid schema', () => Promise.resolve(json({ ok: true, private: 'email@example.com' }))],
    ['mismatched operation', () => Promise.resolve(json({ ...successBody, operationId: '2'.repeat(32) }))],
    ['status mismatch', () => Promise.resolve(json(successBody, 201))],
    ['invalid failure status', () => Promise.resolve(json({ ok: false, code: 'operation-conflict' }, 200))],
    ['oversized response', () => Promise.resolve(json({ private: 'x'.repeat(70_000) }))],
  ])('maps downstream %s to a fixed private 503 response', async (_case, implementation) => {
    const gatewayFetch = vi.fn(implementation);

    const response = await proxyTextAdminRequest(env(gatewayFetch), ACCOUNT_KEY, workerRequest);
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'service-disabled' });
    expect(serialized).not.toMatch(/@|private stack/);
    expectSecure(response);
  });
});

describe('text admin Pages Function route', () => {
  test('maps a valid administrator request through the firewall', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async () => json(successBody));

    const response = await textAdminAccountRoute(context(request(), env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(successBody);
    expectSecure(response);
  });

  test('maps missing binding and invalid downstream to service-disabled without leaking input', async () => {
    installJwks();
    for (const routeEnv of [env(), env(async () => json({ private: 'email@example.com' }))]) {
      const response = await textAdminAccountRoute(context(request(), routeEnv));
      const serialized = await response.text();
      expect(response.status).toBe(503);
      expect(JSON.parse(serialized)).toEqual({ ok: false, code: 'service-disabled' });
      expect(serialized).not.toContain('@');
      expectSecure(response);
    }
  });

  test.each([
    ['administrator', token()],
    ['service principal', serviceToken()],
  ])('derives Bob account key from the target for an authenticated %s', async (
    _principal,
    accessToken,
  ) => {
    installJwks();
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(INTERNAL_URL);
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': expect.any(String),
        'content-type': 'application/json',
        'x-tiezheng-account-key': BOB_ACCOUNT_KEY,
      });
      const serialized = await new Response(init?.body).text();
      expect(JSON.parse(serialized)).toEqual({
        schemaVersion: 1,
        operationId: OPERATION_ID,
        operation: 'status',
        accountKey: BOB_ACCOUNT_KEY,
      });
      expect(serialized).not.toMatch(/@|alice|bob|cf-access/i);
      expect(JSON.stringify(headerRecord(init?.headers))).not.toMatch(/@|alice|bob|cf-access/i);
      return json(successBody);
    });
    const source = request({
      accessToken,
      body: JSON.stringify({ ...adminBody, targetEmail: 'bob@example.com' }),
    });

    const response = await textAdminAccountRoute(context(source, env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('times out and cancels a stalled request body before Access or binding', async () => {
    vi.useFakeTimers();
    const authFetch = installJwks();
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
      expect(authFetch).not.toHaveBeenCalled();
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
    installJwks();
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

  test('cancels a stalled downstream response stream at the same fixed deadline', async () => {
    vi.useFakeTimers();
    installJwks();
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
