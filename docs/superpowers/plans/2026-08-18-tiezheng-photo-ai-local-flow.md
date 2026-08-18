# 铁证照片 AI 本地流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实 Cloudflare 与火山方舟尚未开通时，完成可由假网关驱动的拍照/相册、客户端重编码、逐图同意、候选编辑、原子确认和失败降级，并保证确认前不影响任何摄入统计。

**Architecture:** 浏览器只在内存中保存上传副本，通过独立的 `photoAiContract` 与同源网关通信；日期和餐次只写短时 `sessionStorage` 意图，不发送给服务端。`PhotoEstimateSheet` 只编排状态，图像转换、响应解析、候选营养和持久化分别落在纯模块与 repo。最终确认由 `mealRepo` 在一个 Dexie 事务中创建全部 B 级条目、写本机 WebP 缩略图并清空临时候选；任一步失败全部回滚。

**Tech Stack:** React 19、TypeScript 5.8 strict、Dexie 4、dexie-react-hooks、Vitest 3、Testing Library、Web Crypto、Canvas、Vite PWA。

---

## Execution order, prerequisite, and hard stop

本计划必须先于以下两份计划执行：

1. `docs/superpowers/plans/2026-08-18-tiezheng-photo-ai-gateway.md`
2. `docs/superpowers/plans/2026-08-18-tiezheng-photo-ai-beta-release.md`

实现前必须存在：

- `src/lib/nutritionTypes.ts` 中的 `MealEstimate`、`MealPhoto` 和 `method:'ai-confirmed'`；
- Dexie v4 的 `mealPhotos`、`mealEstimates`；
- `/health`、四餐 `MealSection` 和本地食物目录；
- `docs/superpowers/specs/2026-08-18-tiezheng-photo-ai-stage2-design.md`。

正式编码前，按设计规范取得 Claude Code 与 Codex 的可验证 GREEN receipt。没有 receipt 时停止；只有用户明确书面豁免才可继续。设计批准、计划自审和单模型 code review 都不能替代该门禁。

本计划不创建网络密钥，不配置 Cloudflare Access，不调用真实模型，不新增 Dexie version，不修改 JSON 备份范围，不把缩略图加入备份，也不改变自动营养目标开关。

## File map

### New files

- `src/lib/photoAiContract.ts`
- `src/lib/photoAiContract.test.ts`
- `src/lib/photoAiImage.ts`
- `src/lib/photoAiImage.test.ts`
- `src/lib/photoAiIntent.ts`
- `src/lib/photoAiIntent.test.ts`
- `src/lib/photoAiClient.ts`
- `src/lib/photoAiClient.test.ts`
- `src/lib/photoAiCandidate.ts`
- `src/lib/photoAiCandidate.test.ts`
- `src/screens/health/PhotoEstimateSheet.tsx`
- `src/screens/health/PhotoEstimateSheet.test.tsx`
- `src/test/photoAiFixtures.ts`

### Modified files

- `src/lib/nutritionTypes.ts`
- `src/lib/nutritionFeatureFlags.ts`
- `src/lib/nutritionFeatureFlags.test.ts`
- `src/lib/nutritionIds.ts`
- `src/lib/nutritionIds.test.ts`
- `src/repos/mealRepo.ts`
- `src/repos/mealRepo.test.ts`
- `src/screens/health/MealSection.tsx`
- `src/screens/health/MealSection.test.tsx`
- `src/screens/health/HealthScreen.tsx`
- `src/screens/health/HealthScreen.test.tsx`

## Authoritative local constants

所有任务只使用这些字面量，禁止另建同义常量：

```ts
export const PHOTO_AI_VERSIONS = {
  model: 'doubao-seed-2-1-pro-260628',
  prompt: 'tiezheng-food-photo-zh-v1',
  schema: 'tiezheng-photo-estimate-v1',
  catalog: 'tiezheng-food-catalog-v1',
  transform: 'tiezheng-photo-webp-v1',
  uncertainty: 'tiezheng-photo-uncertainty-v1',
  providerPolicy: 'volcengine-ark-policy-2026-08-18',
} as const;

export const PHOTO_AI_PROVIDER_POLICY_URL =
  'https://docs.volcengine.com/docs/82379/1142195';

export const PHOTO_AI_LIMITS = {
  rawBytes: 15 * 1024 * 1024,
  decodedPixels: 40_000_000,
  uploadBytes: 1_000_000,
  uploadLongEdge: 1600,
  thumbnailBytes: 100 * 1024,
  thumbnailLongEdge: 320,
  consentMs: 10 * 60 * 1000,
  intentMs: 15 * 60 * 1000,
  candidates: 6,
} as const;
```

### Task 0: Record baseline and run the existing nutrition suite

**Files:** Read only `package.json`, `src/lib/nutritionTypes.ts`, `src/repos/mealRepo.ts`, `src/screens/health/HealthScreen.tsx`.

- [ ] **Step 1: Confirm the plan is executed from a clean descendant of the approved design**

Run:

```bash
git status --short
git merge-base --is-ancestor ac40937 HEAD
```

Expected: the first command prints nothing and the second exits 0. Record the exact `git rev-parse HEAD` in task commentary.

- [ ] **Step 2: Install the locked graph and run the baseline**

Run:

```bash
npm ci
npm test -- src/lib/nutritionFeatureFlags.test.ts src/lib/nutritionIds.test.ts src/repos/mealRepo.test.ts src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx
npm run typecheck
```

Expected: every command exits 0. If not, stop and diagnose the pre-existing failure before editing.

### Task 1: Freeze the browser/edge contract, candidate shape, error codes, and client kill switch

**Files:** Create `src/lib/photoAiContract.ts`, `src/lib/photoAiContract.test.ts`, `src/test/photoAiFixtures.ts`; modify `src/lib/nutritionTypes.ts`, `src/lib/nutritionFeatureFlags.ts`, `src/lib/nutritionFeatureFlags.test.ts`.

- [ ] **Step 1: Write RED contract tests**

Create `src/lib/photoAiContract.test.ts` with exact-key tests for one session response, one successful estimate, one `202` in-flight response, and every error code. Include these assertions:

```ts
expect(parsePhotoAiSessionResponse({
  ok: true,
  enabled: true,
  accountRemaining: 9,
  globalRemaining: 29,
  resetAt: '2026-08-19T00:00:00+08:00',
})).toEqual({
  ok: true,
  enabled: true,
  accountRemaining: 9,
  globalRemaining: 29,
  resetAt: '2026-08-19T00:00:00+08:00',
});

expect(() => parsePhotoAiEstimateResponse({
  ok: true,
  status: 'complete',
  requestId: 'request-1',
  requestFingerprint: 'a'.repeat(64),
  versions: PHOTO_AI_VERSIONS,
  candidates: [{
    id: 'candidate-1',
    name: '鸡胸肉',
    preparation: '熟，少油',
    amountLow: 90,
    amountHigh: 120,
    unit: 'g',
    catalogFoodId: null,
    nutrientSource: 'model-range',
    energyKcalLow: 130,
    energyKcalHigh: 210,
    proteinGLow: 22,
    proteinGHigh: 34,
    assumptions: ['未计额外酱汁'],
    extra: 'must fail',
  }],
})).toThrow('unexpected field');
```

Add feature-flag tests proving only the exact string `true` enables the entry and that missing, whitespace, `TRUE`, `1`, and `false` all fail closed.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/lib/photoAiContract.test.ts src/lib/nutritionFeatureFlags.test.ts
```

Expected: fail because `photoAiContract.ts`, the extended candidate fields, and `photoAiEnabled` do not exist.

- [ ] **Step 3: Extend the persistence vocabulary exactly**

In `src/lib/nutritionTypes.ts`, replace the existing error union and candidate interface with:

```ts
export type EstimateNutrientSource = 'catalog' | 'model-range' | 'none';

export type MealEstimateErrorCode =
  | 'unsupported-file'
  | 'image-too-large'
  | 'decode-failed'
  | 'offline'
  | 'auth-required'
  | 'auth-expired'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'service-disabled'
  | 'budget-exceeded'
  | 'consent-expired'
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'invalid-estimate'
  | 'uncertain-food';

export interface MealEstimateCandidate {
  id: string;
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
  nutrientSource: EstimateNutrientSource;
  energyKcalLow: number | null;
  energyKcalHigh: number | null;
  proteinGLow: number | null;
  proteinGHigh: number | null;
  assumptions: string[];
}
```

Also change only this transient, backup-excluded field:

```ts
export interface MealEstimate {
  id: string;
  mealId: string;
  status: MealEstimateStatus;
  requestId: string;
  requestFingerprint: string | null;
  candidates: MealEstimateCandidate[];
  consent: MealEstimateConsentBinding | null;
  error: MealEstimateErrorCode | null;
  updatedAt: number;
}
```

`requestFingerprint` is null before the authenticated gateway computes the account-bound fingerprint. `needs-confirmation` and `confirmed` require lowercase 64-hex; after it becomes non-null it is immutable for that request.

Do not add an index or change DB version. Update `mealRepo` validation in Task 5, not here.

- [ ] **Step 4: Implement the shared contract with closed-world parsers**

`photoAiContract.ts` must export:

```ts
export { PHOTO_AI_LIMITS, PHOTO_AI_PROVIDER_POLICY_URL, PHOTO_AI_VERSIONS };
export type PhotoAiErrorCode = MealEstimateErrorCode | 'idempotency-conflict';

export interface PhotoAiRequestMetadata {
  requestId: string;
  idempotencyKey: string;
  uploadBlobSha256: string;
  modelVersion: typeof PHOTO_AI_VERSIONS.model;
  promptVersion: typeof PHOTO_AI_VERSIONS.prompt;
  schemaVersion: typeof PHOTO_AI_VERSIONS.schema;
  catalogVersion: typeof PHOTO_AI_VERSIONS.catalog;
  transformVersion: typeof PHOTO_AI_VERSIONS.transform;
  uncertaintyVersion: typeof PHOTO_AI_VERSIONS.uncertainty;
  providerPolicyVersion: typeof PHOTO_AI_VERSIONS.providerPolicy;
  locale: 'zh-CN';
}

export interface PhotoAiSessionSuccess {
  ok: true;
  enabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  resetAt: string;
}

export interface PhotoAiEstimateSuccess {
  ok: true;
  status: 'complete';
  requestId: string;
  requestFingerprint: string;
  versions: typeof PHOTO_AI_VERSIONS;
  candidates: MealEstimateCandidate[];
}

export interface PhotoAiEstimateInFlight {
  ok: true;
  status: 'in-flight';
  requestId: string;
  retryAfterMs: number;
}

export interface PhotoAiFailure {
  ok: false;
  code: PhotoAiErrorCode;
  retryAt: string | null;
  resetAt: string | null;
}

export type PhotoAiSessionResponse = PhotoAiSessionSuccess | PhotoAiFailure;
export type PhotoAiEstimateResponse =
  | PhotoAiEstimateSuccess
  | PhotoAiEstimateInFlight
  | PhotoAiFailure;

export function parsePhotoAiSessionResponse(value: unknown): PhotoAiSessionResponse;
export function parsePhotoAiEstimateResponse(value: unknown): PhotoAiEstimateResponse;
export function photoAiErrorCopy(code: PhotoAiErrorCode): string;
export function photoAiErrorToMealEstimateError(
  code: PhotoAiErrorCode,
): MealEstimateErrorCode;
```

Parsers must reject inherited required properties, unknown keys, arrays with holes/inherited indices, non-finite values, candidate count above 6, strings above 120 characters, assumptions above 12 rows or 240 characters per row, range inversion, partial nutrient ranges, and these invalid source combinations:

- `catalog`: non-null catalog ID and all four nutrient fields null;
- `model-range`: null catalog ID, all four nutrient fields present, at least one assumption;
- `none`: null catalog ID and all four nutrient fields null.

`PhotoAiEstimateInFlight` is exactly `{ ok:true, status:'in-flight', requestId:string, retryAfterMs:number }`. Success is exactly `{ ok:true, status:'complete', requestId, requestFingerprint, versions:typeof PHOTO_AI_VERSIONS, candidates }`. The parser requires every returned version to equal the current local release contract. Failure is exactly `{ ok:false, code, retryAt:string|null, resetAt:string|null }`.

- [ ] **Step 5: Implement the fail-closed flag**

Append to `src/lib/nutritionFeatureFlags.ts`:

```ts
export function photoAiEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_PHOTO_AI === 'true';
}
```

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
npm test -- src/lib/photoAiContract.test.ts src/lib/nutritionFeatureFlags.test.ts
npm run typecheck
git diff --check
git add src/lib/photoAiContract.ts src/lib/photoAiContract.test.ts src/test/photoAiFixtures.ts src/lib/nutritionTypes.ts src/lib/nutritionFeatureFlags.ts src/lib/nutritionFeatureFlags.test.ts
git commit -m "feat: define photo AI client contract"
```

Expected: tests and typecheck pass; commit contains only the six listed paths.

### Task 2: Build memory-only image preprocessing and per-photo consent

**Files:** Create `src/lib/photoAiImage.ts`, `src/lib/photoAiImage.test.ts`.

- [ ] **Step 1: Write RED tests against an injected codec**

Cover JPEG/PNG/WebP plus browser-decodable HEIC input, raw file above 15 MiB, decode failure, more than 40 million decoded pixels, upload longest edge 1600, thumbnail longest edge 320, upload above 1 MB after all attempts, thumbnail above 100 KB, SHA-256, disposal after success/failure, and absence of storage calls.

Use this public test seam:

```ts
export interface PhotoCodec {
  decode(file: Blob): Promise<DecodedPhoto>;
  encode(source: DecodedPhoto, request: EncodePhotoRequest): Promise<EncodedPhoto>;
}

export interface DecodedPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

export interface EncodePhotoRequest {
  format: 'image/webp';
  longEdge: number;
  quality: number;
}

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export interface PreparedPhoto {
  uploadBlob: Blob;
  uploadBlobSha256: string;
  uploadWidth: number;
  uploadHeight: number;
  thumbnailBlob: Blob;
  thumbnailWidth: number;
  thumbnailHeight: number;
  dispose(): void;
}

export function preparePhoto(
  file: File,
  codec?: PhotoCodec,
): Promise<PreparedPhoto>;
```

The fake codec must prove the quality sequence is `0.82, 0.72, 0.62, 0.52` before dimensions shrink by `0.85`, and that both outputs are `image/webp`.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/lib/photoAiImage.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement the pure orchestration and browser codec**

Implementation rules:

1. Copy the `File` reference synchronously and never write it to IndexedDB, Cache API, localStorage, sessionStorage, R2, or object URLs beyond decode lifetime.
2. Decode with `createImageBitmap`; fallback to `HTMLImageElement` plus a revocable object URL when unavailable.
3. Draw to a new canvas; do not preserve EXIF or filenames.
4. Use `canvas.toBlob('image/webp', quality)` and reject null/non-WebP results.
5. Hash only the final upload WebP with `crypto.subtle.digest('SHA-256', ...)`.
6. Return independent upload and thumbnail Blobs; `dispose()` closes the bitmap and revokes every object URL.
7. Any exception disposes intermediate resources before rethrowing one of `unsupported-file`, `image-too-large`, or `decode-failed` through a typed `PhotoPreparationError`.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npm test -- src/lib/photoAiImage.test.ts
npm run typecheck
git diff --check
git add src/lib/photoAiImage.ts src/lib/photoAiImage.test.ts
git commit -m "feat: preprocess food photos in memory"
```

### Task 3: Add fixed login intent and same-origin API client

**Files:** Create `src/lib/photoAiIntent.ts`, `.test.ts`, `src/lib/photoAiClient.ts`, `.test.ts`.

- [ ] **Step 1: Write RED tests for intent expiry and fixed navigation**

The intent contract is exactly:

```ts
export interface PhotoAiIntent {
  version: 1;
  date: string;
  slot: MealSlot;
  createdAt: number;
  expiresAt: number;
}

export function savePhotoAiIntent(date: string, slot: MealSlot, now?: number): void;
export function takePhotoAiIntent(now?: number): PhotoAiIntent | undefined;
export function clearPhotoAiIntent(): void;
export const PHOTO_AI_LOGIN_PATH = '/api/nutrition/photo/session?resume=1';
```

Tests must reject external return URLs, invalid dates, unknown slots, extra fields, stale timestamps, unsafe timestamps, corrupted JSON and storage exceptions. `take` consumes a valid intent exactly once.

- [ ] **Step 2: Write RED client tests**

Assert:

- every URL begins `/api/nutrition/photo/` and never accepts a caller-provided origin;
- all calls use `credentials:'include'` and `cache:'no-store'`;
- multipart code does not set `Content-Type` manually;
- upload includes only image plus request/version/hash/idempotency metadata, never date, meal slot, weight, goal, email or food history;
- HTML/redirect session responses map to `auth-required`;
- a 202 response retries the same request ID, idempotency key and fingerprint after bounded delay;
- timeout aborts and maps to `provider-timeout` without generating a new key;
- response parsing uses the Task 1 closed-world parser.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- src/lib/photoAiIntent.test.ts src/lib/photoAiClient.test.ts
```

Expected: both suites fail because the modules do not exist.

- [ ] **Step 4: Implement the client API**

Export exactly:

```ts
export interface PhotoAiClient {
  session(): Promise<PhotoAiSessionResponse>;
  estimate(input: PhotoAiEstimateInput): Promise<PhotoAiEstimateResponse>;
  logout(): Promise<{ logoutUrl: '/cdn-cgi/access/logout' }>;
}

export interface PhotoAiEstimateInput {
  requestId: string;
  idempotencyKey: string;
  uploadBlobSha256: string;
  uploadBlob: Blob;
}

export function createPhotoAiClient(
  fetcher?: typeof fetch,
  delay?: (ms: number) => Promise<void>,
): PhotoAiClient;
```

Generate the 128-bit idempotency key in UI with `crypto.getRandomValues(new Uint8Array(16))`, encoded as 32 lowercase hex characters. Do not use a device fingerprint.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- src/lib/photoAiIntent.test.ts src/lib/photoAiClient.test.ts
npm run typecheck
git diff --check
git add src/lib/photoAiIntent.ts src/lib/photoAiIntent.test.ts src/lib/photoAiClient.ts src/lib/photoAiClient.test.ts
git commit -m "feat: add photo AI session client"
```

### Task 4: Make candidate nutrition deterministic and conservative

**Files:** Create `src/lib/photoAiCandidate.ts`, `src/lib/photoAiCandidate.test.ts`.

- [ ] **Step 1: Write RED tests for all three sources**

Tests must prove:

- catalog nutrition ignores every model nutrient number and uses the current local `Food` snapshot;
- a missing/deleted/mismatched catalog food fails closed;
- shared uncertainty v1 widens a raw model range by 20 percent exactly once, rounds energy outward to integers and protein outward to 0.1 g;
- local confirmation conservatively rescales the already-widened server range from the original amount interval without adding a second 20 percent widening;
- `none` cannot create a confirmed item;
- catalog unit changes use the versioned Food density when present; catalog conversion without density and every model-range g/mL unit change fail with a manual-entry fallback;
- zero/negative/NaN/Infinity, inverted ranges and partial fields are rejected;
- resulting `MealItem` uses `method:'ai-confirmed'`, `quality:'B'` and never claims A-grade precision.

The authoritative server-side uncertainty formula is:

```ts
const energyKcalLow = Math.max(0, Math.floor(raw.energyKcalLow * 0.8));
const energyKcalHigh = Math.ceil(raw.energyKcalHigh * 1.2);
const proteinGLow = Math.max(0, Math.floor(raw.proteinGLow * 0.8 * 10) / 10);
const proteinGHigh = Math.ceil(raw.proteinGHigh * 1.2 * 10) / 10;
```

The authoritative local rescale for confirmed amount `a` is:

```ts
const energyKcalLow = Math.max(
  0,
  Math.floor(candidate.energyKcalLow * a / candidate.amountHigh),
);
const energyKcalHigh = Math.ceil(
  candidate.energyKcalHigh * a / candidate.amountLow,
);
const proteinGLow = Math.max(
  0,
  Math.floor(candidate.proteinGLow * a / candidate.amountHigh * 10) / 10,
);
const proteinGHigh = Math.ceil(
  candidate.proteinGHigh * a / candidate.amountLow * 10,
 ) / 10;
```

- [ ] **Step 2: Run RED**

Run `npm test -- src/lib/photoAiCandidate.test.ts`.

Expected: module-not-found failure.

- [ ] **Step 3: Implement the builder**

Export:

```ts
export interface ConfirmedPhotoCandidate {
  candidate: MealEstimateCandidate;
  confirmedAmount: number;
  confirmedUnit: 'g' | 'mL';
  confirmedName: string;
  confirmedPreparation: string;
  confirmedAssumptions: string[];
}

export interface RawModelNutrientRange {
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
}

export function applyPhotoUncertaintyV1(
  raw: RawModelNutrientRange,
): RawModelNutrientRange;

export function buildPhotoMealItem(
  input: ConfirmedPhotoCandidate,
  catalogFood: Food | undefined,
  ids: { id: string; mealId: string; order: number; now: number },
): MealItem;
```

For model-range rows, set `source:'photo-ai-user-confirmed'`, `sourceVersion` to the joined model/prompt/schema/uncertainty versions, `license:'model-estimate-user-confirmed'`, point fields to rounded range midpoints, and include `估算不确定性较高` plus the user-confirmed assumptions. Do not persist chain-of-thought, confidence percentages or model prose outside the bounded assumptions.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npm test -- src/lib/photoAiCandidate.test.ts
npm run typecheck
git diff --check
git add src/lib/photoAiCandidate.ts src/lib/photoAiCandidate.test.ts
git commit -m "feat: build conservative AI nutrition snapshots"
```

### Task 5: Add orphan-safe estimate state and one-transaction confirmation

**Files:** Modify `src/lib/nutritionIds.ts`, `.test.ts`, `src/repos/mealRepo.ts`, `.test.ts`.

- [ ] **Step 1: Write RED ID and estimate-state tests**

Add `parseMealId(value)` tests for all four slots, invalid dates, suffixes, prototype strings and non-canonical dates. Then add repo tests proving an estimate may exist before its `Meal`, candidate state never appears in `listNutritionDay`, and confirmed state contains no consent or candidates.

- [ ] **Step 2: Write RED atomic confirmation tests**

Use a fresh Dexie database per test. Cover:

1. two candidates create one meal, two B-grade items, one WebP photo and one sanitized confirmed estimate;
2. totals are unchanged before confirm and live after commit;
3. catalog rows are loaded inside the transaction and cannot be supplied as forged input;
4. same operation and same semantics are idempotent;
5. same operation with changed amount/name/photo/request conflicts;
6. stale request ID, expired consent, changed upload hash or estimate not in `needs-confirmation` fails;
7. failure after each of the four table writes rolls back all tables;
8. two Dexie connections racing the same confirm cannot create duplicate order values;
9. cancel deletes only the estimate and never deletes an existing final photo;
10. confirmed thumbnail stays local and remains excluded by existing backup tests.

- [ ] **Step 3: Run RED**

Run:

```bash
npm test -- src/lib/nutritionIds.test.ts src/repos/mealRepo.test.ts
```

Expected: failures for missing parser, orphan estimate rejection, old confirmed-state invariant and missing confirmation API.

- [ ] **Step 4: Extend the repository interface**

Add exactly:

```ts
export interface ConfirmPhotoEstimateInput {
  operationId: string;
  date: string;
  slot: MealSlot;
  requestId: string;
  uploadBlobSha256: string;
  candidates: ConfirmedPhotoCandidate[];
  thumbnail: { blob: Blob; width: number; height: number };
}

export interface MealRepository {
  saveConfirmedFoodItem(input: SaveConfirmedFoodItemInput): Promise<MealItem>;
  updateMealItemAmount(id: string, amount: number): Promise<MealItem>;
  removeMealItem(id: string): Promise<void>;
  removeMeal(id: string): Promise<void>;
  listNutritionDay(date: string): Promise<NutritionDay>;
  putMealPhoto(photo: MealPhoto): Promise<void>;
  putMealEstimate(estimate: MealEstimate): Promise<void>;
  clearMealTemporaryState(mealId: string): Promise<void>;
  confirmPhotoEstimate(input: ConfirmPhotoEstimateInput): Promise<MealItem[]>;
  clearMealEstimate(mealId: string): Promise<void>;
}
```

Change `putMealEstimate` so it validates canonical `mealId` but does not require a `Meal` parent. A temporary estimate is intentionally not a nutrition record.

Change the state invariant to:

```ts
const stateIsValid =
  ((status === 'preprocessing' || status === 'awaiting-consent') && !hasConsent && !hasCandidates) ||
  ((status === 'uploading' || status === 'estimating') && hasConsent && !hasCandidates) ||
  (status === 'needs-confirmation' && hasConsent && hasCandidates) ||
  (status === 'confirmed' && !hasConsent && !hasCandidates) ||
  (status === 'failed' && !hasCandidates);
```

Fingerprint validation is part of the same invariant: preprocessing, awaiting-consent, uploading and estimating require null; needs-confirmation and confirmed require 64-hex; failed accepts null or the immutable 64-hex value. The transition from `estimating` to `needs-confirmation` is the only transition that may set null to the server fingerprint.

- [ ] **Step 5: Implement the atomic transaction**

Use one `database.transaction('rw', [foods, meals, mealItems, mealPhotos, mealEstimates], scope)`. Inside it:

1. synchronously snapshot the input before the first await;
2. reload the estimate by deterministic ID and validate request/hash/consent/expiry/status;
3. load catalog foods from Dexie and call Task 4 builder;
4. allocate deterministic item IDs as `mealItemId(operationKey(operationId + '_' + index))` and unique orders after active siblings;
5. put parent and all items;
6. compute the post-write semantic meal hash with `Dexie.waitFor(buildMealSnapshotHash(...))`;
7. validate and put `mealPhotoId(parentId)` using the final local thumbnail;
8. put the estimate as `{status:'confirmed', candidates:[], consent:null, error:null}`;
9. return structured-cloned rows only after the transaction commits.

Use one monotonic safe timestamp for parent, items, photo and estimate. Never call existing public repo methods from inside the transaction.

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
npm test -- src/lib/nutritionIds.test.ts src/repos/mealRepo.test.ts src/lib/nutritionBackup.test.ts src/lib/nutritionRestore.test.ts
npm run typecheck
git diff --check
git add src/lib/nutritionIds.ts src/lib/nutritionIds.test.ts src/repos/mealRepo.ts src/repos/mealRepo.test.ts
git commit -m "feat: confirm photo estimates atomically"
```

### Task 6: Build the accessible photo flow sheet with a fake client

**Files:** Create `src/screens/health/PhotoEstimateSheet.tsx`, `.test.tsx`.

- [ ] **Step 1: Write the complete RED interaction suite**

Tests use an injected `PhotoAiClient`, injected `preparePhoto`, and fake repo callbacks. Cover:

- focus trap, scroll lock, close focus restoration, Escape and reduced motion;
- camera input has `capture="environment"`; library input has no capture;
- exact clear-photo guidance appears before either chooser;
- session disabled/auth/quota/budget/rate errors show page-local `role=alert` and preserve manual exit;
- an authenticated user can choose `退出照片识别登录`, receive only the fixed `/cdn-cgi/access/logout` path and navigate there without deleting local meals;
- unauthenticated click saves date/slot before navigating only to `PHOTO_AI_LOGIN_PATH`;
- valid resume opens the original date/slot once;
- consent text includes Cloudflare, 火山方舟, no Ironclad original storage, unknown third-party retention, policy link and 10-minute expiry;
- cancel/reselect/expiry clears consent and never invokes estimate;
- upload uses one request/key/hash; duplicate click is latched;
- at most six candidates render; `none` cannot be selected for confirmation;
- user can delete, rename, edit preparation, amount and assumptions;
- catalog/model-range source and uncertainty copy are visible without confidence percentages;
- confirm calls one atomic callback and closes only after success;
- failure leaves candidates editable and never calls `window.alert`;
- StrictMode async success and retry do not leave a permanent latch.

- [ ] **Step 2: Run RED**

Run `npm test -- src/screens/health/PhotoEstimateSheet.test.tsx`.

Expected: missing-module failure.

- [ ] **Step 3: Implement one explicit state machine**

Use only:

```ts
type PhotoFlowState =
  | { step: 'checking-session' }
  | { step: 'source' }
  | { step: 'preprocessing' }
  | { step: 'consent'; prepared: PreparedPhoto; requestId: string; idempotencyKey: string }
  | { step: 'uploading'; prepared: PreparedPhoto; requestId: string; idempotencyKey: string }
  | { step: 'confirming'; prepared: PreparedPhoto; requestId: string; candidates: EditableCandidate[] }
  | { step: 'saving'; prepared: PreparedPhoto; requestId: string; candidates: EditableCandidate[] }
  | { step: 'error'; code: PhotoAiErrorCode; previous: RecoverablePhotoFlowState };

type RecoverablePhotoFlowState =
  | { step: 'source' }
  | { step: 'consent'; prepared: PreparedPhoto; requestId: string; idempotencyKey: string }
  | { step: 'confirming'; prepared: PreparedPhoto; requestId: string; candidates: EditableCandidate[] };

interface EditableCandidate extends ConfirmedPhotoCandidate {
  enabled: boolean;
}
```

The component props are exact:

```ts
export interface PhotoEstimateSheetProps {
  date: string;
  slot: MealSlot;
  foods: Food[];
  client: PhotoAiClient;
  onLogin(): void;
  onPutEstimate(estimate: MealEstimate): Promise<void>;
  onClearEstimate(mealId: string): Promise<void>;
  onConfirm(input: ConfirmPhotoEstimateInput): Promise<void>;
  onClose(): void;
}
```

The persistence sequence is exact: after preprocessing put `awaiting-consent` with null fingerprint; consent puts `uploading`; immediately before the client call put `estimating`; a valid response puts `needs-confirmation` with the returned fingerprint and candidates; a failure puts `failed` with no candidates using `photoAiErrorToMealEstimateError` (`idempotency-conflict` maps to `invalid-estimate`); confirmation calls only the Task 5 atomic API. UI states `checking-session`, `source` and `error` do not invent extra persisted status values.

Use the existing `Button`, `forged-surface`, iron/amber tokens and `useDialogFocusTrap`. Do not add cartoon icons, a new global palette, native unstyled buttons, alerts, progress bars in red, or bottom navigation.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npm test -- src/screens/health/PhotoEstimateSheet.test.tsx src/components/Button.test.tsx
npm run typecheck
git diff --check
git add src/screens/health/PhotoEstimateSheet.tsx src/screens/health/PhotoEstimateSheet.test.tsx
git commit -m "feat: add photo estimate confirmation flow"
```

### Task 7: Add the meal entry and Health orchestration behind the independent flag

**Files:** Modify `MealSection.tsx/.test.tsx`, `HealthScreen.tsx/.test.tsx`.

- [ ] **Step 1: Write RED integration tests**

Assert:

- `VITE_ENABLE_PHOTO_AI` missing: no photo button, all local picker behavior unchanged;
- exact `true`: each of four meals has a secondary `拍照识别` action beside `选择食物`;
- clicking photo does not open or change the local picker;
- unauthenticated flow writes intent and navigates to fixed session path;
- `?photoAi=resume` consumes the stored intent and removes the query without changing date history;
- expired/corrupt intent opens nothing;
- changing dates closes the sheet and disposes the in-memory photo;
- successful atomic confirm updates the live summary once;
- failed confirm leaves totals and existing entries unchanged;
- gateway disabled still permits preset and manual food saves;
- photo UI never appears in Today, calendar, data restore or profile routes.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx src/App.test.tsx
```

Expected: failures for missing action, props and orchestration.

- [ ] **Step 3: Extend `MealSection` without changing the existing action**

Add props:

```ts
photoAiEnabled?: boolean;
onPhoto?(slot: MealSlot): void;
```

Render `拍照识别` only when `photoAiEnabled === true && onPhoto`, using `Button variant="tertiary"`. Keep `选择食物` as the primary local action.

- [ ] **Step 4: Wire `HealthScreen`**

Create the client once with `useMemo`, keep `photoSlot` separate from `pickerSlot`, and pass repository functions directly. Session/login intent must never include food, weight or goals. On unmount or date change, close the photo sheet so its cleanup disposes the Blobs.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
npm test -- src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx src/screens/health/PhotoEstimateSheet.test.tsx src/App.test.tsx
npm run typecheck
npm run build
git diff --check
git add src/screens/health/MealSection.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.tsx src/screens/health/HealthScreen.test.tsx
git commit -m "feat: open photo recognition from meals"
```

### Task 8: Verify the local vertical slice and keep production closed

**Files:** No new production files.

- [ ] **Step 1: Run the complete local photo suite**

```bash
npm test -- src/lib/photoAiContract.test.ts src/lib/photoAiImage.test.ts src/lib/photoAiIntent.test.ts src/lib/photoAiClient.test.ts src/lib/photoAiCandidate.test.ts src/repos/mealRepo.test.ts src/screens/health/PhotoEstimateSheet.test.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx src/App.test.tsx
```

Expected: zero failures and zero React act warnings from the new suites.

- [ ] **Step 2: Run repository gates**

```bash
npm run typecheck
npm test
npm run build
git diff --check HEAD~7..HEAD
```

Expected: all exit 0.

- [ ] **Step 3: Run privacy and scope scans**

```bash
if rg -n "ARK_API_KEY|PHOTO_AI_ALLOWED_EMAILS|data:image/|uploadBlob" dist; then exit 1; fi
if rg -n "localStorage.*photo|indexedDB.*upload|caches\.open|navigator\.sendBeacon" src/lib/photoAi* src/screens/health/PhotoEstimateSheet.tsx; then exit 1; fi
git diff --name-only HEAD~7..HEAD
```

Expected: both negative scans print nothing. The file list contains only the paths declared in this plan.

- [ ] **Step 4: Browser acceptance with the fake client**

Run the app with the client flag enabled and fake adapter selected only in the local dev environment. Verify iPhone-sized and Android-sized layouts for camera, library, consent, six candidates, keyboard editing, retry and close. Confirm Network contains no external request and Application storage contains no upload Blob.

- [ ] **Step 5: Record handoff**

Record the seven commit SHAs, test counts and screenshot paths in task commentary. Do not push, deploy, enable production or begin the real gateway without the gateway plan's separate consensus receipt.

## Self-review checklist

- [ ] Every Stage 2 local-flow requirement has a named RED test.
- [ ] No placeholder text, alternate type alias, undefined function or generic object parser remains.
- [ ] `MealEstimateCandidate` is identical in browser, repo and edge contract imports.
- [ ] Candidate count is 6 in the client even though the older repo limit was 30.
- [ ] Confirmed state removes consent/candidates; backup still excludes estimates/photos.
- [ ] No raw image or upload Blob crosses a persistence boundary.
- [ ] Kill switch off leaves every local nutrition path usable.
- [ ] This plan does not claim a real provider, Cloudflare deployment or production approval.
