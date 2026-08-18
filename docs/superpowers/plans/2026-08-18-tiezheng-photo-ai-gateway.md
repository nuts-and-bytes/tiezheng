# 铁证照片 AI Cloudflare 网关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不公开 Worker、不把原图落盘、不开生产入口的前提下，交付可本地自动验证的 Cloudflare Access 入口、私有照片 Worker、Images 重编码、豆包结构化输出、Durable Object 原子配额/幂等/预算和安全日志。

**Architecture:** Pages Function 只验证同源请求、Cloudflare Access JWT 和三邮箱白名单，再通过 Service Binding 把伪匿名账号键与请求流交给无公网路由的 `tiezheng-photo-ai-gateway` Worker。该 Worker持有 Images、Ark Secret 与单个 SQLite-backed Durable Object；图片只在内存中重编码和 Base64 调用模型，候选结果以 AES-GCM 密文短时存入协调器。Durable Object 的每次 reserve/mark/settle 都是同步 SQL 事务，不跨外部 I/O 持锁。

**Tech Stack:** Cloudflare Pages Functions、Cloudflare Workers、Service Bindings、Images Binding、SQLite-backed Durable Objects、Wrangler 4.123.0、Workers Types 5.20260818.1、Workers Vitest Pool 0.12.21、jose 6.2.9、Vitest 3、Web Crypto、Volcengine Ark Responses API。

---

## Prerequisite and scope guard

先完成 `docs/superpowers/plans/2026-08-18-tiezheng-photo-ai-local-flow.md` 并取得本计划自己的 Claude Code + Codex GREEN receipt。未取得 receipt 且用户未明确书面豁免时不得编码。

本计划只交付关闭状态的网关候选：

- `workers_dev:false`，不配置公网 route；
- `PHOTO_AI_GATEWAY_ENABLED:false`；
- 不在 GitHub Actions 自动部署；
- 不添加真实邮箱、Audience、Team Domain、API Key、HMAC Key 或 AES Key；
- 普通 CI 只用假 JWKS、假 Images、假模型和本地 Durable Object；
- 真实绑定、Preview、三个账号和生产放行属于第三份计划。

Cloudflare 官方当前约束要求 Durable Object 由 Worker 创建，不能在 Pages 项目内创建；Images 原始字节 Binding 也在 Worker 配置。因此 Pages 项目只保留最小 Function 与 Service Binding 边界，不把模型调用塞进浏览器或 Pages 构建变量。

## File map

### Root/tooling

- Modify `package.json`, `package-lock.json`, `vite.config.ts`, `.gitignore`
- Create `tsconfig.edge.json`, `vitest.edge.config.ts`

### Pages Access boundary

- Create `edge/photo-ai/access.ts`, `.test.ts`
- Create `edge/photo-ai/pagesRequest.ts`, `.test.ts`
- Create `edge/photo-ai/pagesProxy.ts`, `.test.ts`
- Create `edge/photo-ai/pagesRoutes.test.ts`
- Create `functions/api/nutrition/photo/session.ts`
- Create `functions/api/nutrition/photo/estimate.ts`
- Create `functions/api/nutrition/photo/logout.ts`
- Create `public/_routes.json`

### Private Worker

- Create `workers/photo-ai-gateway/wrangler.jsonc`
- Create `workers/photo-ai-gateway/src/env.ts`
- Create `workers/photo-ai-gateway/src/imageFirewall.ts`, `.test.ts`
- Create `workers/photo-ai-gateway/src/doubaoSchema.ts`, `.test.ts`
- Create `workers/photo-ai-gateway/src/doubaoAdapter.ts`, `.test.ts`
- Create `workers/photo-ai-gateway/src/cryptoCache.ts`, `.test.ts`
- Create `workers/photo-ai-gateway/src/coordinator.ts`
- Create `workers/photo-ai-gateway/src/coordinator.worker.test.ts`
- Create `workers/photo-ai-gateway/src/handler.ts`, `.test.ts`
- Create `workers/photo-ai-gateway/src/index.ts`
- Create `workers/photo-ai-gateway/test/env.d.ts`

## Fixed release and limit contract

The gateway imports `PHOTO_AI_VERSIONS`, `PHOTO_AI_LIMITS`, response parsers and `applyPhotoUncertaintyV1` from the local-flow commit. It may not duplicate their literals.

The lowercase SHA-256 request fingerprint is the stable JSON of exactly `accountKey`, `uploadBlobSha256`, `transformVersion`, `modelVersion`, `promptVersion`, `schemaVersion`, `catalogVersion`, `uncertaintyVersion`, and `providerPolicyVersion`. It excludes idempotency key, request ID, timestamps, email, IP, date and meal slot.

Gateway-only constants are exact:

```ts
export const GATEWAY_LIMITS = {
  accountDaily: 10,
  accountPerMinute: 2,
  accountConcurrent: 1,
  globalDaily: 30,
  globalConcurrent: 2,
  monthlyBudgetMicros: 50_000_000,
  initialAttemptReserveMicros: 2_000_000,
  retryAttemptReserveMicros: 2_000_000,
  leaseMs: 60_000,
  resultCacheMs: 10 * 60_000,
  idempotencyMs: 24 * 60 * 60_000,
  providerTimeoutMs: 12_000,
  maxInputTokens: 256_000,
  maxOutputTokens: 1500,
  maxMultipartBytes: 1_100_000,
  maxDecodedPixels: 40_000_000,
  maxDimension: 12_000,
  maxAspectRatio: 20,
} as const;
```

Money uses integer micro-yuan. At the approved public prices, known usage costs exactly:

```ts
export function arkCostMicros(inputTokens: number, outputTokens: number): number {
  return inputTokens * 6 + outputTokens * 30;
}
```

Both token counts must be non-negative safe integers and the result must be a safe integer.

The ¥2 reserve is deliberately conservative: 256,000 input tokens at ¥6/million plus 1,500 output tokens at ¥30/million is ¥1.581. Before real release, the third plan must reconfirm the exact model context and price; if either bound increases, raise the reserve before enabling. A timeout with no usage report spends the full ¥2 reservation, so repeated unknown failures close the service early instead of risking budget overshoot.

The private Worker environment is exact:

```ts
export interface GatewayEnv {
  IMAGES: ImagesBinding;
  PHOTO_AI_COORDINATOR: DurableObjectNamespace<PhotoAiCoordinator>;
  PHOTO_AI_GATEWAY_ENABLED: string;
  PHOTO_AI_MODEL: string;
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_MONTHLY_BUDGET_MICROS: string;
  ARK_API_KEY: string;
  PHOTO_AI_CACHE_AES_KEY: string;
}
```

Secrets are required only when the exact gateway flag is `true`; when false, every user request returns `service-disabled` before reading the body or touching bindings.

### Task 0: Install exact edge dependencies and isolate edge tests

**Files:** Modify `package.json`, `package-lock.json`, `vite.config.ts`; create edge configs.

- [ ] **Step 1: Install exact versions**

Run:

```bash
npm install --save-exact jose@6.2.9
npm install --save-dev --save-exact wrangler@4.123.0 @cloudflare/workers-types@5.20260818.1 @cloudflare/vitest-pool-workers@0.12.21
```

Expected: package lock changes only through npm. `0.12.21` is intentional: its peer range is Vitest `2.0.x - 3.2.x`, which includes this repository's Vitest 3.1.4. Do not replace it with current `0.21.3`, whose peer contract requires Vitest 4.1.

- [ ] **Step 2: Add scripts**

Add exactly:

```json
{
  "scripts": {
    "test:edge": "vitest run --config vitest.edge.config.ts",
    "typecheck:edge": "tsc --noEmit -p tsconfig.edge.json",
    "dev:photo-worker": "wrangler dev --config workers/photo-ai-gateway/wrangler.jsonc",
    "deploy:photo-worker": "wrangler deploy --config workers/photo-ai-gateway/wrangler.jsonc"
  }
}
```

Keep all existing scripts.

- [ ] **Step 3: Configure separate type and runtime pools**

`tsconfig.edge.json` uses `ES2022`, `Bundler`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `lib:["ES2022","WebWorker"]`, `types:["@cloudflare/workers-types","vitest/globals"]`, and includes only `edge`, `functions`, `workers`, `src/lib/photoAiContract.ts`, `src/lib/photoAiCandidate.ts`, and `vitest.edge.config.ts`.

`vite.config.ts` excludes `workers/**/*.worker.test.ts` from the jsdom suite while retaining Vitest defaults. `vitest.edge.config.ts` uses `defineWorkersConfig` and the Worker Wrangler file so Durable Object tests run in workerd.

- [ ] **Step 4: Run tooling RED/GREEN and commit**

Before adding config, `npm run test:edge` and `npm run typecheck:edge` must fail because the scripts do not exist. After config:

```bash
npm run typecheck
npm run typecheck:edge
npm test
npm run test:edge -- --passWithNoTests
git diff --check
git add package.json package-lock.json vite.config.ts tsconfig.edge.json vitest.edge.config.ts .gitignore
git commit -m "build: add Cloudflare photo gateway tooling"
```

### Task 1: Verify Access JWT, exact allowlist, origin, and pseudonymous account key

**Files:** Create `edge/photo-ai/access.ts/.test.ts`, `edge/photo-ai/pagesRequest.ts/.test.ts`.

- [ ] **Step 1: Write RED Access tests**

Generate an ephemeral RS256 key pair in tests and expose a fake JWKS fetcher. Cover missing header, malformed JWT, wrong algorithm, signature, issuer, audience, expired/not-yet-valid token, missing sub/email, non-string claims, allowlist miss, mixed-case allowed email, more/fewer than exactly three configured emails, and remote JWKS failure.

Assert successful output is only:

```ts
export interface AccessIdentity {
  accountKey: string;
  expiresAt: number;
}
```

It must not contain email, sub or raw JWT. `accountKey` is lowercase 64-hex HMAC-SHA-256 of Access `sub` with `PHOTO_AI_ACCOUNT_HMAC_KEY`.

- [ ] **Step 2: Write RED request-boundary tests**

Cover:

- only the exact configured Preview origin succeeds;
- production origin `https://tiezheng.pages.dev`, arbitrary `*.pages.dev`, HTTP, userinfo, ports, suffix attacks and missing Origin on POST are rejected;
- POST requires `Sec-Fetch-Site:same-origin`;
- JSON session fetch allows same-origin;
- resume navigation allows missing Origin and cross-site Access callback but validates exact request host and JWT;
- unsupported method, body, content type and content length fail before proxy;
- no reflected CORS origin and no wildcard CORS.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- edge/photo-ai/access.test.ts edge/photo-ai/pagesRequest.test.ts
```

Expected: module-not-found failures.

- [ ] **Step 4: Implement exact env validation and JWT verification**

`access.ts` exports:

```ts
export interface AccessEnv {
  PHOTO_AI_TEAM_DOMAIN: string;
  PHOTO_AI_ACCESS_AUD: string;
  PHOTO_AI_ALLOWED_EMAILS: string;
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
}

export interface AccessConfig {
  issuer: string;
  audience: string;
  allowedEmails: ReadonlySet<string>;
  accountHmacSecret: string;
}

export function parseAccessConfig(env: AccessEnv): AccessConfig;
export function verifyAccess(
  request: Request,
  config: AccessConfig,
  fetcher?: typeof fetch,
): Promise<AccessIdentity>;
```

Use `createRemoteJWKSet` and `jwtVerify` from `jose`, restrict `algorithms:['RS256']`, exact issuer/audience, 30-second clock tolerance, and never log caught token/JWKS content. Parse the allowlist into exactly three distinct normalized addresses.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- edge/photo-ai/access.test.ts edge/photo-ai/pagesRequest.test.ts
npm run typecheck:edge
git diff --check
git add edge/photo-ai/access.ts edge/photo-ai/access.test.ts edge/photo-ai/pagesRequest.ts edge/photo-ai/pagesRequest.test.ts
git commit -m "feat: authenticate photo AI requests at Pages"
```

### Task 2: Build a strict image firewall and Images adapter

**Files:** Create Worker env and image firewall files.

- [ ] **Step 1: Write RED container and transformation tests**

Cover valid JPEG/PNG/WebP, MIME/magic mismatch, GIF/SVG/PDF/HEIC, truncated data, APNG `acTL`, animated WebP `ANIM/ANMF`, JPEG MPO `MPF`, more than 1 MB image part, more than 1.1 MB multipart, invalid dimensions, more than 40 MP, dimension above 12000, aspect ratio above 20, hash mismatch, Images `.info()` disagreement, and transformed output above 1 MB or not WebP.

The fake Images adapter must prove `.info()` and `.input()` receive independent streams, transform longest edge is 1600, output is `{format:'image/webp', quality:80, anim:false}`, and Cache/R2/KV are never called.

- [ ] **Step 2: Run RED**

Run `npm test -- workers/photo-ai-gateway/src/imageFirewall.test.ts`.

- [ ] **Step 3: Implement the firewall**

Export:

```ts
export interface SanitizedImage {
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
  mime: 'image/webp';
}

export interface BoundedPhotoUpload {
  bytes: Uint8Array;
  metadata: PhotoAiRequestMetadata;
}

export async function readPhotoUpload(request: Request): Promise<BoundedPhotoUpload>;
export async function sanitizeImage(
  upload: BoundedPhotoUpload,
  images: ImagesBinding,
): Promise<SanitizedImage>;
```

Check method/origin/content type/content length in Pages before the Worker and repeat content length/multipart/image constraints in the Worker. `readPhotoUpload` reads at most `maxMultipartBytes + 1`; it may not call `request.arrayBuffer()` without a bound. It recomputes the upload hash, compares constant-time and performs cheap container checks. The handler computes the request fingerprint and reserves minute/quota/concurrency/budget before `sanitizeImage` invokes Images. Any sanitation failure calls `abortBeforeInvoke`, releasing pending daily quota, concurrency and model cost while retaining the minute attempt. Discard original bytes as soon as sanitized bytes exist.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- workers/photo-ai-gateway/src/imageFirewall.test.ts
npm run typecheck:edge
git diff --check
git add workers/photo-ai-gateway/src/env.ts workers/photo-ai-gateway/src/imageFirewall.ts workers/photo-ai-gateway/src/imageFirewall.test.ts
git commit -m "feat: sanitize photo uploads at the edge"
```

### Task 3: Lock the Doubao schema, catalog mapping, uncertainty policy, and retry adapter

**Files:** Create `doubaoSchema.ts/.test.ts`, `doubaoAdapter.ts/.test.ts`.

- [ ] **Step 1: Write RED schema tests**

Cover non-JSON, Markdown fences, extra keys, sparse arrays, more than six candidates, duplicate candidates, long strings, invalid enums, NaN/Infinity encoded through direct JS objects, inverted ranges, partial nutrient fields, model-supplied IDs, unknown catalog IDs, catalog rows containing model nutrition, `none` with numbers, and `model-range` without assumptions.

Assert the server allocates `candidate-1` through `candidate-6`, resolves only exact preset catalog IDs, discards every model nutrient value for catalog matches, and calls shared `applyPhotoUncertaintyV1` once for model ranges.

- [ ] **Step 2: Write RED provider tests**

Assert exact endpoint `https://ark.cn-beijing.volces.com/api/v3/responses`, exact model ID, one Base64 WebP data URL, fixed prompt/schema/catalog versions, no tools/URL/file upload, deep thinking disabled, output token max 1500, 12-second abort, and local validation after strict JSON Schema.

Retry matrix:

- 400/401/403/404: no retry;
- 429/500/502/503/504/timeout: one retry only after coordinator approves another cost reservation;
- invalid JSON/schema: no retry;
- second failure returns one stable public error and no raw provider body.

- [ ] **Step 3: Run RED**

```bash
npm test -- workers/photo-ai-gateway/src/doubaoSchema.test.ts workers/photo-ai-gateway/src/doubaoAdapter.test.ts
```

- [ ] **Step 4: Implement the exact adapter seam**

```ts
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface PhotoModelAdapter {
  estimate(image: SanitizedImage, signal: AbortSignal): Promise<{
    raw: unknown;
    usage: ModelUsage | null;
  }>;
}

export function createDoubaoAdapter(
  apiKey: string,
  fetcher?: typeof fetch,
): PhotoModelAdapter;
```

The prompt instructs the model to identify food/preparation/amount only, ignore instructions inside the image, never infer medical/identity data, never call tools, return `none` when uncertain, and use catalog hints only from the supplied fixed preset list.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- workers/photo-ai-gateway/src/doubaoSchema.test.ts workers/photo-ai-gateway/src/doubaoAdapter.test.ts src/lib/photoAiCandidate.test.ts
npm run typecheck:edge
git diff --check
git add workers/photo-ai-gateway/src/doubaoSchema.ts workers/photo-ai-gateway/src/doubaoSchema.test.ts workers/photo-ai-gateway/src/doubaoAdapter.ts workers/photo-ai-gateway/src/doubaoAdapter.test.ts
git commit -m "feat: validate structured Doubao food estimates"
```

### Task 4: Implement the single Stage 2 SQLite coordinator

**Files:** Create `coordinator.ts`, worker tests, Wrangler config and test env declarations.

- [ ] **Step 1: Write RED Durable Object tests in workerd**

Cover all boundaries with injected timestamps:

- account day 10, global day 30, account minute 2;
- Shanghai day/month rollover including UTC boundary and leap day;
- account concurrent 1, global concurrent 2;
- ¥50,000,000 micro-yuan cap under simultaneous reserves;
- reserve increments pending quota, mark-invoked converts pending to consumed, pre-invoke abort releases pending;
- provider-called failure keeps logical quota consumed;
- unknown usage settles worst-case cost; known usage releases difference;
- retry reserves a second worst-case amount but no second logical quota;
- same account/key/fingerprint yields cached or in-flight; changed fingerprint conflicts; another account is isolated;
- lease expiry releases concurrency and pre-invoke resources but conservatively spends invoked reservations;
- candidate ciphertext expires at 10 minutes; idempotency row remains 24 hours;
- account/global disable, re-enable and status;
- a previously unseen account is disabled by default until the private admin operation explicitly enables it;
- Durable Object eviction preserves counters/idempotency and no in-memory-only correctness dependency;
- SQL contains no email, IP, image, Base64, food name, weight, date/slot or health target.

- [ ] **Step 2: Run RED**

```bash
npm run test:edge -- workers/photo-ai-gateway/src/coordinator.worker.test.ts
```

Expected: missing Worker/config failure.

- [ ] **Step 3: Add the Worker config**

Create `workers/photo-ai-gateway/wrangler.jsonc`:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "tiezheng-photo-ai-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-18",
  "workers_dev": false,
  "images": { "binding": "IMAGES" },
  "durable_objects": {
    "bindings": [
      { "name": "PHOTO_AI_COORDINATOR", "class_name": "PhotoAiCoordinator" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["PhotoAiCoordinator"] }
  ],
  "vars": {
    "PHOTO_AI_GATEWAY_ENABLED": "false",
    "PHOTO_AI_MODEL": "doubao-seed-2-1-pro-260628",
    "PHOTO_AI_ALLOWED_ORIGINS": "https://photo-ai-stage2.tiezheng.pages.dev",
    "PHOTO_AI_MONTHLY_BUDGET_MICROS": "50000000"
  }
}
```

Do not add secrets or routes.

- [ ] **Step 4: Create the synchronous SQL state machine**

`PhotoAiCoordinator` extends `DurableObject<GatewayEnv>`. In its constructor create `idempotency`, `daily_counters`, `minute_counters`, `active_leases`, `account_flags`, and `settings`. Every mutating RPC uses `ctx.storage.transactionSync`; SQL cursors are fully consumed before any await.

Export typed RPCs:

```ts
export interface StatusInput {
  accountKey: string;
  now: number;
}

export interface CoordinatorStatus {
  enabled: boolean;
  accountEnabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  accountConcurrent: number;
  globalConcurrent: number;
  budgetSpentMicros: number;
  budgetReservedMicros: number;
  resetAt: string;
}

export interface ReserveInput {
  accountKey: string;
  idempotencyKey: string;
  fingerprint: string;
  now: number;
  reserveMicros: number;
}

export interface EncryptedCandidateCache {
  ivBase64: string;
  ciphertextBase64: string;
  expiresAt: number;
}

export type ReserveResult =
  | { kind: 'reserved'; leaseId: string }
  | { kind: 'cached'; cache: EncryptedCandidateCache }
  | { kind: 'in-flight'; retryAfterMs: number }
  | {
      kind: 'rejected';
      code: 'service-disabled' | 'quota-exceeded' | 'rate-limited' | 'budget-exceeded' | 'idempotency-conflict';
      retryAt: string | null;
      resetAt: string | null;
    };

export interface LeaseInput {
  accountKey: string;
  idempotencyKey: string;
  fingerprint: string;
  leaseId: string;
  now: number;
}

export interface SettleSuccessInput extends LeaseInput {
  cache: EncryptedCandidateCache;
  actualCostMicros: number;
}

export interface SettleFailureInput extends LeaseInput {
  actualCostMicros: number | null;
  errorCode: 'provider-timeout' | 'provider-unavailable' | 'invalid-estimate';
}

status(input: StatusInput): Promise<CoordinatorStatus>;
reserve(input: ReserveInput): Promise<ReserveResult>;
markInvoked(input: LeaseInput): Promise<void>;
reserveRetryCost(input: LeaseInput): Promise<void>;
abortBeforeInvoke(input: LeaseInput): Promise<void>;
settleSuccess(input: SettleSuccessInput): Promise<void>;
settleFailure(input: SettleFailureInput): Promise<void>;
setGlobalEnabled(enabled: boolean): Promise<void>;
setAccountEnabled(accountKey: string, enabled: boolean): Promise<void>;
deleteAccount(accountKey: string): Promise<void>;
```

The coordinator never performs `fetch`, Images, encryption or model work. The approved single global object is a bounded three-account beta exception; any account expansion requires a new sharding ADR.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:edge -- workers/photo-ai-gateway/src/coordinator.worker.test.ts
npm run typecheck:edge
git diff --check
git add workers/photo-ai-gateway/wrangler.jsonc workers/photo-ai-gateway/src/coordinator.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts workers/photo-ai-gateway/test/env.d.ts
git commit -m "feat: coordinate photo AI quotas atomically"
```

### Task 5: Encrypt cached candidates and orchestrate the private Worker

**Files:** Create `cryptoCache.ts/.test.ts`, `handler.ts/.test.ts`, `index.ts`.

- [ ] **Step 1: Write RED AES-GCM tests**

Test a 32-byte Base64 key, random 96-bit IV, fingerprint as additional authenticated data, round trip, wrong key/fingerprint/IV/ciphertext, malformed key, expired ciphertext, deterministic JSON serialization and absence of plaintext food names in stored bytes.

- [ ] **Step 2: Write RED end-to-end fake-adapter tests**

Using fake Images, model and coordinator, cover:

1. disabled/missing secret/binding fails before body/model;
2. pre-invoke validation failure aborts reserve and consumes no logical quota;
3. mark-invoked occurs immediately before provider fetch;
4. success stores only ciphertext and settles actual usage;
5. same completed request decrypts cached result without Images/model;
6. same in-flight request returns 202; changed fingerprint returns 409;
7. 429/5xx/timeout retries once only after retry-cost reserve;
8. invalid model output consumes logical quota and returns `invalid-estimate`;
9. timeout with unknown usage spends worst-case;
10. thrown encryption/settle/logging errors do not leak provider body, image, email or candidate text;
11. response always has `Cache-Control:no-store`, `X-Content-Type-Options:nosniff`, fixed JSON type and no stack;
12. every success echoes the exact release versions and current request fingerprint.

- [ ] **Step 3: Run RED**

```bash
npm test -- workers/photo-ai-gateway/src/cryptoCache.test.ts workers/photo-ai-gateway/src/handler.test.ts
```

- [ ] **Step 4: Implement handler ordering**

Ordering is authoritative:

```text
validate gateway config and account key
→ bounded multipart read, upload hash and cheap container validation
→ compute full request fingerprint
→ coordinator.reserve
→ return cached/in-flight/conflict when applicable
→ Images info, decode and WebP sanitation
→ on sanitation failure coordinator.abortBeforeInvoke
→ coordinator.markInvoked
→ call model attempt 1
→ if retryable: coordinator.reserveRetryCost, then attempt 2
→ validate/widen/map candidates
→ AES-GCM encrypt result
→ coordinator.settleSuccess or settleFailure
→ release all image/provider references
→ return no-store JSON
```

The Worker exports only the default fetch handler and `PhotoAiCoordinator`. No route is configured. Use `env.PHOTO_AI_COORDINATOR.getByName('stage2')`.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- workers/photo-ai-gateway/src/cryptoCache.test.ts workers/photo-ai-gateway/src/handler.test.ts
npm run test:edge -- workers/photo-ai-gateway/src/coordinator.worker.test.ts
npm run typecheck:edge
git diff --check
git add workers/photo-ai-gateway/src/cryptoCache.ts workers/photo-ai-gateway/src/cryptoCache.test.ts workers/photo-ai-gateway/src/handler.ts workers/photo-ai-gateway/src/handler.test.ts workers/photo-ai-gateway/src/index.ts
git commit -m "feat: orchestrate private photo AI inference"
```

### Task 6: Add the three Pages Function routes and service proxy

**Files:** Create pages proxy and route files.

- [ ] **Step 1: Write RED proxy/route tests**

Directly call exported Pages handlers with fake context. Cover:

- session JSON, fixed `/health?photoAi=resume` redirect and fixed logout URL;
- no caller-controlled `return` is read or reflected;
- JWT/allowlist/origin errors never call service;
- missing service binding returns `service-disabled`;
- estimate forwards body stream once, only account key plus required original headers, and never email/sub/JWT;
- downstream status/body preserved only for approved JSON statuses;
- downstream HTML/stack/oversized body maps to `provider-unavailable`;
- all responses no-store/nosniff and no permissive CORS.
- `public/_routes.json` invokes Functions only for `/api/nutrition/photo/*` and `/api/nutrition/photo-admin/*`, never all static asset requests.

- [ ] **Step 2: Run RED**

```bash
npm test -- edge/photo-ai/pagesProxy.test.ts edge/photo-ai/pagesRoutes.test.ts
```

Keep all route tests under `edge/photo-ai/pagesRoutes.test.ts` and import the three handlers there; do not place `*.test.ts` below `functions/`, because every source file below that directory participates in Pages routing.

- [ ] **Step 3: Implement the service binding contract**

Pages env is exact:

```ts
export interface PhotoAiPagesEnv extends AccessEnv {
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_GATEWAY?: Fetcher;
}
```

`session?resume=1` authenticates and redirects to the fixed same-origin path. Normal session and estimate call the service binding. Logout authenticates POST and returns `{logoutUrl:'/cdn-cgi/access/logout'}` without calling the Worker.

Create exact routing metadata:

```json
{
  "version": 1,
  "include": [
    "/api/nutrition/photo/*",
    "/api/nutrition/photo-admin/*"
  ],
  "exclude": []
}
```

Vite copies this file to `dist/_routes.json`; route tests must fail if `/*` or a static path is ever included.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- edge/photo-ai/access.test.ts edge/photo-ai/pagesRequest.test.ts edge/photo-ai/pagesProxy.test.ts edge/photo-ai/pagesRoutes.test.ts
npm run typecheck:edge
git diff --check
git add edge/photo-ai/pagesProxy.ts edge/photo-ai/pagesProxy.test.ts edge/photo-ai/pagesRoutes.test.ts functions/api/nutrition/photo/session.ts functions/api/nutrition/photo/estimate.ts functions/api/nutrition/photo/logout.ts public/_routes.json
git commit -m "feat: proxy Access-gated photo AI routes"
```

### Task 7: Close security, logging, and CI gaps

**Files:** Add tests beside existing edge modules; modify `.github/workflows/ci.yml` only to run non-billing checks.

- [ ] **Step 1: Add negative log/network tests**

Capture `console.log/error` and fake fetch inputs across every failure. The combined serialized output must not contain:

- `data:image`, RIFF/WebP bytes or SHA input bytes;
- any configured email, Access JWT/sub or raw IP;
- food name, preparation, assumptions, date, slot, weight or goal;
- Ark key, HMAC key, AES key, provider raw body, prompt or schema text.

Allowed log fields are event code, request/account prefixes no longer than 8 hex, status family, duration bucket, token counts, integer cost and quota outcome. Request-level logs default to 30-day external retention configuration; code must not claim it controls Cloudflare Access retention.

- [ ] **Step 2: Add config fail-closed tests**

Cover every missing/invalid binding, secret, version, price, budget and enabled flag. Alias model IDs and unexpected model version must fail startup/request before provider call.

- [ ] **Step 3: Add CI gates**

After the existing browser tests, add:

```yaml
      - run: npm run typecheck:edge
      - run: npm run test:edge
```

These tests use local workerd/fakes and do not receive real secrets. Do not add deployment or real model calls.

- [ ] **Step 4: Run complete verification and commit**

```bash
npm run typecheck
npm run typecheck:edge
npm test
npm run test:edge
npm run build
git diff --check
if rg -n "@volcengine|ARK_API_KEY=|PHOTO_AI_ALLOWED_EMAILS=|BEGIN (RSA|PRIVATE)" . --glob '!package-lock.json' --glob '!docs/**'; then exit 1; fi
git add .github/workflows/ci.yml edge functions workers package.json package-lock.json vite.config.ts tsconfig.edge.json vitest.edge.config.ts .gitignore
git commit -m "test: gate the photo AI edge runtime"
```

Expected: all tests pass and the negative secret scan prints nothing.

### Task 8: Verify a closed, deployable candidate without deploying it

- [ ] **Step 1: Rebuild from a clean checkout**

Create a temporary clean worktree at the final commit, run `npm ci`, browser and edge typechecks/tests/build, then remove only that explicit temporary worktree after verification.

- [ ] **Step 2: Run Wrangler dry validation**

```bash
npx wrangler deploy --dry-run --config workers/photo-ai-gateway/wrangler.jsonc
```

Expected: bundle succeeds, reports the Images and Durable Object bindings, and performs no deployment.

- [ ] **Step 3: Inspect the bundle and config**

Verify `workers_dev:false`, no routes, `PHOTO_AI_GATEWAY_ENABLED:false`, no secrets, one SQLite migration, exact model ID and no R2/KV/D1/Cache binding.

- [ ] **Step 4: Record the eight commit SHAs and stop**

Do not push or configure Cloudflare. Handoff must explicitly say: local/edge candidate passed; Access control plane, service binding, Images account entitlement, real Ark contract, Mainland reachability and three-account delivery remain unverified.

## Self-review checklist

- [ ] Pages receives identity; Worker receives only pseudonymous account key.
- [ ] Worker has no public route and Pages never receives Ark/AES secrets.
- [ ] Every image read is bounded before allocation.
- [ ] Images and provider bytes never enter coordinator storage/logs.
- [ ] Pending and consumed quotas prevent concurrent overshoot.
- [ ] Every provider attempt reserves worst-case cost before invocation.
- [ ] User logical quota is charged once even when provider retries.
- [ ] Cache is encrypted, 10 minutes; idempotency is 24 hours.
- [ ] Exact versions are in response and request fingerprint.
- [ ] Real provider tests are absent from normal CI.
- [ ] Production and Preview remain disabled and undeployed.
