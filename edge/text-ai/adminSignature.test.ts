import { describe, expect, test } from 'vitest';

import {
  TEXT_ADMIN_SIGNATURE_HEADERS,
  signTextAdminRequestForTest,
  verifyTextAdminSignature,
} from './adminSignature';

const ADMIN_KEY = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';
const ADMIN_PATH = '/api/nutrition/text-admin/account';
const ORIGIN = 'https://app.example.test';
const NOW = 1_777_777_777_000;
const TIMESTAMP = String(NOW);
const OPERATION_ID = '1'.repeat(32);
const EXPECTED_SIGNATURE =
  '2539065831c6bba4ac32208bc2053c1f7c5e0e6363c7ff9949731e11c908aa86';
const BODY = new TextEncoder().encode(
  '{"schemaVersion":1,"operationId":"11111111111111111111111111111111","operation":"status","target":"user-1"}',
);

type Signed = Awaited<ReturnType<typeof signTextAdminRequestForTest>>;

function requestFrom(
  signed: Signed,
  body: Uint8Array = BODY,
  options: {
    method?: string;
    path?: string;
    version?: string;
    timestamp?: string;
    signature?: string;
    duplicate?: keyof typeof TEXT_ADMIN_SIGNATURE_HEADERS;
  } = {},
): Request {
  const entries: [string, string][] = [
    [TEXT_ADMIN_SIGNATURE_HEADERS.version, options.version ?? signed.version],
    [TEXT_ADMIN_SIGNATURE_HEADERS.timestamp, options.timestamp ?? signed.timestamp],
    [TEXT_ADMIN_SIGNATURE_HEADERS.signature, options.signature ?? signed.signature],
  ];
  if (options.duplicate !== undefined) {
    const name = TEXT_ADMIN_SIGNATURE_HEADERS[options.duplicate];
    entries.push([name, entries.find(([candidate]) => candidate === name)?.[1] ?? '']);
  }
  return new Request(`${ORIGIN}${options.path ?? ADMIN_PATH}`, {
    method: options.method ?? 'POST',
    headers: entries,
    body: new Uint8Array(body).buffer,
  });
}

async function signedAt(timestamp = TIMESTAMP): Promise<Signed> {
  return signTextAdminRequestForTest({
    key: ADMIN_KEY,
    method: 'POST',
    path: ADMIN_PATH,
    timestamp,
    operationId: OPERATION_ID,
    body: BODY,
  });
}

describe('canonical text admin HMAC', () => {
  test('locks the cross-runtime signature vector and verifies it', async () => {
    expect(TEXT_ADMIN_SIGNATURE_HEADERS).toEqual({
      version: 'x-tiezheng-admin-version',
      timestamp: 'x-tiezheng-admin-timestamp',
      signature: 'x-tiezheng-admin-signature',
    });
    const signed = await signedAt();

    expect(signed).toEqual({
      version: 'v1',
      timestamp: TIMESTAMP,
      signature: EXPECTED_SIGNATURE,
    });
    await expect(
      verifyTextAdminSignature(requestFrom(signed), ADMIN_KEY, NOW),
    ).resolves.toBeUndefined();
  });

  test.each([
    ['future boundary', NOW + 300_000],
    ['past boundary', NOW - 300_000],
  ] as const)('accepts the exact five-minute %s', async (_case, timestamp) => {
    const signed = await signedAt(String(timestamp));
    await expect(
      verifyTextAdminSignature(requestFrom(signed), ADMIN_KEY, NOW),
    ).resolves.toBeUndefined();
  });

  test('rejects any changed body byte, method, path, operation id, version, or signature', async () => {
    const signed = await signedAt();
    const changedBody = BODY.slice();
    changedBody[changedBody.length - 3] ^= 1;
    const changedOperationId = new TextEncoder().encode(
      new TextDecoder().decode(BODY).replace(OPERATION_ID, '2'.repeat(32)),
    );
    const cases = [
      requestFrom(signed, changedBody),
      requestFrom(signed, BODY, { method: 'PUT' }),
      requestFrom(signed, BODY, { path: '/api/nutrition/text-admin/other' }),
      requestFrom(signed, changedOperationId),
      requestFrom(signed, BODY, { version: 'v2' }),
      requestFrom(signed, BODY, {
        signature: `${signed.signature.slice(0, -1)}${signed.signature.endsWith('0') ? '1' : '0'}`,
      }),
    ];

    for (const source of cases) {
      await expect(
        verifyTextAdminSignature(source, ADMIN_KEY, NOW),
      ).rejects.toThrow('Invalid text admin signature');
    }
  });

  test.each([
    ['version', 'version'],
    ['timestamp', 'timestamp'],
    ['signature', 'signature'],
  ] as const)('rejects duplicate %s headers', async (_case, duplicate) => {
    const signed = await signedAt();
    await expect(
      verifyTextAdminSignature(requestFrom(signed, BODY, { duplicate }), ADMIN_KEY, NOW),
    ).rejects.toThrow('Invalid text admin signature');
  });

  test.each([
    ['future', NOW + 300_001],
    ['past', NOW - 300_001],
  ] as const)('rejects %s clock drift outside five minutes', async (_case, timestamp) => {
    const signed = await signedAt(String(timestamp));
    await expect(
      verifyTextAdminSignature(requestFrom(signed), ADMIN_KEY, NOW),
    ).rejects.toThrow('Invalid text admin signature');
  });

  test.each([
    ['missing version', { version: '' }],
    ['non-canonical timestamp', { timestamp: `0${TIMESTAMP}` }],
    ['uppercase signature', { signature: EXPECTED_SIGNATURE.toUpperCase() }],
  ] as const)('rejects %s', async (_case, overrides) => {
    const signed = await signedAt();
    await expect(
      verifyTextAdminSignature(requestFrom(signed, BODY, overrides), ADMIN_KEY, NOW),
    ).rejects.toThrow('Invalid text admin signature');
  });

  test.each([
    'short',
    'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=',
    '!'.repeat(43),
  ])('rejects non-canonical signing key %j', async (key) => {
    const signed = await signedAt();
    await expect(
      verifyTextAdminSignature(requestFrom(signed), key, NOW),
    ).rejects.toThrow('Invalid text admin signature');
  });
});
