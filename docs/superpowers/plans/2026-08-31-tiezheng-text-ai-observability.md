# 铁证文字 AI 脱敏诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Preview 文字餐食估算链路加入可搜索、无餐食或凭证内容的阶段日志，并开启 Cloudflare Worker 日志持久化，以定位模型调用前的超时断点。

**Architecture:** Worker 在文字估算处理器内部创建单次请求诊断轨迹，只允许固定阶段名、固定结果码、耗时和随机 trace ID 进入日志。Wrangler 是 Observability 的唯一配置源；本次部署不发送估算请求，模型调用仍需单独授权。

**Tech Stack:** TypeScript、Vitest、Cloudflare Workers、Wrangler 4、GitHub Actions。

---

### Task 1: 锁定诊断日志的隐私边界

**Files:**
- Create: `workers/photo-ai-gateway/src/textDiagnostics.test.ts`
- Create: `workers/photo-ai-gateway/src/textDiagnostics.ts`

- [x] **Step 1: 写失败测试**

测试固定输出只含以下字段，并验证关闭态无输出：

```ts
expect(records[0]).toEqual({
  event: 'tiezheng.text-ai.lifecycle',
  traceId: '11111111-1111-4111-8111-111111111111',
  stage: 'request-received',
  elapsedMs: 0,
});
expect(Object.keys(records[0])).toEqual(['event', 'traceId', 'stage', 'elapsedMs']);
expect(records).not.toContainEqual(expect.objectContaining({ description: expect.anything() }));
```

- [x] **Step 2: 运行 RED**

```bash
npx vitest run workers/photo-ai-gateway/src/textDiagnostics.test.ts
```

Expected: FAIL，因为 `textDiagnostics.ts` 尚不存在。

- [x] **Step 3: 写最小实现**

实现 `createTextDiagnosticTrace(enabled, dependencies)`。记录器只能输出 `event`、`traceId`、`stage`、`elapsedMs`，以及可选的 `code`、`reservationKind`、`aborted`；任何时钟、UUID 或日志写入异常都必须静默失败，不能改变业务响应。

- [x] **Step 4: 运行 GREEN**

```bash
npx vitest run workers/photo-ai-gateway/src/textDiagnostics.test.ts
```

Expected: PASS。

### Task 2: 在模型调用前后加入阶段打点

**Files:**
- Modify: `workers/photo-ai-gateway/src/env.ts`
- Modify: `workers/photo-ai-gateway/src/textHandler.ts`
- Modify: `workers/photo-ai-gateway/src/textHandler.test.ts`

- [x] **Step 1: 写失败集成测试**

启用 `TEXT_AI_DIAGNOSTICS_ENABLED` 后，缓存失败路径必须按顺序输出：

```ts
['request-received', 'gateway-ready', 'body-parsed', 'fingerprint-ready', 'reservation-pending', 'reservation-failed']
```

且不得出现 `provider-started`。正常 fake-adapter 路径必须包含 `provider-started`、`provider-succeeded` 和 `response-succeeded`。

- [x] **Step 2: 运行 RED**

```bash
npx vitest run workers/photo-ai-gateway/src/textHandler.test.ts
```

Expected: FAIL，因为处理器尚未发出诊断阶段。

- [x] **Step 3: 写最小实现**

在配置检查、正文解析、fingerprint、reserve 结果、adapter 创建、markInvoked、provider 调用和最终成功边界调用固定 `trace.emit(...)`。不得把 request、body、accountKey、idempotencyKey、邮箱、访问码、API Key、模型请求或模型响应传给记录器。

- [x] **Step 4: 运行 GREEN**

```bash
npx vitest run workers/photo-ai-gateway/src/textDiagnostics.test.ts workers/photo-ai-gateway/src/textHandler.test.ts
```

Expected: PASS。

### Task 3: 开启 Worker Observability 并验证部署产物

**Files:**
- Modify: `.github/workflows/text-ai-preview.yml`
- Modify: `scripts/verify-text-ai-preview-workflow.mjs`
- Modify: `scripts/verify-text-ai-preview-workflow.test.mjs`
- Modify: `workers/photo-ai-gateway/wrangler.jsonc`

- [x] **Step 1: 配置持久化日志**

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1,
  "logs": {
    "enabled": true,
    "head_sampling_rate": 1,
    "invocation_logs": false,
    "persist": true
  }
}
```

- [x] **Step 2: 完整本地验证**

```bash
npm run typecheck
npm test
npm run typecheck:edge
npm run test:edge
npm run build
npm run verify:text-preview-workflow
./node_modules/.bin/wrangler deploy --dry-run --config workers/photo-ai-gateway/wrangler.jsonc --outdir /private/tmp/tiezheng-text-diagnostic-dry-run
```

Expected: 所有命令退出码 0，且 dry-run 不发布 Worker。

- [ ] **Step 3: 经独立授权后提交、推送并部署**

```bash
git commit -m "chore: add privacy-safe text AI diagnostics"
git -C <main-checkout> merge --ff-only <diagnostic-commit-sha>
git -C <main-checkout> push origin main
gh workflow run text-ai-preview.yml --repo nuts-and-bytes/tiezheng --ref main \
  -f operation=deploy-diagnostics \
  -f target=user-1 \
  -f expected_sha=<40-character-main-sha> \
  -f confirmation=DEPLOY_TEXT_DIAGNOSTICS
```

Expected: 工作流仅在 Worker/全局/user-1 已启用、user-2 未启用且两个账号无预留费用时，重新发布启用态 Worker；不修改管理状态、不发布 Pages，也不发起任何餐食估算或模型请求。
