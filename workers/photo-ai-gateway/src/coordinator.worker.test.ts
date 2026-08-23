import {
  env,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';

import {
  GATEWAY_LIMITS,
  PhotoAiCoordinator,
  arkCostMicros,
  ensureCoordinatorSchema,
  type LeaseInput,
  type ReserveInput,
} from './coordinator';
import type { GatewayEnv } from './env';
import { GATEWAY_CHANNEL_POLICY, type AiChannel } from './gatewayPolicy';
import worker from './index';

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
    channel: 'photo',
    accountKey,
    idempotencyKey: key(index),
    fingerprint: fingerprint(index),
    now,
    reserveMicros,
  };
}

function channelReserveInput(
  channel: AiChannel,
  accountKey: string,
  index: number,
  now = BASE_NOW,
  reserveMicros: number = GATEWAY_CHANNEL_POLICY[channel].initialAttemptReserveMicros,
): ReserveInput & { channel: AiChannel } {
  return {
    channel,
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

describe('arkCostMicros', () => {
  test('uses the exact approved integer micro-yuan formula', () => {
    expect(arkCostMicros(100, 20)).toBe(1_200);
    expect(arkCostMicros(256_000, 1_500)).toBe(1_581_000);
  });

  test.each([
    [-1, 0],
    [0, -1],
    [0.5, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
    [Number.MAX_SAFE_INTEGER, 0],
  ])('rejects unsafe token counts or an unsafe result', (inputTokens, outputTokens) => {
    expect(() => arkCostMicros(inputTokens, outputTokens)).toThrow('Invalid coordinator input');
  });
});

describe('private gateway entrypoint', () => {
  test('loads text gateway vars in their fixed default-closed state', () => {
    expect((env as GatewayEnv).TEXT_AI_GATEWAY_ENABLED).toBe('false');
    expect((env as GatewayEnv).TEXT_AI_MODEL).toBe('doubao-seed-2-1-pro-260628');
  });

  test('serves the exact coordinator session through the private route', async () => {
    const stub = await enable();
    const gatewayEnv = {
      ...env,
      PHOTO_AI_GATEWAY_ENABLED: 'true',
      ARK_API_KEY: 'test-ark-key',
      PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    } as GatewayEnv;

    const response = await worker.fetch(
      new Request('https://photo-ai-gateway.internal/session', {
        headers: { 'x-tiezheng-account-key': ACCOUNT_A },
      }),
      gatewayEnv,
    );
    const expected = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: Date.now() });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({
      ok: true,
      enabled: true,
      accountRemaining: expected.accountRemaining,
      globalRemaining: expected.globalRemaining,
      resetAt: expected.resetAt,
    });
  });

  test('serves the exact text session route through text configuration and status', async () => {
    const stub = await enable();
    await stub.setTextGlobalEnabled(true);
    const gatewayEnv = {
      ...env,
      TEXT_AI_GATEWAY_ENABLED: 'true',
      ARK_API_KEY: 'test-ark-key',
      PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    } as GatewayEnv;

    const response = await worker.fetch(
      new Request('https://photo-ai-gateway.internal/text/session', {
        headers: { 'x-tiezheng-account-key': ACCOUNT_A },
      }),
      gatewayEnv,
    );
    const expected = await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: Date.now() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      enabled: true,
      accountRemaining: expected.accountRemaining,
      globalRemaining: expected.globalRemaining,
      resetAt: expected.resetAt,
    });
  });

  test('routes only the exact text estimate method, path and empty query', async () => {
    const gatewayEnv = {
      ...env,
      TEXT_AI_GATEWAY_ENABLED: 'true',
      ARK_API_KEY: 'test-ark-key',
      PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    } as GatewayEnv;
    const exact = await worker.fetch(new Request(
      'https://photo-ai-gateway.internal/text/estimate',
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-tiezheng-account-key': ACCOUNT_A,
        },
        body: '{}',
      },
    ), gatewayEnv);
    expect(exact.status).toBe(502);
    expect(await exact.json()).toMatchObject({ ok: false, code: 'invalid-estimate' });

    for (const [method, url] of [
      ['GET', 'https://photo-ai-gateway.internal/text/estimate'],
      ['POST', 'https://photo-ai-gateway.internal/text/estimate?x=1'],
      ['POST', 'https://photo-ai-gateway.internal/text/session'],
      ['GET', 'https://photo-ai-gateway.internal/text/session?resume=1'],
    ] as const) {
      const response = await worker.fetch(new Request(url, {
        method,
        body: method === 'POST' ? '{}' : undefined,
      }), gatewayEnv);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, code: 'service-disabled' });
    }
  });

  test('rejects an incomplete estimate configuration before touching the coordinator', async () => {
    const getByName = vi.fn();
    const response = await worker.fetch(
      new Request('https://photo-ai-gateway.internal/session', {
        headers: { 'x-tiezheng-account-key': ACCOUNT_A },
      }),
      {
        ...env,
        PHOTO_AI_GATEWAY_ENABLED: 'true',
        ARK_API_KEY: 'test-ark-key',
        PHOTO_AI_CACHE_AES_KEY: 'not-a-canonical-key',
        PHOTO_AI_COORDINATOR: { getByName } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
      } as GatewayEnv,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(getByName).not.toHaveBeenCalled();
  });

  test('routes the default fetch through the fail-closed handler', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.invalid/', { method: 'POST', body: 'private-image' }),
      env as GatewayEnv,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('PhotoAiCoordinator', () => {
  test('keeps photo and text daily quota independent while sharing active concurrency and monthly budget', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const photoInput = channelReserveInput('photo', ACCOUNT_A, 1);
    const result = await stub.reserve(photoInput);
    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') throw new Error('expected reserved lease');
    await stub.markInvoked(leaseInput(photoInput, result.leaseId));

    const photo = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW });
    const text = await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW });
    expect(photo.accountRemaining).toBe(9);
    expect(photo.globalRemaining).toBe(29);
    expect(text.accountRemaining).toBe(10);
    expect(text.globalRemaining).toBe(30);
    expect(text.accountConcurrent).toBe(1);
    expect(text.globalConcurrent).toBe(1);
    expect(text.budgetReservedMicros).toBe(2_000_000);
  });

  test('charges photo and text daily quota independently while accumulating both actual costs in one monthly budget', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);

    const photoInput = channelReserveInput('photo', ACCOUNT_A, 21);
    const photoResult = await stub.reserve(photoInput);
    expect(photoResult.kind).toBe('reserved');
    if (photoResult.kind !== 'reserved') throw new Error('expected photo lease');
    const photoLease = leaseInput(photoInput, photoResult.leaseId);
    await stub.markInvoked(photoLease);
    await stub.settleFailure({
      ...photoLease,
      actualCostMicros: 123_456,
      errorCode: 'invalid-estimate',
    });

    const textInput = channelReserveInput('text', ACCOUNT_A, 22);
    const textResult = await stub.reserve(textInput);
    expect(textResult.kind).toBe('reserved');
    if (textResult.kind !== 'reserved') throw new Error('expected text lease');
    const textLease = leaseInput(textInput, textResult.leaseId);
    await stub.markInvoked(textLease);
    await stub.settleFailure({
      ...textLease,
      actualCostMicros: 321_000,
      errorCode: 'uncertain-food',
    });

    const photo = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW });
    const text = await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW });
    expect(photo).toMatchObject({
      accountRemaining: 9,
      globalRemaining: 29,
      budgetSpentMicros: 444_456,
      budgetReservedMicros: 0,
    });
    expect(text).toMatchObject({
      accountRemaining: 9,
      globalRemaining: 29,
      budgetSpentMicros: 444_456,
      budgetReservedMicros: 0,
    });
  });

  test('starts text closed separately and enables it without changing the photo global gate', async () => {
    const stub = coordinator();
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setGlobalEnabled(true);
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ enabled: true, accountEnabled: true });
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ enabled: false, accountEnabled: true });
    expect(await stub.reserve(channelReserveInput('text', ACCOUNT_A, 1))).toMatchObject({
      kind: 'rejected',
      code: 'service-disabled',
    });
    await stub.setTextGlobalEnabled(true);
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ enabled: true, accountEnabled: true });
    expect((await stub.reserve(channelReserveInput('text', ACCOUNT_A, 2))).kind).toBe('reserved');
  });

  test('namespaces raw idempotency keys so equal keys are independent across channels', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setAccountEnabled(ACCOUNT_B, true);
    const photo = channelReserveInput('photo', ACCOUNT_A, 7);
    const text = channelReserveInput('text', ACCOUNT_B, 7);
    const [photoResult, textResult] = await Promise.all([stub.reserve(photo), stub.reserve(text)]);
    expect(photoResult.kind).toBe('reserved');
    expect(textResult.kind).toBe('reserved');
    expect(await stub.reserve(photo)).toMatchObject({ kind: 'in-flight' });
    expect(await stub.reserve(text)).toMatchObject({ kind: 'in-flight' });
    await runInDurableObject(stub, async (_instance, state) => {
      const keys = state.storage.sql.exec<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM idempotency ORDER BY idempotency_key',
      ).toArray().map((row) => row.idempotency_key);
      expect(keys).toEqual([`photo:${key(7)}`, `text:${key(7)}`]);
    });
  });

  test('keeps equal raw idempotency keys independent for the same account after photo settles', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const photo = channelReserveInput('photo', ACCOUNT_A, 8);
    const photoResult = await stub.reserve(photo);
    if (photoResult.kind !== 'reserved') throw new Error('expected photo lease');
    const photoLease = leaseInput(photo, photoResult.leaseId);
    await stub.markInvoked(photoLease);
    await stub.settleFailure({ ...photoLease, actualCostMicros: 0, errorCode: 'invalid-estimate' });

    const text = channelReserveInput('text', ACCOUNT_A, 8, BASE_NOW + 1);
    expect((await stub.reserve(text)).kind).toBe('reserved');
    expect(await stub.reserve({ ...photo, now: BASE_NOW + 1 })).toEqual({
      kind: 'failed',
      code: 'invalid-estimate',
    });
  });

  test('applies separate per-minute scopes while sharing account and global active limits', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setAccountEnabled(ACCOUNT_B, true);
    await stub.setAccountEnabled(ACCOUNT_C, true);

    for (const channel of ['photo', 'text'] as const) {
      for (let index = 1; index <= 2; index += 1) {
        const input = channelReserveInput(channel, ACCOUNT_A, channel === 'photo' ? index : index + 10);
        const result = await stub.reserve(input);
        if (result.kind !== 'reserved') throw new Error(`expected ${channel} lease`);
        await stub.abortBeforeInvoke(leaseInput(input, result.leaseId));
      }
      expect(await stub.reserve(channelReserveInput(
        channel,
        ACCOUNT_A,
        channel === 'photo' ? 3 : 13,
      ))).toMatchObject({ kind: 'rejected', code: 'rate-limited' });
    }

    const later = BASE_NOW + 60_000;
    const photo = channelReserveInput('photo', ACCOUNT_A, 20, later);
    const photoResult = await stub.reserve(photo);
    if (photoResult.kind !== 'reserved') throw new Error('expected photo lease');
    expect(await stub.reserve(channelReserveInput('text', ACCOUNT_A, 21, later))).toMatchObject({
      kind: 'rejected',
      code: 'rate-limited',
    });
    const textB = channelReserveInput('text', ACCOUNT_B, 22, later);
    expect((await stub.reserve(textB)).kind).toBe('reserved');
    expect(await stub.reserve(channelReserveInput('photo', ACCOUNT_C, 23, later))).toMatchObject({
      kind: 'rejected',
      code: 'rate-limited',
    });
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_C, now: later })).toMatchObject({
      accountConcurrent: 0,
      globalConcurrent: 2,
    });
  });

  test('shares the exact monthly budget across channels', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setAccountEnabled(ACCOUNT_B, true);
    expect((await stub.reserve(channelReserveInput(
      'photo', ACCOUNT_A, 1, BASE_NOW, 49_500_000,
    ))).kind).toBe('reserved');
    expect(await stub.reserve(channelReserveInput(
      'text', ACCOUNT_B, 2, BASE_NOW, 500_001,
    ))).toMatchObject({ kind: 'rejected', code: 'budget-exceeded' });
    expect((await stub.reserve(channelReserveInput(
      'text', ACCOUNT_B, 3, BASE_NOW, 500_000,
    ))).kind).toBe('reserved');
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ budgetReservedMicros: 50_000_000, globalConcurrent: 2 });
  });

  test('serializes simultaneous cross-channel account, global and budget reservations', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setAccountEnabled(ACCOUNT_B, true);
    await stub.setAccountEnabled(ACCOUNT_C, true);

    const sameAccountInputs = [
      channelReserveInput('photo', ACCOUNT_A, 30),
      channelReserveInput('text', ACCOUNT_A, 31),
    ] as const;
    const sameAccount = await Promise.all(sameAccountInputs.map((input) => stub.reserve(input)));
    expect(sameAccount.filter((result) => result.kind === 'reserved')).toHaveLength(1);
    expect(sameAccount.filter((result) => result.kind === 'rejected')).toEqual([
      expect.objectContaining({ code: 'rate-limited' }),
    ]);
    for (let index = 0; index < sameAccount.length; index += 1) {
      const result = sameAccount[index]!;
      if (result.kind === 'reserved') {
        await stub.abortBeforeInvoke(leaseInput(sameAccountInputs[index]!, result.leaseId));
      }
    }

    const globalInputs = [
      channelReserveInput('photo', ACCOUNT_A, 32, BASE_NOW + 60_000),
      channelReserveInput('text', ACCOUNT_B, 33, BASE_NOW + 60_000),
      channelReserveInput('photo', ACCOUNT_C, 34, BASE_NOW + 60_000),
    ] as const;
    const global = await Promise.all(globalInputs.map((input) => stub.reserve(input)));
    expect(global.filter((result) => result.kind === 'reserved')).toHaveLength(2);
    expect(global.filter((result) => result.kind === 'rejected')).toEqual([
      expect.objectContaining({ code: 'rate-limited' }),
    ]);
    for (let index = 0; index < global.length; index += 1) {
      const result = global[index]!;
      if (result.kind === 'reserved') {
        await stub.abortBeforeInvoke(leaseInput(globalInputs[index]!, result.leaseId));
      }
    }

    const budgetInputs = [
      channelReserveInput('photo', ACCOUNT_A, 35, BASE_NOW + 120_000, 49_500_000),
      channelReserveInput('text', ACCOUNT_B, 36, BASE_NOW + 120_000, 500_001),
    ] as const;
    const budget = await Promise.all(budgetInputs.map((input) => stub.reserve(input)));
    expect(budget.filter((result) => result.kind === 'reserved')).toHaveLength(1);
    expect(budget.filter((result) => result.kind === 'rejected')).toEqual([
      expect.objectContaining({ code: 'budget-exceeded' }),
    ]);
    for (let index = 0; index < budget.length; index += 1) {
      const result = budget[index]!;
      if (result.kind === 'reserved') {
        await stub.abortBeforeInvoke(leaseInput(budgetInputs[index]!, result.leaseId));
      }
    }
    expect(await stub.status({
      channel: 'text',
      accountKey: ACCOUNT_A,
      now: BASE_NOW + 120_000,
    })).toMatchObject({ globalConcurrent: 0, budgetReservedMicros: 0 });
  });

  test('enforces a separate text allowance of ten per account and thirty globally', async () => {
    const accounts = [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C];
    const stub = coordinator();
    await stub.setTextGlobalEnabled(true);
    for (const account of accounts) await stub.setAccountEnabled(account, true);
    let operation = 1;
    for (const account of accounts) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await consumeWithoutCost(channelReserveInput(
          'text',
          account,
          operation,
          BASE_NOW + operation * 60_000,
        ));
        operation += 1;
      }
      expect(await stub.status({
        channel: 'text',
        accountKey: account,
        now: BASE_NOW + operation * 60_000,
      })).toMatchObject({ accountRemaining: 0 });
    }
    expect(await stub.status({
      channel: 'text',
      accountKey: ACCOUNT_A,
      now: BASE_NOW + operation * 60_000,
    })).toMatchObject({ globalRemaining: 0 });
    expect(await stub.reserve(channelReserveInput(
      'text', ACCOUNT_A, operation, BASE_NOW + operation * 60_000,
    ))).toMatchObject({ kind: 'rejected', code: 'quota-exceeded' });
    expect(await stub.status({
      channel: 'photo',
      accountKey: ACCOUNT_A,
      now: BASE_NOW + operation * 60_000,
    })).toMatchObject({ accountRemaining: 10, globalRemaining: 30 });
  });

  test('uses the channel-specific initial and retry reserves from the actual lease', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const textInput = channelReserveInput('text', ACCOUNT_A, 1);
    const result = await stub.reserve(textInput);
    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') throw new Error('expected text lease');
    const lease = leaseInput(textInput, result.leaseId);
    await stub.markInvoked(lease);
    await stub.reserveRetryCost(lease);
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ accountRemaining: 10, budgetReservedMicros: 1_000_000 });
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ accountRemaining: 9, budgetReservedMicros: 1_000_000 });
  });

  test('rejects a wrong channel for every lease operation without changing the text lease', async () => {
    const stub = coordinator();
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const textInput = channelReserveInput('text', ACCOUNT_A, 1);
    const result = await stub.reserve(textInput);
    if (result.kind !== 'reserved') throw new Error('expected text lease');
    const textLease = leaseInput(textInput, result.leaseId);
    const photoLease = { ...textLease, channel: 'photo' as const };
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.markInvoked(photoLease)).rejects.toThrow('Coordinator operation rejected');
      await expect(instance.abortBeforeInvoke(photoLease)).rejects.toThrow('Coordinator operation rejected');
      await expect(instance.reserveRetryCost(photoLease)).rejects.toThrow('Coordinator operation rejected');
      await expect(instance.settleFailure({
        ...photoLease,
        actualCostMicros: 0,
        errorCode: 'provider-timeout',
      })).rejects.toThrow('Coordinator operation rejected');
    });
    expect(await stub.reserve(textInput)).toMatchObject({ kind: 'in-flight' });
    await stub.abortBeforeInvoke(textLease);
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW }))
      .toMatchObject({ accountRemaining: 10, budgetReservedMicros: 0 });
  });

  test('fails closed for missing or forged channels and caller-supplied storage namespaces', async () => {
    const stub = coordinator();
    await runInDurableObject(stub, async (instance) => {
      for (const channel of [undefined, null, 'Photo', 'photo:', 'text:raw']) {
        await expect(instance.status({
          channel,
          accountKey: ACCOUNT_A,
          now: BASE_NOW,
        } as never)).rejects.toThrow('Invalid coordinator input');
        await expect(instance.reserve({
          ...channelReserveInput('photo', ACCOUNT_A, 40),
          channel,
        } as never)).rejects.toThrow('Invalid coordinator input');
      }
      await expect(instance.reserve({
        ...channelReserveInput('photo', ACCOUNT_A, 41),
        idempotencyKey: `text:${key(41)}`,
      })).rejects.toThrow('Invalid coordinator input');
      await expect(instance.setTextGlobalEnabled(1 as never)).rejects.toThrow('Invalid coordinator input');
    });
  });

  test('rejects an idempotent replay whose active row no longer matches its channel tuple', async () => {
    const stub = coordinator();
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const input = channelReserveInput('text', ACCOUNT_A, 42);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected text lease');
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE active_leases SET channel = 'photo' WHERE lease_id = ?",
        result.leaseId,
      ).toArray();
    });
    expect(await stub.reserve(input)).toMatchObject({
      kind: 'rejected',
      code: 'idempotency-conflict',
    });
  });

  test('accepts uncertain-food as the only new fixed terminal failure code', async () => {
    const stub = coordinator();
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const input = channelReserveInput('text', ACCOUNT_A, 1);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected text lease');
    const lease = leaseInput(input, result.leaseId);
    await stub.markInvoked(lease);
    await stub.settleFailure({ ...lease, actualCostMicros: 1, errorCode: 'uncertain-food' });
    expect(await stub.reserve({ ...input, now: BASE_NOW + 1 })).toEqual({
      kind: 'failed',
      code: 'uncertain-food',
    });
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.settleFailure({
        ...lease,
        leaseId: '22222222-2222-4222-8222-222222222222',
        errorCode: 'arbitrary-provider-detail' as 'uncertain-food',
        actualCostMicros: 0,
      })).rejects.toThrow('Invalid coordinator input');
    });
  });

  test('migrates legacy photo rows once and preserves active invoked and settled state', async () => {
    const stub = coordinator();
    const rawActiveKey = key(91);
    const rawSettledKey = key(92);
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec('DROP TABLE active_leases').toArray();
      sql.exec(`CREATE TABLE active_leases (
        lease_id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        day_bucket TEXT NOT NULL,
        month_bucket TEXT NOT NULL,
        initial_reserve_micros INTEGER NOT NULL,
        retry_reserve_micros INTEGER NOT NULL,
        invoked INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`).toArray();
      sql.exec('DELETE FROM idempotency').toArray();
      sql.exec("DELETE FROM settings WHERE key = 'text_global_enabled'").toArray();
      sql.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'invoked', 'legacy-lease', NULL, NULL, NULL, NULL, ?)`,
        ACCOUNT_A, rawActiveKey, fingerprint(91), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'failed', NULL, NULL, NULL, NULL, 'provider-timeout', ?)`,
        ACCOUNT_A, rawSettledKey, fingerprint(92), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO active_leases VALUES (
          'legacy-lease', ?, ?, ?, '2026-08-18', '2026-08', 2000000, 0, 1, ?
        )`,
        ACCOUNT_A, rawActiveKey, fingerprint(91), BASE_NOW + 60_000,
      ).toArray();
      sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('spent:2026-08', 123)").toArray();
      sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('reserved:2026-08', 2000000)").toArray();

      const firstReload = new PhotoAiCoordinator(state, env);
      expect(firstReload).toBeInstanceOf(PhotoAiCoordinator);
      const secondReload = new PhotoAiCoordinator(state, env);
      expect(secondReload).toBeInstanceOf(PhotoAiCoordinator);

      expect(sql.exec<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM idempotency ORDER BY idempotency_key',
      ).toArray().map((row) => row.idempotency_key)).toEqual([
        `photo:${rawActiveKey}`,
        `photo:${rawSettledKey}`,
      ]);
      expect(sql.exec<{ channel: string; idempotency_key: string; invoked: number }>(
        'SELECT channel, idempotency_key, invoked FROM active_leases',
      ).toArray()).toEqual([{
        channel: 'photo',
        idempotency_key: `photo:${rawActiveKey}`,
        invoked: 1,
      }]);
      expect(sql.exec<{ value: number }>(
        "SELECT value FROM settings WHERE key = 'text_global_enabled'",
      ).toArray()).toEqual([{ value: 0 }]);
      expect(sql.exec<{ key: string; value: number }>(
        "SELECT key, value FROM settings WHERE key IN ('spent:2026-08', 'reserved:2026-08') ORDER BY key",
      ).toArray()).toEqual([
        { key: 'reserved:2026-08', value: 2_000_000 },
        { key: 'spent:2026-08', value: 123 },
      ]);
      await firstReload.setGlobalEnabled(true);
      await firstReload.setAccountEnabled(ACCOUNT_A, true);
      expect(await firstReload.reserve({
        channel: 'photo',
        accountKey: ACCOUNT_A,
        idempotencyKey: rawActiveKey,
        fingerprint: fingerprint(91),
        now: BASE_NOW,
        reserveMicros: 2_000_000,
      })).toMatchObject({ kind: 'in-flight' });
      expect(await firstReload.reserve({
        channel: 'photo',
        accountKey: ACCOUNT_A,
        idempotencyKey: rawSettledKey,
        fingerprint: fingerprint(92),
        now: BASE_NOW,
        reserveMicros: 2_000_000,
      })).toEqual({ kind: 'failed', code: 'provider-timeout' });
    });
  });

  test('exports an idempotent schema migration for mixed legacy and namespaced rows', async () => {
    expect(typeof ensureCoordinatorSchema).toBe('function');
    const stub = coordinator();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'reserved', 'mixed-photo', NULL, NULL, NULL, NULL, ?)`,
        ACCOUNT_A, key(93), fingerprint(93), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO active_leases (
          lease_id, channel, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
          initial_reserve_micros, retry_reserve_micros, invoked, expires_at
        ) VALUES ('mixed-photo', 'photo', ?, ?, ?, '2026-08-18', '2026-08', 2000000, 0, 0, ?)`,
        ACCOUNT_A, key(93), fingerprint(93), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'reserved', 'mixed-text', NULL, NULL, NULL, NULL, ?)`,
        ACCOUNT_B, `text:${key(94)}`, fingerprint(94), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO active_leases (
          lease_id, channel, account_key, idempotency_key, fingerprint, day_bucket, month_bucket,
          initial_reserve_micros, retry_reserve_micros, invoked, expires_at
        ) VALUES ('mixed-text', 'text', ?, ?, ?, '2026-08-18', '2026-08', 500000, 0, 0, ?)`,
        ACCOUNT_B, `text:${key(94)}`, fingerprint(94), BASE_NOW + 60_000,
      ).toArray();
      sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('reserved:2026-08', 2500000)").toArray();
      sql.exec("INSERT OR REPLACE INTO daily_counters VALUES ('text:sentinel', '2026-08-18', 4, 5)").toArray();

      state.storage.transactionSync(() => ensureCoordinatorSchema(sql));
      state.storage.transactionSync(() => ensureCoordinatorSchema(sql));

      expect(sql.exec<{ channel: string; idempotency_key: string }>(
        'SELECT channel, idempotency_key FROM active_leases ORDER BY channel',
      ).toArray()).toEqual([
        { channel: 'photo', idempotency_key: `photo:${key(93)}` },
        { channel: 'text', idempotency_key: `text:${key(94)}` },
      ]);
      expect(sql.exec<{ value: number }>(
        "SELECT value FROM settings WHERE key = 'reserved:2026-08'",
      ).toArray()).toEqual([{ value: 2_500_000 }]);
      expect(sql.exec<{ pending: number; consumed: number }>(
        "SELECT pending, consumed FROM daily_counters WHERE scope = 'text:sentinel'",
      ).toArray()).toEqual([{ pending: 4, consumed: 5 }]);
    });
  });

  test('rolls back the entire legacy migration when raw and namespaced keys conflict', async () => {
    const stub = coordinator();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec('DROP TABLE active_leases').toArray();
      sql.exec(`CREATE TABLE active_leases (
        lease_id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        day_bucket TEXT NOT NULL,
        month_bucket TEXT NOT NULL,
        initial_reserve_micros INTEGER NOT NULL,
        retry_reserve_micros INTEGER NOT NULL,
        invoked INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`).toArray();
      sql.exec('DELETE FROM idempotency').toArray();
      sql.exec("DELETE FROM settings WHERE key = 'text_global_enabled'").toArray();
      for (const persistedKey of [key(95), `photo:${key(95)}`]) {
        sql.exec(
          `INSERT INTO idempotency (
            account_key, idempotency_key, fingerprint, state, lease_id,
            cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
          ) VALUES (?, ?, ?, 'failed', NULL, NULL, NULL, NULL, 'provider-timeout', ?)`,
          ACCOUNT_A, persistedKey, fingerprint(95), BASE_NOW + 60_000,
        ).toArray();
      }

      expect(() => new PhotoAiCoordinator(state, env))
        .toThrow('Coordinator operation rejected');
      expect(sql.exec<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM idempotency ORDER BY idempotency_key',
      ).toArray().map((row) => row.idempotency_key)).toEqual([key(95), `photo:${key(95)}`]);
      expect(sql.exec<{ name: string }>('PRAGMA table_info(active_leases)').toArray()
        .some((column) => column.name === 'channel')).toBe(false);
      expect(sql.exec<{ value: number }>(
        "SELECT value FROM settings WHERE key = 'text_global_enabled'",
      ).toArray()).toEqual([]);
    });
  });

  test('fails migration atomically when a legacy active lease does not match its idempotency row', async () => {
    const stub = coordinator();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec('DROP TABLE active_leases').toArray();
      sql.exec(`CREATE TABLE active_leases (
        lease_id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        day_bucket TEXT NOT NULL,
        month_bucket TEXT NOT NULL,
        initial_reserve_micros INTEGER NOT NULL,
        retry_reserve_micros INTEGER NOT NULL,
        invoked INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`).toArray();
      sql.exec('DELETE FROM idempotency').toArray();
      sql.exec("DELETE FROM settings WHERE key = 'text_global_enabled'").toArray();
      sql.exec(
        `INSERT INTO idempotency (
          account_key, idempotency_key, fingerprint, state, lease_id,
          cache_iv, cache_ciphertext, cache_expires_at, error_code, expires_at
        ) VALUES (?, ?, ?, 'reserved', 'legacy-lease', NULL, NULL, NULL, NULL, ?)`,
        ACCOUNT_A, key(96), fingerprint(96), BASE_NOW + 60_000,
      ).toArray();
      sql.exec(
        `INSERT INTO active_leases VALUES (
          'legacy-lease', ?, ?, ?, '2026-08-18', '2026-08', 2000000, 0, 0, ?
        )`,
        ACCOUNT_A, key(96), fingerprint(97), BASE_NOW + 60_000,
      ).toArray();

      expect(() => state.storage.transactionSync(() => ensureCoordinatorSchema(sql)))
        .toThrow('Coordinator operation rejected');
      expect(sql.exec<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM idempotency',
      ).toArray()).toEqual([{ idempotency_key: key(96) }]);
      expect(sql.exec<{ name: string }>('PRAGMA table_info(active_leases)').toArray()
        .some((column) => column.name === 'channel')).toBe(false);
      expect(sql.exec<{ value: number }>(
        "SELECT value FROM settings WHERE key = 'text_global_enabled'",
      ).toArray()).toEqual([]);
    });
  });

  test('starts closed for an unseen account', async () => {
    const status = await coordinator().status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW });

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
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      enabled: false,
      accountEnabled: true,
    });
    expect(await stub.reserve(reserveInput(ACCOUNT_A, 1))).toMatchObject({
      kind: 'rejected',
      code: 'service-disabled',
    });

    await stub.setGlobalEnabled(true);
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
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
    expect((await stub.status({ channel: 'photo', accountKey: fourth, now: BASE_NOW })).accountEnabled).toBe(false);
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
    expect((await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(10);
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
        await expect(instance.status({ channel: 'photo', accountKey: ACCOUNT_A, now })).rejects.toThrow(
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
    expect((await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(9);
    await stub.abortBeforeInvoke(leaseInput(first, firstResult.leaseId));
    expect((await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(10);

    const second = reserveInput(ACCOUNT_A, 2);
    const secondResult = await stub.reserve(second);
    if (secondResult.kind !== 'reserved') throw new Error('expected reserved lease');
    const invoked = leaseInput(second, secondResult.leaseId);
    await stub.markInvoked(invoked);
    await stub.settleFailure({ ...invoked, actualCostMicros: 0, errorCode: 'invalid-estimate' });
    expect((await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).accountRemaining).toBe(9);
  });

  test('atomically compensates an invocation aborted before provider work', async () => {
    const stub = await enable();
    const input = reserveInput(ACCOUNT_A, 1);
    const result = await stub.reserve(input);
    if (result.kind !== 'reserved') throw new Error('expected reserved lease');
    const lease = leaseInput(input, result.leaseId);
    await stub.markInvoked(lease);
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountRemaining: 9,
      globalRemaining: 29,
      accountConcurrent: 1,
      globalConcurrent: 1,
      budgetSpentMicros: 0,
      budgetReservedMicros: GATEWAY_LIMITS.initialAttemptReserveMicros,
    });

    await stub.abortAfterMarkBeforeProvider(lease);

    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountRemaining: 10,
      globalRemaining: 30,
      accountConcurrent: 0,
      globalConcurrent: 0,
      budgetSpentMicros: 0,
      budgetReservedMicros: 0,
    });
    expect((await stub.reserve(input)).kind).toBe('reserved');
  });

  test('rejects post-mark compensation for a pending lease or after retry cost is reserved', async () => {
    const stub = await enable();
    const pendingInput = reserveInput(ACCOUNT_A, 1);
    const pendingResult = await stub.reserve(pendingInput);
    if (pendingResult.kind !== 'reserved') throw new Error('expected pending lease');
    const pendingLease = leaseInput(pendingInput, pendingResult.leaseId);
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.abortAfterMarkBeforeProvider(pendingLease)).rejects.toThrow(
        'Coordinator operation rejected',
      );
    });
    await stub.abortBeforeInvoke(pendingLease);

    const retryInput = reserveInput(ACCOUNT_A, 2);
    const retryResult = await stub.reserve(retryInput);
    if (retryResult.kind !== 'reserved') throw new Error('expected retry lease');
    const retryLease = leaseInput(retryInput, retryResult.leaseId);
    await stub.markInvoked(retryLease);
    await stub.reserveRetryCost(retryLease);
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.abortAfterMarkBeforeProvider(retryLease)).rejects.toThrow(
        'Coordinator operation rejected',
      );
    });
    await stub.settleFailure({
      ...retryLease,
      actualCostMicros: 0,
      errorCode: 'provider-unavailable',
    });
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

    const status = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW });
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
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
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
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
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
    let status = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW + 60_001 });
    expect(status).toMatchObject({ accountRemaining: 10, accountConcurrent: 0, budgetReservedMicros: 0 });

    const invokedInput = reserveInput(ACCOUNT_B, 2, BASE_NOW + 60_001);
    const invokedResult = await stub.reserve(invokedInput);
    if (invokedResult.kind !== 'reserved') throw new Error('expected lease');
    await stub.markInvoked(leaseInput(invokedInput, invokedResult.leaseId));
    status = await stub.status({ channel: 'photo', accountKey: ACCOUNT_B, now: BASE_NOW + 120_002 });
    expect(status).toMatchObject({
      accountRemaining: 9,
      accountConcurrent: 0,
      budgetSpentMicros: 2_000_000,
      budgetReservedMicros: 0,
    });
  });

  test('cleans expired text leases through either status channel without mixing daily scopes', async () => {
    const stub = coordinator();
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    const pending = channelReserveInput('text', ACCOUNT_A, 70);
    expect((await stub.reserve(pending)).kind).toBe('reserved');
    expect(await stub.status({
      channel: 'photo',
      accountKey: ACCOUNT_A,
      now: BASE_NOW + GATEWAY_LIMITS.leaseMs + 1,
    })).toMatchObject({
      accountRemaining: 10,
      globalRemaining: 30,
      accountConcurrent: 0,
      budgetReservedMicros: 0,
    });
    expect(await stub.status({
      channel: 'text',
      accountKey: ACCOUNT_A,
      now: BASE_NOW + GATEWAY_LIMITS.leaseMs + 1,
    })).toMatchObject({ accountRemaining: 10, globalRemaining: 30 });

    const invoked = channelReserveInput(
      'text', ACCOUNT_A, 71, BASE_NOW + GATEWAY_LIMITS.leaseMs + 1,
    );
    const invokedResult = await stub.reserve(invoked);
    if (invokedResult.kind !== 'reserved') throw new Error('expected invoked text lease');
    await stub.markInvoked(leaseInput(invoked, invokedResult.leaseId));
    expect(await stub.status({
      channel: 'photo',
      accountKey: ACCOUNT_A,
      now: invoked.now + GATEWAY_LIMITS.leaseMs + 1,
    })).toMatchObject({ budgetSpentMicros: 500_000, budgetReservedMicros: 0 });
    expect(await stub.reserve({
      ...invoked,
      now: invoked.now + GATEWAY_LIMITS.leaseMs + 1,
    })).toEqual({ kind: 'failed', code: 'provider-timeout' });
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
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: beforeMidnight })).toMatchObject({
      accountRemaining: 9,
      budgetSpentMicros: 123,
      resetAt: '2028-02-29T16:00:00.000Z',
    });
    const nextDay = Date.UTC(2028, 1, 29, 16, 0);
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: nextDay })).toMatchObject({
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
      expect(await reloaded.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
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
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW })).toMatchObject({
      accountEnabled: false,
      accountRemaining: 10,
      globalRemaining: 29,
    });
    await stub.setAccountEnabled(ACCOUNT_A, true);
    expect((await stub.reserve(reserveInput(ACCOUNT_A, 1, BASE_NOW + 60_000))).kind).toBe('reserved');
  });

  test('deletes both channel scopes, leases, idempotency and cache while preserving another account', async () => {
    const stub = coordinator();
    await stub.setGlobalEnabled(true);
    await stub.setTextGlobalEnabled(true);
    await stub.setAccountEnabled(ACCOUNT_A, true);
    await stub.setAccountEnabled(ACCOUNT_B, true);

    const settledPhoto = channelReserveInput('photo', ACCOUNT_A, 80);
    const settledPhotoResult = await stub.reserve(settledPhoto);
    if (settledPhotoResult.kind !== 'reserved') throw new Error('expected settled photo');
    const settledPhotoLease = leaseInput(settledPhoto, settledPhotoResult.leaseId);
    await stub.markInvoked(settledPhotoLease);
    await stub.settleSuccess({
      ...settledPhotoLease,
      actualCostMicros: 123,
      cache: { ivBase64: 'aXY=', ciphertextBase64: 'Y2lwaGVy', expiresAt: BASE_NOW + 600_000 },
    });

    const pendingText = channelReserveInput('text', ACCOUNT_A, 81, BASE_NOW + 60_000);
    const pendingTextResult = await stub.reserve(pendingText);
    if (pendingTextResult.kind !== 'reserved') throw new Error('expected pending text');
    const otherPhoto = channelReserveInput('photo', ACCOUNT_B, 82, BASE_NOW + 60_000);
    const otherPhotoResult = await stub.reserve(otherPhoto);
    if (otherPhotoResult.kind !== 'reserved') throw new Error('expected other photo');

    await stub.deleteAccount(ACCOUNT_A);

    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW + 60_000 }))
      .toMatchObject({ accountEnabled: false, accountRemaining: 10, globalRemaining: 28 });
    expect(await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW + 60_000 }))
      .toMatchObject({ accountEnabled: false, accountRemaining: 10, globalRemaining: 30 });
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_B, now: BASE_NOW + 60_000 }))
      .toMatchObject({ accountEnabled: true, accountConcurrent: 1, budgetSpentMicros: 123, budgetReservedMicros: 2_000_000 });
    expect(await stub.reserve(otherPhoto)).toMatchObject({ kind: 'in-flight' });

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      expect(sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM idempotency WHERE account_key = ?
         UNION ALL SELECT COUNT(*) FROM active_leases WHERE account_key = ?
         UNION ALL SELECT COUNT(*) FROM minute_counters WHERE account_key IN (?, ?)
         UNION ALL SELECT COUNT(*) FROM daily_counters WHERE scope IN (?, ?)
         UNION ALL SELECT COUNT(*) FROM account_flags WHERE account_key = ?`,
        ACCOUNT_A,
        ACCOUNT_A,
        ACCOUNT_A,
        `text:${ACCOUNT_A}`,
        ACCOUNT_A,
        `text:${ACCOUNT_A}`,
        ACCOUNT_A,
      ).toArray().map((row) => row.count)).toEqual([0, 0, 0, 0, 0]);
      expect(sql.exec<{ account_key: string }>(
        'SELECT account_key FROM active_leases',
      ).toArray()).toEqual([{ account_key: ACCOUNT_B }]);
      expect(sql.exec<{ value: number }>(
        "SELECT value FROM settings WHERE key = 'reserved:2026-08'",
      ).toArray()).toEqual([{ value: 2_000_000 }]);
    });

    await stub.abortBeforeInvoke(leaseInput(otherPhoto, otherPhotoResult.leaseId));
    expect(await stub.status({ channel: 'photo', accountKey: ACCOUNT_B, now: BASE_NOW + 60_000 }))
      .toMatchObject({ budgetSpentMicros: 123, budgetReservedMicros: 0 });
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
