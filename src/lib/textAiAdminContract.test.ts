import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  TEXT_AI_ADMIN_SCHEMA_VERSION,
  parseTextAiAdminRequest,
  parseTextAiAdminResponse,
  parseTextAiAdminWorkerRequest,
  type TextAiAdminOperation,
  type TextAiAdminRequest,
  type TextAiAdminResponse,
  type TextAiAdminStatus,
  type TextAiAdminTarget,
  type TextAiAdminWorkerRequest,
} from './textAiAdminContract';

const INVALID_CONTRACT = 'Invalid text admin contract';
const OPERATION_ID = '1'.repeat(32);
const ACCOUNT_KEY = 'a'.repeat(64);
const RESET_AT = '2026-08-25T00:00:00.000Z';

const OPERATIONS = [
  'status',
  'enable-text-global',
  'disable-text-global',
  'enable-account',
  'disable-account',
  'delete-account',
] as const satisfies readonly TextAiAdminOperation[];

const FAILURE_CODES = [
  'auth-required',
  'invalid-request',
  'operation-conflict',
  'service-disabled',
] as const;

function adminRequest(
  operation: TextAiAdminOperation = 'status',
): TextAiAdminRequest {
  return {
    schemaVersion: 1,
    operationId: OPERATION_ID,
    operation,
    target: 'user-1',
  };
}

function workerRequest(
  operation: TextAiAdminOperation = 'status',
): TextAiAdminWorkerRequest {
  return {
    schemaVersion: 1,
    operationId: OPERATION_ID,
    operation,
    accountKey: ACCOUNT_KEY,
  };
}

function adminStatus(): TextAiAdminStatus {
  return {
    textGlobalEnabled: false,
    accountEnabled: false,
    accountRemaining: 10,
    globalRemaining: 30,
    budgetSpentMicros: 0,
    budgetReservedMicros: 0,
    resetAt: RESET_AT,
  };
}

function successResponse(): Extract<TextAiAdminResponse, { ok: true }> {
  return {
    ok: true,
    operationId: OPERATION_ID,
    status: adminStatus(),
  };
}

function expectInvalid(
  parser: (value: unknown) => unknown,
  value: unknown,
): void {
  let caught: unknown;
  try {
    parser(value);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({ message: INVALID_CONTRACT });
}

function withoutKey(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function withNullPrototype<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}

describe('fixed text AI admin contract', () => {
  test('exports schema version one and the exact public types', () => {
    expect(TEXT_AI_ADMIN_SCHEMA_VERSION).toBe(1);
    expectTypeOf<TextAiAdminOperation>().toEqualTypeOf<
      | 'status'
      | 'enable-text-global'
      | 'disable-text-global'
      | 'enable-account'
      | 'disable-account'
      | 'delete-account'
    >();
    expectTypeOf<TextAiAdminRequest>().toEqualTypeOf<{
      schemaVersion: 1;
      operationId: string;
      operation: TextAiAdminOperation;
      target: TextAiAdminTarget;
    }>();
    expectTypeOf<TextAiAdminTarget>().toEqualTypeOf<'user-1' | 'user-2'>();
    expectTypeOf<TextAiAdminWorkerRequest>().toEqualTypeOf<{
      schemaVersion: 1;
      operationId: string;
      operation: TextAiAdminOperation;
      accountKey: string;
    }>();
    expectTypeOf<TextAiAdminStatus>().toEqualTypeOf<{
      textGlobalEnabled: boolean;
      accountEnabled: boolean;
      accountRemaining: number;
      globalRemaining: number;
      budgetSpentMicros: number;
      budgetReservedMicros: number;
      resetAt: string;
    }>();
    expectTypeOf<TextAiAdminResponse>().toEqualTypeOf<
      | { ok: true; operationId: string; status: TextAiAdminStatus }
      | {
        ok: false;
        code:
          | 'auth-required'
          | 'invalid-request'
          | 'operation-conflict'
          | 'service-disabled';
      }
    >();
  });
});

describe('parseTextAiAdminRequest', () => {
  test.each(OPERATIONS)('accepts and preserves operation %s', (operation) => {
    const input = adminRequest(operation);
    const parsed = parseTextAiAdminRequest(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.operation).toBe(operation);
    expect(parsed.target).toBe('user-1');
  });

  test.each(OPERATIONS)('requires a target slot for operation %s', (operation) => {
    expectInvalid(
      parseTextAiAdminRequest,
      withoutKey(adminRequest(operation) as unknown as Record<string, unknown>, 'target'),
    );
  });

  test.each([
    'ABC',
    '1'.repeat(31),
    '1'.repeat(33),
    `${'1'.repeat(31)}G`,
  ])('rejects non-canonical operation id %j', (operationId) => {
    expectInvalid(parseTextAiAdminRequest, { ...adminRequest(), operationId });
  });

  test.each([
    'USER-1',
    ' user-1',
    'user-1 ',
    'user-3',
    'user-01',
    'alice@example.com',
    '',
  ])('rejects non-canonical target slot %j', (target) => {
    expectInvalid(parseTextAiAdminRequest, { ...adminRequest(), target });
  });

  test.each(['user-1', 'user-2'] as const)('accepts exact target slot %s', (target) => {
    expect(parseTextAiAdminRequest({ ...adminRequest(), target }).target).toBe(target);
  });

  test.each([
    { ...adminRequest(), schemaVersion: 2 },
    { ...adminRequest(), schemaVersion: '1' },
    { ...adminRequest(), operation: 'enable-photo-global' },
    { ...adminRequest(), extra: true },
    withoutKey(adminRequest() as unknown as Record<string, unknown>, 'operation'),
  ])('rejects a wrong version, operation, extra key, or missing key %#', (value) => {
    expectInvalid(parseTextAiAdminRequest, value);
  });
});

describe('parseTextAiAdminWorkerRequest', () => {
  test.each(OPERATIONS)('accepts and preserves operation %s with account key', (operation) => {
    const input = workerRequest(operation);
    const parsed = parseTextAiAdminWorkerRequest(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.operation).toBe(operation);
    expect(parsed.accountKey).toBe(ACCOUNT_KEY);
    expect(parsed).not.toHaveProperty('target');
  });

  test.each(OPERATIONS)('requires an account key for operation %s', (operation) => {
    expectInvalid(
      parseTextAiAdminWorkerRequest,
      withoutKey(workerRequest(operation) as unknown as Record<string, unknown>, 'accountKey'),
    );
  });

  test.each([
    'ABC',
    '1'.repeat(31),
    '1'.repeat(33),
    `${'1'.repeat(31)}G`,
  ])('rejects non-canonical operation id %j', (operationId) => {
    expectInvalid(parseTextAiAdminWorkerRequest, {
      ...workerRequest(),
      operationId,
    });
  });

  test.each([
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    `${'a'.repeat(63)}g`,
  ])('rejects non-canonical account key %j', (accountKey) => {
    expectInvalid(parseTextAiAdminWorkerRequest, {
      ...workerRequest(),
      accountKey,
    });
  });

  test.each([
    { ...workerRequest(), schemaVersion: 2 },
    { ...workerRequest(), schemaVersion: '1' },
    { ...workerRequest(), operation: 'enable-photo-global' },
    { ...workerRequest(), target: 'user-1' },
    { ...workerRequest(), extra: true },
    withoutKey(workerRequest() as unknown as Record<string, unknown>, 'operation'),
  ])('rejects wrong version, operation, browser boundary, or key set %#', (value) => {
    expectInvalid(parseTextAiAdminWorkerRequest, value);
  });
});

describe('parseTextAiAdminResponse', () => {
  test('accepts, detaches, and safely serializes a success response', () => {
    const input = successResponse();
    const parsed = parseTextAiAdminResponse(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected success response');
    expect(parsed.status).not.toBe(input.status);
    input.status.accountRemaining = 0;
    expect(parsed.status.accountRemaining).toBe(10);
    expect(JSON.stringify(parsed)).not.toContain('@');
  });

  test.each(FAILURE_CODES)('accepts only the fixed failure code %s', (code) => {
    const input = { ok: false as const, code };
    const parsed = parseTextAiAdminResponse(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
  });

  test.each([
    { ...successResponse(), operationId: 'ABC' },
    { ...successResponse(), operationId: '1'.repeat(31) },
    { ...successResponse(), operationId: 'A'.repeat(32) },
    { ...successResponse(), schemaVersion: 1 },
    { ...successResponse(), extra: true },
    withoutKey(successResponse() as unknown as Record<string, unknown>, 'status'),
  ])('rejects a malformed success envelope %#', (value) => {
    expectInvalid(parseTextAiAdminResponse, value);
  });

  test.each([
    ['textGlobalEnabled', 0],
    ['accountEnabled', 'false'],
    ['accountRemaining', Number.NaN],
    ['accountRemaining', Number.POSITIVE_INFINITY],
    ['accountRemaining', -1],
    ['accountRemaining', -0],
    ['accountRemaining', 1.5],
    ['accountRemaining', 11],
    ['globalRemaining', Number.NaN],
    ['globalRemaining', Number.NEGATIVE_INFINITY],
    ['globalRemaining', -1],
    ['globalRemaining', -0],
    ['globalRemaining', 1.5],
    ['globalRemaining', 31],
    ['budgetSpentMicros', Number.NaN],
    ['budgetSpentMicros', Number.POSITIVE_INFINITY],
    ['budgetSpentMicros', -1],
    ['budgetSpentMicros', -0],
    ['budgetSpentMicros', 0.5],
    ['budgetSpentMicros', Number.MAX_SAFE_INTEGER + 1],
    ['budgetReservedMicros', Number.NaN],
    ['budgetReservedMicros', Number.NEGATIVE_INFINITY],
    ['budgetReservedMicros', -1],
    ['budgetReservedMicros', -0],
    ['budgetReservedMicros', 0.5],
    ['budgetReservedMicros', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid status field %s=%j', (field, value) => {
    expectInvalid(parseTextAiAdminResponse, {
      ...successResponse(),
      status: { ...adminStatus(), [field]: value },
    });
  });

  test.each([
    '2026-08-25T00:00:00Z',
    '2026-08-25T00:00:00.000+00:00',
    '2026-08-25',
    '2026-02-30T00:00:00.000Z',
    'not-a-date',
    new Date(RESET_AT),
    null,
  ])('rejects a non-canonical resetAt %#', (resetAt) => {
    expectInvalid(parseTextAiAdminResponse, {
      ...successResponse(),
      status: { ...adminStatus(), resetAt },
    });
  });

  test('rejects every missing or extra status key', () => {
    for (const key of Object.keys(adminStatus())) {
      expectInvalid(parseTextAiAdminResponse, {
        ...successResponse(),
        status: withoutKey(
          adminStatus() as unknown as Record<string, unknown>,
          key,
        ),
      });
    }
    expectInvalid(parseTextAiAdminResponse, {
      ...successResponse(),
      status: { ...adminStatus(), extra: true },
    });
  });

  test.each([
    { ok: false, code: 'unknown' },
    { ok: false, code: 'auth-required', operationId: OPERATION_ID },
    { ok: false, code: 'auth-required', extra: true },
    { ok: false },
    { code: 'auth-required' },
  ])('rejects a malformed failure envelope %#', (value) => {
    expectInvalid(parseTextAiAdminResponse, value);
  });
});

type ParserCase = readonly [
  string,
  (value: unknown) => unknown,
  () => Record<string, unknown>,
  string,
];

const PARSER_CASES: readonly ParserCase[] = [
  [
    'browser request',
    parseTextAiAdminRequest,
    () => adminRequest() as unknown as Record<string, unknown>,
    'target',
  ],
  [
    'worker request',
    parseTextAiAdminWorkerRequest,
    () => workerRequest() as unknown as Record<string, unknown>,
    'accountKey',
  ],
  [
    'response',
    parseTextAiAdminResponse,
    () => successResponse() as unknown as Record<string, unknown>,
    'status',
  ],
];

describe('descriptor-safe plain-data boundary', () => {
  test.each(PARSER_CASES)('%s accepts an exact null-prototype object', (
    _name,
    parser,
    makeValid,
  ) => {
    const valid = makeValid();
    expect(parser(withNullPrototype(valid))).toEqual(valid);
  });

  test('accepts a null-prototype nested status object', () => {
    expect(parseTextAiAdminResponse({
      ...successResponse(),
      status: withNullPrototype(adminStatus()),
    })).toEqual(successResponse());
  });

  test.each(PARSER_CASES)('%s reads descriptor snapshots, not properties', (
    _name,
    parser,
    makeValid,
  ) => {
    const valid = makeValid();
    const proxy = new Proxy(valid, {
      get() {
        throw new Error('property read must not happen');
      },
    });

    expect(parser(proxy)).toEqual(valid);
  });

  test('reads a nested status descriptor snapshot, not status properties', () => {
    const status = adminStatus();
    const proxy = new Proxy(status, {
      get() {
        throw new Error('nested property read must not happen');
      },
    });

    expect(parseTextAiAdminResponse({
      ...successResponse(),
      status: proxy,
    })).toEqual(successResponse());
  });

  test.each(PARSER_CASES)('%s rejects an accessor without invoking it', (
    _name,
    parser,
    makeValid,
    accessorKey,
  ) => {
    const value = makeValid();
    let getterCalls = 0;
    Object.defineProperty(value, accessorKey, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'secret@example.com';
      },
    });

    expectInvalid(parser, value);
    expect(getterCalls).toBe(0);
  });

  test('rejects a nested status accessor without invoking it', () => {
    const status = adminStatus();
    let getterCalls = 0;
    Object.defineProperty(status, 'accountRemaining', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 10;
      },
    });

    expectInvalid(parseTextAiAdminResponse, { ...successResponse(), status });
    expect(getterCalls).toBe(0);
  });

  test.each(PARSER_CASES)('%s rejects symbols and non-plain values', (
    _name,
    parser,
    makeValid,
  ) => {
    const valid = makeValid();
    const symbolDecorated = { ...valid, [Symbol('hidden')]: true };
    const customPrototype = Object.assign(Object.create({ inherited: true }), valid);
    class Payload {}
    const classInstance = Object.assign(new Payload(), valid);

    for (const value of [
      symbolDecorated,
      customPrototype,
      classInstance,
      [],
      null,
      new Date(),
    ]) {
      expectInvalid(parser, value);
    }
  });

  test.each(PARSER_CASES)('%s normalizes reflection errors without leaking input', (
    _name,
    parser,
    makeValid,
  ) => {
    const proxy = new Proxy(makeValid(), {
      ownKeys() {
        throw new Error('alice@example.com internal diagnostic');
      },
    });

    expectInvalid(parser, proxy);
  });
});
