import assert from 'node:assert/strict';
import test from 'node:test';

import { signTextAdminRequest } from './text-ai-admin-signature.mjs';

const ADMIN_KEY = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';
const TIMESTAMP = '1777777777000';
const OPERATION_ID = '1'.repeat(32);
const BODY =
  '{"schemaVersion":1,"operationId":"11111111111111111111111111111111","operation":"status","target":"user-1"}';
const EXPECTED_SIGNATURE =
  '2539065831c6bba4ac32208bc2053c1f7c5e0e6363c7ff9949731e11c908aa86';

test('matches the fixed Web Crypto signature vector', () => {
  assert.equal(signTextAdminRequest({
    key: ADMIN_KEY,
    timestamp: TIMESTAMP,
    operationId: OPERATION_ID,
    body: BODY,
  }), EXPECTED_SIGNATURE);
});

test('signs exact body bytes without canonicalizing JSON', () => {
  const compact = signTextAdminRequest({
    key: ADMIN_KEY,
    timestamp: TIMESTAMP,
    operationId: OPERATION_ID,
    body: BODY,
  });
  const spaced = signTextAdminRequest({
    key: ADMIN_KEY,
    timestamp: TIMESTAMP,
    operationId: OPERATION_ID,
    body: BODY.replace('{', '{ '),
  });
  assert.match(compact, /^[a-f0-9]{64}$/);
  assert.match(spaced, /^[a-f0-9]{64}$/);
  assert.notEqual(compact, spaced);
});

test('rejects non-canonical keys, timestamps, operation IDs, and body values', () => {
  const valid = {
    key: ADMIN_KEY,
    timestamp: TIMESTAMP,
    operationId: OPERATION_ID,
    body: BODY,
  };
  for (const input of [
    { ...valid, key: 'short' },
    { ...valid, key: `${ADMIN_KEY}=` },
    { ...valid, timestamp: `0${TIMESTAMP}` },
    { ...valid, operationId: 'A'.repeat(32) },
    { ...valid, body: Buffer.from(BODY) },
    { ...valid, extra: true },
  ]) {
    assert.throws(() => signTextAdminRequest(input), {
      name: 'Error',
      message: 'Text admin signature failed',
    });
  }
});
