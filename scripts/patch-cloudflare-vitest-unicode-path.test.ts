import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'patch-cloudflare-vitest-unicode-path.mjs',
);
const fixtureRoots: string[] = [];
const encodedRedirect = 'headers: { Location: encodeURI(filePath) }';
const originalPoolSource = `
function buildRedirectResponse(filePath) {
  return new Response2(null, { status: 301, headers: { Location: filePath } });
}
async function load(vite, logBase, method, target, specifier, filePath) {
  if (target !== filePath) {
  }
  const targetUrl = pathToFileURL(target);
}
async function handleModuleFallbackRequest(vite, request) {
  const method = request.headers.get("X-Resolve-Method");
  const url = new URL(request.url);
  let target = url.searchParams.get("specifier");
  let referrer = url.searchParams.get("referrer");
  assert3(target !== null, "Expected specifier search param");
  assert3(referrer !== null, "Expected referrer search param");
  const referrerDir = posixPath.dirname(referrer);
  let specifier = getApproximateSpecifier(target, referrerDir);
  if (isWindows) {
    if (target[0] === "/") {
      target = target.substring(1);
    }
    if (referrer[0] === "/") {
      referrer = referrer.substring(1);
    }
  }
  try {
    const filePath = await resolve(vite, method, target, specifier, referrer);
    return await load(vite, logBase, method, target, specifier, filePath);
  } catch (e) {
  }
}
async function runTests(stub) {
  const res = await stub.fetch("http://placeholder", {
    headers: {
      Upgrade: "websocket",
      "MF-Vitest-Worker-Data": structuredSerializableStringify({
        filePath: pathToFileURL2(workerPath).href,
        name: method,
        data,
        cwd: process.cwd()
      })
    }
  });
}
`.trim();
const originalWorkerSource = `
const workerDataHeader = request.headers.get("MF-Vitest-Worker-Data");
assert3(workerDataHeader !== null);
const wd = structuredSerializableParse(workerDataHeader);
`.trim();

async function createFixture(
  version = '0.12.21',
  poolSource = originalPoolSource,
  workerSource = originalWorkerSource,
) {
  const root = await mkdtemp(join(tmpdir(), '铁证-cloudflare-vitest-'));
  fixtureRoots.push(root);
  await mkdir(join(root, 'dist/pool'), { recursive: true });
  await mkdir(join(root, 'dist/worker'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version }), 'utf8');
  await writeFile(join(root, 'dist/pool/index.mjs'), poolSource, 'utf8');
  await writeFile(join(root, 'dist/worker/index.mjs'), workerSource, 'utf8');
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

test('patches every Unicode boundary while preserving the workerd module identifier', async () => {
  const root = await createFixture();
  const result = runPatch(root);
  const poolSource = await readFile(join(root, 'dist/pool/index.mjs'), 'utf8');
  const workerSource = await readFile(join(root, 'dist/worker/index.mjs'), 'utf8');

  expect(result.status).toBe(0);
  expect(poolSource).toContain(encodedRedirect);
  expect(poolSource).toContain('let fileTarget = decodeFileSystemPath(target);');
  expect(poolSource).toContain('let fileReferrer = decodeFileSystemPath(referrer);');
  expect(poolSource).toContain('if (fileTarget !== filePath) {');
  expect(poolSource).toContain(
    'return await load(vite, logBase, method, target, specifier, filePath, fileTarget);',
  );
  expect(poolSource).toContain(
    '"MF-Vitest-Worker-Data": encodeURIComponent(structuredSerializableStringify({',
  );
  expect(workerSource).toContain(
    'structuredSerializableParse(decodeURIComponent(workerDataHeader))',
  );
  expect(() => new Response(null, { headers: { Location: '/铁证/index.mjs' } })).toThrow(
    /ByteString/,
  );
  const encoded = encodeURI('/铁证/index.mjs');
  expect(new Response(null, { headers: { Location: encoded } }).headers.get('location')).toBe(
    encoded,
  );
  const workerData = JSON.stringify({ cwd: '/Users/example/铁证' });
  const encodedWorkerData = encodeURIComponent(workerData);
  expect(
    new Response(null, { headers: { 'MF-Vitest-Worker-Data': encodedWorkerData } }).headers.get(
      'mf-vitest-worker-data',
    ),
  ).toBe(encodedWorkerData);
  expect(decodeURIComponent(encodedWorkerData)).toBe(workerData);
});

test('decodes only absolute filesystem paths containing encoded UTF-8', async () => {
  const patchModule = (await import(pathToFileURL(scriptPath).href)) as {
    decodeFileSystemPath?: (value: string) => string;
  };
  const decodeFileSystemPath = patchModule.decodeFileSystemPath;

  expect(decodeFileSystemPath).toBeTypeOf('function');
  if (typeof decodeFileSystemPath !== 'function') return;
  expect(decodeFileSystemPath('/Users/example/%E9%93%81%E8%AF%81/file%2520.ts')).toBe(
    '/Users/example/铁证/file%20.ts',
  );
  expect(decodeFileSystemPath('/Users/example/plain%20file.ts')).toBe(
    '/Users/example/plain%20file.ts',
  );
  expect(decodeFileSystemPath('relative/%E9%93%81%E8%AF%81.ts')).toBe(
    'relative/%E9%93%81%E8%AF%81.ts',
  );
  expect(decodeFileSystemPath('/Users/example/%E9.ts')).toBe('/Users/example/%E9.ts');
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
  const wrongPoolLayout = await createFixture(
    '0.12.21',
    originalPoolSource.replace('headers: { Location: filePath }', 'headers: { Location: other }'),
  );
  const wrongWorkerLayout = await createFixture(
    '0.12.21',
    originalPoolSource,
    'const wd = structuredSerializableParse(otherHeader);',
  );
  const conflictingDecoderLayout = await createFixture(
    '0.12.21',
    originalPoolSource.replace(
      'async function handleModuleFallbackRequest(vite, request) {',
      `function decodeFileSystemPath(value) {
  return value;
}
async function handleModuleFallbackRequest(vite, request) {`,
    ),
  );
  const wrongVersionResult = runPatch(wrongVersion);
  const wrongPoolLayoutResult = runPatch(wrongPoolLayout);
  const wrongWorkerLayoutResult = runPatch(wrongWorkerLayout);
  const conflictingDecoderResult = runPatch(conflictingDecoderLayout);

  expect(wrongVersionResult.status).not.toBe(0);
  expect(wrongVersionResult.stderr).toContain('0.12.21');
  expect(wrongPoolLayoutResult.status).not.toBe(0);
  expect(wrongPoolLayoutResult.stderr).toContain('bundle layout');
  expect(wrongWorkerLayoutResult.status).not.toBe(0);
  expect(wrongWorkerLayoutResult.stderr).toContain('bundle layout');
  expect(conflictingDecoderResult.status).not.toBe(0);
  expect(conflictingDecoderResult.stderr).toContain('path decoder');
});
