# 铁证文字餐食 AI 双账号 Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `text-ai-preview.tiezheng.pages.dev` 建立只允许两个邮箱、最多一次真实豆包调用、可独立停用和回滚的文字餐食 AI Preview，生产与照片 AI 始终关闭。

**Architecture:** 保留现有浏览器 → Pages Function → Service Binding → Worker → Durable Object → 豆包链路；新增文字专用 Access profile、无 UI 管理端点、原子管理操作和受保护 `workflow_dispatch`。Cloudflare 控制面由严格、可测试的 Node 脚本收敛，GitHub workflow 只传固定枚举操作，不接受任意邮箱或任意命令。

**Tech Stack:** React 19、TypeScript、Vitest、Cloudflare Pages Functions、Workers、Durable Objects SQLite、Cloudflare Access、Wrangler 4.123、GitHub Actions、火山方舟 Responses API。

---

## 范围与执行约束

- 设计来源：`docs/superpowers/specs/2026-08-24-tiezheng-text-ai-preview-release-design.md`。
- Preview origin 固定为 `https://text-ai-preview.tiezheng.pages.dev`。
- Worker 名固定为 `tiezheng-photo-ai-gateway`，Pages binding 名继续为 `PHOTO_AI_GATEWAY`。
- 模型固定为 `doubao-seed-2-1-pro-260628`。
- 当前用户数固定为 2，管理员必须是 `user-1`。
- Preview 供应商最大尝试数固定为 1。
- 所有源码默认开关为 false；只允许受保护手动 workflow 覆盖 Preview。
- 普通 CI、生产 Pages、照片 UI、照片 Worker 开关不得改变。
- Cloudflare audience 是控制面生成值，由 reconciliation 脚本写入 Preview Pages secret；不要求人工复制 audience。
- 任何真实部署、Access 写入、secret 写入和豆包调用都在 Task 11 之后；Task 1–10 只产生本地代码、测试、文档与提交。

## File map

### Access 与公共契约

- Modify `edge/photo-ai/access.ts`：提取可复用 JWT 验证、固定人数配置和邮箱派生账号键；保留照片三账号 wrapper。
- Modify `edge/photo-ai/access.test.ts`：锁定照片三账号不变、邮箱派生身份和 JWT 失败关闭。
- Create `edge/text-ai/access.ts`：文字双账号、单管理员、Access service-token principal。
- Create `edge/text-ai/access.test.ts`：双账号/管理员/service-token profile 测试。
- Create `src/lib/textAiAdminContract.ts`：浏览器到 Pages、Pages 到 Worker、Worker 到 Pages 的严格管理契约。
- Create `src/lib/textAiAdminContract.test.ts`：严格字段、operation/target 组合、响应边界。

### Pages 与 Worker 管理路径

- Modify `edge/text-ai/pagesProxy.ts`：使用文字 Access env，不再复用照片三邮箱 parser。
- Modify `edge/text-ai/pagesProxy.test.ts`：双邮箱用户门禁回归。
- Create `edge/text-ai/admin.ts`：同源管理请求、人工/服务 principal、邮箱到账号键和有界代理。
- Create `edge/text-ai/admin.test.ts`：鉴权、CSRF、隐私、代理和失败映射。
- Create `functions/api/nutrition/text-admin/account.ts`：唯一管理 Function route。
- Modify `public/_routes.json`：加入 `/api/nutrition/text-admin/*`。
- Modify `workers/photo-ai-gateway/src/coordinator.ts`：原子管理操作、24 小时防重放和状态快照。
- Modify `workers/photo-ai-gateway/src/coordinator.worker.test.ts`：真实 SQLite 管理迁移、幂等、隔离与删除测试。
- Create `workers/photo-ai-gateway/src/textAdminHandler.ts`：内部管理请求防火墙和协调器 RPC。
- Create `workers/photo-ai-gateway/src/textAdminHandler.test.ts`：配置、请求、RPC 与隐私测试。
- Modify `workers/photo-ai-gateway/src/index.ts`：增加 `/internal/text-admin`。
- Modify `workers/photo-ai-gateway/src/env.ts`：增加管理开关和最大供应商尝试数。
- Modify `workers/photo-ai-gateway/src/textHandler.ts`：最大尝试数为 1 时不自动 retry。
- Modify `workers/photo-ai-gateway/src/textHandler.test.ts`：一次尝试和既有两次注入测试。
- Modify `workers/photo-ai-gateway/wrangler.jsonc`：两个新变量默认安全值。

### 控制面、workflow 与运维文档

- Create `scripts/cloudflare-api.mjs`：有界 Cloudflare API client 和 shape validation。
- Create `scripts/cloudflare-api.test.mjs`：响应上限、失败隐藏和 API envelope 测试。
- Create `scripts/text-ai-preview-control.mjs`：只读 preflight、Access/Pages reconcile、管理调用。
- Create `scripts/text-ai-preview-control.test.mjs`：固定资源、策略、Preview-only patch 和脱敏输出。
- Create `scripts/verify-text-ai-preview-workflow.mjs`：静态验证 workflow 安全策略。
- Create `scripts/verify-text-ai-preview-workflow.test.mjs`：拒绝 push、生产开关、任意输入与多次真实调用。
- Create `.github/workflows/text-ai-preview.yml`：受保护手动 workflow。
- Modify `package.json`：增加控制面和 workflow policy 测试命令。
- Modify `.gitignore`：排除本地控制面 evidence、Access exports 和临时 secret 文件。
- Modify `vitest.edge.config.ts`、`tsconfig.edge.json`：纳入新增 Edge/Worker 测试和契约。
- Create `docs/operations/text-ai-preview-runbook.md`：配置、启用、验证和回滚命令。
- Create `docs/operations/text-ai-preview-release-checklist.md`：只记录脱敏状态。

---

### Task 1: 提取文字 Access profile 并把账号键固定为邮箱 HMAC

**Files:**
- Modify: `edge/photo-ai/access.ts`
- Modify: `edge/photo-ai/access.test.ts`
- Create: `edge/text-ai/access.ts`
- Create: `edge/text-ai/access.test.ts`
- Modify: `vitest.edge.config.ts`

- [ ] **Step 1: 写照片人数不变和邮箱稳定身份的失败测试**

在 `edge/photo-ai/access.test.ts` 增加：

```ts
test('照片 wrapper 仍只接受三个邮箱', () => {
  expect(() => parseAccessConfig({
    ...baseEnv,
    PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
  })).toThrow('Access denied');
});

test('账号键由规范化邮箱而不是可变化的 sub 派生', async () => {
  const { fetcher, sign } = await fixture();
  const first = await verifyAccess(
    request(await sign({ sub: 'first-sub', email: 'Alice@Example.Com' })),
    parseAccessConfig(baseEnv),
    fetcher,
  );
  const second = await verifyAccess(
    request(await sign({ sub: 'second-sub', email: 'alice@example.com' })),
    parseAccessConfig(baseEnv),
    fetcher,
  );
  expect(first.accountKey).toBe(second.accountKey);
  expect(first.accountKey).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: 写文字双账号、管理员和 service principal 的失败测试**

创建 `edge/text-ai/access.test.ts`，覆盖：

```ts
const env: TextAccessEnv = {
  PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
  PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
  TEXT_AI_ACCESS_AUD: 'text-user-aud',
  TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
  TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
  TEXT_AI_ADMIN_ACCESS_AUD: 'text-admin-aud',
  TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
  TEXT_AI_ADMIN_SERVICE_CLIENT_ID: 'service-client.access',
};

test('文字用户当前必须恰好两个且管理员属于用户清单', () => {
  expect(parseTextUserAccessConfig(env).allowedEmails.size).toBe(2);
  expect(parseTextAdminAccessConfig(env).adminEmail).toBe('alice@example.com');
  expect(() => parseTextUserAccessConfig({
    ...env,
    TEXT_AI_ALLOWED_EMAILS: 'alice@example.com',
  })).toThrow('Access denied');
  expect(() => parseTextAdminAccessConfig({
    ...env,
    TEXT_AI_ADMIN_EMAIL: 'carol@example.com',
  })).toThrow('Access denied');
});

test('管理 Access 只接受配置的管理员或精确 service client', async () => {
  await expect(verifyTextAdminAccess(userRequest, parseTextAdminAccessConfig(env), fetcher))
    .resolves.toMatchObject({ kind: 'user', email: 'alice@example.com' });
  await expect(verifyTextAdminAccess(serviceRequest, parseTextAdminAccessConfig(env), fetcher))
    .resolves.toEqual({ kind: 'service', clientId: 'service-client.access', expiresAt });
});
```

service JWT fixture 必须使用 Cloudflare 官方形状：`sub:''`、无 `email`、`common_name` 为 Client ID。错误 audience、错误 common_name、同时出现 email/common_name 和缺失 expiry 全部拒绝。

- [ ] **Step 3: 运行测试确认 RED**

Run:

```bash
npm run test:edge -- edge/photo-ai/access.test.ts edge/text-ai/access.test.ts
```

Expected: 新导出不存在，且旧账号键仍由 `payload.sub` 派生。

- [ ] **Step 4: 实现可复用 Access 核心和文字 profile**

`edge/photo-ai/access.ts` 保留 `parseAccessConfig(env)`，新增以下稳定边界：

```ts
export interface AccessConfigFields {
  teamDomain: string;
  audience: string;
  allowedEmails: string;
  expectedEmailCount: 1 | 2 | 3;
  accountHmacSecret: string;
}

export type VerifiedAccessPrincipal =
  | { kind: 'user'; email: string; expiresAt: number }
  | { kind: 'service'; clientId: string; expiresAt: number };

export function parseAccessConfigFields(fields: AccessConfigFields): AccessConfig;
export function deriveAccountKey(email: string, secret: string): Promise<string>;
export function verifyAccessPrincipal(
  request: Request,
  config: AccessConfig,
  fetcher?: typeof fetch,
): Promise<VerifiedAccessPrincipal>;
```

`parseAccessConfig()` 必须调用 `parseAccessConfigFields()`，传 `expectedEmailCount:3`。`verifyAccess()` 只接受 `kind:'user'`，并调用：

```ts
const accountKey = await deriveAccountKey(principal.email, config.accountHmacSecret);
return { accountKey, expiresAt: principal.expiresAt };
```

`deriveAccountKey()` 只接受已规范化且通过 EMAIL regex 的小写邮箱，HMAC-SHA256 后返回 64 位小写十六进制。

创建 `edge/text-ai/access.ts`：

```ts
export interface TextAccessEnv {
  PHOTO_AI_TEAM_DOMAIN: string;
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
  TEXT_AI_ACCESS_AUD: string;
  TEXT_AI_ALLOWED_EMAILS: string;
  TEXT_AI_ALLOWED_EMAIL_COUNT: string;
  TEXT_AI_ADMIN_ACCESS_AUD: string;
  TEXT_AI_ADMIN_EMAIL: string;
  TEXT_AI_ADMIN_SERVICE_CLIENT_ID: string;
}

export interface TextAdminAccessConfig extends AccessConfig {
  adminEmail: string;
  serviceClientId: string;
}

export function parseTextUserAccessConfig(env: TextAccessEnv): AccessConfig;
export function parseTextAdminAccessConfig(env: TextAccessEnv): TextAdminAccessConfig;
export async function verifyTextAdminAccess(
  request: Request,
  config: TextAdminAccessConfig,
  fetcher?: typeof fetch,
): Promise<VerifiedAccessPrincipal>;
```

`parseTextUserAccessConfig()` 只接受计数字符串 `'2'` 或 `'3'`，并要求邮箱清单与计数精确相等；当前 workflow 固定传 `'2'`。这允许第三账号以后通过受保护配置加入而不改 Access 业务 parser。管理员 verifier 对 user 要求 `email===adminEmail`，对 service 要求 `clientId===serviceClientId`。

- [ ] **Step 5: 运行 Access 测试确认 GREEN**

Run:

```bash
npm run test:edge -- edge/photo-ai/access.test.ts edge/text-ai/access.test.ts
```

Expected: PASS，照片人数仍固定 3，文字人数固定 2，管理员固定 1。

- [ ] **Step 6: 提交 Access 边界**

```bash
git add edge/photo-ai/access.ts edge/photo-ai/access.test.ts edge/text-ai/access.ts edge/text-ai/access.test.ts vitest.edge.config.ts
git commit -m "feat: add isolated text AI access profiles"
```

### Task 2: 建立严格文字管理契约

**Files:**
- Create: `src/lib/textAiAdminContract.ts`
- Create: `src/lib/textAiAdminContract.test.ts`
- Modify: `tsconfig.edge.json`

- [ ] **Step 1: 写 operation 与 target 组合的失败测试**

```ts
const base = {
  schemaVersion: 1,
  operationId: '1'.repeat(32),
  operation: 'status',
  targetEmail: 'alice@example.com',
};

test('接受六个固定动作且所有动作都携带目标邮箱', () => {
  for (const operation of [
    'status',
    'enable-text-global',
    'disable-text-global',
    'enable-account',
    'disable-account',
    'delete-account',
  ] as const) {
    expect(parseTextAiAdminRequest({ ...base, operation }).operation).toBe(operation);
  }
});

test.each([
  { ...base, operationId: 'ABC' },
  { ...base, targetEmail: 'Alice@example.com' },
  { ...base, targetEmail: 'alice@example' },
  { ...base, extra: true },
  { ...base, operation: 'enable-photo-global' },
])('拒绝非法管理请求 %#', (value) => {
  expect(() => parseTextAiAdminRequest(value)).toThrow('Invalid text admin contract');
});
```

- [ ] **Step 2: 写 Worker 请求和响应严格测试**

Worker 请求必须把邮箱替换为账号键：

```ts
const workerRequest = {
  schemaVersion: 1,
  operationId: '1'.repeat(32),
  operation: 'status',
  accountKey: 'a'.repeat(64),
};

const success = {
  ok: true,
  operationId: '1'.repeat(32),
  status: {
    textGlobalEnabled: false,
    accountEnabled: false,
    accountRemaining: 10,
    globalRemaining: 30,
    budgetSpentMicros: 0,
    budgetReservedMicros: 0,
    resetAt: '2026-08-25T00:00:00.000Z',
  },
};

expect(parseTextAiAdminWorkerRequest(workerRequest)).toEqual(workerRequest);
expect(parseTextAiAdminResponse(success)).toEqual(success);
expect(JSON.stringify(success)).not.toContain('@');
```

拒绝 NaN、负预算、超过 10/30 的剩余额度、非法 ISO 时间、多余字段、错误 operation ID 和 `ok:false` 中未知错误码。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- src/lib/textAiAdminContract.test.ts`

Expected: FAIL，因为模块不存在。

- [ ] **Step 4: 实现严格 descriptor parser**

创建以下导出：

```ts
export const TEXT_AI_ADMIN_SCHEMA_VERSION = 1 as const;
export type TextAiAdminOperation =
  | 'status'
  | 'enable-text-global'
  | 'disable-text-global'
  | 'enable-account'
  | 'disable-account'
  | 'delete-account';

export interface TextAiAdminRequest {
  schemaVersion: 1;
  operationId: string;
  operation: TextAiAdminOperation;
  targetEmail: string;
}

export interface TextAiAdminWorkerRequest {
  schemaVersion: 1;
  operationId: string;
  operation: TextAiAdminOperation;
  accountKey: string;
}

export interface TextAiAdminStatus {
  textGlobalEnabled: boolean;
  accountEnabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  budgetSpentMicros: number;
  budgetReservedMicros: number;
  resetAt: string;
}

export type TextAiAdminResponse =
  | { ok: true; operationId: string; status: TextAiAdminStatus }
  | { ok: false; code: 'auth-required' | 'invalid-request' | 'operation-conflict' | 'service-disabled' };
```

实现 `parseTextAiAdminRequest()`、`parseTextAiAdminWorkerRequest()` 和 `parseTextAiAdminResponse()`。所有 parser 使用 own-property descriptor snapshot，拒绝 getter、symbol、多余键、非普通对象、NaN 和 Infinity。

- [ ] **Step 5: 运行契约测试和类型检查**

```bash
npm test -- src/lib/textAiAdminContract.test.ts
npm run typecheck:edge
```

Expected: PASS。

- [ ] **Step 6: 提交管理契约**

```bash
git add src/lib/textAiAdminContract.ts src/lib/textAiAdminContract.test.ts tsconfig.edge.json
git commit -m "feat: define strict text AI admin contract"
```

### Task 3: 在 Durable Object 中原子实现管理操作

**Files:**
- Modify: `workers/photo-ai-gateway/src/coordinator.ts`
- Modify: `workers/photo-ai-gateway/src/coordinator.worker.test.ts`

- [ ] **Step 1: 写 schema migration 和重放失败测试**

```ts
test('管理表迁移幂等且默认文字关闭', async () => {
  const stub = coordinator();
  await runInDurableObject(stub, async (_instance, state) => {
    ensureCoordinatorSchema(state.storage.sql);
    ensureCoordinatorSchema(state.storage.sql);
    expect(state.storage.sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='text_admin_operations'",
    ).toArray()).toEqual([{ name: 'text_admin_operations' }]);
  });
});

test('相同 operation 幂等，不同指纹冲突', async () => {
  const stub = coordinator();
  const input = adminInput('enable-account', ACCOUNT_A, 1);
  const first = await stub.applyTextAdminOperation(input);
  const replay = await stub.applyTextAdminOperation(input);
  expect(replay).toEqual(first);
  await expect(stub.applyTextAdminOperation({
    ...input,
    operation: 'delete-account',
  })).resolves.toEqual({ kind: 'conflict' });
});
```

- [ ] **Step 2: 写文字/照片开关隔离和账号删除测试**

```ts
test('文字总开关不改变照片总开关', async () => {
  const stub = coordinator();
  await stub.applyTextAdminOperation(adminInput('enable-text-global', ACCOUNT_A, 2));
  const text = await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW });
  const photo = await stub.status({ channel: 'photo', accountKey: ACCOUNT_A, now: BASE_NOW });
  expect(text.enabled).toBe(true);
  expect(photo.enabled).toBe(false);
});

test('删除账号清理双通道状态但不改变全局设置', async () => {
  const stub = coordinator();
  await stub.applyTextAdminOperation(adminInput('enable-text-global', ACCOUNT_A, 3));
  await stub.applyTextAdminOperation(adminInput('enable-account', ACCOUNT_A, 4));
  await stub.applyTextAdminOperation(adminInput('delete-account', ACCOUNT_A, 5));
  const status = await stub.status({ channel: 'text', accountKey: ACCOUNT_A, now: BASE_NOW });
  expect(status.enabled).toBe(true);
  expect(status.accountEnabled).toBe(false);
  expect(status.accountRemaining).toBe(10);
});
```

- [ ] **Step 3: 运行协调器测试确认 RED**

Run: `npm run test:edge -- workers/photo-ai-gateway/src/coordinator.worker.test.ts`

Expected: FAIL，`applyTextAdminOperation` 不存在。

- [ ] **Step 4: 增加管理输入、状态和 24 小时表**

在 `coordinator.ts` 导出：

```ts
export interface TextAdminOperationInput {
  operationId: string;
  operation: TextAiAdminOperation;
  accountKey: string;
  fingerprint: string;
  now: number;
}

export type TextAdminOperationResult =
  | { kind: 'applied'; status: TextAiAdminStatus }
  | { kind: 'conflict' };
```

schema 增加：

```sql
CREATE TABLE IF NOT EXISTS text_admin_operations (
  operation_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)
```

operation ID 只接受 32 位小写十六进制。指纹固定为 `SHA-256(stableJson({operation,accountKey}))` 的 64 位小写十六进制；传入协调器前由 Worker 计算，协调器同时验证格式。表只保存 operation ID、指纹和过期时间，不保存邮箱或响应正文。

- [ ] **Step 5: 实现单事务管理操作**

新增私有 helper：

```ts
private setAccountFlag(account: string, enabled: boolean): void;
private deleteAccountState(account: string): void;
private textStatusSnapshot(account: string, now: number): TextAiAdminStatus;
```

`applyTextAdminOperation()` 在一个 `transactionSync` 中按以下顺序执行：清理过期 operation；检查同 ID 指纹；同 ID 不同指纹返回 `{kind:'conflict'}`；应用固定动作；插入 operation；返回 `{kind:'applied',status:textStatusSnapshot()}`。`enable-text-global` 和 `disable-text-global` 只写 `text_global_enabled`。账号上限继续使用 `GATEWAY_LIMITS.betaAccounts===3`。

- [ ] **Step 6: 运行协调器和照片/文字回归**

```bash
npm run test:edge -- workers/photo-ai-gateway/src/coordinator.worker.test.ts workers/photo-ai-gateway/src/handler.test.ts workers/photo-ai-gateway/src/textHandler.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交协调器管理操作**

```bash
git add workers/photo-ai-gateway/src/coordinator.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts
git commit -m "feat: add atomic text AI admin operations"
```

### Task 4: 增加内部 Worker 管理路由

**Files:**
- Create: `workers/photo-ai-gateway/src/textAdminHandler.ts`
- Create: `workers/photo-ai-gateway/src/textAdminHandler.test.ts`
- Modify: `workers/photo-ai-gateway/src/env.ts`
- Modify: `workers/photo-ai-gateway/src/index.ts`
- Modify: `workers/photo-ai-gateway/wrangler.jsonc`
- Modify: `vitest.edge.config.ts`

- [ ] **Step 1: 写失败关闭和严格 JSON 测试**

```ts
test.each([
  { TEXT_AI_ADMIN_ENABLED: undefined },
  { TEXT_AI_ADMIN_ENABLED: 'TRUE' },
])('管理开关非精确 true 时不接触协调器', async (override) => {
  const env = configuredEnv(override);
  const response = await handleTextAdminRequest(workerRequest(validBody), env);
  expect(response.status).toBe(503);
  expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
});

test.each([
  workerRequest(validBody, { contentType: 'text/plain' }),
  workerRequest({ ...validBody, extra: true }),
  workerRequest(validBody, { accountKey: 'bad' }),
  workerRequest(validBody, { query: '?x=1' }),
])('非法内部请求在 RPC 前拒绝 %#', async (request) => {
  const env = configuredEnv();
  const response = await handleTextAdminRequest(request, env);
  expect(response.status).toBe(400);
  expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 写 RPC 映射、冲突和隐私测试**

```ts
test('只把 operation、operationId、accountKey、fingerprint 和 now 传给协调器', async () => {
  const applyTextAdminOperation = vi.fn().mockResolvedValue({ kind: 'applied', status: statusFixture });
  const response = await handleTextAdminRequest(workerRequest(validBody), configuredEnv({
    PHOTO_AI_COORDINATOR: namespace({ applyTextAdminOperation }),
  }), { now: () => BASE_NOW });
  expect(response.status).toBe(200);
  expect(applyTextAdminOperation).toHaveBeenCalledWith({
    operationId: validBody.operationId,
    operation: validBody.operation,
    accountKey: 'a'.repeat(64),
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    now: BASE_NOW,
  });
  expect(JSON.stringify(await response.json())).not.toContain('@');
});
```

协调器 operation conflict 映射 409；其他 RPC 异常映射 503；不调用 `console.*`。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm run test:edge -- workers/photo-ai-gateway/src/textAdminHandler.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 handler 与 route**

`GatewayEnv` 增加：

```ts
TEXT_AI_ADMIN_ENABLED: string;
TEXT_AI_MAX_PROVIDER_ATTEMPTS: string;
```

`wrangler.jsonc` 默认：

```json
"TEXT_AI_ADMIN_ENABLED": "false",
"TEXT_AI_MAX_PROVIDER_ATTEMPTS": "1"
```

`textAdminHandler.ts` 导出：

```ts
export interface TextAdminDependencies { now(): number }
export const TEXT_ADMIN_RUNTIME = Object.freeze({ now: Date.now });
export async function handleTextAdminRequest(
  request: Request,
  env: GatewayEnv,
  dependencies?: TextAdminDependencies,
): Promise<Response>;
```

正文上限 2048 bytes，fatal UTF-8，精确 `application/json`，账号 header 精确 64 hex。`index.ts` 只接受：

```ts
if (request.method === 'POST'
  && url.pathname === '/internal/text-admin'
  && url.search === '') {
  return handleTextAdminRequest(request, env);
}
```

- [ ] **Step 5: 运行 Worker 管理和 route 回归**

```bash
npm run test:edge -- workers/photo-ai-gateway/src/textAdminHandler.test.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts
npm run typecheck:edge
```

Expected: PASS。

- [ ] **Step 6: 提交 Worker 管理路由**

```bash
git add workers/photo-ai-gateway/src/textAdminHandler.ts workers/photo-ai-gateway/src/textAdminHandler.test.ts workers/photo-ai-gateway/src/env.ts workers/photo-ai-gateway/src/index.ts workers/photo-ai-gateway/wrangler.jsonc vitest.edge.config.ts
git commit -m "feat: add internal text AI admin route"
```

### Task 5: 增加 Pages 管理防火墙和双账号文字用户路由

**Files:**
- Modify: `edge/text-ai/pagesProxy.ts`
- Modify: `edge/text-ai/pagesProxy.test.ts`
- Create: `edge/text-ai/admin.ts`
- Create: `edge/text-ai/admin.test.ts`
- Create: `functions/api/nutrition/text-admin/account.ts`
- Modify: `public/_routes.json`
- Modify: `vitest.edge.config.ts`

- [ ] **Step 1: 写文字用户双邮箱门禁测试**

把 text Pages test env 改为：

```ts
const env: TextAiPagesEnv = {
  PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
  PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
  PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
  TEXT_AI_ACCESS_AUD: 'text-user-aud',
  TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
  TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
  TEXT_AI_ADMIN_ACCESS_AUD: 'text-admin-aud',
  TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
  TEXT_AI_ADMIN_SERVICE_CLIENT_ID: 'service-client.access',
  PHOTO_AI_GATEWAY: gateway,
};
```

断言第三邮箱 token 401、两个邮箱 token 可到达绑定、照片 route tests 仍要求三个照片邮箱。

- [ ] **Step 2: 写管理同源、JWT 和邮箱映射失败测试**

`edge/text-ai/admin.test.ts` 覆盖：

```ts
test.each([
  ['https://evil.example', 'same-origin'],
  [ORIGIN, 'cross-site'],
  ['', 'same-origin'],
])('拒绝非同源管理请求 %#', async (origin, site) => {
  const response = await handleTextAdminPagesRequest(request({ origin, site }), env);
  expect(response.status).toBe(401);
  expect(gateway.fetch).not.toHaveBeenCalled();
});

test('管理员和配置的 service token 都可调用，普通用户不可调用', async () => {
  await expect(authorizeTextAdminPagesRequest(adminUserRequest, env)).resolves.toMatchObject({
    accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await expect(authorizeTextAdminPagesRequest(serviceRequest, env)).resolves.toMatchObject({
    accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await expect(authorizeTextAdminPagesRequest(secondUserRequest, env)).rejects.toThrow();
});
```

目标邮箱必须属于两邮箱清单；gateway 输入只能包含 internal URL、账号 header 和无邮箱 Worker body。

- [ ] **Step 3: 运行 Pages 测试确认 RED**

```bash
npm run test:edge -- edge/text-ai/pagesProxy.test.ts edge/text-ai/admin.test.ts edge/photo-ai/pagesRoutes.test.ts
```

Expected: FAIL，新 env 和管理模块不存在。

- [ ] **Step 4: 实现 TextAiPagesEnv 和用户 Access profile**

`pagesProxy.ts` 改为导出：

```ts
export interface TextAiPagesEnv extends TextAccessEnv {
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_GATEWAY?: Fetcher;
}
```

`authorizeTextAiPagesRequest()` 使用 `parseTextUserAccessConfig(env)`；三个 Function 文件改为 `PagesFunction<TextAiPagesEnv>`。照片类型和 parser 不变。

- [ ] **Step 5: 实现管理 Pages module 和 Function**

`edge/text-ai/admin.ts` 固定：

```ts
export async function authorizeTextAdminPagesRequest(
  request: Request,
  env: TextAiPagesEnv,
): Promise<{ accountKey: string; request: TextAiAdminWorkerRequest }>;

export async function proxyTextAdminRequest(
  env: TextAiPagesEnv,
  accountKey: string,
  body: TextAiAdminWorkerRequest,
): Promise<Response>;
```

验证路径 `/api/nutrition/text-admin/account`、POST、无 query、同源 Origin、`Sec-Fetch-Site:same-origin`、精确 JSON 和 2048-byte 上限。人工或 service principal 验证后，目标邮箱必须在 `parseTextUserAccessConfig(env).allowedEmails` 中；用 `deriveAccountKey()` 得到账号键。下游固定 `/internal/text-admin`，响应必须经过 `parseTextAiAdminResponse()`。

Function catch 映射：认证/请求错误 401，binding 缺失或下游非法 503，operation conflict 保留 409。

- [ ] **Step 6: 更新 Pages routes 并运行 GREEN**

`public/_routes.json` include 增加：

```json
"/api/nutrition/text-admin/*"
```

Run:

```bash
npm run test:edge -- edge/text-ai/pagesProxy.test.ts edge/text-ai/admin.test.ts edge/photo-ai/pagesRoutes.test.ts
npm run typecheck:edge
```

Expected: PASS，照片 route 回归通过。

- [ ] **Step 7: 提交 Pages 管理层**

```bash
git add edge/text-ai/pagesProxy.ts edge/text-ai/pagesProxy.test.ts edge/text-ai/admin.ts edge/text-ai/admin.test.ts functions/api/nutrition/text functions/api/nutrition/text-admin/account.ts public/_routes.json vitest.edge.config.ts
git commit -m "feat: add authenticated text AI admin pages route"
```

### Task 6: 将 Preview 供应商尝试数锁定为 1

**Files:**
- Modify: `workers/photo-ai-gateway/src/textHandler.ts`
- Modify: `workers/photo-ai-gateway/src/textHandler.test.ts`
- Modify: `workers/photo-ai-gateway/src/env.ts`
- Modify: `workers/photo-ai-gateway/wrangler.jsonc`

- [ ] **Step 1: 写单次失败不 retry 的红灯测试**

```ts
test('maxProviderAttempts=1 时 retryable 错误也只调用供应商一次', async () => {
  const harness = textHandlerHarness({
    maxProviderAttempts: 1,
    modelResults: [new TextModelAdapterError('provider-unavailable', true)],
  });
  const response = await harness.run();
  expect(response.status).toBe(503);
  expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
  expect(harness.coordinator.reserveRetryCost).not.toHaveBeenCalled();
  expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
});

test('env attempts 与 runtime 不一致时失败关闭', async () => {
  const env = configuredEnv({ TEXT_AI_MAX_PROVIDER_ATTEMPTS: '2' });
  const response = await handleTextAiRequest(workerRequest(textAiRequestFixture), env, {
    ...TEXT_GATEWAY_RUNTIME,
    maxProviderAttempts: 1,
  });
  expect(response.status).toBe(503);
});
```

保留一条注入 `maxProviderAttempts:2` 的测试，证明既有 retry 结算逻辑未被破坏，但默认 runtime 不使用它。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm run test:edge -- workers/photo-ai-gateway/src/textHandler.test.ts`

Expected: FAIL，dependencies 没有 `maxProviderAttempts` 且仍调用第二次。

- [ ] **Step 3: 实现 attempts gate**

```ts
export interface TextHandlerDependencies {
  // existing fields
  maxProviderAttempts: 1 | 2;
}

export const TEXT_GATEWAY_RUNTIME = Object.freeze({
  // existing fields
  maxProviderAttempts: 1,
});
```

`isTextAiGatewayConfigured()` 增加精确比较：

```ts
env.TEXT_AI_MAX_PROVIDER_ATTEMPTS === String(runtime.maxProviderAttempts)
```

retryable catch 在 `maxProviderAttempts===1` 时直接 `settleFailure(adapterError.code, null)`；只有值 2 才调用 `reserveRetryCost()` 和第二次 adapter。

- [ ] **Step 4: 运行文字 handler 全矩阵**

```bash
npm run test:edge -- workers/photo-ai-gateway/src/textHandler.test.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts
```

Expected: PASS；默认一次，显式测试依赖仍可覆盖两次逻辑。

- [ ] **Step 5: 提交单次调用边界**

```bash
git add workers/photo-ai-gateway/src/textHandler.ts workers/photo-ai-gateway/src/textHandler.test.ts workers/photo-ai-gateway/src/env.ts workers/photo-ai-gateway/wrangler.jsonc
git commit -m "feat: cap preview text AI provider attempts"
```

### Task 7: 实现有界 Cloudflare API client

**Files:**
- Create: `scripts/cloudflare-api.mjs`
- Create: `scripts/cloudflare-api.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写 envelope、上限和隐藏错误测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareClient } from './cloudflare-api.mjs';

test('只返回 success result 且不回显 token', async () => {
  const fetcher = async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer private-token');
    return new Response(JSON.stringify({ success: true, result: { id: 'safe-id' }, errors: [], messages: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createCloudflareClient({ accountId: 'a'.repeat(32), apiToken: 'private-token', fetcher });
  assert.deepEqual(await client.get('/pages/projects/tiezheng'), { id: 'safe-id' });
});

test('非 JSON、超 1MB、success false 和底层异常统一隐藏', async () => {
  for (const fetcher of invalidFetchers) {
    const client = createCloudflareClient({ accountId: 'a'.repeat(32), apiToken: 'private-token', fetcher });
    await assert.rejects(client.get('/pages/projects/tiezheng'), /Cloudflare request failed/);
  }
});
```

- [ ] **Step 2: 运行 Node 测试确认 RED**

Run: `node --test scripts/cloudflare-api.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现固定 account-scope client**

```js
export function createCloudflareClient({ accountId, apiToken, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId) || !validSecret(apiToken)) fail();
  const request = async (method, path, body) => {
    if (!/^\/[a-z0-9_./-]+$/i.test(path) || path.includes('..')) fail();
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await readBoundedJson(response, 1_048_576);
    if (!response.ok || envelope.success !== true || !('result' in envelope)) fail();
    return envelope.result;
  };
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
```

`readBoundedJson()` 使用 reader 流式上限、fatal UTF-8、普通对象 envelope；异常只抛 `Cloudflare request failed`，不包含 URL response body、token 或 API error message。

- [ ] **Step 4: 运行 client 测试**

Run: `node --test scripts/cloudflare-api.test.mjs`

Expected: PASS。

- [ ] **Step 5: 增加 package script 并提交**

`package.json`：

```json
"test:text-preview-control": "node --test scripts/cloudflare-api.test.mjs scripts/text-ai-preview-control.test.mjs scripts/verify-text-ai-preview-workflow.test.mjs"
```

在后两个测试文件创建前，暂时只运行 `node --test scripts/cloudflare-api.test.mjs`。

```bash
git add scripts/cloudflare-api.mjs scripts/cloudflare-api.test.mjs package.json
git commit -m "build: add bounded Cloudflare control client"
```

### Task 8: 实现 Preview 控制面 reconciliation 和管理调用

**Files:**
- Create: `scripts/text-ai-preview-control.mjs`
- Create: `scripts/text-ai-preview-control.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写配置加载与脱敏输出测试**

```js
const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'private-cf-token',
  TEXT_AI_TEAM_DOMAIN: 'team-alpha',
  TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
  TEXT_AI_USER_1_EMAIL: 'alice@example.com',
  TEXT_AI_USER_2_EMAIL: 'bob@example.com',
  TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
  TEXT_AI_CF_ACCESS_CLIENT_ID: 'service-client.access',
  TEXT_AI_CF_ACCESS_CLIENT_SECRET: 'private-service-secret',
  PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
};

test('管理员必须是 user-1 且两个邮箱不同', () => {
  assert.equal(loadTextPreviewConfig(env).adminEmail, 'alice@example.com');
  assert.throws(() => loadTextPreviewConfig({ ...env, TEXT_AI_USER_2_EMAIL: 'alice@example.com' }));
  assert.throws(() => loadTextPreviewConfig({ ...env, TEXT_AI_ADMIN_EMAIL: 'bob@example.com' }));
});

test('人数只允许 2 或 3，选择 3 时必须提供第三个不同邮箱', () => {
  assert.throws(() => loadTextPreviewConfig({ ...env, TEXT_AI_ALLOWED_EMAIL_COUNT: '1' }));
  assert.throws(() => loadTextPreviewConfig({ ...env, TEXT_AI_ALLOWED_EMAIL_COUNT: '3' }));
  assert.equal(loadTextPreviewConfig({
    ...env,
    TEXT_AI_ALLOWED_EMAIL_COUNT: '3',
    TEXT_AI_USER_3_EMAIL: 'carol@example.com',
  }).allowedEmailCount, 3);
});
```

捕获 stdout/stderr，断言不含任一 token、邮箱、HMAC 和 audience。

- [ ] **Step 2: 写 Access 应用和 policy reconciliation 测试**

Fake Cloudflare API 必须证明：

- 精确查找/创建 `tiezheng-text-ai-preview-users` 和 `tiezheng-text-ai-preview-admin`；
- domain 分别为 `text-ai-preview.tiezheng.pages.dev/api/nutrition/text` 与 `/api/nutrition/text-admin`；
- session duration `30m`，app launcher 隐藏；
- 用户 policy `allow` 两个精确 email 且 require One-time PIN identity provider；
- 管理 human policy 只允许 user-1 且 require OTP；
- 管理 service policy `decision:'non_identity'` 且只 include 匹配 client ID 的 service token ID；
- dedicated app 出现未知 policy 时停止，不删除或覆盖；
- `disable-access` 只删除这两个精确名称的 dedicated apps，拒绝模糊匹配。

- [ ] **Step 3: 写 Pages Preview-only patch 测试**

断言只 PATCH：

```js
{
  deployment_configs: {
    preview: {
      env_vars: {
        PHOTO_AI_TEAM_DOMAIN: { type: 'plain_text', value: 'team-alpha' },
        PHOTO_AI_ALLOWED_ORIGINS: { type: 'plain_text', value: 'https://text-ai-preview.tiezheng.pages.dev' },
        PHOTO_AI_ACCOUNT_HMAC_KEY: { type: 'secret_text', value: config.accountHmacKey },
        TEXT_AI_ACCESS_AUD: { type: 'secret_text', value: userApp.aud },
        TEXT_AI_ALLOWED_EMAILS: { type: 'secret_text', value: config.allowedEmails },
        TEXT_AI_ALLOWED_EMAIL_COUNT: { type: 'plain_text', value: String(config.allowedEmailCount) },
        TEXT_AI_ADMIN_ACCESS_AUD: { type: 'secret_text', value: adminApp.aud },
        TEXT_AI_ADMIN_EMAIL: { type: 'secret_text', value: config.adminEmail },
        TEXT_AI_ADMIN_SERVICE_CLIENT_ID: { type: 'secret_text', value: config.serviceClientId },
      },
      services: {
        PHOTO_AI_GATEWAY: {
          service: 'tiezheng-photo-ai-gateway',
          environment: 'production',
        },
      },
    },
  },
}
```

GET 到任何未知 Preview Function env/binding 时停止，避免覆盖用户现有配置。PATCH 前后 production deployment config 的 canonical redacted hash 必须相同。

- [ ] **Step 4: 写管理调用测试**

`invoke-admin` 只接受固定 operation 和 `user-1|user-2`，生成 32-hex operation ID，向管理 endpoint 发送 service headers。响应经 `parseRedactedAdminResponse()` 验证后只输出：operation、textGlobalEnabled、accountEnabled、remaining、预算和 resetAt。

- [ ] **Step 5: 运行测试确认 RED**

Run: `node --test scripts/text-ai-preview-control.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 6: 实现四个固定命令**

CLI 只接受：

```text
preflight
configure
disable-access
invoke-admin --operation=<fixed> --target=user-1|user-2
```

实现导出：

```js
export function loadTextPreviewConfig(env);
export async function preflightTextPreview(config, client);
export async function reconcileTextPreview(config, client);
export async function disableTextPreviewAccess(config, client);
export async function invokeTextPreviewAdmin(config, options, fetcher = fetch);
```

`preflight` 依次只读验证 token、Pages project、Worker script、Worker vars、OTP IdP 和 service token。若远端 `PHOTO_AI_GATEWAY_ENABLED` 为 `true`，必须在邮箱身份派生变更部署前停止，因为已有照片 beta 状态可能仍按旧 `sub` 键存在。`configure` 只在 preflight 全绿后 create/update dedicated Access resources 和 Preview Pages config。API 响应只通过 shape validator，禁止 `console.log(object)`。

- [ ] **Step 7: 运行 Node 控制面测试**

```bash
node --test scripts/cloudflare-api.test.mjs scripts/text-ai-preview-control.test.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交控制面脚本**

```bash
git add scripts/text-ai-preview-control.mjs scripts/text-ai-preview-control.test.mjs package.json
git commit -m "build: reconcile text AI preview control plane"
```

### Task 9: 增加 workflow policy verifier 和受保护手动 workflow

**Files:**
- Create: `scripts/verify-text-ai-preview-workflow.mjs`
- Create: `scripts/verify-text-ai-preview-workflow.test.mjs`
- Create: `.github/workflows/text-ai-preview.yml`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写 workflow policy 红灯测试**

验证器必须拒绝：

```js
const forbidden = [
  'push:',
  'pull_request:',
  'schedule:',
  'VITE_ENABLE_PHOTO_AI: true',
  'PHOTO_AI_GATEWAY_ENABLED:true',
  'TEXT_AI_MAX_PROVIDER_ATTEMPTS: 2',
  'workflow_call:',
];
```

并要求：`workflow_dispatch`、environment `text-ai-preview`、`permissions: contents: read`、完整测试顺序、Worker dry-run、`PHOTO_AI_GATEWAY_ENABLED=false`、Preview branch、固定 origin、受限 operation choices、delete/enable confirmation、真实请求标记最多出现一次。

- [ ] **Step 2: 运行 verifier 测试确认 RED**

Run: `node --test scripts/verify-text-ai-preview-workflow.test.mjs`

Expected: FAIL，workflow 和 verifier 不存在。

- [ ] **Step 3: 实现纯静态 verifier**

`verifyTextPreviewWorkflow(source)` 返回：

```js
{
  manualOnly: true,
  protectedEnvironment: true,
  productionDisabled: true,
  photoDisabled: true,
  maxProviderAttempts: 1,
  realRequestBudget: 1,
}
```

它使用精确字符串、缩进块提取和重复计数，不执行 YAML 表达式。任何未知 top-level trigger、shell 中 secret echo、`set -x`、artifact 上传整个工作目录、任意 `operation` 字符串输入都失败。

- [ ] **Step 4: 创建完整 workflow**

workflow inputs：

```yaml
on:
  workflow_dispatch:
    inputs:
      operation:
        type: choice
        required: true
        options:
          - preflight
          - deploy-disabled
          - enable-admin-preview
          - status
          - enable-second-account
          - disable-account
          - disable-all
          - delete-account
      target:
        type: choice
        required: true
        default: user-1
        options: [user-1, user-2]
      confirmation:
        type: string
        required: false
```

单 job 使用 `environment: text-ai-preview`、`permissions: contents: read`、`timeout-minutes:30`。顺序固定：checkout、Node 22、npm ci、typecheck、unit、edge typecheck、edge tests、build、workflow verifier、Worker dry-run、operation dispatch。

部署步骤必须：

1. 调用 `scripts/text-ai-preview-control.mjs preflight`；
2. `deploy-disabled`/`enable-admin-preview` 调用 `configure`；
3. 在 `$RUNNER_TEMP` 生成仅含 `ARK_API_KEY` 与 `PHOTO_AI_CACHE_AES_KEY` 的 0600 JSON secret file；
4. Wrangler deploy 使用源码 config、secret file 和全部非 secret vars，照片 false、admin true、origin 精确 Preview、attempts 1；
5. Preview build 只设置 `VITE_ENABLE_TEXT_AI=true`；
6. Pages deploy 使用 `--project-name=tiezheng --branch=text-ai-preview --commit-hash=$GITHUB_SHA`；
7. `enable-admin-preview` 先启用 user-1 和 text global，再以 text enabled 部署 Worker；
8. `enable-second-account` 只调用管理 endpoint，不部署或调用模型；
9. `disable-all` 先禁用 text global，再部署 text false Worker，最后 `disable-access`；
10. `delete-account` 要求 confirmation 精确 `DELETE_TEXT_PREVIEW_ACCOUNT_STATE`；
11. `enable-admin-preview` 要求 confirmation 精确 `ENABLE_ONE_TEXT_PREVIEW_ACCOUNT`。

workflow 不执行真实餐食请求；真实的一次请求保留给浏览器验收，避免 CI 日志接触餐食正文。

- [ ] **Step 5: 更新忽略项和 package scripts**

`.gitignore` 增加：

```gitignore
.dev.vars
workers/**/.dev.vars
text-ai-preview-evidence/
text-ai-preview-access-export*.json
text-ai-preview-secrets*.json
```

`package.json` 增加：

```json
"verify:text-preview-workflow": "node scripts/verify-text-ai-preview-workflow.mjs .github/workflows/text-ai-preview.yml"
```

- [ ] **Step 6: 运行 workflow policy 和全量 Node tests**

```bash
npm run test:text-preview-control
npm run verify:text-preview-workflow
```

Expected: PASS。

- [ ] **Step 7: 提交 workflow**

```bash
git add .github/workflows/text-ai-preview.yml scripts/verify-text-ai-preview-workflow.mjs scripts/verify-text-ai-preview-workflow.test.mjs package.json .gitignore
git commit -m "ci: add protected text AI preview workflow"
```

### Task 10: 写运维文档并完成确定性验证

**Files:**
- Create: `docs/operations/text-ai-preview-runbook.md`
- Create: `docs/operations/text-ai-preview-release-checklist.md`
- Verify: all files in Tasks 1–9

- [ ] **Step 1: 写 runbook**

runbook 必须给出固定信息：

- GitHub Environment 名、八个人工 secret、team domain 与 allowed-email-count variables；
- Cloudflare token 所需权限：Workers Scripts Edit、Pages Edit、Access Apps and Policies Write、Access Identity Providers Read、Access Service Tokens Read；
- 先 `preflight`、再 `deploy-disabled`、再 `enable-admin-preview`；
- user-1 管理员单次真实请求、user-2 OTP；
- status/disable-account/delete-account；
- 回滚顺序和每一步预期状态；
- 禁止复制 audience、邮箱、JWT、OTP、密钥和餐食正文到 evidence。

其中 API Key 的设置只写 GitHub UI 路径，不出现命令行值或示例密钥。

- [ ] **Step 2: 写 release checklist**

每一项只允许 `PASS | FAIL | BLOCKED | NOT_RUN`，初始全部 `NOT_RUN`。项目包括：代码 SHA、测试、Access 人数、Service Binding、Worker secret names、disabled smoke、一次模型调用、计数差、预算差、日志扫描、第二账号 OTP、生产/照片关闭和回滚演练。

- [ ] **Step 3: 运行全量确定性验证**

```bash
npm test
npm run typecheck
npm run build
npm run test:edge
npm run typecheck:edge
npm run test:text-preview-control
npm run verify:text-preview-workflow
npm run deploy:photo-worker -- --dry-run
git diff --check
```

Expected: 全部退出码 0；无 act warning、未处理 rejection、secret value 或餐食正文。

- [ ] **Step 4: 做静态隐私扫描**

```bash
rg -n "console\.|ARK_API_KEY|CF-Access-Client-Secret|targetEmail|description" src edge functions workers scripts .github
```

Expected:

- `ARK_API_KEY` 只在 Worker env/adapter、受保护 workflow secret 映射和测试；
- service secret 只在 workflow env/header，绝不打印；
- `targetEmail` 只在严格管理 contract、Pages 内存转换和 fixture；
- `description` 不进入管理、workflow、控制面或日志代码；
- 生产 CI 不出现 `VITE_ENABLE_TEXT_AI`。

- [ ] **Step 5: 提交运维文档与确定性证据状态**

```bash
git add docs/operations/text-ai-preview-runbook.md docs/operations/text-ai-preview-release-checklist.md
git commit -m "docs: add text AI preview operations runbook"
```

### Task 11: 配置受保护环境并部署关闭状态 Preview

**Files:**
- Remote: GitHub Environment `text-ai-preview`
- Remote: Cloudflare Access, Pages Preview, Worker
- Update: `docs/operations/text-ai-preview-release-checklist.md`（只写脱敏状态）

- [ ] **Step 1: 要求用户在 GitHub UI 输入 secret**

在仓库 Settings → Environments → `text-ai-preview` 中设置 approval protection，并由用户直接输入：`ARK_API_KEY`、`PHOTO_AI_CACHE_AES_KEY`、`PHOTO_AI_ACCOUNT_HMAC_KEY`、两个用户邮箱、管理员邮箱、Access service client ID/secret。不得通过聊天、shell history 或 workflow input 传值。

- [ ] **Step 2: 检查 secret 名称而非值**

Run:

```bash
gh secret list --env text-ai-preview --json name --jq '.[].name'
```

Expected: 名称集合与 runbook 完全一致；输出没有值。

- [ ] **Step 3: 推送实现分支并合并 workflow 所需提交**

先运行 Task 10 全量验证和独立 code review；只有 review 无阻塞项且用户授权合并时，才把实现合并到 `main`。workflow 必须存在于默认分支后才能稳定手动触发。

- [ ] **Step 4: 运行只读 preflight**

```bash
gh workflow run text-ai-preview.yml -f operation=preflight -f target=user-1 -f confirmation=''
gh run watch --exit-status "$(gh run list --workflow text-ai-preview.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: 只读 PASS；若 Cloudflare token 权限不足或远端照片开关为 true，停止并列出缺失权限名/照片状态，不做远端写入。

- [ ] **Step 5: 部署 disabled Worker 和 Pages Preview**

```bash
gh workflow run text-ai-preview.yml -f operation=deploy-disabled -f target=user-1 -f confirmation=''
gh run watch --exit-status "$(gh run list --workflow text-ai-preview.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: Preview 静态站 200；未登录文字 API 被 Access 拦截；登录后 session 为 `service-disabled`；豆包用量不变；生产首页仍无文字 AI 入口。

- [ ] **Step 6: 记录脱敏 disabled evidence**

只把 workflow run ID、commit SHA、Access 应用存在性、binding 存在性和 disabled 状态填入 checklist，不记录账户 ID、邮箱、audience 或 URL token。

### Task 12: 执行单账号真实门禁，再启用第二账号

**Files:**
- Remote: Preview Access/Worker/Pages/Durable Object/Ark
- Update: `docs/operations/text-ai-preview-release-checklist.md`

- [ ] **Step 1: 启用管理员 Preview**

```bash
gh workflow run text-ai-preview.yml \
  -f operation=enable-admin-preview \
  -f target=user-1 \
  -f confirmation=ENABLE_ONE_TEXT_PREVIEW_ACCOUNT
gh run watch --exit-status "$(gh run list --workflow text-ai-preview.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: user-1 enabled、text global enabled、Worker text flag true、photo flag false、attempts 1。

- [ ] **Step 2: 浏览器执行唯一真实餐食请求**

使用 user-1 OTP 登录 `https://text-ai-preview.tiezheng.pages.dev/health`，提交固定描述“牛肉面一碗，少油，约 500 g”。只点击估算一次。验证完整热量/蛋白质范围，人工把最终热量改为 900 后确认。

Expected: 只新增一条当前餐次记录；刷新仍存在；请求失败时不自动或手动重试，立即进入回滚检查。

- [ ] **Step 3: 检查计数、预算和照片隔离**

运行 workflow `status`，对比调用前状态：文字 account/global 各减少 1；budget spent/reserved 只结算一次；照片 counter 和照片 global flag 不变。供应商 dashboard 只出现一次请求。

- [ ] **Step 4: 扫描日志与浏览器存储**

检查 GitHub job log、Cloudflare Worker/Pages log、Access 邻接日志、Durable Object 状态和浏览器存储。禁止出现餐食描述、候选原文、邮箱、账号键、JWT、OTP、密钥、IP 和 Cookie。任何命中立即 `disable-all` 并按 runbook 轮换对应 secret。

- [ ] **Step 5: 启用第二账号**

```bash
gh workflow run text-ai-preview.yml -f operation=enable-second-account -f target=user-2 -f confirmation=''
gh run watch --exit-status "$(gh run list --workflow text-ai-preview.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

user-2 只验证 OTP、session enabled 和剩余额度，不提交餐食估算。

- [ ] **Step 6: 演练回滚后恢复**

先运行 `disable-all`，验证 Access、Worker text flag 和 global flag 关闭；再重新运行 `deploy-disabled` 和 `enable-admin-preview`，但不再发真实请求；最后启用 user-2。任何恢复异常保持关闭。

- [ ] **Step 7: 记录 Preview 决策**

全部通过才把 checklist 结论设为 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW`；否则为 `BLOCKED`。明确写“生产和照片 AI 未启用”。

### Task 13: 最终代码审查、验证和分支收尾

**Files:**
- Verify: all changed files
- Verify: `docs/superpowers/specs/2026-08-24-tiezheng-text-ai-preview-release-design.md`
- Verify: `docs/superpowers/plans/2026-08-24-tiezheng-text-ai-preview-release.md`

- [ ] **Step 1: 运行最终全量验证**

重复 Task 10 Step 3 的全部命令，并运行 `git status --short`、`git diff --check`。Expected: 全部成功、工作树干净。

- [ ] **Step 2: 做独立 code review**

Review 固定检查：Access audience/profile 混用、email/sub 身份迁移、管理重放、未知 policy 覆盖、Preview/production config 混写、secret 日志、retry 次数、回滚顺序和照片开关。

- [ ] **Step 3: 处理 review 意见并重跑相关测试**

每个确定性修正先补失败测试，再改实现。没有发现问题时不创建空提交。

- [ ] **Step 4: 检查提交范围**

```bash
git status --short
git log --oneline --decorate main..HEAD
git ls-files | rg '(\.dev\.vars|text-ai-preview-secrets|access-export|evidence/)'
```

Expected: 无 secret、邮箱、Access export、真实模型响应、数据库、截图或临时 evidence 入库。

- [ ] **Step 5: 按用户授权决定合并/推送**

本地实现完成不等于 Preview 启用；合并、推送、控制面部署、真实调用和生产启用分别保留独立状态。生产启用不在本计划范围内。
