# Cloudflare Vitest Unicode Path Fix Implementation Plan

> **For agentic workers:** execute each task with TDD and verify again from a repository path containing non-ASCII characters.

**Goal:** Make `npm run test:edge` start and pass when the repository absolute path contains Chinese or other non-ASCII characters.

**Root cause:** `@cloudflare/vitest-pool-workers@0.12.21` crosses an HTTP-based fallback boundary in three places that assume ASCII-only paths:

1. It writes a raw absolute filesystem path to a `Location` header, which Undici rejects as a non-ByteString.
2. Once the redirect is URI-encoded, workerd keeps that encoded path as the module identifier. The pool must preserve that identifier while decoding separate `target` and `referrer` copies for filesystem resolution.
3. The pool serializes test-worker data containing `cwd` and file paths directly into `MF-Vitest-Worker-Data`, which is another ByteString header.

**Architecture:** Keep the pinned dependency and install a zero-dependency, version-guarded patch across both `dist/pool/index.mjs` and `dist/worker/index.mjs`. Every source transform is exact, idempotent, and fails closed for an unknown bundle layout. Run it after installs and immediately before Edge tests.

**Tech stack:** Node.js ESM, npm lifecycle scripts, Vitest, Cloudflare Workers Vitest pool.

---

### Task 1: Lock the full Unicode protocol regression

**Files:**

- Modify: `scripts/patch-cloudflare-vitest-unicode-path.test.ts`

- [x] Build a real temporary fake package beneath a Unicode path with both pool and worker bundles.
- [x] Assert all three protocol boundaries are patched while the workerd module identifier remains encoded.
- [x] Assert the path decoder only touches absolute paths containing valid encoded UTF-8 and preserves plain, relative, and malformed percent sequences.
- [x] Assert idempotence, the pinned package version, and fail-closed handling for unknown pool or worker layouts.
- [x] Run the focused test before implementation and observe RED: 3 failed, 1 passed.

### Task 2: Implement the guarded two-bundle patch

**Files:**

- Modify: `scripts/patch-cloudflare-vitest-unicode-path.mjs`
- Keep: `package.json`

- [x] Encode the fallback `Location` value with `encodeURI(filePath)`.
- [x] Keep the raw workerd `target` for `buildModuleResponse`, while using decoded `fileTarget` and `fileReferrer` values for resolution, comparison, and source URLs.
- [x] URI-encode `MF-Vitest-Worker-Data` in the pool and decode it in the worker.
- [x] Guard every transform by exact original/patched marker counts and package version `0.12.21`.
- [x] Patch both bundles only after both transforms validate, and retain the production-install skip when the development dependency is absent.
- [x] Run the focused suite: 4/4 passed.
- [x] Run the installer twice from a partially patched dependency: `applied`, then `already patched`.
- [x] Run the isolated ASCII-path Edge suite: 610/610 passed.

### Task 3: Verify in the real Unicode path and integrate locally

- [x] Install the formal patch into `/Users/ericlu/Documents/ChatGPT/铁证优化/tiezheng/node_modules`.
- [x] Run `npm run test:edge` from the real Unicode path and require 610/610.
- [ ] Run `npm test`, `npm run typecheck`, `npm run typecheck:edge`, `npm run build`, and `git diff --check`.
- [x] Review the focused diff and confirm no tracked dependency files or unrelated user changes were touched.
- [ ] Commit the follow-up fix on `codex/food-catalog-text-ai`.
- [ ] Fast-forward local `main`, rerun the critical checks there, and leave the branch unpushed.

Expected final state: the Edge suite passes from the real Chinese path, the installer is idempotent, local `main` is clean and ahead of `origin/main`, and no push or deployment occurs.
