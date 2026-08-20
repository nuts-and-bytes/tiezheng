import {
  env,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

import {
  GATEWAY_LIMITS,
  PhotoAiCoordinator,
  type LeaseInput,
  type ReserveInput,
} from './coordinator';
import type { GatewayEnv } from './env';

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const ACCOUNT_C = 'c'.repeat(64);
const BASE_NOW = Date.UTC(2026, 7, 18, 4, 0, 0);

function key(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function fingerprint(index: number): string {
  return index.toString(16).padStart(64, '0');
}

function coordinator() {
  return env.PHOTO_AI_COORDINATOR.getByName('stage2');
}

async function enable(accountKeys: string[] = [ACCOUNT_A]) {
  const stub = coordinator();
  await stub.setGlobalEnabled(true);
  for (const accountKey of accountKeys) await stub.setAccountEnabled(accountKey, true);
  return stub;
}

function reserveInput(
  accountKey: string,
  index: number,
  now = BASE_NOW,
  reserveMicros: number = GATEWAY_LIMITS.initialAttemptReserveMicros,
): ReserveInput {
  return {
    accountKey,
    idempotencyKey: key(index),
    fingerprint: fingerprint(index),
    now,
    reserveMicros,
  };
}

function leaseInput(input: ReserveInput, leaseId: string, now = input.now): LeaseInput {
  return { ...input, leaseId, now };
}

async function reserveLease(input: ReserveInput): Promise<{ stub: ReturnType<typeof coordinator>; leaseId: string }> {
  const stub = coordinator();
  const result = await stub.reserve(input);
  expect(result.kind).toBe('reserved');
  if (result.kind !== 'reserved') throw new Error('expected reserved lease');
  return { stub, leaseId: result.leaseId };
}

async function consumeWithoutCost(input: ReserveInput): Promise<void> {
  const { stub, leaseId } = await reserveLease(input);
  const lease = leaseInput(input, leaseId);
  await stub.markInvoked(lease);
  await stub.settleFailure({ ...lease, actualCostMicros: 0, errorCode: 'invalid-estimate' });
}

describe('PhotoAiCoordinator', () => {
  test('starts closed for an unseen account', async () => {
    const status = await coordinator().status({ accountKey: ACCOUNT_A, now: BASE_NOW });

    expect(status.enabled).toBe(false);
    expect(status.accountEnabled).toBe(false);
    expect(status.accountRemaining).toBe(10);
    expect(status.globalRemaining).toBe(30);
    expect(status.resetAt).toBe('2026-08-18T16:00:00.000Z');
  });

  test('requires both persisted global and explicit account enablement', async () => {
    const stub = coordinator();
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 1))).kind).toBe('rejected');
    await stub.setGlobalEnabled(true);
    expect(await stub.reserve(reserveInput(ACCOUNT_A, 2))).toMatchObject({
      kind: 'rejected', code: 'service-disabled',
    });
    await stub.setAccountEnabled(ACCOUNT_A, true);
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 3))).kind).toBe('reserved');
    await stub.setAccountEnabled(ACCOUNT_A, false);
    expect(await stub.reserve(reserveInput(ACCOUNT_A, 4))).toMatchObject({
      kind: 'rejected', code: 'service-disabled',
    });
  });

  test('disables and re-enables the global gate with status reflecting each transition', async () => {
    const stub = await enable();
    await stub.setGlobalEnabled(false);
    expect(await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      enabled: false,
      accountEnabled: true,
    });
    expect(await stub.reserve(reserveInput(ACCOUNT_A, 1))).toMatchObject({
      kind: 'rejected',
      code: 'service-disabled',
    });

    await stub.setGlobalEnabled(true);
    expect(await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      enabled: true,
      accountEnabled: true,
    });
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 2))).kind).toBe('reserved');
  });

  test('allows no more than the approved three enabled beta accounts', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B, ACCOUNT_C]);
    const fourth = 'd'.repeat(64);
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.setAccountEnabled(fourth, true)).rejects.toThrow(
        'Coordinator operation rejected',
      );
      await instance.setAccountEnabled(ACCOUNT_B, true);
    });
    expect((await stub.status({ accountKey: fourth, now: BASE_NOW })).accountEnabled).toBe(false);
  });

  test('keeps two per-minute attempts even when pre-invoke work aborts', async () => {
    const stub = await enable();
    for (let index = 1; index <= 2; index += 1) {
      const input = reserveInput(ACCOUNT_A, index);
      const result = await stub.reserve(input);
      expect(result).toMatchObject({ kind: 'reserved' });
      if (result.kind !== 'reserved') throw new Error('expected reserved lease');
      await stub.abortBeforeInvoke(leaseInput(input, result.leaseId));
    }
    expect(await stub.reserve(reserveInput(ACCOUNT_A, 3))).toMatchObject({
      kind: 'rejected', code: 'rate-limited', retryAt: '2026-08-18T04:01:00.000Z',
    });
    expect((await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(10);
  });

  test('counts pending and consumed rows against the ten-request account day limit', async () => {
    await enable();
    for (let index = 1; index <= 10; index += 1) {
      await consumeWithoutCost(reserveInput(ACCOUNT_A, index, BASE_NOW + index * 60_000));
    }
    expect(await coordinator().reserve(reserveInput(ACCOUNT_A, 11, BASE_NOW + 11 * 60_000))).toMatchObject({
      kind: 'rejected', code: 'quota-exceeded', resetAt: '2026-08-18T16:00:00.000Z',
    });
  });

  test('enforces the thirty-request global day limit across the three beta accounts', async () => {
    const accounts = [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C];
    await enable(accounts);
    let operation = 1;
    for (const account of accounts) {
      for (let accountAttempt = 0; accountAttempt < 10; accountAttempt += 1) {
        await consumeWithoutCost(reserveInput(account, operation, BASE_NOW + operation * 60_000));
        operation += 1;
      }
    }
    expect(await coordinator().reserve(reserveInput(ACCOUNT_A, operation, BASE_NOW + operation * 60_000))).toMatchObject({
      kind: 'rejected', code: 'quota-exceeded', resetAt: '2026-08-18T16:00:00.000Z',
    });
  });

  test('atomically limits one account to one lease and the global object to two leases', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B, ACCOUNT_C]);
    const sameAccount = await Promise.all([
      stub.reserve(reserveInput(ACCOUNT_A, 1)),
      stub.reserve(reserveInput(ACCOUNT_A, 2)),
    ]);
    expect(sameAccount.filter((result) => result.kind === 'reserved')).toHaveLength(1);
    expect(sameAccount.filter((result) => result.kind === 'rejected')).toEqual([
      expect.objectContaining({ code: 'rate-limited' }),
    ]);

    const otherAccounts = await Promise.all([
      stub.reserve(reserveInput(ACCOUNT_B, 3)),
      stub.reserve(reserveInput(ACCOUNT_C, 4)),
    ]);
    expect(otherAccounts.filter((result) => result.kind === 'reserved')).toHaveLength(1);
    expect(otherAccounts.filter((result) => result.kind === 'rejected')).toEqual([
      expect.objectContaining({ code: 'rate-limited' }),
    ]);
  });

  test('never lets simultaneous reservations exceed the fifty-yuan monthly cap', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 1, BASE_NOW, 30_000_000))).kind).toBe('reserved');
    expect(await stub.reserve(reserveInput(ACCOUNT_B, 2, BASE_NOW, 20_000_001))).toMatchObject({
      kind: 'rejected', code: 'budget-exceeded', resetAt: '2026-08-31T16:00:00.000Z',
    });
  });

  test('never accepts less than the fixed worst-case initial provider reserve', async () => {
    const stub = await enable();
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.reserve(reserveInput(ACCOUNT_A, 1, BASE_NOW, 1))).rejects.toThrow(
        'Invalid coordinator input',
      );
      await expect(instance.reserve(reserveInput(
        ACCOUNT_A,
        2,
        BASE_NOW,
        GATEWAY_LIMITS.initialAttemptReserveMicros - 1,
      ))).rejects.toThrow('Invalid coordinator input');
    });
  });

  test('rejects safe-integer timestamps that cannot support every derived date window', async () => {
    const stub = await enable();
    const dateLimit = 8_640_000_000_000_000;
    await runInDurableObject(stub, async (instance) => {
      for (const now of [dateLimit, dateLimit - 8 * 60 * 60_000, dateLimit - 86_400_000]) {
        await expect(instance.status({ accountKey: ACCOUNT_A, now })).rejects.toThrow(
          'Invalid coordinator input',
        );
        await expect(instance.reserve(reserveInput(ACCOUNT_A, 90, now))).rejects.toThrow(
          'Invalid coordinator input',
        );
      }
    });
  });

  test('fails closed when the monthly budget configuration is missing or invalid', async () => {
    const stub = await enable();
    await runInDurableObject(stub, async (_instance, state) => {
      const invalidEnv = {
        ...env,
        PHOTO_AI_MONTHLY_BUDGET_MICROS: 'not-a-budget',
      } as GatewayEnv;
      const reloaded = new PhotoAiCoordinator(state, invalidEnv);
      await expect(reloaded.reserve(reserveInput(ACCOUNT_A, 1))).resolves.toMatchObject({
        kind: 'rejected',
        code: 'budget-exceeded',
      });
    });
  });

  test('moves pending quota to consumed on invocation and releases only pre-invoke reservations', async () => {
    const stub = await enable();
    const first = reserveInput(ACCOUNT_A, 1);
    const firstResult = await stub.reserve(first);
    if (firstResult.kind !== 'reserved') throw new Error('expected reserved lease');
    expect((await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(9);
    await stub.abortBeforeInvoke(leaseInput(first, firstResult.leaseId));
    expect((await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(10);

    const second = reserveInput(ACCOUNT_A, 2);
    const secondResult = await stub.reserve(second);
    if (secondResult.kind !== 'reserved') throw new Error('expected reserved lease');
    const invoked = leaseInput(second, secondResult.leaseId);
    await stub.markInvoked(invoked);
    await stub.settleFailure({ ...invoked, actualCostMicros: 0, errorCode: 'invalid-estimate' });
    expect((await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(9);
  });

  test('settles known cost exactly and unknown usage at the full reserved amount', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    const first = reserveInput(ACCOUNT_A, 1);
    const firstResult = await stub.reserve(first);
    if (firstResult.kind !== 'reserved') throw new Error('expected lease');
    const firstLease = leaseInput(first, firstResult.leaseId);
    await stub.markInvoked(firstLease);
    await stub.settleFailure({ ...firstLease, actualCostMicros: 123_456, errorCode: 'provider-unavailable' });

    const second = reserveInput(ACCOUNT_B, 2);
    const secondResult = await stub.reserve(second);
    if (secondResult.kind !== 'reserved') throw new Error('expected lease');
    const secondLease = leaseInput(second, secondResult.leaseId);
    await stub.markInvoked(secondLease);
    await stub.settleFailure({ ...secondLease, actualCostMicros: null, errorCode: 'provider-timeout' });

    const status = await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW });
    expect(status.budgetSpentMicros).toBe(2_123_456);
    expect(status.budgetReservedMicros).toBe(0);
  });

  test('reserves one retry cost without consuming another logical request', async () => {
    const stub = await enable();
    const input = reserveInput(ACCOUNT_A, 1);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected lease');
    const lease = leaseInput(input, result.leaseId);
    await stub.markInvoked(lease);
    await stub.reserveRetryCost(lease);
    expect(await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountRemaining: 9,
      budgetReservedMicros: 4_000_000,
    });
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.reserveRetryCost(lease)).rejects.toThrow('Coordinator operation rejected');
    });
    await stub.settleSuccess({
      ...lease,
      actualCostMicros: 3_000_000,
      cache: { ivBase64: 'aXY=', ciphertextBase64: 'Y2lwaGVy', expiresAt: BASE_NOW + 600_000 },
    });
    expect(await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountRemaining: 9,
      budgetSpentMicros: 3_000_000,
      budgetReservedMicros: 0,
    });
  });

  test('returns in-flight, conflict, isolated-account and encrypted cached idempotency states', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    const input = reserveInput(ACCOUNT_A, 1);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected lease');
    expect(await stub.reserve(input)).toMatchObject({ kind: 'in-flight' });
    expect(await stub.reserve({ ...input, fingerprint: fingerprint(2) })).toMatchObject({
      kind: 'rejected', code: 'idempotency-conflict',
    });
    expect((await stub.reserve({ ...input, accountKey: ACCOUNT_B })).kind).toBe('reserved');

    const lease = leaseInput(input, result.leaseId);
    await stub.markInvoked(lease);
    const cache = { ivBase64: 'aXY=', ciphertextBase64: 'Y2lwaGVy', expiresAt: BASE_NOW + 600_000 };
    await stub.settleSuccess({ ...lease, actualCostMicros: 1, cache });
    expect(await stub.reserve({ ...input, now: BASE_NOW + 1 })).toEqual({ kind: 'cached', cache });
    expect(await stub.reserve({ ...input, now: BASE_NOW + 600_001 })).toMatchObject({
      kind: 'rejected',
      code: 'idempotency-conflict',
      resetAt: '2026-08-19T04:00:00.000Z',
    });
    expect((await stub.reserve({ ...input, now: BASE_NOW + 86_400_001 })).kind).toBe('reserved');
  });

  test('reopens pre-invoke work but replays invoked terminal failures without false in-flight state', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);

    const aborted = reserveInput(ACCOUNT_A, 1);
    const abortedResult = await stub.reserve(aborted);
    if (abortedResult.kind !== 'reserved') throw new Error('expected lease');
    await stub.abortBeforeInvoke(leaseInput(aborted, abortedResult.leaseId));
    const reopened = await stub.reserve({ ...aborted, now: BASE_NOW + 60_000 });
    expect(reopened.kind).toBe('reserved');
    if (reopened.kind !== 'reserved') throw new Error('expected reopened lease');
    await stub.abortBeforeInvoke(leaseInput(aborted, reopened.leaseId, BASE_NOW + 60_000));

    const failed = reserveInput(ACCOUNT_A, 2, BASE_NOW + 120_000);
    const failedResult = await stub.reserve(failed);
    if (failedResult.kind !== 'reserved') throw new Error('expected lease');
    const failedLease = leaseInput(failed, failedResult.leaseId);
    await stub.markInvoked(failedLease);
    await stub.settleFailure({
      ...failedLease,
      actualCostMicros: 1,
      errorCode: 'provider-unavailable',
    });
    expect(await stub.reserve({ ...failed, now: failed.now + 1 })).toEqual({
      kind: 'failed',
      code: 'provider-unavailable',
    });

    const expired = reserveInput(ACCOUNT_B, 3, BASE_NOW + 180_000);
    const expiredResult = await stub.reserve(expired);
    if (expiredResult.kind !== 'reserved') throw new Error('expected lease');
    await stub.markInvoked(leaseInput(expired, expiredResult.leaseId));
    expect(await stub.reserve({ ...expired, now: expired.now + GATEWAY_LIMITS.leaseMs + 1 })).toEqual({
      kind: 'failed',
      code: 'provider-timeout',
    });
  });

  test('persists only reserved, invoked, succeeded and failed idempotency states', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    const succeeded = reserveInput(ACCOUNT_A, 1);
    const succeededResult = await stub.reserve(succeeded);
    if (succeededResult.kind !== 'reserved') throw new Error('expected lease');
    const succeededLease = leaseInput(succeeded, succeededResult.leaseId);
    await stub.markInvoked(succeededLease);
    await stub.settleSuccess({
      ...succeededLease,
      actualCostMicros: 1,
      cache: { ivBase64: 'aXY=', ciphertextBase64: 'Y2lwaGVy', expiresAt: BASE_NOW + 600_000 },
    });

    const failed = reserveInput(ACCOUNT_B, 2);
    const failedResult = await stub.reserve(failed);
    if (failedResult.kind !== 'reserved') throw new Error('expected lease');
    const failedLease = leaseInput(failed, failedResult.leaseId);
    await stub.markInvoked(failedLease);
    await stub.settleFailure({ ...failedLease, actualCostMicros: 1, errorCode: 'invalid-estimate' });

    await runInDurableObject(stub, async (_instance, state) => {
      const states = state.storage.sql.exec<{ state: string }>(
        'SELECT DISTINCT state FROM idempotency ORDER BY state',
      ).toArray().map((row) => row.state);
      expect(states).toEqual(['failed', 'succeeded']);
    });
  });

  test('expires leases by releasing pre-invoke work and conservatively spending invoked work', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    const pre = reserveInput(ACCOUNT_A, 1);
    expect((await stub.reserve(pre)).kind).toBe('reserved');
    let status = await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW + 60_001 });
    expect(status).toMatchObject({ accountRemaining: 10, accountConcurrent: 0, budgetReservedMicros: 0 });

    const invokedInput = reserveInput(ACCOUNT_B, 2, BASE_NOW + 60_001);
    const invokedResult = await stub.reserve(invokedInput);
    if (invokedResult.kind !== 'reserved') throw new Error('expected lease');
    await stub.markInvoked(leaseInput(invokedInput, invokedResult.leaseId));
    status = await stub.status({ accountKey: ACCOUNT_B, now: BASE_NOW + 120_002 });
    expect(status).toMatchObject({
      accountRemaining: 9,
      accountConcurrent: 0,
      budgetSpentMicros: 2_000_000,
      budgetReservedMicros: 0,
    });
  });

  test('uses exact Shanghai leap-day, UTC day boundary and month reset buckets', async () => {
    const stub = await enable();
    const beforeMidnight = Date.UTC(2028, 1, 29, 15, 59);
    const input = reserveInput(ACCOUNT_A, 1, beforeMidnight);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected lease');
    const lease = leaseInput(input, result.leaseId);
    await stub.markInvoked(lease);
    await stub.settleFailure({ ...lease, actualCostMicros: 123, errorCode: 'invalid-estimate' });
    expect(await stub.status({ accountKey: ACCOUNT_A, now: beforeMidnight })).toMatchObject({
      accountRemaining: 9,
      budgetSpentMicros: 123,
      resetAt: '2028-02-29T16:00:00.000Z',
    });
    const nextDay = Date.UTC(2028, 1, 29, 16, 0);
    expect(await stub.status({ accountKey: ACCOUNT_A, now: nextDay })).toMatchObject({
      accountRemaining: 10,
      resetAt: '2028-03-01T16:00:00.000Z',
      budgetSpentMicros: 0,
    });
  });

  test('persists counters and idempotency when a fresh class instance is created over the same storage', async () => {
    const stub = await enable();
    const input = reserveInput(ACCOUNT_A, 1);
    expect((await stub.reserve(input)).kind).toBe('reserved');

    await runInDurableObject(stub, async (instance) => {
      expect(instance).toBeInstanceOf(PhotoAiCoordinator);
    });
    await runInDurableObject(stub, async (_instance, state) => {
      const reloaded = new PhotoAiCoordinator(state, env);
      expect(await reloaded.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
        enabled: true,
        accountEnabled: true,
        accountRemaining: 9,
        accountConcurrent: 1,
      });
      expect(await reloaded.reserve(input)).toMatchObject({ kind: 'in-flight' });
    });
  });

  test('deletes one account state without deleting global consumed usage', async () => {
    const stub = await enable([ACCOUNT_A, ACCOUNT_B]);
    await consumeWithoutCost(reserveInput(ACCOUNT_A, 1));
    await stub.deleteAccount(ACCOUNT_A);
    expect(await stub.status({ accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountEnabled: false,
      accountRemaining: 10,
      globalRemaining: 29,
    });
    await stub.setAccountEnabled(ACCOUNT_A, true);
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 1, BASE_NOW + 60_000))).kind).toBe('reserved');
  });

  test('stores only operational hashes, counters, ciphertext and fixed error codes in SQLite', async () => {
    const stub = await enable();
    const input = reserveInput(ACCOUNT_A, 1);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected lease');
    await runInDurableObject(stub, async (_instance, state) => {
      const schema = state.storage.sql.exec<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).toArray().map((row) => row.sql ?? '').join('\n').toLowerCase();
      expect(schema).toContain('idempotency');
      expect(schema).toContain('daily_counters');
      expect(schema).toContain('minute_counters');
      expect(schema).toContain('active_leases');
      expect(schema).toContain('account_flags');
      expect(schema).toContain('settings');
      expect(schema).not.toMatch(/email|ip_address|image|base64|food|weight|meal|date_slot|health_target/);
      const persisted = state.storage.sql.exec<{ value: string }>(
        `SELECT account_key AS value FROM account_flags
         UNION ALL SELECT account_key FROM idempotency
         UNION ALL SELECT fingerprint FROM idempotency`,
      ).toArray().map((row) => row.value);
      expect(persisted).toEqual(expect.arrayContaining([ACCOUNT_A, fingerprint(1)]));
      expect(persisted.join('\n')).not.toContain('@');
    });
  });
});
