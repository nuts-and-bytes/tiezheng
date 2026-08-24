import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const supportedVersion = '0.12.21';
// This pinned release transports filesystem paths through HTTP-style headers.
// Keep workerd's URI-encoded module identity separate from decoded filesystem paths.
const originalRedirect = 'headers: { Location: filePath }';
const encodedRedirect = 'headers: { Location: encodeURI(filePath) }';
const originalLoadSignature =
  'async function load(vite, logBase, method, target, specifier, filePath) {';
const patchedLoadSignature =
  'async function load(vite, logBase, method, target, specifier, filePath, fileTarget = target) {';
const originalLoadComparison = '  if (target !== filePath) {';
const patchedLoadComparison = '  if (fileTarget !== filePath) {';
const originalTargetUrl = '  const targetUrl = pathToFileURL(target);';
const patchedTargetUrl = '  const targetUrl = pathToFileURL(fileTarget);';
const handlerDeclaration = 'async function handleModuleFallbackRequest(vite, request) {';
const originalPathSetup = `  const referrerDir = posixPath.dirname(referrer);
  let specifier = getApproximateSpecifier(target, referrerDir);`;
const patchedPathSetup = `  let fileTarget = decodeFileSystemPath(target);
  let fileReferrer = decodeFileSystemPath(referrer);
  const referrerDir = posixPath.dirname(fileReferrer);
  let specifier = getApproximateSpecifier(fileTarget, referrerDir);`;
const originalWindowsPaths = `  if (isWindows) {
    if (target[0] === "/") {
      target = target.substring(1);
    }
    if (referrer[0] === "/") {
      referrer = referrer.substring(1);
    }
  }`;
const patchedWindowsPaths = `  if (isWindows) {
    if (target[0] === "/") {
      target = target.substring(1);
    }
    if (fileTarget[0] === "/") {
      fileTarget = fileTarget.substring(1);
    }
    if (referrer[0] === "/") {
      referrer = referrer.substring(1);
    }
    if (fileReferrer[0] === "/") {
      fileReferrer = fileReferrer.substring(1);
    }
  }`;
const originalResolveAndLoad = `    const filePath = await resolve(vite, method, target, specifier, referrer);
    return await load(vite, logBase, method, target, specifier, filePath);`;
const patchedResolveAndLoad = `    const filePath = await resolve(vite, method, fileTarget, specifier, fileReferrer);
    return await load(vite, logBase, method, target, specifier, filePath, fileTarget);`;
const originalWorkerDataHeader = `      "MF-Vitest-Worker-Data": structuredSerializableStringify({
        filePath: pathToFileURL2(workerPath).href,
        name: method,
        data,
        cwd: process.cwd()
      })`;
const patchedWorkerDataHeader = `      "MF-Vitest-Worker-Data": encodeURIComponent(structuredSerializableStringify({
        filePath: pathToFileURL2(workerPath).href,
        name: method,
        data,
        cwd: process.cwd()
      }))`;
const originalWorkerDataParse = 'const wd = structuredSerializableParse(workerDataHeader);';
const patchedWorkerDataParse =
  'const wd = structuredSerializableParse(decodeURIComponent(workerDataHeader));';

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExact(source, original, patched, label) {
  const originalCount = countOccurrences(source, original);
  const patchedCount = countOccurrences(source, patched);

  if (originalCount === 0 && patchedCount === 1) {
    return { source, changed: false };
  }
  if (originalCount !== 1 || patchedCount !== 0) {
    throw new Error(
      `Unsupported @cloudflare/vitest-pool-workers bundle layout (${label}); review the Unicode path patch.`,
    );
  }
  return {
    source: source.replace(original, patched),
    changed: true,
  };
}

export function decodeFileSystemPath(value) {
  const encodedUtf8 = /%(?:C[2-9A-F]|D[0-9A-F]|E[0-9A-F]|F[0-4])(?:%[89AB][0-9A-F])+/i;
  if (value.startsWith('/') && encodedUtf8.test(value)) {
    try {
      return decodeURI(value);
    } catch {
      // Keep malformed or user-authored percent sequences unchanged.
    }
  }
  return value;
}

function injectPathDecoder(source) {
  const helperSource = decodeFileSystemPath.toString();
  const helperCount = countOccurrences(source, helperSource);
  const helperDeclarationCount = countOccurrences(
    source,
    'function decodeFileSystemPath(value) {',
  );
  const handlerCount = countOccurrences(source, handlerDeclaration);

  if (
    handlerCount !== 1 ||
    helperDeclarationCount > 1 ||
    (helperDeclarationCount === 1 && helperCount !== 1)
  ) {
    throw new Error(
      'Unsupported @cloudflare/vitest-pool-workers bundle layout (path decoder); review the Unicode path patch.',
    );
  }
  if (helperCount === 1) {
    return { source, changed: false };
  }
  return {
    source: source.replace(handlerDeclaration, `${helperSource}\n${handlerDeclaration}`),
    changed: true,
  };
}

function applyTransforms(source, transforms) {
  let changed = false;
  for (const [original, patched, label] of transforms) {
    const result = replaceExact(source, original, patched, label);
    source = result.source;
    changed ||= result.changed;
  }
  return { source, changed };
}

export function patchModuleFallbackSource(source) {
  const result = applyTransforms(source, [
    [originalRedirect, encodedRedirect, 'redirect header'],
    [originalLoadSignature, patchedLoadSignature, 'load signature'],
    [originalLoadComparison, patchedLoadComparison, 'filesystem comparison'],
    [originalTargetUrl, patchedTargetUrl, 'source URL'],
    [originalPathSetup, patchedPathSetup, 'target and referrer paths'],
    [originalWindowsPaths, patchedWindowsPaths, 'Windows paths'],
    [originalResolveAndLoad, patchedResolveAndLoad, 'resolve and load'],
    [originalWorkerDataHeader, patchedWorkerDataHeader, 'worker data header'],
  ]);
  const decoderResult = injectPathDecoder(result.source);
  return {
    source: decoderResult.source,
    changed: result.changed || decoderResult.changed,
  };
}

export function patchWorkerSource(source) {
  return replaceExact(
    source,
    originalWorkerDataParse,
    patchedWorkerDataParse,
    'worker data parse',
  );
}

export async function patchPackageRoot(packageRoot) {
  const packageJsonPath = resolve(packageRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.version !== supportedVersion) {
    throw new Error(
      `Expected @cloudflare/vitest-pool-workers ${supportedVersion}, received ${String(packageJson.version)}.`,
    );
  }

  const poolPath = resolve(packageRoot, 'dist/pool/index.mjs');
  const workerPath = resolve(packageRoot, 'dist/worker/index.mjs');
  const [poolSource, workerSource] = await Promise.all([
    readFile(poolPath, 'utf8'),
    readFile(workerPath, 'utf8'),
  ]);
  const poolResult = patchModuleFallbackSource(poolSource);
  const workerResult = patchWorkerSource(workerSource);
  const writes = [];
  if (poolResult.changed) {
    writes.push(writeFile(poolPath, poolResult.source, 'utf8'));
  }
  if (workerResult.changed) {
    writes.push(writeFile(workerPath, workerResult.source, 'utf8'));
  }
  await Promise.all(writes);
  return poolResult.changed || workerResult.changed;
}

function resolveInstalledPackageRoot() {
  const require = createRequire(import.meta.url);
  try {
    return resolve(dirname(require.resolve('@cloudflare/vitest-pool-workers/config')), '../..');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    ) {
      return null;
    }
    throw error;
  }
}

async function main(args) {
  let packageRoot;
  if (args.length === 0) {
    packageRoot = resolveInstalledPackageRoot();
    if (packageRoot === null) {
      console.log('[cloudflare-vitest-patch] development dependency absent; skipped');
      return;
    }
  } else if (args.length === 2 && args[0] === '--package-root') {
    packageRoot = resolve(args[1]);
  } else {
    throw new Error(
      'Usage: patch-cloudflare-vitest-unicode-path.mjs [--package-root <path>]',
    );
  }

  const changed = await patchPackageRoot(packageRoot);
  console.log(`[cloudflare-vitest-patch] ${changed ? 'applied' : 'already patched'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
