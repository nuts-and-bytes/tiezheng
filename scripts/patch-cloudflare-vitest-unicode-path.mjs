import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const supportedVersion = '0.12.21';
// This release writes absolute module paths directly into an HTTP Location header.
// Undici rejects non-ASCII header values as non-ByteString, so encode only that redirect.
const originalRedirect = 'headers: { Location: filePath }';
const encodedRedirect = 'headers: { Location: encodeURI(filePath) }';

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

export function patchModuleFallbackSource(source) {
  const originalCount = countOccurrences(source, originalRedirect);
  const encodedCount = countOccurrences(source, encodedRedirect);

  if (originalCount === 0 && encodedCount === 1) {
    return { source, changed: false };
  }
  if (originalCount !== 1 || encodedCount !== 0) {
    throw new Error(
      'Unsupported @cloudflare/vitest-pool-workers bundle layout; review the Unicode redirect patch.',
    );
  }
  return {
    source: source.replace(originalRedirect, encodedRedirect),
    changed: true,
  };
}

export async function patchPackageRoot(packageRoot) {
  const packageJsonPath = resolve(packageRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.version !== supportedVersion) {
    throw new Error(
      `Expected @cloudflare/vitest-pool-workers ${supportedVersion}, received ${String(packageJson.version)}.`,
    );
  }

  const modulePath = resolve(packageRoot, 'dist/pool/index.mjs');
  const result = patchModuleFallbackSource(await readFile(modulePath, 'utf8'));
  if (result.changed) {
    await writeFile(modulePath, result.source, 'utf8');
  }
  return result.changed;
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
