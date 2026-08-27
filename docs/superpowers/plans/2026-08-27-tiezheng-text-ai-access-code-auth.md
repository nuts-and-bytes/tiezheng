# 铁证文字 AI 双访问码认证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将文字 AI Preview 从 Cloudflare Access 邮箱 OTP 迁移为两个独立访问码交换 30 天 HttpOnly JWT 的认证方式，同时保留双账号额度、预算熔断、私有 Worker 和关闭态发布门禁。

**Architecture:** Pages Functions 新增同源登录入口，并使用固定密钥验证访问码、签发及验证 JWT；私有 Worker 的 Durable Object 提供原子登录失败限流。GitHub 管理调用改用独立 HMAC 请求签名，首次配置向导只生成访问码、摘要和随机密钥，不再创建或访问任何 Zero Trust 资源。

**Tech Stack:** React 19、TypeScript 5.8、Cloudflare Pages Functions、Cloudflare Workers、Durable Objects SQLite、jose 6、Node.js 22 ESM、Vitest、node:test、GitHub Actions。

---

## 实施前固定边界

- 设计规格：docs/superpowers/specs/2026-08-27-text-ai-access-code-auth-design.md。
- 从当前提交 f098abf 创建隔离 worktree；不得直接在 main 工作树编码。
- Task 1–9 只做代码、文档和本地确定性验证。
- Task 10 是真实远端首次配置，执行前必须再次取得 GitHub secrets、Cloudflare token 轮换与旧 token 撤销授权。
- Task 11 是 Preview 部署和真实模型验证，必须与 Task 10 分开取得部署、账号启用和一次 ARK 模型调用授权。
- 生产文字 AI、照片 AI 和生产 main 功能开关始终保持关闭，除非另行明确批准。
- 每个实现任务均遵循 RED → GREEN → targeted regression → commit；提交信息带 [skip ci]。
- 不在聊天、argv、shell history、环境变量、文件、日志或 evidence 中承载真实访问码、JWT、ARK key、Cloudflare token 或随机签名密钥。

## 文件职责图

| 文件 | 职责 |
|---|---|
| edge/identity/opaqueKey.ts | 通用 HMAC 伪匿名键派生，不理解邮箱或用户槽位 |
| edge/text-ai/auth.ts | 双访问码配置、摘要、credential version、JWT、Cookie 和账号键 |
| edge/text-ai/login.ts | 登录请求边界、盲化限流键、私有 Worker 限流调用和 Cookie 响应 |
| workers/photo-ai-gateway/src/textAuthThrottleHandler.ts | 只接受 Service Binding 的登录限流内部协议 |
| workers/photo-ai-gateway/src/coordinator.ts | 原子失败计数、冷却和成功清除 |
| edge/text-ai/pagesRequest.ts | login/session/estimate/logout 的精确同源请求矩阵 |
| edge/text-ai/pagesProxy.ts | 使用文字 JWT 替代 Cf-Access-Jwt-Assertion |
| src/lib/textAiContract.ts | 登录响应的严格共享契约 |
| src/lib/textAiClient.ts | 同源 login/session/estimate/logout 客户端 |
| src/screens/health/TextEstimateSheet.tsx | 当前 sheet 内输入访问码、验证后恢复草稿 |
| edge/text-ai/adminSignature.ts | 管理请求 canonical HMAC 的生成和验证 |
| edge/text-ai/admin.ts | target slot 到 account key、管理签名验证和私有 Worker 转发 |
| scripts/text-ai-preview-control.mjs | 无 Access 的 token preflight、Pages bindings 和签名管理调用 |
| scripts/text-ai-preview-setup-*.mjs | 两项输入、随机材料、摘要写入、补偿与关闭态 preflight |
| .github/workflows/text-ai-preview.yml | 只注入新 secret 集合和固定 operation |
| scripts/verify-text-ai-preview-*.mjs | 静态锁定无 Access、无 secret 输出和关闭态发布边界 |
| docs/operations/text-ai-preview-*.md | 新的配置、轮换、回滚和验收操作说明 |

### Task 1: 提取不依赖邮箱的伪匿名账号键

**Files:**
- Create: edge/identity/opaqueKey.ts
- Create: edge/identity/opaqueKey.test.ts
- Modify: edge/photo-ai/access.ts:1-103
- Test: edge/photo-ai/access.test.ts

- [ ] **Step 1: 写纯 HMAC 派生的红灯测试**

在 edge/identity/opaqueKey.test.ts 固定输入、输出长度、detached result 和异常矩阵：

~~~ts
import { describe, expect, test } from 'vitest';
import { deriveOpaqueKey } from './opaqueKey';

describe('opaque account key', () => {
  test('derives one deterministic lowercase 64-hex key', async () => {
    const first = await deriveOpaqueKey('text-ai:user-1', 'x'.repeat(32));
    const second = await deriveOpaqueKey('text-ai:user-1', 'x'.repeat(32));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(await deriveOpaqueKey('text-ai:user-2', 'x'.repeat(32))).not.toBe(first);
  });

  test.each(['', ' user-1', 'user-1 ', 'a\u0000b'])(
    'rejects an invalid subject %j',
    async (subject) => {
      await expect(deriveOpaqueKey(subject, 'x'.repeat(32))).rejects.toThrow('Access denied');
    },
  );
});
~~~

- [ ] **Step 2: 运行测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run edge/identity/opaqueKey.test.ts
~~~

Expected: FAIL，提示 edge/identity/opaqueKey 不存在。

- [ ] **Step 3: 实现单一职责的派生函数**

edge/identity/opaqueKey.ts 必须只接受规范化无控制字符 subject 和至少 32 UTF-8 bytes 的 secret：

~~~ts
const SUBJECT = /^(?=.{1,128}$)[\x21-\x7e]+$/;

export async function deriveOpaqueKey(subject: string, secret: string): Promise<string> {
  try {
    if (typeof subject !== 'string' || !SUBJECT.test(subject)) throw new TypeError();
    if (
      typeof secret !== 'string'
      || new TextEncoder().encode(secret).byteLength < 32
    ) throw new TypeError();
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(subject),
    );
    return Array.from(
      new Uint8Array(signature),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    throw new Error('Access denied');
  }
}
~~~

edge/photo-ai/access.ts 的 deriveAccountKey 继续先验证规范化邮箱，再调用 deriveOpaqueKey(email, secret)。外部导出、错误消息和照片测试契约不得改变。

- [ ] **Step 4: 运行新旧认证测试确认 GREEN**

Run:

~~~bash
./node_modules/.bin/vitest run edge/identity/opaqueKey.test.ts edge/photo-ai/access.test.ts
~~~

Expected: PASS。

- [ ] **Step 5: 提交**

~~~bash
git add edge/identity/opaqueKey.ts edge/identity/opaqueKey.test.ts edge/photo-ai/access.ts
git commit -m "refactor: extract opaque account key derivation [skip ci]"
~~~

### Task 2: 建立双访问码、JWT 和 Cookie 认证核心

**Files:**
- Create: edge/text-ai/auth.ts
- Create: edge/text-ai/auth.test.ts
- Delete: edge/text-ai/access.ts
- Delete: edge/text-ai/access.test.ts

- [ ] **Step 1: 写配置、访问码和 JWT 红灯测试**

测试必须覆盖：

- 两个 64 位小写 hex 摘要必须不同；
- 两个账号 pepper、session key、rate-limit key、admin key 均为相互独立的 32 bytes canonical base64url；
- 访问码精确为 32 个 base64url 字符，不允许 trim；
- user-1 与 user-2 映射到不同 account key；
- JWT header 只能是 alg=HS256、typ=JWT；
- issuer、audience、subject、iat、exp、cv 缺失或漂移全部失败；
- token 生命周期不超过 2592000 秒；
- 轮换 user-1 digest 只使 user-1 token 失效；
- Cookie duplicate、错误名称、超长值和非 canonical token 失败关闭；
- 清除 Cookie 使用同名、Max-Age=0、HttpOnly、Secure、SameSite=Strict、Path=/。

核心测试形状：

~~~ts
const env = {
  PHOTO_AI_ACCOUNT_HMAC_KEY: 'a'.repeat(32),
  TEXT_AI_USER_1_ACCESS_CODE_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  TEXT_AI_USER_1_ACCESS_CODE_DIGEST: '1'.repeat(64),
  TEXT_AI_USER_2_ACCESS_CODE_PEPPER: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
  TEXT_AI_USER_2_ACCESS_CODE_DIGEST: '2'.repeat(64),
  TEXT_AI_SESSION_SIGNING_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  TEXT_AI_RATE_LIMIT_HMAC_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
};

test('authenticates one code and verifies its session', async () => {
  const configured = await testEnvWithAccessCodes(
    env,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  );
  const identity = await authenticateTextAccessCode(
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    configured,
  );
  const token = await issueTextSession(identity, configured, 1_777_777_777_000);
  const request = new Request('https://text-ai-preview.tiezheng.pages.dev/', {
    headers: { cookie: textSessionCookie(token) },
  });
  await expect(verifyTextSession(request, configured, 1_777_777_778_000))
    .resolves.toMatchObject({ slot: 'user-1', accountKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
});
~~~

- [ ] **Step 2: 运行测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run edge/text-ai/auth.test.ts
~~~

Expected: FAIL，提示 auth 模块导出不存在。

- [ ] **Step 3: 实现固定类型和配置解析**

edge/text-ai/auth.ts 固定公开边界：

~~~ts
import { SignJWT, jwtVerify } from 'jose';
import { deriveOpaqueKey } from '../identity/opaqueKey';

export type TextAccountSlot = 'user-1' | 'user-2';

export interface TextAuthEnv {
  PHOTO_AI_ACCOUNT_HMAC_KEY: string;
  TEXT_AI_USER_1_ACCESS_CODE_PEPPER: string;
  TEXT_AI_USER_1_ACCESS_CODE_DIGEST: string;
  TEXT_AI_USER_2_ACCESS_CODE_PEPPER: string;
  TEXT_AI_USER_2_ACCESS_CODE_DIGEST: string;
  TEXT_AI_SESSION_SIGNING_KEY: string;
  TEXT_AI_RATE_LIMIT_HMAC_KEY: string;
}

export interface TextIdentity {
  slot: TextAccountSlot;
  accountKey: string;
  credentialVersion: string;
}

export const TEXT_SESSION_COOKIE = '__Host-tiezheng-text-ai-session';
export const TEXT_SESSION_SECONDS = 2_592_000;
const ACCESS_CODE = /^[A-Za-z0-9_-]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
~~~

实现下列固定导出，不再暴露 Cloudflare issuer、audience 或邮箱集合：

~~~ts
export function parseTextAuthConfig(env: TextAuthEnv): Readonly<TextAuthConfig>;
export async function digestTextAccessCode(code: string, pepper: Uint8Array): Promise<string>;
export async function authenticateTextAccessCode(code: string, config: TextAuthConfig): Promise<TextIdentity>;
export async function issueTextSession(identity: TextIdentity, config: TextAuthConfig, nowMs?: number): Promise<string>;
export async function verifyTextSession(request: Request, config: TextAuthConfig, nowMs?: number): Promise<TextIdentity>;
export function textSessionCookie(token: string): string;
export function clearTextSessionCookie(): string;
export async function deriveTextAttemptKey(ip: string | null, config: TextAuthConfig): Promise<{ attemptKey: string; anonymous: boolean }>;
~~~

实现约束：

- base64url 解码后必须精确 32 bytes，重新编码必须与输入一致；
- digest 比较先验证固定 64-hex，再转换为两个等长 Uint8Array，循环 XOR 后只比较累计值；
- credentialVersion = base64url(SHA-256(UTF-8 digest))；
- accountKey = deriveOpaqueKey('text-ai:' + slot, PHOTO_AI_ACCOUNT_HMAC_KEY)；
- JWT 使用 jose 的 SignJWT 和 jwtVerify，固定 algorithms: ['HS256']；
- verify 时重新计算当前 slot 的 credentialVersion 并恒定时间比较；
- Cookie parser 必须拒绝同名 Cookie 出现两次。

- [ ] **Step 4: 运行认证测试和类型检查**

Run:

~~~bash
./node_modules/.bin/vitest run edge/text-ai/auth.test.ts
npm run typecheck:edge
~~~

Expected: PASS。

- [ ] **Step 5: 提交**

~~~bash
git add edge/text-ai/auth.ts edge/text-ai/auth.test.ts edge/text-ai/access.ts edge/text-ai/access.test.ts
git commit -m "feat: add text AI access-code sessions [skip ci]"
~~~

### Task 3: 在私有 Worker 中增加原子登录失败限流

**Files:**
- Create: workers/photo-ai-gateway/src/textAuthThrottleHandler.ts
- Create: workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts
- Modify: workers/photo-ai-gateway/src/coordinator.ts:22-158, 352-484, 486-535, 1064-1130
- Modify: workers/photo-ai-gateway/src/index.ts:1-98
- Modify: workers/photo-ai-gateway/src/coordinator.worker.test.ts

- [ ] **Step 1: 写 Durable Object 限流红灯测试**

固定策略：

- 正常 IP：10 分钟窗口允许 5 次失败，第 6 次开始冷却 15 分钟；
- 匿名桶：10 分钟窗口允许 3 次失败，第 4 次开始冷却 30 分钟；
- 成功 clear 删除失败状态；
- 同一个 attemptKey 并发调用由 Durable Object 串行化；
- 不同 attemptKey 互不影响；
- now 非安全整数、attemptKey 非 64-hex 或 anonymous 非 boolean 全部拒绝。

测试使用以下公开类型：

~~~ts
export interface TextAuthAttemptInput {
  attemptKey: string;
  anonymous: boolean;
  now: number;
}

export type TextAuthAttemptResult =
  | { kind: 'allowed' }
  | { kind: 'blocked'; retryAfterMs: number };
~~~

关键断言：

~~~ts
for (let attempt = 0; attempt < 5; attempt += 1) {
  await expect(stub.consumeTextAuthAttempt({
    attemptKey: ACCOUNT_A,
    anonymous: false,
    now: NOW + attempt,
  })).resolves.toEqual({ kind: 'allowed' });
}
await expect(stub.consumeTextAuthAttempt({
  attemptKey: ACCOUNT_A,
  anonymous: false,
  now: NOW + 5,
})).resolves.toEqual({ kind: 'blocked', retryAfterMs: 900_000 });
await stub.clearTextAuthAttempts(ACCOUNT_A);
await expect(stub.consumeTextAuthAttempt({
  attemptKey: ACCOUNT_A,
  anonymous: false,
  now: NOW + 6,
})).resolves.toEqual({ kind: 'allowed' });
~~~

- [ ] **Step 2: 运行 Worker 测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run --config vitest.edge.config.ts workers/photo-ai-gateway/src/coordinator.worker.test.ts
~~~

Expected: FAIL，提示 consumeTextAuthAttempt 不存在。

- [ ] **Step 3: 增加 SQLite 表和原子方法**

ensureCoordinatorSchema 增加：

~~~sql
CREATE TABLE IF NOT EXISTS text_auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
)
~~~

PhotoAiCoordinator 增加：

~~~ts
async consumeTextAuthAttempt(input: TextAuthAttemptInput): Promise<TextAuthAttemptResult> {
  const value = textAuthAttemptInput(input);
  const maxFailures = value.anonymous ? 3 : 5;
  const cooldownMs = value.anonymous ? 1_800_000 : 900_000;
  return this.ctx.storage.transactionSync(() => {
    const current = this.rows<TextAuthAttemptRow>(
      'SELECT window_started_at, failures, blocked_until FROM text_auth_attempts WHERE attempt_key = ?',
      value.attemptKey,
    )[0];
    if (current?.blocked_until > value.now) {
      return { kind: 'blocked', retryAfterMs: current.blocked_until - value.now };
    }
    const expired = current === undefined || value.now - current.window_started_at >= 600_000;
    const failures = expired ? 0 : current.failures;
    if (failures >= maxFailures) {
      const blockedUntil = value.now + cooldownMs;
      this.exec(
        'UPDATE text_auth_attempts SET blocked_until = ? WHERE attempt_key = ?',
        blockedUntil,
        value.attemptKey,
      );
      return { kind: 'blocked', retryAfterMs: cooldownMs };
    }
    this.exec(
      'INSERT INTO text_auth_attempts (attempt_key, window_started_at, failures, blocked_until) VALUES (?, ?, ?, 0) ON CONFLICT(attempt_key) DO UPDATE SET window_started_at = excluded.window_started_at, failures = excluded.failures, blocked_until = 0',
      value.attemptKey,
      expired ? value.now : current.window_started_at,
      failures + 1,
    );
    return { kind: 'allowed' };
  });
}

async clearTextAuthAttempts(attemptKeyValue: string): Promise<void> {
  const normalized = opaqueKey(attemptKeyValue);
  this.ctx.storage.transactionSync(() => {
    this.exec('DELETE FROM text_auth_attempts WHERE attempt_key = ?', normalized);
  });
}
~~~

实现时将通用 64-hex validator 命名为 opaqueKey，而不是误用 accountKey 语义。

- [ ] **Step 4: 增加只允许 Service Binding 的内部 handler**

textAuthThrottleHandler.ts 只接受：

- POST https://photo-ai-gateway.internal/internal/text-auth-attempt；
- 无 query、redirect 或 body；
- x-tiezheng-auth-action 为 consume 或 clear；
- x-tiezheng-auth-attempt-key 为 64-hex；
- x-tiezheng-auth-anonymous 为 true 或 false；
- clear 响应固定 204，consume 响应固定 JSON。

index.ts 在 text admin 路由之前分派该精确内部路由。workers_dev 继续为 false，不增加公开 route。

- [ ] **Step 5: 运行 targeted Worker 回归**

Run:

~~~bash
./node_modules/.bin/vitest run --config vitest.edge.config.ts \
  workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts \
  workers/photo-ai-gateway/src/coordinator.worker.test.ts
npm run typecheck:edge
~~~

Expected: PASS。

- [ ] **Step 6: 提交**

~~~bash
git add workers/photo-ai-gateway/src/textAuthThrottleHandler.ts \
  workers/photo-ai-gateway/src/textAuthThrottleHandler.test.ts \
  workers/photo-ai-gateway/src/coordinator.ts \
  workers/photo-ai-gateway/src/coordinator.worker.test.ts \
  workers/photo-ai-gateway/src/index.ts
git commit -m "feat: rate limit text AI access-code login [skip ci]"
~~~

### Task 4: 接入 Pages login、session、estimate 和 logout

**Files:**
- Modify: edge/text-ai/pagesRequest.ts:1-179
- Modify: edge/text-ai/pagesRequest.test.ts
- Create: edge/text-ai/login.ts
- Create: edge/text-ai/login.test.ts
- Modify: edge/text-ai/pagesProxy.ts:1-154
- Modify: edge/text-ai/pagesProxy.test.ts
- Modify: functions/api/nutrition/text/session.ts
- Modify: functions/api/nutrition/text/estimate.ts
- Modify: functions/api/nutrition/text/logout.ts
- Create: functions/api/nutrition/text/login.ts

- [ ] **Step 1: 写 Pages 请求矩阵红灯测试**

TextPagesRoute 改为：

~~~ts
export type TextPagesRoute = 'login' | 'session' | 'estimate' | 'logout';
~~~

测试固定：

- login 只接受 POST /api/nutrition/text/login 和 application/json；
- session 只接受 GET /api/nutrition/text/session；
- estimate 只接受 POST /api/nutrition/text/estimate；
- logout 只接受 POST /api/nutrition/text/logout 且无 body；
- 删除 GET session?resume=1；
- login/estimate/logout 必须精确 Origin 和 Sec-Fetch-Site；
- GET session 继续接受精确同源 fetch metadata；
- login body 最大 512 bytes。

- [ ] **Step 2: 运行 Pages request 测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run edge/text-ai/pagesRequest.test.ts
~~~

Expected: FAIL，login route 未定义且 resume 仍存在。

- [ ] **Step 3: 实现登录 handler**

edge/text-ai/login.ts 固定流程：

~~~ts
export async function handleTextLoginRequest(
  request: Request,
  env: TextAiPagesEnv,
  nowMs = Date.now(),
): Promise<Response> {
  const pages = parseTextPagesRequestConfig({
    PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
  });
  const validated = validateTextPagesRequest(request, pages);
  if (validated.route !== 'login') throw new TypeError('Invalid Pages route');
  const config = parseTextAuthConfig(env);
  const { accessCode } = parseExactLoginBody(await readBoundedJson(request, 512));
  const blinded = await deriveTextAttemptKey(
    request.headers.get('CF-Connecting-IP'),
    config,
  );
  const gate = await callTextAuthThrottle(env.PHOTO_AI_GATEWAY, 'consume', blinded, nowMs);
  if (gate.kind === 'blocked') {
    return textAiPagesJson({
      ok: false,
      code: 'rate-limited',
      retryAt: new Date(nowMs + gate.retryAfterMs).toISOString(),
      resetAt: null,
    }, 429);
  }
  let identity: TextIdentity;
  try {
    identity = await authenticateTextAccessCode(accessCode, config);
  } catch {
    return textAiPagesFailure('auth-required', 401);
  }
  await callTextAuthThrottle(env.PHOTO_AI_GATEWAY, 'clear', blinded, nowMs);
  const token = await issueTextSession(identity, config, nowMs);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...TEXT_AI_SECURITY_HEADERS,
      'set-cookie': textSessionCookie(token),
    },
  });
}
~~~

callTextAuthThrottle 必须：

- 在 binding 缺失、3xx、超时、错误 content-type、超大 body 或 schema 漂移时失败关闭；
- 不把 accessCode、IP 或 JWT 发给 Worker；
- clear 失败时不签发 Cookie。

- [ ] **Step 4: 用 JWT 替换文字 Access 校验**

pagesProxy.ts：

~~~ts
export interface TextAiPagesEnv extends TextAuthEnv {
  PHOTO_AI_ALLOWED_ORIGINS: string;
  TEXT_AI_ADMIN_SIGNING_KEY: string;
  PHOTO_AI_GATEWAY?: Fetcher;
}

export async function authorizeTextAiPagesRequest(
  request: Request,
  env: TextAiPagesEnv,
  allowedRoutes: readonly Exclude<TextPagesRoute, 'login'>[],
): Promise<AuthorizedTextAiPagesRequest> {
  const pagesConfig = parseTextPagesRequestConfig({
    PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
  });
  const { route } = validateTextPagesRequest(request, pagesConfig);
  if (!allowedRoutes.some((candidate) => candidate === route)) {
    throw new TypeError('Invalid Pages route');
  }
  const identity = await verifyTextSession(request, parseTextAuthConfig(env));
  return { accountKey: identity.accountKey, origin: pagesConfig.origin, route };
}
~~~

functions 行为：

- login.ts 调用 handleTextLoginRequest；
- session.ts 删除 resume redirect，只做 session JWT + proxy；
- estimate.ts 保持代理语义，仅换认证；
- logout.ts 不要求 token 有效，验证同源请求后总是返回 { ok: true } 并清除同名 Cookie；这样损坏或过期 token 也能退出。

- [ ] **Step 5: 运行 Pages 认证回归**

Run:

~~~bash
./node_modules/.bin/vitest run \
  edge/text-ai/auth.test.ts \
  edge/text-ai/pagesRequest.test.ts \
  edge/text-ai/login.test.ts \
  edge/text-ai/pagesProxy.test.ts
npm run typecheck:edge
~~~

Expected: PASS，并且测试内 Cf-Access-Jwt-Assertion 只允许出现在照片测试或文字负向断言。

- [ ] **Step 6: 提交**

~~~bash
git add edge/text-ai/pagesRequest.ts edge/text-ai/pagesRequest.test.ts \
  edge/text-ai/login.ts edge/text-ai/login.test.ts \
  edge/text-ai/pagesProxy.ts edge/text-ai/pagesProxy.test.ts \
  functions/api/nutrition/text/login.ts \
  functions/api/nutrition/text/session.ts \
  functions/api/nutrition/text/estimate.ts \
  functions/api/nutrition/text/logout.ts
git commit -m "feat: authenticate text AI Pages routes with access codes [skip ci]"
~~~

### Task 5: 在现有文字估算 Sheet 内完成访问码登录

**Files:**
- Modify: src/lib/textAiContract.ts:45-101, 287-397, 539-648
- Modify: src/lib/textAiContract.test.ts
- Modify: src/lib/textAiClient.ts:14-55, 234-301, 369-421
- Modify: src/lib/textAiClient.test.ts
- Modify: src/screens/health/TextEstimateSheet.tsx:57-152, 414-629, 923-1052
- Modify: src/screens/health/TextEstimateSheet.test.tsx
- Modify: src/screens/health/HealthScreen.tsx:45-145, 353-373
- Modify: src/screens/health/HealthScreen.test.tsx
- Modify: src/App.tsx
- Modify: src/App.test.tsx
- Delete: src/lib/textAiIntent.ts
- Delete: src/lib/textAiIntent.test.ts

- [ ] **Step 1: 写登录客户端和 UI 红灯测试**

TextAiClient 公共接口改为：

~~~ts
export interface TextAiClient {
  login(accessCode: string): Promise<TextAiLoginResponse>;
  logout(): Promise<TextAiLogoutResponse>;
  session(): Promise<TextAiSessionResponse>;
  estimate(input: TextAiEstimateInput): Promise<TextAiEstimateResponse>;
  estimateWithOutcome(input: TextAiEstimateInput): Promise<TextAiEstimateOutcome>;
}
~~~

测试固定：

- login 只向 /api/nutrition/text/login POST exact JSON；
- accessCode 非 32 位 base64url 时 fetch 前抛 TypeError；
- logout 只向固定同源 URL POST 空 body；
- login/logout 都使用 credentials=same-origin；
- 只接受固定 200 success、401 auth-required、429 rate-limited、503 service-disabled；
- TextEstimateSheet 收到 auth-required 后显示 type=password 的“访问码”输入；
- 点击“验证并继续”成功后再次检查 session，并保留餐食描述、数量和单位；
- session 成功后显示“退出 AI 登录”，调用 logout 后清除 Cookie 并回到访问码输入；
- 错码、限流和网络错误保留草稿与输入层，但测试不得读取或快照真实访问码；
- 双击提交只发送一次 login；
- 卸载或关闭后 pending login 不更新组件；
- accessCode 不进入 URL、sessionStorage、localStorage、IndexedDB 或 callback props；
- HealthScreen 不再执行 location.assign 或保存 textAi resume intent。

关键 UI 测试：

~~~tsx
test('访问码登录成功后保留草稿并恢复 session', async () => {
  const user = userEvent.setup();
  const session = vi.fn()
    .mockResolvedValueOnce(failure('auth-required'))
    .mockResolvedValueOnce(structuredClone(textAiSessionSuccessFixture));
  const login = vi.fn().mockResolvedValue({ ok: true });
  renderSheet({ client: clientWith({ session, login }) });

  await enterDraft(user);
  await user.type(screen.getByLabelText('访问码'), 'A'.repeat(32));
  await user.click(screen.getByRole('button', { name: '验证并继续' }));

  await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
  expect(login).toHaveBeenCalledWith('A'.repeat(32));
  expect(screen.getByLabelText('餐食描述')).toHaveValue(DESCRIPTION);
  expect(screen.queryByLabelText('访问码')).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: 运行前端测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run \
  src/lib/textAiContract.test.ts \
  src/lib/textAiClient.test.ts \
  src/screens/health/TextEstimateSheet.test.tsx \
  src/screens/health/HealthScreen.test.tsx \
  src/App.test.tsx
~~~

Expected: FAIL，login/logout 类型和访问码 UI 尚不存在。

- [ ] **Step 3: 增加严格登录响应契约**

textAiContract.ts 增加：

~~~ts
export interface TextAiLoginSuccess {
  ok: true;
}

export interface TextAiLogoutSuccess {
  ok: true;
}

export type TextAiLoginResponse = TextAiLoginSuccess | TextAiFailure;
export type TextAiLogoutResponse = TextAiLogoutSuccess | TextAiFailure;
~~~

parseTextAiLoginResponse 只接受服务端可能返回的 auth-required、rate-limited、service-disabled；parseTextAiLogoutResponse 只接受 200 的 exact { ok: true }。客户端本地 timeout、network 和 invalid response 仍通过现有 TextAiFailure 返回固定错误。

- [ ] **Step 4: 实现同源 login/logout 客户端**

textAiClient.ts 固定：

~~~ts
const LOGIN_URL = '/api/nutrition/text/login';
const LOGOUT_URL = '/api/nutrition/text/logout';
const ACCESS_CODE = /^[A-Za-z0-9_-]{32}$/;

async function login(accessCode: string): Promise<TextAiLoginResponse> {
  if (typeof accessCode !== 'string' || !ACCESS_CODE.test(accessCode)) invalidRequest();
  return withTimeout((signal) => sendAuthJson(
    fetcher,
    LOGIN_URL,
    JSON.stringify({ accessCode }),
    signal,
    parseTextAiLoginResponse,
  ));
}

async function logout(): Promise<TextAiLogoutResponse> {
  return withTimeout((signal) => sendAuthJson(
    fetcher,
    LOGOUT_URL,
    undefined,
    signal,
    parseTextAiLogoutResponse,
  ));
}
~~~

sendAuthJson 不重试、不打印 body，遇到 3xx、opaque response、超大 body、错误 content-type 或 schema/status mismatch 时返回固定 invalid-estimate/offline 映射，不暴露响应正文。

- [ ] **Step 5: 将登录做成 Sheet 内瞬时状态**

TextEstimateSheet：

- 删除 onLogin prop；
- 增加 step='login' 与 step='logging-in'，状态只保存 draft 和固定错误码，不保存 accessCode；
- 使用 accessCodeRef 读取 uncontrolled password input；
- input 使用 autoComplete='off'、autoCapitalize='none'、spellCheck=false、maxLength=32；
- 登录开始后立即清空 DOM input；
- 成功后调用 checkSession(draft)，失败保留 draft 并重新聚焦访问码；
- session 成功后提供 tertiary “退出 AI 登录”按钮；logout 成功后进入 login，失败显示固定可重试错误；
- close/useManual 会增加 loginGeneration 并忽略迟到响应。

渲染核心：

~~~tsx
{state.step === 'login' || state.step === 'logging-in' ? (
  <label className="block">
    <span className="mb-2 block text-sm font-semibold text-ink">访问码</span>
    <input
      ref={accessCodeRef}
      aria-label="访问码"
      type="password"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      maxLength={32}
      disabled={state.step === 'logging-in'}
      className={CONTROL_CLASS}
    />
  </label>
) : null}
~~~

HealthScreen 删除文字 redirect/resume intent；照片 resume 流程保持不变。删除 textAiIntent.ts 及测试，并从 App/HealthScreen 的 URL 清理逻辑中移除 textAi=resume 分支。

- [ ] **Step 6: 运行前端回归和构建**

Run:

~~~bash
./node_modules/.bin/vitest run \
  src/lib/textAiContract.test.ts \
  src/lib/textAiClient.test.ts \
  src/screens/health/TextEstimateSheet.test.tsx \
  src/screens/health/HealthScreen.test.tsx \
  src/App.test.tsx
npm run build
~~~

Expected: PASS；dist 中不含 TEXT_AI_LOGIN_PATH、textAi=resume、cloudflareaccess.com 或 Cf-Access。

- [ ] **Step 7: 提交**

~~~bash
git add src/lib/textAiContract.ts src/lib/textAiContract.test.ts \
  src/lib/textAiClient.ts src/lib/textAiClient.test.ts \
  src/screens/health/TextEstimateSheet.tsx src/screens/health/TextEstimateSheet.test.tsx \
  src/screens/health/HealthScreen.tsx src/screens/health/HealthScreen.test.tsx \
  src/App.tsx src/App.test.tsx src/lib/textAiIntent.ts src/lib/textAiIntent.test.ts
git commit -m "feat: add in-sheet text AI access-code login [skip ci]"
~~~

### Task 6: 用 HMAC 签名替换管理 Access 身份

**Files:**
- Modify: src/lib/textAiAdminContract.ts:1-232
- Modify: src/lib/textAiAdminContract.test.ts
- Create: edge/text-ai/adminSignature.ts
- Create: edge/text-ai/adminSignature.test.ts
- Modify: edge/text-ai/admin.ts:1-389
- Modify: edge/text-ai/admin.test.ts
- Modify: functions/api/nutrition/text-admin/account.ts

- [ ] **Step 1: 写 slot contract 与签名红灯测试**

TextAiAdminRequest 改为：

~~~ts
export type TextAiAdminTarget = 'user-1' | 'user-2';

export interface TextAiAdminRequest {
  schemaVersion: 1;
  operationId: string;
  operation: TextAiAdminOperation;
  target: TextAiAdminTarget;
}
~~~

删除 EMAIL_PATTERN 和 targetEmail。测试 getter、prototype、extra key、错误 slot、大小写和空白全部拒绝。

管理签名测试使用固定向量：

~~~ts
const body = new TextEncoder().encode(
  '{"schemaVersion":1,"operationId":"11111111111111111111111111111111","operation":"status","target":"user-1"}',
);
const signed = await signTextAdminRequestForTest({
  key: ADMIN_KEY,
  method: 'POST',
  path: '/api/nutrition/text-admin/account',
  timestamp: '1777777777000',
  operationId: '11111111111111111111111111111111',
  body,
});
expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
await expect(verifyTextAdminSignature(requestFrom(signed, body), ADMIN_KEY, 1_777_777_777_000))
  .resolves.toBeUndefined();
~~~

负向矩阵覆盖 body byte、method、path、timestamp、operationId、version、重复 header、签名和 ±300001ms 漂移。

- [ ] **Step 2: 运行测试确认 RED**

Run:

~~~bash
./node_modules/.bin/vitest run \
  src/lib/textAiAdminContract.test.ts \
  edge/text-ai/adminSignature.test.ts \
  edge/text-ai/admin.test.ts
~~~

Expected: FAIL，target slot 和 adminSignature 尚不存在。

- [ ] **Step 3: 实现 canonical 管理签名**

固定 header：

~~~ts
export const TEXT_ADMIN_SIGNATURE_HEADERS = Object.freeze({
  version: 'x-tiezheng-admin-version',
  timestamp: 'x-tiezheng-admin-timestamp',
  signature: 'x-tiezheng-admin-signature',
});
~~~

签名材料精确为 UTF-8：

~~~text
v1
POST
/api/nutrition/text-admin/account
1777777777000
11111111111111111111111111111111
<64 lowercase hex body sha256>
~~~

末尾不得有换行。adminSignature.ts 使用 Web Crypto HMAC-SHA-256 和恒定时间比较，key 是 canonical 32-byte base64url，时间窗口固定 5 分钟。

- [ ] **Step 4: 改写 Pages 管理授权顺序**

authorizeWithDeadline 固定顺序：

1. 校验 method、URL、Host、Origin、Sec-Fetch-Site、content type 和长度；
2. 一次性读取最多 2048 bytes 原始 body；
3. 从 body bytes 提取 operationId 之前先完成 JSON parse 的 exact contract snapshot，但签名计算必须使用原始 bytes；
4. 验证 HMAC、时间窗和 operationId 一致；
5. 使用 deriveOpaqueKey('text-ai:' + target, PHOTO_AI_ACCOUNT_HMAC_KEY)；
6. 构造既有 TextAiAdminWorkerRequest 并通过 Service Binding 转发。

不得读取 TEXT_AI_SESSION_SIGNING_KEY、访问码摘要或 Cookie。错误统一返回 auth-required；签名成功但下游失败继续返回 service-disabled。

- [ ] **Step 5: 运行管理边界回归**

Run:

~~~bash
./node_modules/.bin/vitest run \
  src/lib/textAiAdminContract.test.ts \
  edge/text-ai/adminSignature.test.ts \
  edge/text-ai/admin.test.ts \
  workers/photo-ai-gateway/src/textAdminHandler.test.ts
npm run typecheck:edge
~~~

Expected: PASS；序列化失败输出中不含 target、签名、body 或 account key。

- [ ] **Step 6: 提交**

~~~bash
git add src/lib/textAiAdminContract.ts src/lib/textAiAdminContract.test.ts \
  edge/text-ai/adminSignature.ts edge/text-ai/adminSignature.test.ts \
  edge/text-ai/admin.ts edge/text-ai/admin.test.ts \
  functions/api/nutrition/text-admin/account.ts
git commit -m "feat: sign text AI admin requests without Access [skip ci]"
~~~

### Task 7: 移除控制脚本和 GitHub workflow 的 Zero Trust 依赖

**Files:**
- Create: scripts/text-ai-admin-signature.mjs
- Create: scripts/text-ai-admin-signature.test.mjs
- Modify: scripts/text-ai-preview-control.mjs
- Modify: scripts/text-ai-preview-control.test.mjs
- Modify: .github/workflows/text-ai-preview.yml
- Modify: scripts/verify-text-ai-preview-workflow.mjs
- Modify: scripts/verify-text-ai-preview-workflow.test.mjs

- [ ] **Step 1: 写无 Access policy 的红灯测试**

固定 token 权限集合：

~~~js
export const TEXT_PREVIEW_TOKEN_PERMISSION_NAMES = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
]);
~~~

测试断言 control 和 workflow：

- 不请求 /access/organizations、/access/apps、/access/identity_providers、/access/service_tokens；
- 不出现 TEAM_DOMAIN、EMAIL、ACCESS_AUD、CF_ACCESS_CLIENT；
- configure 只更新 Pages Preview env secrets 和 PHOTO_AI_GATEWAY binding；
- preflight 只读 token、Pages project、Worker inventory/settings；
- disable-all 只关闭 Worker text flag 和两个账号/全局状态，不再调用 disable-access；
- rotate-user-code 只接受 user-1 或 user-2，重新应用 Pages Preview secret bindings 并部署固定 SHA，不改变 Worker 或账号开关；
- invoke-admin 的 target 直接是 user-1 或 user-2；
- 管理 secret 只经 process env 读取并在内存生成签名 headers；
- workflow 不把签名、timestamp、body 或 access code 写入 output/artifact。

- [ ] **Step 2: 运行 Node 红灯测试**

Run:

~~~bash
node --test \
  scripts/text-ai-admin-signature.test.mjs \
  scripts/text-ai-preview-control.test.mjs \
  scripts/verify-text-ai-preview-workflow.test.mjs
~~~

Expected: FAIL，旧 Access API 与环境变量仍存在。

- [ ] **Step 3: 实现 Node 管理签名器并锁定跨运行时向量**

scripts/text-ai-admin-signature.mjs 公开：

~~~js
export function signTextAdminRequest({
  key,
  timestamp,
  operationId,
  body,
}) {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const material = [
    'v1',
    'POST',
    '/api/nutrition/text-admin/account',
    timestamp,
    operationId,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', decodeCanonicalKey(key))
    .update(material, 'utf8')
    .digest('hex');
}
~~~

Node 测试向量必须与 edge/text-ai/adminSignature.test.ts 使用相同 key、timestamp、operationId、body 和 expected signature，防止两个实现漂移。

- [ ] **Step 4: 瘦身 control 配置和 Pages patch**

EXPECTED_PREVIEW_ENV_NAMES 精确改为：

~~~js
const EXPECTED_PREVIEW_ENV_NAMES = new Set([
  'PHOTO_AI_ALLOWED_ORIGINS',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  'TEXT_AI_SESSION_SIGNING_KEY',
  'TEXT_AI_RATE_LIMIT_HMAC_KEY',
  'TEXT_AI_ADMIN_SIGNING_KEY',
]);
~~~

loadTextPreviewConfig 只解析这些值、account ID、Cloudflare token、ARK key 和 cache AES key。preflightTextPreview 不返回 Access IDs。configure 只 patch Preview env_vars 和 PHOTO_AI_GATEWAY service binding。

invokeAdmin 构建唯一 canonical JSON：

~~~js
const body = JSON.stringify({
  schemaVersion: 1,
  operationId,
  operation: parsed.operation,
  target: parsed.target,
});
const timestamp = String(Date.now());
const signature = signTextAdminRequest({
  key: config.adminSigningKey,
  timestamp,
  operationId,
  body,
});
~~~

fetch headers 只含固定 Origin、Sec-Fetch-Site、Content-Type、Content-Length 和三项管理签名 header，不含 cf-access-client-id/secret。

- [ ] **Step 5: 更新 workflow 和静态 verifier**

workflow 环境只引用新 secret；删除 TEXT_AI_TEAM_DOMAIN variable 和全部邮箱/Access secrets。operation choices 删除 disable-access、增加 rotate-user-code；该 operation 要求固定确认短语 ROTATE_ONE_TEXT_ACCESS_CODE，并只执行 configure、build 和 Pages Preview deploy。verifier 重算固定 dispatch/operation-case SHA256，并增加：

~~~js
const FORBIDDEN_ACCESS_SHAPES = Object.freeze([
  '/access/',
  'cloudflareaccess.com',
  'Cf-Access-Jwt-Assertion',
  'cf-access-client-id',
  'cf-access-client-secret',
  'TEXT_AI_TEAM_DOMAIN',
  'TEXT_AI_USER_1_EMAIL',
  'TEXT_AI_USER_2_EMAIL',
]);
~~~

照片模块和历史 specs/docs 可以出现这些词；静态 source gate 只扫描运行时代码、脚本和 workflow 的文字 AI allowlist。

- [ ] **Step 6: 运行控制面测试**

Run:

~~~bash
node --test \
  scripts/text-ai-admin-signature.test.mjs \
  scripts/text-ai-preview-control.test.mjs \
  scripts/verify-text-ai-preview-workflow.test.mjs
npm run verify:text-preview-workflow
~~~

Expected: PASS。

- [ ] **Step 7: 提交**

~~~bash
git add scripts/text-ai-admin-signature.mjs scripts/text-ai-admin-signature.test.mjs \
  scripts/text-ai-preview-control.mjs scripts/text-ai-preview-control.test.mjs \
  .github/workflows/text-ai-preview.yml \
  scripts/verify-text-ai-preview-workflow.mjs \
  scripts/verify-text-ai-preview-workflow.test.mjs
git commit -m "feat: remove Zero Trust from text AI control plane [skip ci]"
~~~

### Task 8: 把首次配置向导改成两项输入和双访问码输出

**Files:**
- Modify: scripts/text-ai-preview-setup-values.mjs
- Modify: scripts/text-ai-preview-setup-values.test.mjs
- Modify: scripts/text-ai-preview-setup-prompt.mjs
- Modify: scripts/text-ai-preview-setup-prompt.test.mjs
- Modify: scripts/text-ai-preview-setup-cloudflare.mjs
- Modify: scripts/text-ai-preview-setup-cloudflare.test.mjs
- Modify: scripts/text-ai-preview-setup-github.mjs
- Modify: scripts/text-ai-preview-setup-github.test.mjs
- Modify: scripts/text-ai-preview-setup.mjs
- Modify: scripts/text-ai-preview-setup.test.mjs
- Create: scripts/text-ai-access-code-rotate.mjs
- Create: scripts/text-ai-access-code-rotate.test.mjs
- Modify: package.json
- Modify: scripts/verify-text-ai-preview-setup.mjs
- Modify: scripts/verify-text-ai-preview-setup.test.mjs

- [ ] **Step 1: 写新 secret inventory 和随机材料红灯测试**

最终 GitHub Environment secret 名称精确为：

~~~js
const SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'ARK_API_KEY',
  'PHOTO_AI_CACHE_AES_KEY',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  'TEXT_AI_SESSION_SIGNING_KEY',
  'TEXT_AI_RATE_LIMIT_HMAC_KEY',
  'TEXT_AI_ADMIN_SIGNING_KEY',
]);
const VARIABLE_NAMES = Object.freeze(['CLOUDFLARE_ACCOUNT_ID']);
~~~

测试固定：

- prompt 只读取隐藏 Cloudflare API Token 和隐藏 ARK_API_KEY；
- random 依次请求 24、24、32、32、32、32、32、32、32 bytes；
- 两个 24-byte access code 编码为 32-char canonical base64url；
- 七个 32-byte key 相互独立，包括两个账号各自的 pepper；
- 每个 digest 为 HMAC-SHA-256(该账号 pepper, 该账号 access code) 的 64-hex；
- access code 明文不进入 writes、preview summary、GitHub stdin fixture、异常或 compensation；
- TTY 成功输出只显示 user-1 和 user-2 code 各一次；
- 所有本地 Buffer 在 success、cancel、validation failure、GitHub partial failure 和 preflight block 后归零；
- GitHub 最终名称为 11 secrets + 1 existing variable；
- Cloudflare setup 检查不调用 Access API、不创建资源。
- 单账号轮换只生成并更新目标槽位的 pepper/digest，另一个槽位的 secret 名称不出现在 gh set 调用；
- 轮换部署失败提供固定 --resume=user-N 路径，重试时不生成或输出新 code，也不再次写 secrets。

- [ ] **Step 2: 运行 setup 红灯测试**

Run:

~~~bash
node --test scripts/text-ai-preview-setup*.test.mjs scripts/verify-text-ai-preview-setup.test.mjs
~~~

Expected: FAIL，旧四项输入、team domain 和 service token 流程仍存在。

- [ ] **Step 3: 重写纯值生成边界**

SETUP_POLICY：

~~~js
export const SETUP_POLICY = Object.freeze({
  repository: 'nuts-and-bytes/tiezheng',
  environment: 'text-ai-preview',
  secretNames: SECRET_NAMES,
  variableNames: VARIABLE_NAMES,
});
~~~

generateSetupMaterials(random) 返回受 WeakSet 标记的 opaque record，内含 Buffer：

~~~js
{
  user1Code,
  user2Code,
  cacheAesKey,
  accountHmacKey,
  user1AccessCodePepper,
  user2AccessCodePepper,
  sessionSigningKey,
  rateLimitHmacKey,
  adminSigningKey,
}
~~~

assembleSetupWrites 只把两个 code 的 HMAC digest 放入 writes；明文 code 只交给 renderAccessCodesOnce(output, materials)，写完立即擦除。

- [ ] **Step 4: 删除 Cloudflare service-token 状态机**

setup-cloudflare.mjs 只保留：

- token verify/detail/catalog；
- account scope 和三项窄权限检查；
- Pages project 与 Worker inventory 的只读存在性检查。

删除 organization、auth_domain、service token inventory/create/delete 和对应 blocked error。setup.mjs 的远端阶段变为：

1. inspect GitHub；
2. inspect Cloudflare；
3. prompt 两项 secret；
4. generate materials；
5. 无值预览；
6. 用户 y/N；
7. 写 11 个 GitHub secrets；
8. 核对 11+1 名称；
9. 显示并立即擦除两个访问码；
10. dispatch 精确关闭态 preflight。

partial failure 只逆序删除本次尝试写入的 GitHub secret，不删除 Cloudflare 资源。若远端写入完成但 TTY 无法完整显示两个访问码，也必须删除本次 11 个 secrets 并停止，不能留下用户无法恢复的凭据。

新增 text-ai-access-code-rotate.mjs：

1. 只接受 --target=user-1、--target=user-2 或 --resume=user-N；
2. 普通轮换先生成目标账号的新 24-byte code、32-byte pepper 和 digest；
3. 在真实 TTY 显示 code 一次并要求 y/N 确认已保存；
4. 通过 bounded gh stdin 只覆盖目标账号的 PEPPER 与 DIGEST 两个 secret；
5. 精确派发 rotate-user-code、target、ROTATE_ONE_TEXT_ACCESS_CODE 和 expected SHA；
6. 绑定唯一 run/job/step 并验证成功；
7. 若 secrets 已写但 dispatch/deploy 失败，只输出 ROTATION BLOCKED deploy 和固定 resume 命令；旧 Pages deployment 与旧 code 继续有效；
8. --resume 只派发同一固定 workflow，不读取、生成或显示任何 secret。

package.json 增加固定入口：

~~~json
{
  "scripts": {
    "rotate:text-preview-code": "node scripts/text-ai-access-code-rotate.mjs",
    "test:text-access-code-rotate": "node --test scripts/text-ai-access-code-rotate.test.mjs"
  }
}
~~~

- [ ] **Step 5: 更新 setup verifier**

固定允许外部命令仍只有 gh read/set/delete/workflow dispatch/watch/view；禁止 wrangler deploy、workflow enable operation、模型 URL 和任何 /access/ API。输出 allowlist 精确为：

~~~text
SETUP COMPLETE
secrets=11 variables=1 preflight=pass workerTextEnabled=false photoEnabled=false
~~~

访问码 TTY 行不进入 captured CLI summary 测试 snapshot；测试只验证 labels、长度和出现次数，禁止复制 fixture secret 到失败消息。

- [ ] **Step 6: 运行完整 setup 套件**

Run:

~~~bash
node --test scripts/text-ai-preview-setup*.test.mjs scripts/verify-text-ai-preview-setup.test.mjs
npm run test:text-access-code-rotate
npm run verify:text-preview-setup
~~~

Expected: PASS。

- [ ] **Step 7: 提交**

~~~bash
git add scripts/text-ai-preview-setup-values.mjs scripts/text-ai-preview-setup-values.test.mjs \
  scripts/text-ai-preview-setup-prompt.mjs scripts/text-ai-preview-setup-prompt.test.mjs \
  scripts/text-ai-preview-setup-cloudflare.mjs scripts/text-ai-preview-setup-cloudflare.test.mjs \
  scripts/text-ai-preview-setup-github.mjs scripts/text-ai-preview-setup-github.test.mjs \
  scripts/text-ai-preview-setup.mjs scripts/text-ai-preview-setup.test.mjs \
  scripts/text-ai-access-code-rotate.mjs scripts/text-ai-access-code-rotate.test.mjs \
  scripts/verify-text-ai-preview-setup.mjs scripts/verify-text-ai-preview-setup.test.mjs \
  package.json
git commit -m "feat: generate text AI access codes in setup wizard [skip ci]"
~~~

### Task 9: 更新运维文档并执行完整本地验证

**Files:**
- Modify: docs/operations/text-ai-preview-runbook.md
- Modify: docs/operations/text-ai-preview-release-checklist.md

- [ ] **Step 1: 写文档 verifier 红灯断言**

runbook/checklist 必须包含：

- 两个访问码只显示一次及保存提醒；
- 11 secrets + CLOUDFLARE_ACCOUNT_ID inventory；
- 三项 Cloudflare token 权限；
- 无 Zero Trust、邮箱、OTP、Access app/service token；
- 30 天 Cookie、单账号轮换、全 session key 轮换；
- 正常 5 次/15 分钟与匿名 3 次/30 分钟限流；
- 管理 HMAC 时间窗和重放边界；
- 关闭态 setup、部署授权、模型调用授权三段 gate；
- 泄露时先关闭全局文字 AI，再轮换对应 secret；
- 旧 Access setup token 只有在新窄 token 验证后才撤销。

- [ ] **Step 2: 更新操作文档**

历史 specs 和 plans 保持不可变；运维文档以 2026-08-27 设计为当前执行依据，并明确 2026-08-24/26 Access 文档只保留决策历史，不能用于当前首次配置。

- [ ] **Step 3: 执行 targeted 静态泄漏扫描**

Run:

~~~bash
rg -n -i \
  'TEXT_AI_TEAM_DOMAIN|TEXT_AI_USER_[12]_EMAIL|TEXT_AI_ADMIN_EMAIL|TEXT_AI_CF_ACCESS|cf-access-client|cloudflareaccess[.]com|/access/' \
  edge functions workers scripts .github src \
  --glob '!**/*.test.*'
~~~

Expected: 文字运行时、控制脚本和 workflow 零命中；edge/photo-ai/access.ts 中 cloudflareaccess.com 是照片认证保留项，必须由精确 allowlist 单独解释，不能全局删除。

再扫描明文密钥形状：

~~~bash
rg -n \
  'ARK_API_KEY\s*[:=]\s*[^*{]|TEXT_AI_(ACCESS_CODE|SESSION_SIGNING|RATE_LIMIT_HMAC|ADMIN_SIGNING).*\s*[:=]\s*[^*{]|eyJ[A-Za-z0-9_-]+[.]eyJ' \
  edge functions workers scripts .github src dist
~~~

Expected: 只有明显 test-only placeholder 或固定 secret 名映射，且 verifier 分类通过；无真实值。

- [ ] **Step 4: 运行完整验证矩阵**

Run:

~~~bash
npm test
npm run test:edge
npm run typecheck
npm run typecheck:edge
npm run build
npm run verify:text-preview-setup
npm run verify:text-preview-workflow
git diff --check
~~~

Expected: 全部 exit 0。记录实际 test 数量和命令结论，不预写固定通过数量。

- [ ] **Step 5: 检查变更只覆盖批准范围**

Run:

~~~bash
git status --short
git diff --stat f098abf...HEAD
git log --oneline --decorate f098abf..HEAD
~~~

Expected: 只有文字认证、管理签名、setup/workflow/verifier 和对应文档；照片模型、营养契约、生产开关无无关改动。

- [ ] **Step 6: 提交文档与最终本地门禁**

~~~bash
git add docs/operations/text-ai-preview-runbook.md \
  docs/operations/text-ai-preview-release-checklist.md
git commit -m "docs: operate text AI preview without Zero Trust [skip ci]"
~~~

### Task 10: 首次远端配置，无部署、无启用、无模型调用

**Files:**
- No repository changes expected

- [ ] **Step 1: 停止并取得新的远端授权**

授权必须精确覆盖：

- 在 GitHub nuts-and-bytes/tiezheng 的 text-ai-preview Environment 写入新的 11-secret inventory；
- 创建或使用只含 Account API Tokens Read、Workers Scripts Edit、Cloudflare Pages Edit 的 Cloudflare token；
- 在新 token 验证后撤销旧的 tiezheng-text-ai-preview-setup token；
- 在真实 TTY 显示两个访问码一次；
- 只运行关闭态 preflight，不部署、不启用、不调用模型。

没有这段授权不得继续。

- [ ] **Step 2: 只读确认远端前置条件**

Run:

~~~bash
gh api repos/nuts-and-bytes/tiezheng/environments/text-ai-preview
gh secret list -R nuts-and-bytes/tiezheng --env text-ai-preview --json name
gh variable list -R nuts-and-bytes/tiezheng --env text-ai-preview --json name
~~~

Expected: Environment/branch policy 正确；目标 11 secrets 不存在；CLOUDFLARE_ACCOUNT_ID 唯一存在。只报告名称，不读取值。

- [ ] **Step 3: 创建并验证窄 Cloudflare token**

通过可信 Cloudflare Dashboard 创建或编辑固定用途 token。API token 不进入聊天或 shell history。先用向导只读检查证明 account scope 和三项权限精确通过，再准备撤销旧 token。

- [ ] **Step 4: 在真实 TTY 运行向导**

Run:

~~~bash
npm run setup:text-preview
~~~

用户保存 user-1 与 user-2 的访问码；向导结束后只允许报告固定 COMPLETE 行和关闭态 preflight 结论。

- [ ] **Step 5: 核对远端名称和关闭态**

只读确认：

- 11 个 secret 名称精确存在；
- CLOUDFLARE_ACCOUNT_ID 唯一存在；
- preflight 精确绑定 main SHA、唯一 job/step 且 workerTextEnabled=false；
- 没有 Access app、service token 或 team domain 被本流程创建。

- [ ] **Step 6: 撤销旧配置 token**

只有新 token 已完成 Step 5 后才撤销旧 token。报告被撤销 token 的固定名称，不报告 ID 或值。

### Task 11: Preview 关闭态部署、双账号登录和单次真实 AI 验证

**Files:**
- No source changes unless verification finds a bug; any bug returns Task 1–9 TDD loop

- [ ] **Step 1: 停止并取得部署与费用授权**

授权必须分别覆盖：

- push/merge main；
- workflow deploy-disabled；
- Preview 登录验证；
- enable-admin-preview user-1；
- 一次真实 ARK 文字餐食估算；
- enable-account user-2。

生产启用和第二次真实模型调用不包含在授权中。

- [ ] **Step 2: 推送经过验证的 main**

推送前重新运行 Task 9 完整矩阵，并使用 verification-before-completion 与 finishing-a-development-branch 流程。远端 main 必须与本地批准 SHA 一致。

- [ ] **Step 3: 部署关闭态 Preview**

精确 dispatch deploy-disabled，绑定 run ID、main、SHA、唯一 text-ai-preview job 和 Dispatch fixed operation step。随后只读证明 Worker text=false、photo=false。

- [ ] **Step 4: 验证两个访问码登录但服务关闭**

在真实浏览器分别使用 user-1/user-2 访问码：

- Cookie 为 HttpOnly/Secure/SameSite=Strict；
- 页面脚本、storage、URL、console、network evidence 不出现访问码或 JWT；
- 两账号 session 都返回关闭状态且账号键不可见；
- 错码和限流返回固定错误，不调用模型。

- [ ] **Step 5: 只启用 user-1 并执行一次真实估算**

按固定 workflow 启用文字 global 与 user-1。使用无敏感内容的批准测试餐食执行一次估算，验证：

- 只发生一次供应商消费；
- accountRemaining 与 globalRemaining 各减少一次；
- 候选确认前本地数据库无新记录；
- 确认后只新增一条预期记录；
- 日志和 evidence 不含描述、候选、访问码、JWT 或 provider 原文。

- [ ] **Step 6: 启用 user-2 但不调用模型**

验证 user-2 session enabled、额度独立；不执行第二次真实估算。user-1 与 user-2 不得共享 Cookie、额度或账号状态。

- [ ] **Step 7: 完成安全收尾**

运行精确 disable-all 演练并重新启用批准的最终状态；若任一检查失败，最终状态保持 text global=false、两个账号 disabled，并报告 BLOCKED，不声称可用。
