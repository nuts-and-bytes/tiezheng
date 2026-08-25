import { env as runtimeEnv } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  parseTextAiAdminResponse,
  type TextAiAdminStatus,
  type TextAiAdminWorkerRequest,
} from '../../../src/lib/textAiAdminContract';
import { stableJson } from '../../../src/lib/stableJson';
import type { GatewayEnv } from './env';
import worker from './index';
import {
  handleTextAdminRequest,
  type TextAdminDependencies,
} from './textAdminHandler';

const ACCOUNT_KEY = 'a'.repeat(64);
const OTHER_ACCOUNT_KEY = 'b'.repeat(64);
const OPERATION_ID = '1'.repeat(32);
const BASE_NOW = Date.UTC(2026, 7, 25, 4, 0, 0);
const FIXED_FINGERPRINT = 'b873a2ea0b7c4e99d3276d0e578c4404210c4a1f6df509c41751af125f8a07d0';
const ADMIN_URL = 'https://photo-ai-gateway.internal/internal/text-admin';

const ADMIN_BODY: TextAiAdminWorkerRequest = {
  schemaVersion: 1,
  operationId: OPERATION_ID,
  operation: 'enable-account',
  accountKey: ACCOUNT_KEY,
};

const STATUS: TextAiAdminStatus = {
  textGlobalEnabled: true,
  accountEnabled: true,
  accountRemaining: 10,
  globalRemaining: 30,
  budgetSpentMicros: 0,
  budgetReservedMicros: 0,
  resetAt: '2026-08-26T04:00:00.000Z',
};

const DEPENDENCIES: TextAdminDependencies = Object.freeze({
  now: () => BASE_NOW,
});

function coordinatorHarness(result: unknown = { kind: 'applied', status: STATUS }) {
  const applyTextAdminOperation = vi.fn().mockResolvedValue(result);
  const getByName = vi.fn().mockReturnValue({ applyTextAdminOperation });
  const gatewayEnv = {
    TEXT_AI_ADMIN_ENABLED: 'true',
    TEXT_AI_MAX_PROVIDER_ATTEMPTS: '1',
    TEXT_AI_GATEWAY_ENABLED: 'false',
    TEXT_AI_MODEL: 'doubao-seed-2-1-pro-260628',
    PHOTO_AI_GATEWAY_ENABLED: 'false',
    PHOTO_AI_MODEL: 'doubao-seed-2-1-pro-260628',
    PHOTO_AI_ALLOWED_ORIGINS: 'https://photo-ai-stage2.tiezheng.pages.dev',
    PHOTO_AI_MONTHLY_BUDGET_MICROS: '50000000',
    ARK_API_KEY: 'test-only-not-a-secret',
    PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    IMAGES: {
      info: vi.fn(),
      input: vi.fn(),
    } as unknown as ImagesBinding,
    PHOTO_AI_COORDINATOR: {
      getByName,
    } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
  } as unknown as GatewayEnv;

  return { gatewayEnv, getByName, applyTextAdminOperation };
}

function adminRequest(
  body: BodyInit | null = JSON.stringify(ADMIN_BODY),
  options: {
    method?: string;
    url?: string;
    contentType?: string | null;
    accountKey?: string | null;
    headers?: HeadersInit;
  } = {},
): Request {
  const headers = new Headers(options.headers);
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json');
  }
  if (options.accountKey !== null) {
    headers.set('x-tiezheng-account-key', options.accountKey ?? ACCOUNT_KEY);
  }
  const method = options.method ?? 'POST';
  return new Request(options.url ?? ADMIN_URL, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

async function expectFixedJson(
  response: Response,
  status: number,
  expected: unknown,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(expected);
}

async function independentFingerprint(
  operation: TextAiAdminWorkerRequest['operation'],
  accountKey: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableJson({ operation, accountKey })),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('internal text admin configuration firewall', () => {
  test('loads the two new vars in their fixed fail-closed defaults without opening existing gateways', () => {
    const vars = runtimeEnv as unknown as Record<string, unknown>;
    expect(vars.TEXT_AI_ADMIN_ENABLED).toBe('false');
    expect(vars.TEXT_AI_MAX_PROVIDER_ATTEMPTS).toBe('1');
    expect(vars.TEXT_AI_GATEWAY_ENABLED).toBe('false');
    expect(vars.PHOTO_AI_GATEWAY_ENABLED).toBe('false');
  });

  test.each([undefined, 'false', 'TRUE', ' true', 'true '])(
    'fails closed for non-exact TEXT_AI_ADMIN_ENABLED=%s before body or coordinator access',
    async (flag) => {
      const { gatewayEnv, getByName, applyTextAdminOperation } = coordinatorHarness();
      if (flag === undefined) {
        delete (gatewayEnv as unknown as Record<string, unknown>).TEXT_AI_ADMIN_ENABLED;
      } else {
        (gatewayEnv as unknown as Record<string, unknown>).TEXT_AI_ADMIN_ENABLED = flag;
      }
      const request = adminRequest();

      await expectFixedJson(
        await handleTextAdminRequest(request, gatewayEnv, DEPENDENCIES),
        503,
        { ok: false, code: 'service-disabled' },
      );

      expect(request.bodyUsed).toBe(false);
      expect(getByName).not.toHaveBeenCalled();
      expect(applyTextAdminOperation).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['missing binding', undefined],
    ['primitive binding', true],
    ['incomplete binding', {}],
  ])('fails closed for a %s before reading the body', async (_name, binding) => {
    const { gatewayEnv } = coordinatorHarness();
    (gatewayEnv as unknown as Record<string, unknown>).PHOTO_AI_COORDINATOR = binding;
    const request = adminRequest();

    await expectFixedJson(
      await handleTextAdminRequest(request, gatewayEnv, DEPENDENCIES),
      503,
      { ok: false, code: 'service-disabled' },
    );
    expect(request.bodyUsed).toBe(false);
  });
});

describe('internal text admin request firewall', () => {
  test.each([
    ['wrong method', () => adminRequest(null, { method: 'GET' })],
    ['wrong path', () => adminRequest(JSON.stringify(ADMIN_BODY), { url: `${ADMIN_URL}/` })],
    ['query string', () => adminRequest(JSON.stringify(ADMIN_BODY), { url: `${ADMIN_URL}?x=1` })],
    ['missing content type', () => adminRequest(JSON.stringify(ADMIN_BODY), { contentType: null })],
    ['content type with charset', () => adminRequest(JSON.stringify(ADMIN_BODY), { contentType: 'application/json; charset=utf-8' })],
    ['wrong content type case', () => adminRequest(JSON.stringify(ADMIN_BODY), { contentType: 'Application/JSON' })],
    ['missing account header', () => adminRequest(JSON.stringify(ADMIN_BODY), { accountKey: null })],
    ['empty account header', () => adminRequest(JSON.stringify(ADMIN_BODY), { accountKey: '' })],
    ['uppercase account header', () => adminRequest(JSON.stringify(ADMIN_BODY), { accountKey: 'A'.repeat(64) })],
    ['short account header', () => adminRequest(JSON.stringify(ADMIN_BODY), { accountKey: 'a'.repeat(63) })],
    ['header and body mismatch', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, accountKey: OTHER_ACCOUNT_KEY }))],
    ['empty body', () => adminRequest(null)],
    ['blank body', () => adminRequest('   ')],
    ['bad JSON', () => adminRequest('{')],
    ['non-object JSON', () => adminRequest('null')],
    ['extra body key', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, targetEmail: 'alice@example.com' }))],
    ['invalid schema version', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, schemaVersion: 2 }))],
    ['invalid operation id', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, operationId: 'z'.repeat(32) }))],
    ['invalid operation', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, operation: 'enable-photo-global' }))],
    ['uppercase body account key', () => adminRequest(JSON.stringify({ ...ADMIN_BODY, accountKey: 'A'.repeat(64) }), { accountKey: 'A'.repeat(64) })],
    ['invalid UTF-8', () => adminRequest(new Uint8Array([0xc3, 0x28]))],
  ])('returns only invalid-request for %s before the coordinator', async (_name, makeRequest) => {
    const { gatewayEnv, getByName, applyTextAdminOperation } = coordinatorHarness();

    await expectFixedJson(
      await handleTextAdminRequest(makeRequest(), gatewayEnv, DEPENDENCIES),
      400,
      { ok: false, code: 'invalid-request' },
    );

    expect(getByName).not.toHaveBeenCalled();
    expect(applyTextAdminOperation).not.toHaveBeenCalled();
  });

  test('accepts exactly 2048 streamed bytes and rejects 2049 despite a small Content-Length', async () => {
    const serialized = JSON.stringify(ADMIN_BODY);
    const exactlyBounded = `${serialized}${' '.repeat(2048 - new TextEncoder().encode(serialized).byteLength)}`;
    const accepted = coordinatorHarness();

    await expectFixedJson(
      await handleTextAdminRequest(
        adminRequest(new TextEncoder().encode(exactlyBounded), {
          headers: { 'content-length': '1' },
        }),
        accepted.gatewayEnv,
        DEPENDENCIES,
      ),
      200,
      { ok: true, operationId: OPERATION_ID, status: STATUS },
    );
    expect(accepted.applyTextAdminOperation).toHaveBeenCalledTimes(1);

    const rejected = coordinatorHarness();
    await expectFixedJson(
      await handleTextAdminRequest(
        adminRequest(new TextEncoder().encode(`${exactlyBounded} `), {
          headers: { 'content-length': '1' },
        }),
        rejected.gatewayEnv,
        DEPENDENCIES,
      ),
      400,
      { ok: false, code: 'invalid-request' },
    );
    expect(rejected.getByName).not.toHaveBeenCalled();
    expect(rejected.applyTextAdminOperation).not.toHaveBeenCalled();
  });
});

describe('internal text admin RPC mapping and privacy', () => {
  test('sends one minimal RPC with the stable fixed-vector fingerprint', async () => {
    const { gatewayEnv, getByName, applyTextAdminOperation } = coordinatorHarness();
    expect(await independentFingerprint(ADMIN_BODY.operation, ADMIN_BODY.accountKey))
      .toBe(FIXED_FINGERPRINT);

    const response = await handleTextAdminRequest(
      adminRequest(),
      gatewayEnv,
      DEPENDENCIES,
    );

    expect(getByName).toHaveBeenCalledTimes(1);
    expect(getByName).toHaveBeenCalledWith('stage2');
    expect(applyTextAdminOperation).toHaveBeenCalledTimes(1);
    expect(applyTextAdminOperation).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      operation: 'enable-account',
      accountKey: ACCOUNT_KEY,
      fingerprint: FIXED_FINGERPRINT,
      now: BASE_NOW,
    });
    const rpcJson = JSON.stringify(applyTextAdminOperation.mock.calls[0]?.[0]);
    expect(rpcJson).not.toContain(ADMIN_URL);
    expect(rpcJson).not.toContain('x-tiezheng-account-key');
    expect(rpcJson).not.toContain('targetEmail');
    expect(rpcJson).not.toContain('description');

    const serialized = await response.clone().text();
    await expectFixedJson(response, 200, {
      ok: true,
      operationId: OPERATION_ID,
      status: STATUS,
    });
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain(ACCOUNT_KEY);
    expect(serialized).not.toContain(FIXED_FINGERPRINT);
    expect(parseTextAiAdminResponse(JSON.parse(serialized))).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      status: STATUS,
    });
  });

  test('maps coordinator conflicts to the fixed 409 response', async () => {
    const { gatewayEnv } = coordinatorHarness({ kind: 'conflict' });
    await expectFixedJson(
      await handleTextAdminRequest(adminRequest(), gatewayEnv, DEPENDENCIES),
      409,
      { ok: false, code: 'operation-conflict' },
    );
  });

  test.each([
    ['invalid status count', { ...STATUS, accountRemaining: 11 }],
    ['extra status field', { ...STATUS, diagnostic: 'alice@example.com private' }],
  ])('fails closed instead of returning an applied RPC with %s', async (_name, status) => {
    const { gatewayEnv } = coordinatorHarness({ kind: 'applied', status });
    const response = await handleTextAdminRequest(adminRequest(), gatewayEnv, DEPENDENCIES);
    await expectFixedJson(response, 503, { ok: false, code: 'service-disabled' });
  });

  test('contains neither thrown internals nor console output for namespace and RPC failures', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const consoleSpies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const namespace = coordinatorHarness();
    namespace.getByName.mockImplementation(() => {
      throw new Error('alice@example.com namespace token account-private');
    });
    const namespaceResponse = await handleTextAdminRequest(
      adminRequest(),
      namespace.gatewayEnv,
      DEPENDENCIES,
    );
    const namespaceSerialized = await namespaceResponse.clone().text();
    await expectFixedJson(namespaceResponse, 503, { ok: false, code: 'service-disabled' });

    const rpc = coordinatorHarness();
    rpc.applyTextAdminOperation.mockRejectedValue(
      new Error('alice@example.com rpc token account-private'),
    );
    const rpcResponse = await handleTextAdminRequest(adminRequest(), rpc.gatewayEnv, DEPENDENCIES);
    const rpcSerialized = await rpcResponse.clone().text();
    await expectFixedJson(rpcResponse, 503, { ok: false, code: 'service-disabled' });

    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(namespaceSerialized).not.toContain('alice@example.com');
    expect(rpcSerialized).not.toContain('account-private');
  });

  test.each([
    ['throws', () => { throw new Error('private runtime'); }],
    ['returns NaN', () => Number.NaN],
    ['returns a fraction', () => 1.5],
    ['returns a negative value', () => -1],
    ['returns an unsafe value', () => Number.MAX_SAFE_INTEGER],
  ])('fails closed without RPC when now() %s', async (_name, now) => {
    const { gatewayEnv, applyTextAdminOperation } = coordinatorHarness();
    await expectFixedJson(
      await handleTextAdminRequest(adminRequest(), gatewayEnv, { now }),
      503,
      { ok: false, code: 'service-disabled' },
    );
    expect(applyTextAdminOperation).not.toHaveBeenCalled();
  });
});

describe('internal text admin worker route', () => {
  test('routes only the exact POST path with an empty query', async () => {
    const exact = coordinatorHarness();
    await expectFixedJson(
      await worker.fetch(adminRequest(), exact.gatewayEnv),
      200,
      { ok: true, operationId: OPERATION_ID, status: STATUS },
    );
    expect(exact.applyTextAdminOperation).toHaveBeenCalledTimes(1);

    for (const [method, url] of [
      ['GET', ADMIN_URL],
      ['PUT', ADMIN_URL],
      ['POST', `${ADMIN_URL}/`],
      ['POST', `${ADMIN_URL}?x=1`],
      ['POST', 'https://photo-ai-gateway.internal/text/admin'],
    ] as const) {
      const rejected = coordinatorHarness();
      const response = await worker.fetch(
        adminRequest(JSON.stringify(ADMIN_BODY), { method, url }),
        rejected.gatewayEnv,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'service-disabled',
        retryAt: null,
        resetAt: null,
      });
      expect(rejected.getByName).not.toHaveBeenCalled();
      expect(rejected.applyTextAdminOperation).not.toHaveBeenCalled();
    }
  });

  test('keeps malformed exact admin requests inside the admin handler', async () => {
    const { gatewayEnv, getByName } = coordinatorHarness();
    await expectFixedJson(
      await worker.fetch(
        adminRequest(JSON.stringify(ADMIN_BODY), { contentType: 'text/plain' }),
        gatewayEnv,
      ),
      400,
      { ok: false, code: 'invalid-request' },
    );
    expect(getByName).not.toHaveBeenCalled();
  });
});
