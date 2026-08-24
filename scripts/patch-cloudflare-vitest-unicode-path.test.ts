import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'patch-cloudflare-vitest-unicode-path.mjs',
);
const fixtureRoots: string[] = [];
const originalRedirect = 'headers: { Location: filePath }';
const encodedRedirect = 'headers: { Location: encodeURI(filePath) }';

async function createFixture(version = '0.12.21', source = originalRedirect) {
  const root = await mkdtemp(join(tmpdir(), '铁证-cloudflare-vitest-'));
  fixtureRoots.push(root);
  await mkdir(join(root, 'dist/pool'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version }), 'utf8');
  await writeFile(join(root, 'dist/pool/index.mjs'), source, 'utf8');
  return root;
}

function runPatch(root: string) {
  return spawnSync(process.execPath, [scriptPath, '--package-root', root], {
    encoding: 'utf8',
  });
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test('encodes the redirect Location so Unicode paths are valid ByteString headers', async () => {
  const root = await createFixture();
  const result = runPatch(root);

  expect(result.status).toBe(0);
  expect(await readFile(join(root, 'dist/pool/index.mjs'), 'utf8')).toBe(encodedRedirect);
  expect(() => new Response(null, { headers: { Location: '/铁证/index.mjs' } })).toThrow(
    /ByteString/,
  );
  const encoded = encodeURI('/铁证/index.mjs');
  expect(new Response(null, { headers: { Location: encoded } }).headers.get('location')).toBe(
    encoded,
  );
});

test('is idempotent when the exact patch is already present', async () => {
  const root = await createFixture();
  expect(runPatch(root).status).toBe(0);

  const second = runPatch(root);
  expect(second.status).toBe(0);
  expect(second.stdout).toContain('already patched');
});

test('fails closed for an unsupported package version or unknown bundle layout', async () => {
  const wrongVersion = await createFixture('0.12.22');
  const wrongLayout = await createFixture('0.12.21', 'headers: { Location: somethingElse }');
  const wrongVersionResult = runPatch(wrongVersion);
  const wrongLayoutResult = runPatch(wrongLayout);

  expect(wrongVersionResult.status).not.toBe(0);
  expect(wrongVersionResult.stderr).toContain('0.12.21');
  expect(wrongLayoutResult.status).not.toBe(0);
  expect(wrongLayoutResult.stderr).toContain('bundle layout');
});
