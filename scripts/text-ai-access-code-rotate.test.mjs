import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  generateAccessCodeRotationMaterials,
  runTextAccessCodeRotation,
  runTextAccessCodeRotationCli,
} from './text-ai-access-code-rotate.mjs';

const SHA = 'a'.repeat(40);

function writer({ throwOnCode = false } = {}) {
  return {
    chunks: [],
    write(value) {
      if (throwOnCode && String(value).startsWith('user-')) throw new Error('secret-sentinel');
      this.chunks.push(String(value));
      return true;
    },
    get text() {
      return this.chunks.join('');
    },
  };
}

function rotationHarness({
  target = 'user-1',
  mode = 'rotate',
  confirmed = true,
  failSetIndex = null,
  failDeploy = false,
  stdout = writer(),
} = {}) {
  const calls = [];
  const raw = [];
  const writes = [];
  let materials;
  let randomIndex = 0;
  let setIndex = 0;
  const stderr = writer();
  const dependencies = Object.freeze({
    github: Object.freeze({
      async inspectRotation() {
        calls.push('inspect');
        return { accountId: 'b'.repeat(32), expectedSha: SHA };
      },
      async setSecret(name, value) {
        calls.push(`set:${name}`);
        setIndex += 1;
        writes.push({ name, value: value.toString('ascii') });
        value.fill(0);
        if (setIndex === failSetIndex) throw new Error('secret-sentinel');
      },
      async runAccessCodeRotation(selectedTarget, expectedSha) {
        calls.push(`deploy:${selectedTarget}:${expectedSha}`);
        if (failDeploy) throw new Error('secret-sentinel');
      },
    }),
    async confirm(selectedTarget) {
      calls.push(`confirm:${selectedTarget}`);
      return confirmed;
    },
    generateMaterials(selectedTarget) {
      calls.push(`generate:${selectedTarget}`);
      materials = generateAccessCodeRotationMaterials(selectedTarget, (length) => {
        randomIndex += 1;
        const value = Buffer.alloc(length, randomIndex);
        raw.push(value);
        return value;
      });
      return materials;
    },
    stdout,
    stderr,
  });
  return {
    target,
    mode,
    dependencies,
    calls,
    raw,
    writes,
    stdout,
    stderr,
    materials: () => materials,
  };
}

function materialBuffers(fixture) {
  const materials = fixture.materials();
  return materials === undefined ? [] : Object.values(materials).filter(Buffer.isBuffer);
}

test('rotates only user-1 pepper/digest, shows one code, and dispatches after both writes', async () => {
  const fixture = rotationHarness();
  assert.equal(await runTextAccessCodeRotation({
    mode: fixture.mode,
    target: fixture.target,
  }, fixture.dependencies), 0);
  assert.deepEqual(fixture.raw.map((value) => value.length), [24, 32]);
  assert.equal(fixture.raw.every((value) => value.every((byte) => byte === 0)), true);
  assert.deepEqual(fixture.writes.map(({ name }) => name), [
    'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
    'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  ]);
  const code = /^user-1: ([A-Za-z0-9_-]{32})$/mu.exec(fixture.stdout.text)?.[1];
  assert.equal(typeof code, 'string');
  assert.equal(fixture.stdout.text.match(new RegExp(code, 'gu'))?.length, 1);
  const expectedDigest = createHmac(
    'sha256',
    Buffer.from(fixture.writes[0].value, 'base64url'),
  ).update(code, 'utf8').digest('hex');
  assert.equal(fixture.writes[1].value, expectedDigest);
  assert.equal(fixture.writes.some(({ value }) => value === code), false);
  assert.equal(fixture.calls.at(-1), `deploy:user-1:${SHA}`);
  assert.equal(fixture.stdout.text.endsWith('ROTATION COMPLETE target=user-1\n'), true);
  assert.equal(materialBuffers(fixture).every((value) => value.every((byte) => byte === 0)), true);
});

test('user-2 rotation never names the other slot', async () => {
  const fixture = rotationHarness({ target: 'user-2' });
  assert.equal(await runTextAccessCodeRotation({ mode: 'rotate', target: 'user-2' }, fixture.dependencies), 0);
  assert.deepEqual(fixture.writes.map(({ name }) => name), [
    'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
    'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  ]);
  assert.equal(fixture.calls.join('\n').includes('USER_1'), false);
});

test('cancel after display performs no remote write and wipes the code and pepper', async () => {
  const fixture = rotationHarness({ confirmed: false });
  assert.equal(await runTextAccessCodeRotation({ mode: 'rotate', target: 'user-1' }, fixture.dependencies), 1);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.calls.some((value) => value.startsWith('deploy:')), false);
  assert.equal(fixture.stderr.text, 'ROTATION CANCELLED\n');
  assert.equal(materialBuffers(fixture).every((value) => value.every((byte) => byte === 0)), true);
});

test('deployment failure preserves written secrets and returns one fixed resume command', async () => {
  const fixture = rotationHarness({ failDeploy: true });
  assert.equal(await runTextAccessCodeRotation({ mode: 'rotate', target: 'user-1' }, fixture.dependencies), 1);
  assert.equal(fixture.writes.length, 2);
  assert.equal(fixture.stderr.text,
    'ROTATION BLOCKED deploy\nresume=npm run rotate:text-preview-code -- --resume=user-1\n');
  const code = /^user-1: ([A-Za-z0-9_-]{32})$/mu.exec(fixture.stdout.text)?.[1];
  assert.equal(fixture.stderr.text.includes(code), false);
});

test('resume only inspects and dispatches without random, prompt, secret write, or code output', async () => {
  const fixture = rotationHarness({ mode: 'resume', target: 'user-2' });
  assert.equal(await runTextAccessCodeRotation({ mode: 'resume', target: 'user-2' }, fixture.dependencies), 0);
  assert.deepEqual(fixture.calls, ['inspect', `deploy:user-2:${SHA}`]);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.materials(), undefined);
  assert.equal(fixture.stdout.text, 'ROTATION COMPLETE target=user-2\n');
});

test('partial secret failure does not dispatch or offer unsafe resume and wipes all materials', async () => {
  const fixture = rotationHarness({ failSetIndex: 2 });
  assert.equal(await runTextAccessCodeRotation({ mode: 'rotate', target: 'user-1' }, fixture.dependencies), 1);
  assert.equal(fixture.calls.some((value) => value.startsWith('deploy:')), false);
  assert.equal(fixture.stderr.text, 'ROTATION FAILED\n');
  assert.equal(fixture.stderr.text.includes('resume='), false);
  assert.equal(materialBuffers(fixture).every((value) => value.every((byte) => byte === 0)), true);
});

test('code output failure stops before confirmation and remote writes', async () => {
  const fixture = rotationHarness({ stdout: writer({ throwOnCode: true }) });
  assert.equal(await runTextAccessCodeRotation({ mode: 'rotate', target: 'user-1' }, fixture.dependencies), 1);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.calls.some((value) => value.startsWith('confirm:')), false);
  assert.equal(fixture.stderr.text, 'ROTATION FAILED\n');
  assert.equal(materialBuffers(fixture).every((value) => value.every((byte) => byte === 0)), true);
});

test('CLI rejects unknown and multiple modes before creating remote clients', async () => {
  const stderr = writer();
  const io = {
    stdin: { isTTY: false },
    stdout: { ...writer(), isTTY: false },
    stderr,
  };
  assert.equal(await runTextAccessCodeRotationCli([], io), 1);
  assert.equal(await runTextAccessCodeRotationCli(['--target=user-3'], io), 1);
  assert.equal(await runTextAccessCodeRotationCli(['--target=user-1', '--resume=user-1'], io), 1);
  assert.equal(stderr.text, 'ROTATION FAILED\nROTATION FAILED\nROTATION FAILED\n');
});
