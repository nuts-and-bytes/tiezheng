import { describe, expect, test } from 'vitest';
import { deriveOpaqueKey } from './opaqueKey';

describe('opaque account key', () => {
  test('derives one deterministic detached lowercase 64-hex key', async () => {
    const first = await deriveOpaqueKey('text-ai:user-1', 'x'.repeat(32));
    const second = await deriveOpaqueKey('text-ai:user-1', 'x'.repeat(32));

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(await deriveOpaqueKey('text-ai:user-2', 'x'.repeat(32))).not.toBe(first);
    expect(first).not.toContain('text-ai:user-1');
  });

  test.each([
    '',
    ' user-1',
    'user-1 ',
    'a\u0000b',
    '用户一',
    'x'.repeat(129),
  ])('rejects an invalid subject %j', async (subject) => {
    await expect(deriveOpaqueKey(subject, 'x'.repeat(32))).rejects.toThrow('Access denied');
  });

  test('validates the secret by UTF-8 byte length without coercion', async () => {
    await expect(deriveOpaqueKey('text-ai:user-1', 'x'.repeat(31))).rejects.toThrow('Access denied');
    await expect(deriveOpaqueKey('text-ai:user-1', 32 as unknown as string)).rejects.toThrow('Access denied');
    await expect(deriveOpaqueKey('text-ai:user-1', '密'.repeat(11))).resolves.toMatch(/^[a-f0-9]{64}$/);
  });
});
