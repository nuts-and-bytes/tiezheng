# 铁证照片 AI Preview 联调与三账号放行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `photo-ai-stage2.tiezheng.pages.dev` 的封闭 Preview 环境完成真实 Cloudflare Access、私有 Worker、Images、Durable Object、火山方舟、真机与三个邮箱验收，同时保持 `tiezheng.pages.dev` 的照片入口和模型调用关闭。

**Architecture:** 代码合入后仍由三层门控：生产客户端无 `VITE_ENABLE_PHOTO_AI`、私有 Worker默认关闭、账号开关默认关闭。人工批准的 Preview workflow 先验证与部署私有 Worker，再以固定 Preview branch 部署 Pages 静态资源和 Functions；Access 分别保护用户 API 与仅管理员可调用的运维 API。真实合同测试和三账号测试均使用 GitHub Environment 人工批准，不进入普通 CI。

**Tech Stack:** GitHub Actions Environments、Cloudflare Pages Preview、Cloudflare Access OTP、Pages Functions Service Binding、Wrangler 4、Cloudflare Images、Durable Objects、Volcengine Ark、iPhone Safari、Android Chrome、Vitest、Playwright/agent-browser 手工验收。

---

## Hard gates and non-goals

先完成并合并：

1. `docs/superpowers/plans/2026-08-18-tiezheng-photo-ai-local-flow.md`
2. `docs/superpowers/plans/2026-08-18-tiezheng-photo-ai-gateway.md`

本计划也必须取得独立 Claude Code + Codex GREEN receipt。没有 receipt 或用户书面豁免时，不得创建云资源、写 secret、部署或邀请账号。

本计划只批准三账号 Preview，不批准公开生产。完成后必须保持：

- `tiezheng.pages.dev` 构建变量中 `VITE_ENABLE_PHOTO_AI` 缺失或空；
- Worker 生产允许 Origin 不包含 `https://tiezheng.pages.dev`；
- 公开用户看不到拍照入口；
- 训练、体重、预设食物、手动食物和本地备份继续无账号使用；
- 没有自有域名/ICP、公开 CAPTCHA ADR、法律与营养专业复核时不得扩白名单。

用户必须亲自在自己的 Cloudflare、火山方舟和 GitHub 账号中创建/确认资源与 secrets。实施代理不得把控制台值复制到聊天、日志、仓库、截图文件名或测试快照。

## File map

### New operational code

- `edge/photo-ai/admin.ts`, `.test.ts`
- `functions/api/nutrition/photo-admin/account.ts`
- `scripts/photo-ai-admin.mjs`, `scripts/photo-ai-admin.test.mjs`
- `scripts/verify-photo-ai-release.mjs`, `.test.mjs`
- `scripts/fixtures/photo-ai-release-valid.json`
- `workers/photo-ai-gateway/src/realContract.test.ts`
- `.github/workflows/photo-ai-preview.yml`
- `.github/workflows/photo-ai-provider-contract.yml`

### New evidence templates

- `docs/operations/photo-ai-stage2-runbook.md`
- `docs/operations/photo-ai-stage2-release-checklist.md`
- `docs/operations/photo-ai-validation-schema.json`
- `docs/operations/photo-ai-validation-template.md`
- `docs/operations/photo-ai-data-processing-register.md`

### Modified files

- `workers/photo-ai-gateway/wrangler.jsonc`
- `edge/photo-ai/access.ts`
- `edge/photo-ai/pagesProxy.ts`
- `workers/photo-ai-gateway/src/handler.ts`, `.test.ts`
- `workers/photo-ai-gateway/src/coordinator.ts`, `.worker.test.ts`
- `package.json`
- `.gitignore`
- `.github/workflows/ci.yml`

## Fixed Preview identity

Use one branch alias only:

```text
https://photo-ai-stage2.tiezheng.pages.dev
```

Do not accept deployment hashes or `*.tiezheng.pages.dev` wildcards in Origin or Access policy. The Pages deploy branch is exactly `photo-ai-stage2`.

The control-plane names are exact:

```text
Worker: tiezheng-photo-ai-gateway
Durable Object class: PhotoAiCoordinator
Pages service binding: PHOTO_AI_GATEWAY
Access user app: tiezheng-photo-ai-stage2-user
Access admin app: tiezheng-photo-ai-stage2-admin
GitHub environment: photo-ai-preview
GitHub environment: photo-ai-provider-contract
```

Secret names are fixed even though their values never enter Git:

```text
Pages Preview: PHOTO_AI_TEAM_DOMAIN
Pages Preview: PHOTO_AI_ACCESS_AUD
Pages Preview: PHOTO_AI_ALLOWED_EMAILS
Pages Preview: PHOTO_AI_ACCOUNT_HMAC_KEY
Pages Preview: PHOTO_AI_ALLOWED_ORIGINS
Pages Preview: PHOTO_AI_ADMIN_ACCESS_AUD
Pages Preview: PHOTO_AI_ADMIN_EMAIL
Worker: ARK_API_KEY
Worker: PHOTO_AI_CACHE_AES_KEY
GitHub environments: CLOUDFLARE_API_TOKEN
GitHub environments: CLOUDFLARE_ACCOUNT_ID
```

`CLOUDFLARE_ACCOUNT_ID` is an environment variable rather than an application secret, but it still stays out of source and release artifacts. The Pages user allowlist contains exactly three distinct normalized emails; the admin allowlist contains exactly one.

### Task 0: Obtain external readiness receipts without exposing values

**Files:** Create the runbook and data-processing register only after each fact is verified.

- [ ] **Step 1: Verify Cloudflare account capabilities**

In the user's Cloudflare account, verify Zero Trust One-time PIN, Workers Paid/required plan status, Pages Functions, Service Bindings, Images Binding and SQLite-backed Durable Objects are available. Record only yes/no, date, account owner and official documentation URL; do not record account ID or token.

- [ ] **Step 2: Verify Volcengine readiness**

Confirm real-name status, Beijing Ark endpoint, exact model `doubao-seed-2-1-pro-260628`, current input/output prices, limits, data authorization/training settings and privacy/terms versions. Save screenshots outside Git if they contain identifiers. Record hashes and redacted local paths in the runbook.

- [ ] **Step 3: Prepare exactly three user emails and one administrator**

The user supplies the addresses directly in Cloudflare Access. The repo and task commentary record only `3 configured`, delivery domain classes and test status. Never write the addresses in Markdown, GitHub variables, source, test fixtures or screenshots committed to Git.

- [ ] **Step 4: Create least-privilege credentials**

Create:

- Cloudflare API token scoped to this Pages project and Worker deployment;
- Ark API key scoped to inference only;
- 32-byte random account HMAC key;
- 32-byte random AES-GCM key;

Store deployment credentials only in the matching GitHub Environment or Worker/Pages secrets. Record key creation/rotation date, not values.

- [ ] **Step 5: Stop if any external prerequisite is unverified**

No fake values, wildcard policies or temporarily public Worker routes are allowed to bypass this task.

### Task 1: Add a private admin operation path for account/global shutdown and deletion

**Files:** Create admin module, route and CLI; modify Access/proxy contracts.

The design forbids a user-facing admin UI but requires per-account/global emergency switches and account-state deletion. This task adds an API used only by a local CLI. It never ships a visible page.

- [ ] **Step 1: Write RED admin boundary tests**

Cover missing/invalid Access JWT, non-admin email, wrong audience, origin/CSRF failure, unsupported action, malformed email, extra fields, replayed operation ID, service binding missing and downstream failure.

Assert the route:

- derives the target account key in Pages memory from normalized target email and the same HMAC key;
- never forwards/stores/logs target or admin email;
- allows only `status`, `enable-account`, `disable-account`, `delete-account`, `enable-global`, `disable-global`;
- requires a 128-bit operation ID and rejects replay for 24 hours in the coordinator;
- returns only switches, counters and pseudonymous 8-character prefixes;
- uses a separate Access Audience and exact administrator allowlist of one.

- [ ] **Step 2: Write RED CLI tests**

`scripts/photo-ai-admin.mjs` must read the target email from hidden stdin or `PHOTO_AI_TARGET_EMAIL` supplied for one process, never a command-line flag. It must require exact Preview origin, print no email, send no operation without a typed confirmation phrase, and clear local variables after response. Cover 401/403/409/429/5xx and JSON shape errors.

- [ ] **Step 3: Run RED**

```bash
npm test -- edge/photo-ai/admin.test.ts
node --test scripts/photo-ai-admin.test.mjs
```

- [ ] **Step 4: Implement the bounded admin contract**

Add `POST /api/nutrition/photo-admin/account`. The Pages route authenticates the separate admin Access app, derives target account key when required, forwards only the action/account key/operation ID to `/internal/admin`, and returns no-store JSON. Add one coordinator RPC `applyAdminOperation` that records the operation ID for 24 hours and applies the switch/delete in the same SQLite transaction. Delete removes account counters, flags, idempotency, cache and leases, but never touches browser-local data.

Refactor Access config parsing to accept an explicit expected allowlist size. User routes pass `3`; the admin route passes `1` and uses a distinct Audience. No caller or request field chooses this size.

The CLI accepts exactly these commands:

```text
node scripts/photo-ai-admin.mjs status
node scripts/photo-ai-admin.mjs enable-global
node scripts/photo-ai-admin.mjs disable-global
node scripts/photo-ai-admin.mjs enable-account
node scripts/photo-ai-admin.mjs disable-account
node scripts/photo-ai-admin.mjs delete-account
```

Account commands prompt for the target email on hidden stdin. Every mutating command then prompts for the exact uppercase action name before sending. There is no `--email`, `--yes`, batch, list or read-data command.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- edge/photo-ai/admin.test.ts edge/photo-ai/access.test.ts edge/photo-ai/pagesProxy.test.ts
node --test scripts/photo-ai-admin.test.mjs
npm run typecheck:edge
git diff --check
git add edge/photo-ai/admin.ts edge/photo-ai/admin.test.ts edge/photo-ai/access.ts edge/photo-ai/pagesProxy.ts functions/api/nutrition/photo-admin/account.ts scripts/photo-ai-admin.mjs scripts/photo-ai-admin.test.mjs workers/photo-ai-gateway/src/handler.ts workers/photo-ai-gateway/src/handler.test.ts workers/photo-ai-gateway/src/coordinator.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts
git commit -m "feat: add private photo AI kill switches"
```

### Task 2: Add release-manifest verification and fail-closed deployment config

**Files:** Create verification script/tests; modify Worker config, package scripts and gitignore.

- [ ] **Step 1: Write RED manifest tests**

The verifier receives a JSON document via stdin and rejects:

- alias/latest model IDs;
- any origin other than the exact Preview alias;
- missing prompt/schema/catalog/transform/uncertainty version;
- budget not exactly 50,000,000 micro-yuan;
- quotas not 10/2/1 and 30/2;
- `workers_dev:true`, any public route, R2/KV/D1/Cache binding;
- missing Images/DO/service binding;
- plaintext secret-like values;
- production client flag enabled;
- prices not explicitly re-confirmed on the release date.
- the ¥2,000,000 per-attempt reservation is less than the recomputed worst case from the model's current documented input context, configured output cap and current prices.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/verify-photo-ai-release.test.mjs
```

- [ ] **Step 3: Implement a generated, non-secret release manifest**

`scripts/verify-photo-ai-release.mjs` validates but does not create control-plane resources. Add `verify:photo-release` to package scripts. The approved manifest is written by the workflow into a temporary directory and uploaded as an artifact; it contains commit SHA, versions, public limits, redacted binding presence, terms/pricing evidence hashes and verification results. It contains no account ID, email, token or secret.

- [ ] **Step 4: Verify Preview-only origin while preserving global default off**

Assert the committed Worker origin remains exactly `https://photo-ai-stage2.tiezheng.pages.dev` and `PHOTO_AI_GATEWAY_ENABLED:false`. Enabling is an explicit protected-workflow `--var` override in Task 6 after tests, not a source edit. Add `.dev.vars`, `.wrangler`, downloaded Access exports, validation photos and unredacted release evidence to `.gitignore`.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test scripts/verify-photo-ai-release.test.mjs
npm run verify:photo-release -- --fixture scripts/fixtures/photo-ai-release-valid.json
npm run typecheck:edge
git diff --check
git add scripts/verify-photo-ai-release.mjs scripts/verify-photo-ai-release.test.mjs scripts/fixtures/photo-ai-release-valid.json workers/photo-ai-gateway/wrangler.jsonc package.json .gitignore
git commit -m "build: verify the photo AI release manifest"
```

The fixture contains only fake/redacted control-plane evidence and `gatewayEnabled:false`.

### Task 3: Add manual Preview and real-provider workflows

**Files:** Create both workflows; update ordinary CI only for static policy scans.

- [ ] **Step 1: Write workflow-policy RED tests**

Extend the release verifier to parse YAML text and assert:

- both workflows use `workflow_dispatch`, never push/pull_request/schedule;
- each declares its matching protected GitHub Environment;
- deployment runs only after typecheck/browser/edge/full/build/dry-run;
- Preview build sets `VITE_ENABLE_PHOTO_AI:true` and branch exactly `photo-ai-stage2`;
- ordinary CI never receives Ark/Access/AES/HMAC secrets;
- real-provider workflow caps calls at three and sets a job timeout;
- no secret is passed as command-line argument or echoed;
- production deploy job still omits `VITE_ENABLE_PHOTO_AI`.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/verify-photo-ai-release.test.mjs
```

- [ ] **Step 3: Create `photo-ai-preview.yml`**

The workflow order is exact:

1. checkout requested ref;
2. Node 22 and `npm ci`;
3. `npm run typecheck`, `typecheck:edge`, `npm test`, `test:edge`, `build`;
4. secret/scope/release-manifest scans;
5. Worker dry-run;
6. deploy `tiezheng-photo-ai-gateway` with pre-provisioned secrets and workflow input `gateway_enabled`, whose default is `false`;
7. build client with `VITE_ENABLE_PHOTO_AI:true`;
8. deploy Pages with branch `photo-ai-stage2`;
9. run unauthenticated 401/Access redirect and disabled-gateway smoke;
10. upload redacted manifest and test logs.

The workflow accepts `gateway_enabled:true` only when a second input equals `ENABLE_PREVIEW_GATEWAY_FOR_APPROVED_BETA`; otherwise it fails before deploy. No push, PR or scheduled run enables the deployment gate automatically.

- [ ] **Step 4: Create `photo-ai-provider-contract.yml`**

It requires protected environment approval and input `confirmation` exactly `SEND_3_PUBLIC_PRESET_IMAGES_TO_VOLCENGINE`. It runs only `rice`, `chicken-breast`, and `lean-beef` WebP assets already public in the repo, at most once each. Output records schema validity, latency bucket, usage and cost; it never prints candidate text or Base64. Add `test:provider` to `package.json`; it is absent from ordinary CI and requires `RUN_REAL_PHOTO_AI_CONTRACT=true` plus the protected Ark secret.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test scripts/verify-photo-ai-release.test.mjs
npm run verify:photo-release -- --workflows
npm run typecheck
npm run typecheck:edge
npm test
npm run test:edge
npm run build
git diff --check
git add .github/workflows/photo-ai-preview.yml .github/workflows/photo-ai-provider-contract.yml .github/workflows/ci.yml scripts/verify-photo-ai-release.mjs scripts/verify-photo-ai-release.test.mjs workers/photo-ai-gateway/src/realContract.test.ts package.json
git commit -m "ci: add approved photo AI preview workflows"
```

### Task 4: Create the operational, privacy, and validation runbooks

**Files:** Create the four docs/templates.

- [ ] **Step 1: Write the runbook with exact commands and reversals**

Include:

- Worker deploy before Pages Preview;
- secret names and where they live, never values;
- exact Access user/admin paths and policies;
- service/Images/DO binding checks;
- enable one account, all three accounts, global switch;
- immediate rollback order: disable global, disable Access app, remove Preview alias deployment, rotate Ark key;
- account deletion and local-data caveat;
- 10-minute cache, 24-hour idempotency and 30-day app-log targets;
- Cloudflare Access retention is provider-controlled and not covered by app deletion;
- OTP bombing response: remove email/policy, disable app, contact affected user;
- billing alert and ¥50 application budget are different controls.

- [ ] **Step 2: Create the validation JSON Schema**

The schema stores no images or identities. Each row records anonymous sample ID, category, weighed amount, ground-truth identity/preparation, truth kcal/protein ranges and sources, model release versions, result source, returned intervals, user corrections, latency bucket and pass/fail reasons. Reject exact timestamps, email, account key, IP, file path, free-form model reasoning and EXIF.

- [ ] **Step 3: Create the manual checklist**

Cover single foods, mixed dishes, soup/oil/sauce/sugar/drink, occlusion, empty plate, blur, poor light and reference object. For private tester photos require a second separate revocable validation-set consent; without it, inspect transiently and do not retain.

- [ ] **Step 4: Validate docs and commit**

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/operations/photo-ai-validation-schema.json','utf8'))"
if rg -n "@[A-Za-z0-9]|ARK_API_KEY.{1,}=|CF_Authorization|data:image" docs/operations; then exit 1; fi
git diff --check
git add docs/operations/photo-ai-stage2-runbook.md docs/operations/photo-ai-stage2-release-checklist.md docs/operations/photo-ai-validation-schema.json docs/operations/photo-ai-validation-template.md docs/operations/photo-ai-data-processing-register.md
git commit -m "docs: add photo AI beta operations runbooks"
```

### Task 5: Configure Cloudflare control plane and deploy disabled Preview

**Files:** No source changes unless an actual documented mismatch is found; mismatches require returning to the relevant implementation task.

- [ ] **Step 1: Deploy the Worker while disabled**

Dispatch the approved Preview workflow with the gateway disabled:

```bash
gh workflow run photo-ai-preview.yml --ref photo-ai-stage2 -f gateway_enabled=false
run_id="$(gh run list --workflow photo-ai-preview.yml --branch photo-ai-stage2 --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

Confirm Worker `workers_dev:false`, no route, Images binding present, SQLite DO migration v1 present, and secrets pre-provisioned. Do not enable global/account switches.

- [ ] **Step 2: Configure Pages Service Binding and secrets**

Bind `PHOTO_AI_GATEWAY` to the Worker in both Preview and production Pages environments so missing-binding differences cannot appear later. Preview receives Access team/audience/user allowlist/admin allowlist/HMAC and exact Preview origin. Production receives the same code but no client flag; its Access policy can remain disabled until production review, and the Function itself still rejects missing JWT.

- [ ] **Step 3: Create two Access applications**

User app covers only `/api/nutrition/photo/*` on the exact Preview alias and allows exactly three emails via One-time PIN. Admin app covers only `/api/nutrition/photo-admin/*` and allows exactly one administrator email. Set bounded session duration. Export only redacted policy evidence.

- [ ] **Step 4: Deploy Pages Preview**

Run the same disabled command again after bindings, capture the new run ID with the same bounded `gh run list` command, and wait for it with `gh run watch`. Verify static app, manifest, service worker and all non-AI routes. With gateway disabled, the entry may be visible but must show service disabled before choosing/uploading a photo; manual and preset nutrition still work.

- [ ] **Step 5: Run disabled-state negative verification**

Confirm Worker logs, Durable Object storage and Ark usage all remain empty after disabled attempts. Confirm production `tiezheng.pages.dev` has no photo button and no request to `/api/nutrition/photo/*`.

### Task 6: Run one-account real provider acceptance, then three-account OTP acceptance

- [ ] **Step 1: Run the three-public-image provider contract**

Dispatch and manually approve the protected provider contract:

```bash
gh workflow run photo-ai-provider-contract.yml --ref photo-ai-stage2 -f confirmation=SEND_3_PUBLIC_PRESET_IMAGES_TO_VOLCENGINE
run_id="$(gh run list --workflow photo-ai-provider-contract.yml --branch photo-ai-stage2 --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

Verify exactly three provider calls maximum, valid strict/local schema, actual usage/cost and no candidate text in logs. If model ID/price/schema differs from evidence, stop and update design/plan through review; never swap to an alias.

- [ ] **Step 2: Enable the Preview deployment gate, then global and administrator account only**

Re-run the protected Preview workflow with the exact gate:

```bash
gh workflow run photo-ai-preview.yml --ref photo-ai-stage2 -f gateway_enabled=true -f confirmation=ENABLE_PREVIEW_GATEWAY_FOR_APPROVED_BETA
run_id="$(gh run list --workflow photo-ai-preview.yml --branch photo-ai-stage2 --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
node scripts/photo-ai-admin.mjs enable-global
node scripts/photo-ai-admin.mjs enable-account
node scripts/photo-ai-admin.mjs status
```

The Worker still accepts only the fixed Preview Origin. The `enable-account` prompt receives only the administrator's tester email. Verify account daily 10, global 30, minute 2, concurrency 1/2 and budget ¥50. Do not add the other two until the administrator flow passes.

- [ ] **Step 3: Run administrator browser acceptance**

On iPhone Safari and Android Chrome verify camera, library, clear-photo prompt, login return to original date/slot, consent expiry, cancel, weak network, controlled retry, candidate editing, `none`, re-shoot, manual fallback, atomic confirm and live totals. Inspect browser storage to prove no upload Blob survives reload and backup to prove photos/estimates remain excluded.

- [ ] **Step 4: Verify abuse controls with bounded tests**

Using public preset images only, verify duplicate in-flight key, cached key, conflicting fingerprint, rapid double-click, minute 3rd request, account concurrent 2nd request, global concurrent 3rd request, daily boundaries through test clock/fake adapter, and budget boundary through test coordinator. Do not spend live calls merely to reach 10/30/¥50.

- [ ] **Step 5: Enable the other two accounts and test OTP delivery**

Run `node scripts/photo-ai-admin.mjs enable-account` once per remaining tester and enter each target only at the hidden prompt. For each email verify initial send, resend interval, expiry, wrong code, successful code, session expiry, account disable and Access removal. Record status only. Exercise `node scripts/photo-ai-admin.mjs disable-account` once with the tester's knowledge, then re-enable that account through the same confirmed CLI flow.

- [ ] **Step 6: Test Mainland network paths**

Test China Mobile, Unicom and Telecom where available, with iPhone Safari and Android Chrome. Record HTML/JS/CSS/manifest/service worker, OTP, POST, timeout and retry separately. A successful single network does not prove nationwide availability.

### Task 7: Run privacy/security inspection and weighted meal validation

- [ ] **Step 1: Inspect logs and storage**

Search Cloudflare Worker logs, Access-adjacent app logs, Durable Object rows, GitHub logs/artifacts and browser storage for image bytes/Base64, emails, raw IP, food names, preparation, assumptions, dates/slots, health fields and secrets. Any match blocks release and triggers key rotation when appropriate.

- [ ] **Step 2: Verify image sanitation**

Use consented test fixtures containing EXIF/GPS, animation, MPO/APNG, MIME mismatch, large pixels, extreme aspect ratio and corrupt data. Confirm re-encoded WebP has no EXIF/GPS and rejected inputs never invoke Ark.

- [ ] **Step 3: Run the weighed meal set**

Use the schema/template. For every sample compare identity, preparation, amount interval, kcal interval and protein interval. A category match cannot substitute for nutritional interval coverage. Record every time the system should have returned `none` but gave narrow numbers; any systematic precision overclaim blocks the beta.

- [ ] **Step 4: Verify deletion and rotation**

Disable and delete a test account through the admin API, confirm its DO flags/counters/idempotency/cache/leases disappear, and confirm its browser-local food/training data remains until that user deletes it locally. Rotate the temporary Ark key after validation if exposure is suspected.

### Task 8: Produce a three-account beta decision while keeping production off

- [ ] **Step 1: Re-run all automated gates at the deployed SHA**

```bash
npm ci
npm run typecheck
npm run typecheck:edge
npm test
npm run test:edge
npm run build
npm run verify:photo-release -- --workflows
git diff --check
```

- [ ] **Step 2: Fill the release checklist**

Every hard gate is Pass/Fail/Blocked with date and evidence reference. Never convert an untested item to Pass. Candidate quality, security, control-plane configuration, deployment, real provider and production authorization are separate statuses.

- [ ] **Step 3: Decide only the closed beta**

Allowed outcomes:

- `GREEN_FOR_THREE_ACCOUNT_PREVIEW`
- `BLOCKED`

There is no public-production outcome in this plan. A GREEN decision states that three named users may continue on the Preview alias only.

- [ ] **Step 4: Commit only redacted evidence**

Commit runbook/checklist/aggregate validation changes with:

```bash
git add docs/operations
git commit -m "docs: record photo AI preview acceptance"
```

Do not commit screenshots, raw photos, emails, tokens, Access exports or provider candidate text.

- [ ] **Step 5: Keep production controls unchanged**

Verify GitHub production variables omit `VITE_ENABLE_PHOTO_AI`, the production UI has no entry, and Worker exact origin remains Preview-only. Any future production enablement requires a new design/plan covering public abuse controls, Mainland production domain/ICP, legal/nutrition review, provider retention evidence and a new release authorization.

## Final release checklist

- [ ] Three user emails and one admin are present only in Access/secrets.
- [ ] Access JWT signature, issuer, audience and allowlist were live-tested.
- [ ] Preview origin is exact; no wildcard Pages domain exists.
- [ ] Worker has no public route and no R2/KV/D1/Cache binding.
- [ ] Images, DO, service binding and SQLite migration are live.
- [ ] Global/account kill switches and account deletion were exercised.
- [ ] Real provider contract used at most three public images.
- [ ] iPhone, Android, camera, library, OTP and weak-network paths passed.
- [ ] Confirm-before-count and Dexie rollback passed in browser.
- [ ] Quota/idempotency/concurrency/budget attacks passed without live overspend.
- [ ] Negative log/storage scans found no forbidden data.
- [ ] Price, terms, privacy and data settings evidence is current.
- [ ] Production client and origin remain disabled.
- [ ] Decision says Preview-only, never public production.
