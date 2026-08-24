# Cloudflare Vitest Unicode Path Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run test:edge` start and pass when the repository absolute path contains Chinese or other non-ASCII characters.

**Architecture:** Keep the pinned `@cloudflare/vitest-pool-workers@0.12.21`, because the same unencoded redirect remains in the current upstream implementation. Add a zero-dependency, version-guarded installer patch that changes the fallback service redirect header from a raw filesystem path to `encodeURI(filePath)`. Apply it after installs and immediately before Edge tests so cached or refreshed `node_modules` cannot silently reintroduce the failure.

**Tech Stack:** Node.js ESM, npm lifecycle scripts, Vitest, Cloudflare Workers Vitest pool.

---

### Task 1: Lock the Unicode redirect regression

**Files:**
- Create: `scripts/patch-cloudflare-vitest-unicode-path.test.ts`

- [ ] **Step 1: Write the failing CLI behavior tests**

Create a Node-environment Vitest file that builds a real temporary fake package at a Unicode path, invokes the wished-for patch script as a subprocess, and asserts transformation, idempotence, version guarding, and unknown-layout guarding:

```ts
// @vitest-environment node
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
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
  expect(new Response(null, { headers: { Location: encoded } }).headers.get('location')).toBe(encoded);
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

  expect(runPatch(wrongVersion).status).not.toBe(0);
  expect(runPatch(wrongVersion).stderr).toContain('0.12.21');
  expect(runPatch(wrongLayout).status).not.toBe(0);
  expect(runPatch(wrongLayout).stderr).toContain('bundle layout');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `./node_modules/.bin/vitest run scripts/patch-cloudflare-vitest-unicode-path.test.ts`

Expected: three tests fail because `scripts/patch-cloudflare-vitest-unicode-path.mjs` does not exist and the subprocess exits non-zero.

### Task 2: Add the guarded installer patch

**Files:**
- Create: `scripts/patch-cloudflare-vitest-unicode-path.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement the exact, idempotent source transformation**

Create the ESM script below. It resolves the installed package by its exported config entry, skips only when the development dependency is intentionally absent, requires version `0.12.21`, and fails closed if the bundled source no longer has exactly one known marker:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const supportedVersion = '0.12.21';
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
    throw new Error('Unsupported @cloudflare/vitest-pool-workers bundle layout; review the Unicode redirect patch.');
  }
  return { source: source.replace(originalRedirect, encodedRedirect), changed: true };
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
    if (error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
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
    throw new Error('Usage: patch-cloudflare-vitest-unicode-path.mjs [--package-root <path>]');
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
```

- [ ] **Step 2: Wire install-time and pre-test enforcement**

Add these scripts to `package.json` without changing dependencies:

```json
"patch:cloudflare-vitest": "node scripts/patch-cloudflare-vitest-unicode-path.mjs",
"postinstall": "npm run patch:cloudflare-vitest",
"pretest:edge": "npm run patch:cloudflare-vitest"
```

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run: `./node_modules/.bin/vitest run scripts/patch-cloudflare-vitest-unicode-path.test.ts`

Expected: 3/3 pass.

- [ ] **Step 4: Apply the patch to the current installed package and verify idempotence**

Run twice: `npm run patch:cloudflare-vitest`

Expected first run: `applied`; expected second run: `already patched`.

### Task 3: Verify, commit, and integrate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-cloudflare-vitest-unicode-path.md` only to check completed steps if desired

- [ ] **Step 1: Run isolated-worktree verification**

Run:

```bash
npm test
npm run test:edge
npm run typecheck
npm run typecheck:edge
npm run build
git diff --check
```

Expected: all commands exit 0; Edge reports 610 passing tests.

- [ ] **Step 2: Commit the focused fix**

```bash
git add package.json scripts/patch-cloudflare-vitest-unicode-path.mjs scripts/patch-cloudflare-vitest-unicode-path.test.ts docs/superpowers/plans/2026-08-24-cloudflare-vitest-unicode-path.md
git commit -m "fix: support edge tests in unicode paths"
```

- [ ] **Step 3: Fast-forward local main and patch its installed dependency**

From the main repository root:

```bash
git merge --ff-only codex/food-catalog-text-ai
npm run patch:cloudflare-vitest
```

Expected: `main` advances to the fix commit and the patch command exits 0.

- [ ] **Step 4: Prove the original failure is fixed in the real Unicode path**

From `/Users/ericlu/Documents/ChatGPT/铁证优化/tiezheng`, run:

```bash
npm run test:edge
npm test
npm run typecheck
npm run typecheck:edge
npm run build
git status --short --branch
```

Expected: Edge reports 610/610 instead of the ByteString error; all other commands pass; `main` is clean and remains unpushed.

