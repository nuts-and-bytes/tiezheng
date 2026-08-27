# 铁证文字 AI Preview 四项输入向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成一个只询问 Cloudflare API Token、ARK API Key 和两个邮箱的一次性本地向导，自动完成其余 Preview 配置并以关闭态 preflight 收尾。

**Architecture:** 把纯值校验、TTY 输入、Cloudflare API、GitHub CLI 和状态机编排拆成五个窄模块。所有远端写入都发生在一次无值预览确认之后；secret 只在内存和单个 `gh` 子进程 stdin 中出现，部分失败只补偿本次新建资源，完整写入后的 preflight 失败则保留控制凭证并停止。

**Tech Stack:** Node.js 22 ESM、`node:test`、现有 `createCloudflareClient`、GitHub CLI、GitHub Actions、Cloudflare Zero Trust API。

---

## 实施前固定边界

- 设计规格：`docs/superpowers/specs/2026-08-26-text-ai-setup-wizard-design.md`。
- 研究依据：`docs/superpowers/research/2026-08-26-text-ai-setup-wizard-inputs.md`。
- 开始编码时先使用 `superpowers:using-git-worktrees` 创建隔离分支；不得直接在当前 `main` 工作树编码。
- 本计划的 Task 1–9 只实现和本地验证。Task 10 才允许真实外部写入，并仍要求用户在 TTY 中输入凭证和确认 `y`。
- 所有提交都带 `[skip ci]`；合并和推送仍是独立授权动作，不能因为测试通过而自动执行。
- 生产、照片 AI、账号启用、模型调用和部署不在本向导权限内。

## 文件职责图

| 文件 | 职责 |
|---|---|
| `scripts/text-ai-preview-control.mjs` | 复用现有 token policy 解析，新增固定 setup 权限检查；不创建 service token |
| `scripts/text-ai-preview-setup-values.mjs` | 四项输入、team domain、Cloudflare credential、随机 key 和 GitHub 写入计划的纯校验/派生 |
| `scripts/text-ai-preview-setup-prompt.mjs` | 只处理真实 TTY 的隐藏/可见输入与一次 `y/N` 确认 |
| `scripts/text-ai-preview-setup-cloudflare.mjs` | 只读检查 organization/token inventory；创建和删除唯一固定 service token |
| `scripts/text-ai-preview-setup-github.mjs` | 只读仓库门禁、stdin 写入/补偿、名称核验和精确 preflight workflow 绑定 |
| `scripts/text-ai-preview-setup.mjs` | 阶段状态机、失败补偿、固定摘要和 CLI main guard |
| `scripts/verify-text-ai-preview-setup.mjs` | 静态锁定允许的命令/API/输出边界，禁止部署、enable、模型与 secret 泄漏形状 |
| 同名 `*.test.mjs` | 每个模块的 RED/GREEN、失败矩阵、泄漏与 mutation tests |
| `package.json` | 增加固定 setup/test/verifier 命令 |
| 三份运维文档 | 把唯一允许的 TTY→stdin 路径写入 runbook/checklist/旧 release plan |

### Task 1: 复用现有 token policy，增加 setup 专用权限门禁

**Files:**
- Modify: `scripts/text-ai-preview-control.mjs:82-92, 432-505, 582-614`
- Modify: `scripts/text-ai-preview-control.test.mjs:98-105, 164-188, 460-525`

- [ ] **Step 1: 写 setup token 权限红灯测试**

在测试 import 中加入 `verifyTextPreviewSetupToken`，并增加固定权限 fixture：

```js
const SETUP_TOKEN_PERMISSION_NAMES = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
  'Access: Apps and Policies Edit',
  'Access: Organizations, Identity Providers, and Groups Read',
  'Access: Service Tokens Read',
  'Access: Service Tokens Write',
]);

function tokenDetailFor(permissionNames) {
  return tokenDetail({
    policies: [{
      id: 'token-policy-id',
      effect: 'allow',
      resources: { [ACCOUNT_RESOURCE_KEY]: '*' },
      permission_groups: permissionNames.map((_, index) => ({
        id: `permission-group-${index}`,
      })),
    }],
  });
}

function setupTokenResults(permissionNames = SETUP_TOKEN_PERMISSION_NAMES) {
  return new Map([
    ['GET /tokens/verify', { id: TOKEN_ID, status: 'active' }],
    [`GET /tokens/${TOKEN_ID}`, tokenDetailFor(permissionNames)],
    ['GET /tokens/permission_groups', permissionGroupCatalog(permissionNames)],
  ]);
}

test('setup token inspection requires exact organization read and service-token write', async () => {
  const { client, calls } = createFakeClient(setupTokenResults());
  const ready = await verifyTextPreviewSetupToken(SENSITIVE.accountId, client);
  assert.deepEqual(ready.missingPermissions, []);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /tokens/verify',
    `GET /tokens/${TOKEN_ID}`,
    'GET /tokens/permission_groups',
  ]);

  for (const missing of SETUP_TOKEN_PERMISSION_NAMES) {
    const names = SETUP_TOKEN_PERMISSION_NAMES.filter((name) => name !== missing);
    const fake = createFakeClient(setupTokenResults(names));
    const result = await verifyTextPreviewSetupToken(SENSITIVE.accountId, fake.client);
    assert.deepEqual(result.missingPermissions, [missing]);
    assert.equal(fake.calls.every(({ method }) => method === 'GET'), true);
  }
});

test('runtime preflight still accepts the documented narrower aliases', async () => {
  const { client } = createFakeClient();
  await assert.doesNotReject(preflightTextPreview(loadTextPreviewConfig(validEnv()), client));
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test scripts/text-ai-preview-control.test.mjs
```

Expected: FAIL，提示 `verifyTextPreviewSetupToken` 未导出。

- [ ] **Step 3: 把 required aliases 变成内部固定参数并新增导出**

实现固定 setup 集合，禁止调用方传任意 aliases：

```js
const SETUP_TOKEN_CAPABILITY_ALIASES = Object.freeze([
  Object.freeze(['Account API Tokens Read']),
  Object.freeze(['Workers Scripts Edit', 'Workers Scripts Write']),
  Object.freeze(['Cloudflare Pages Edit', 'Pages Write']),
  Object.freeze(['Access: Apps and Policies Edit', 'Access: Apps and Policies Write']),
  Object.freeze(['Access: Organizations, Identity Providers, and Groups Read']),
  Object.freeze(['Access: Service Tokens Read']),
  Object.freeze(['Access: Service Tokens Write']),
]);
export const TEXT_PREVIEW_SETUP_PERMISSION_NAMES = Object.freeze(
  SETUP_TOKEN_CAPABILITY_ALIASES.map((aliases) => aliases[0]),
);

function parseTokenDetails(value, tokenId, accountId, permissionCatalog, requiredAliases) {
  const token = snapshotRecord(value);
  rejectPrototypeKeys(token);
  if (
    token.get('id') !== tokenId
    || token.get('status') !== 'active'
    || !token.has('policies')
  ) {
    fail();
  }

  const expectedResourceKey = `${ACCOUNT_PERMISSION_SCOPE}.${accountId}`;
  const capabilities = new Set();
  const observedPermissionGroupIds = new Set();
  const policies = snapshotArray(token.get('policies'));
  if (policies.length === 0) fail();

  for (const policyValue of policies) {
    const policy = snapshotRecord(policyValue);
    rejectPrototypeKeys(policy);
    if (policy.get('effect') !== 'allow') fail();
    if (policy.has('id') && !safeIdentifier(policy.get('id'))) fail();

    const resources = snapshotRecord(policy.get('resources'));
    rejectPrototypeKeys(resources);
    if (
      resources.size !== 1
      || !resources.has(expectedResourceKey)
      || resources.get(expectedResourceKey) !== '*'
    ) {
      fail();
    }

    const groups = snapshotArray(policy.get('permission_groups'));
    if (groups.length === 0) fail();
    for (const groupValue of groups) {
      const group = snapshotRecord(groupValue);
      rejectPrototypeKeys(group);
      const id = group.get('id');
      if (
        !safeIdentifier(id)
        || observedPermissionGroupIds.has(id)
        || !permissionCatalog.has(id)
        || (group.has('name') && !validPermissionName(group.get('name')))
      ) {
        fail();
      }
      observedPermissionGroupIds.add(id);
      const permission = permissionCatalog.get(id);
      if (
        permission.scopes.length !== 1
        || permission.scopes[0] !== ACCOUNT_PERMISSION_SCOPE
      ) {
        fail();
      }
      const { name } = permission;
      for (let index = 0; index < requiredAliases.length; index += 1) {
        if (requiredAliases[index].includes(name)) capabilities.add(index);
      }
    }
  }
  return Object.freeze(requiredAliases
    .filter((_, index) => !capabilities.has(index))
    .map((aliases) => aliases[0]));
}

async function verifyTokenCapabilities(accountId, client, requiredAliases) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId)) fail();
  const get = clientGet(client);
  const tokenId = parseTokenVerification(await get('/tokens/verify'));
  const tokenDetails = await get(`/tokens/${tokenId}`);
  const catalog = parsePermissionGroupCatalog(await get('/tokens/permission_groups'));
  const missingPermissions = parseTokenDetails(
    tokenDetails,
    tokenId,
    accountId,
    catalog,
    requiredAliases,
  );
  return Object.freeze({ accountId, missingPermissions });
}

export async function verifyTextPreviewSetupToken(accountId, client) {
  try {
    return await verifyTokenCapabilities(
      accountId,
      client,
      SETUP_TOKEN_CAPABILITY_ALIASES,
    );
  } catch {
    fail();
  }
}
```

`preflightTextPreview` 的 `try` 内将原有三个 token GET 和 `parseTokenDetails` 替换为下面一段，随后保留 Pages/Worker/OTP/service-client 部分：

```js
const tokenState = await verifyTokenCapabilities(
  config.accountId,
  client,
  REQUIRED_TOKEN_CAPABILITY_ALIASES,
);
if (tokenState.missingPermissions.length !== 0) fail();
const get = clientGet(client);
```

紧接着检查 `tokenState.missingPermissions.length === 0`，否则调用现有 `fail()`；不删减现有任何请求或返回字段。Setup 导出不把“缺权限”混成结构/网络错误，只返回固定 aliases 的第一个官方名称，以便 CLI 安全告诉用户该补哪项。

- [ ] **Step 4: 跑定向和控制面测试**

Run:

```bash
node --test scripts/text-ai-preview-control.test.mjs
npm run test:text-preview-control
```

Expected: 两条命令均 PASS；第二条仍报告现有控制面全部通过。

- [ ] **Step 5: 提交**

```bash
git add scripts/text-ai-preview-control.mjs scripts/text-ai-preview-control.test.mjs
git commit -m "feat: validate text preview setup token [skip ci]"
```

### Task 2: 建立纯值模型与确定性 secret 写入计划

**Files:**
- Create: `scripts/text-ai-preview-setup-values.mjs`
- Create: `scripts/text-ai-preview-setup-values.test.mjs`

- [ ] **Step 1: 写输入、派生值和清零红灯测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SETUP_POLICY,
  assembleSetupWrites,
  generateSetupKeys,
  parseSetupInputs,
  parseTeamDomain,
  wipeSetupWrites,
} from './text-ai-preview-setup-values.mjs';

const INPUTS = Object.freeze({
  cloudflareApiToken: 'cf-token-sentinel',
  arkApiKey: 'ark-key-sentinel',
  user1Email: 'owner@example.com',
  user2Email: 'tester@example.com',
});

test('accepts exactly four canonical inputs and rejects normalization', () => {
  assert.deepEqual(parseSetupInputs(INPUTS), INPUTS);
  for (const bad of [
    { ...INPUTS, user1Email: 'Owner@example.com' },
    { ...INPUTS, user2Email: INPUTS.user1Email },
    { ...INPUTS, arkApiKey: ' ark-key-sentinel' },
    { ...INPUTS, cloudflareApiToken: 'cf-token-sentinel\n' },
    { ...INPUTS, extra: 'field' },
  ]) assert.throws(() => parseSetupInputs(bad), /Text preview setup failed/);
});

test('derives only a lowercase Cloudflare team slug', () => {
  assert.equal(parseTeamDomain('team-name.cloudflareaccess.com'), 'team-name');
  for (const value of ['https://team.cloudflareaccess.com', 'Team.cloudflareaccess.com', 'evil.example.com']) {
    assert.throws(() => parseTeamDomain(value), /Text preview setup failed/);
  }
});

test('builds nine secret buffers and one variable in exact order then wipes them', () => {
  const rawBuffers = [];
  const random = (size) => {
    const value = Buffer.alloc(size, rawBuffers.length === 0 ? 0x41 : 0x42);
    rawBuffers.push(value);
    return value;
  };
  const keys = generateSetupKeys(random);
  assert.ok(rawBuffers.every((value) => value.every((byte) => byte === 0)));
  const keyBuffers = [keys.aesKey, keys.hmacKey];
  const writes = assembleSetupWrites({
    inputs: INPUTS,
    teamDomain: 'team-name',
    serviceClientId: 'client-id.access',
    serviceClientSecret: 'service-secret-sentinel',
    keys,
  });
  assert.ok(keyBuffers.every((value) => value.every((byte) => byte === 0)));
  assert.deepEqual(writes.secrets.map(({ name }) => name), SETUP_POLICY.secretNames);
  assert.deepEqual(writes.variables.map(({ name }) => name), ['TEXT_AI_TEAM_DOMAIN']);
  assert.ok(writes.secrets.every(({ value }) => Buffer.isBuffer(value)));
  wipeSetupWrites(writes);
  assert.ok(writes.secrets.every(({ value }) => value.every((byte) => byte === 0)));
});
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/text-ai-preview-setup-values.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现固定 policy、严格输入和 Buffer 写入计划**

核心导出必须精确如下：

```js
import { randomBytes } from 'node:crypto';

const FAILURE = 'Text preview setup failed';
const EMAIL = /^(?=.{3,254}$)(?=.{1,64}@)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CLIENT_ID = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/;

export const SETUP_POLICY = Object.freeze({
  repo: 'nuts-and-bytes/tiezheng',
  environment: 'text-ai-preview',
  serviceTokenName: 'tiezheng-text-ai-preview-github-actions',
  serviceTokenDuration: '8760h',
  secretNames: Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ]),
  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),
});

function fail() { throw new Error(FAILURE); }
function validSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function parseSetupInputs(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const expected = ['cloudflareApiToken', 'arkApiKey', 'user1Email', 'user2Email'];
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) fail();
  if (!validSecret(value.cloudflareApiToken) || !validSecret(value.arkApiKey)) fail();
  if (!EMAIL.test(value.user1Email) || !EMAIL.test(value.user2Email) || value.user1Email === value.user2Email) fail();
  return Object.freeze({
    cloudflareApiToken: value.cloudflareApiToken,
    arkApiKey: value.arkApiKey,
    user1Email: value.user1Email,
    user2Email: value.user2Email,
  });
}

function parseTeamSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) fail();
  return value;
}

export function parseTeamDomain(authDomain) {
  const suffix = '.cloudflareaccess.com';
  if (typeof authDomain !== 'string' || !authDomain.endsWith(suffix)) fail();
  return parseTeamSlug(authDomain.slice(0, -suffix.length));
}

export function generateSetupKeys(random = randomBytes) {
  let aes;
  let hmac;
  try {
    aes = random(32);
    hmac = random(32);
    if (!Buffer.isBuffer(aes) || aes.length !== 32 || !Buffer.isBuffer(hmac) || hmac.length !== 32) fail();
    return Object.freeze({
      aesKey: Buffer.from(aes.toString('base64'), 'ascii'),
      hmacKey: Buffer.from(hmac.toString('hex'), 'ascii'),
    });
  } finally {
    if (Buffer.isBuffer(aes)) aes.fill(0);
    if (Buffer.isBuffer(hmac)) hmac.fill(0);
  }
}

function entry(name, value) { return Object.freeze({ name, value: Buffer.from(value) }); }

export function assembleSetupWrites({ inputs, teamDomain, serviceClientId, serviceClientSecret, keys }) {
  try {
    const parsed = parseSetupInputs(inputs);
    if (!CLIENT_ID.test(serviceClientId) || !validSecret(serviceClientSecret)) fail();
    if (!Buffer.isBuffer(keys?.aesKey) || !/^[A-Za-z0-9+/]{43}=$/.test(keys.aesKey.toString('ascii'))) fail();
    if (!Buffer.isBuffer(keys?.hmacKey) || !/^[a-f0-9]{64}$/.test(keys.hmacKey.toString('ascii'))) fail();
    const secrets = Object.freeze([
      entry('CLOUDFLARE_API_TOKEN', parsed.cloudflareApiToken),
      entry('ARK_API_KEY', parsed.arkApiKey),
      entry('PHOTO_AI_CACHE_AES_KEY', keys.aesKey),
      entry('PHOTO_AI_ACCOUNT_HMAC_KEY', keys.hmacKey),
      entry('TEXT_AI_USER_1_EMAIL', parsed.user1Email),
      entry('TEXT_AI_USER_2_EMAIL', parsed.user2Email),
      entry('TEXT_AI_ADMIN_EMAIL', parsed.user1Email),
      entry('TEXT_AI_CF_ACCESS_CLIENT_ID', serviceClientId),
      entry('TEXT_AI_CF_ACCESS_CLIENT_SECRET', serviceClientSecret),
    ]);
    return Object.freeze({
      secrets,
      variables: Object.freeze([entry('TEXT_AI_TEAM_DOMAIN', parseTeamSlug(teamDomain))]),
    });
  } finally {
    if (Buffer.isBuffer(keys?.aesKey)) keys.aesKey.fill(0);
    if (Buffer.isBuffer(keys?.hmacKey)) keys.hmacKey.fill(0);
  }
}

export function wipeSetupWrites(writes) {
  for (const group of [writes.secrets, writes.variables]) {
    for (const item of group) item.value.fill(0);
  }
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

```bash
node --test scripts/text-ai-preview-setup-values.test.mjs
```

Expected: PASS，0 failures。

- [ ] **Step 5: 提交**

```bash
git add scripts/text-ai-preview-setup-values.mjs scripts/text-ai-preview-setup-values.test.mjs
git commit -m "feat: model text preview setup values [skip ci]"
```

### Task 3: 实现 Cloudflare setup 窄接口

**Files:**
- Create: `scripts/text-ai-preview-setup-cloudflare.mjs`
- Create: `scripts/text-ai-preview-setup-cloudflare.test.mjs`

- [ ] **Step 1: 写 API 顺序、响应校验和补偿红灯测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSetupServiceToken,
  deleteSetupServiceToken,
  inspectCloudflareSetup,
} from './text-ai-preview-setup-cloudflare.mjs';
import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const TOKEN_ID = 'setup-token-id';
const SETUP_PERMISSIONS = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
  'Access: Apps and Policies Edit',
  'Access: Organizations, Identity Providers, and Groups Read',
  'Access: Service Tokens Read',
  'Access: Service Tokens Write',
]);

function validResults(overrides = []) {
  return new Map([
    ['GET /tokens/verify', { id: TOKEN_ID, status: 'active' }],
    [`GET /tokens/${TOKEN_ID}`, {
      id: TOKEN_ID,
      status: 'active',
      policies: [{
        id: 'setup-policy-id',
        effect: 'allow',
        resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
        permission_groups: SETUP_PERMISSIONS.map((name, index) => ({
          id: `setup-permission-${index}`,
          name,
        })),
      }],
    }],
    ['GET /tokens/permission_groups', SETUP_PERMISSIONS.map((name, index) => ({
      id: `setup-permission-${index}`,
      name,
      scopes: ['com.cloudflare.api.account'],
    }))],
    ['GET /access/organizations', { auth_domain: 'team-name.cloudflareaccess.com' }],
    ['GET /access/service_tokens', []],
    ['POST /access/service_tokens', {
      id: 'created-token-id',
      name: SETUP_POLICY.serviceTokenName,
      duration: SETUP_POLICY.serviceTokenDuration,
      enabled: true,
      client_id: 'client-id.access',
      client_secret: 'service-secret-sentinel',
    }],
    ['DELETE /access/service_tokens/created-token-id', null],
    ...overrides,
  ]);
}

function fakeClient(calls, results = validResults()) {
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (!results.has(key)) throw new Error(`unexpected fake request: ${key}`);
    return results.get(key);
  };
  return Object.freeze({
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    delete: (path) => request('DELETE', path),
  });
}

test('inspects before writing and creates one fixed one-year service token', async () => {
  const calls = [];
  const client = fakeClient(calls);

  const inspected = await inspectCloudflareSetup(ACCOUNT_ID, client);
  assert.deepEqual(inspected, { status: 'ready', teamDomain: 'team-name' });
  const created = await createSetupServiceToken(client);
  assert.deepEqual(created, {
    id: 'created-token-id',
    clientId: 'client-id.access',
    clientSecret: 'service-secret-sentinel',
  });
  await deleteSetupServiceToken(client, created.id);
  assert.deepEqual(calls.slice(-2), [
    { method: 'POST', path: '/access/service_tokens', body: {
      name: SETUP_POLICY.serviceTokenName,
      duration: SETUP_POLICY.serviceTokenDuration,
      enabled: true,
    } },
    { method: 'DELETE', path: '/access/service_tokens/created-token-id', body: undefined },
  ]);
});

test('existing fixed-name token blocks before every write', async () => {
  const calls = [];
  const client = fakeClient(calls, validResults([[
    'GET /access/service_tokens',
    [{ id: 'existing-token-id', name: SETUP_POLICY.serviceTokenName }],
  ]]));
  await assert.rejects(
    inspectCloudflareSetup(ACCOUNT_ID, client),
    /Text preview setup failed/,
  );
  assert.equal(calls.some(({ method }) => method !== 'GET'), false);
});

test('missing setup permissions return only official names before organization access', async () => {
  const missing = 'Access: Service Tokens Write';
  const names = SETUP_PERMISSIONS.filter((name) => name !== missing);
  const results = validResults();
  results.set(`GET /tokens/${TOKEN_ID}`, {
    id: TOKEN_ID,
    status: 'active',
    policies: [{
      id: 'setup-policy-id',
      effect: 'allow',
      resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
      permission_groups: names.map((name, index) => ({
        id: `setup-permission-${index}`,
        name,
      })),
    }],
  });
  results.set('GET /tokens/permission_groups', names.map((name, index) => ({
    id: `setup-permission-${index}`,
    name,
    scopes: ['com.cloudflare.api.account'],
  })));
  const calls = [];
  const state = await inspectCloudflareSetup(ACCOUNT_ID, fakeClient(calls, results));
  assert.deepEqual(state, { status: 'missing-permissions', missingPermissions: [missing] });
  assert.deepEqual(calls.map(({ path }) => path), [
    '/tokens/verify',
    `/tokens/${TOKEN_ID}`,
    '/tokens/permission_groups',
  ]);
});

test('malformed one-time credential responses fail closed', async () => {
  const valid = {
    id: 'created-token-id',
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
    client_id: 'client-id.access',
    client_secret: 'service-secret-sentinel',
  };
  for (const malformed of [
    { ...valid, id: '' },
    { ...valid, client_id: 'wrong.example.com' },
    { ...valid, client_secret: '' },
    { ...valid, name: 'wrong-name' },
    { ...valid, duration: 'forever' },
    { ...valid, enabled: false },
  ]) {
    const calls = [];
    const client = fakeClient(calls, validResults([[
      'POST /access/service_tokens',
      malformed,
    ]]));
    await assert.rejects(createSetupServiceToken(client), /Text preview setup failed/);
    const expected = [{
      method: 'POST',
      path: '/access/service_tokens',
      body: {
        name: SETUP_POLICY.serviceTokenName,
        duration: SETUP_POLICY.serviceTokenDuration,
        enabled: true,
      },
    }];
    if (/^(?=.{1,255}$)[A-Za-z0-9._-]+$/.test(malformed.id)) {
      expected.push({
        method: 'DELETE',
        path: `/access/service_tokens/${malformed.id}`,
        body: undefined,
      });
    } else {
      expected.push({
        method: 'GET',
        path: '/access/service_tokens',
        body: undefined,
      });
    }
    assert.deepEqual(calls, expected);
  }
});
```

Fake client 记录完整 method/path/body，三个 token 端点也由 fixture 回应；测试不注入真实 fetch，不访问网络。再补 organization 非小写 Cloudflare Access 域名、service-token inventory 非数组或长度达 20 的三个失败 case，并断言写请求数为 0。

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/text-ai-preview-setup-cloudflare.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现严格 organization/token 解析和固定写接口**

```js
import { verifyTextPreviewSetupToken } from './text-ai-preview-control.mjs';
import { SETUP_POLICY, parseTeamDomain } from './text-ai-preview-setup-values.mjs';

const FAILURE = 'Text preview setup failed';
const BLOCKED = 'Text preview setup blocked: cloudflare.service-token';
const ID = /^(?=.{1,255}$)[A-Za-z0-9._-]+$/;
const CLIENT_ID = /^(?=.{8,255}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.access$/;
function fail() { throw new Error(FAILURE); }
function blocked() { throw new Error(BLOCKED); }
function validSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function ownRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = new Map();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    result.set(key, descriptor.value);
  }
  return result;
}

export async function inspectCloudflareSetup(accountId, client) {
  try {
    const tokenState = await verifyTextPreviewSetupToken(accountId, client);
    if (tokenState.missingPermissions.length !== 0) {
      return Object.freeze({
        status: 'missing-permissions',
        missingPermissions: tokenState.missingPermissions,
      });
    }
    const organization = ownRecord(await client.get('/access/organizations'));
    const teamDomain = parseTeamDomain(organization.get('auth_domain'));
    const inventory = await client.get('/access/service_tokens');
    if (!Array.isArray(inventory) || inventory.length >= 20) fail();
    for (const value of inventory) {
      const token = ownRecord(value);
      if (token.get('name') === SETUP_POLICY.serviceTokenName) fail();
    }
    return Object.freeze({ status: 'ready', teamDomain });
  } catch { fail(); }
}

export async function createSetupServiceToken(client) {
  let observedId;
  try {
    const value = ownRecord(await client.post('/access/service_tokens', {
      name: SETUP_POLICY.serviceTokenName,
      duration: SETUP_POLICY.serviceTokenDuration,
      enabled: true,
    }));
    const id = value.get('id');
    observedId = id;
    const clientId = value.get('client_id');
    const clientSecret = value.get('client_secret');
    if (!ID.test(id) || !CLIENT_ID.test(clientId) || !validSecret(clientSecret)
      || value.get('name') !== SETUP_POLICY.serviceTokenName
      || value.get('duration') !== SETUP_POLICY.serviceTokenDuration
      || value.get('enabled') !== true) fail();
    return Object.freeze({ id, clientId, clientSecret });
  } catch {
    if (ID.test(observedId)) {
      try { await client.delete(`/access/service_tokens/${observedId}`); }
      catch { blocked(); }
      fail();
    }
    try {
      const inventory = await client.get('/access/service_tokens');
      if (!Array.isArray(inventory) || inventory.length >= 20) blocked();
      const matching = inventory.filter((item) => {
        const token = ownRecord(item);
        return token.get('name') === SETUP_POLICY.serviceTokenName;
      });
      if (matching.length !== 0) blocked();
    } catch (error) {
      if (error instanceof Error && error.message === BLOCKED) throw error;
      blocked();
    }
    fail();
  }
}

export async function deleteSetupServiceToken(client, id) {
  try {
    if (!ID.test(id)) fail();
    await client.delete(`/access/service_tokens/${id}`);
  } catch { fail(); }
}
```

- [ ] **Step 4: 跑 Cloudflare adapter 与通用 client 测试**

```bash
node --test scripts/text-ai-preview-setup-cloudflare.test.mjs scripts/cloudflare-api.test.mjs
```

Expected: PASS；没有真实 fetch。

- [ ] **Step 5: 提交**

```bash
git add scripts/text-ai-preview-setup-cloudflare.mjs scripts/text-ai-preview-setup-cloudflare.test.mjs
git commit -m "feat: add bounded Cloudflare setup adapter [skip ci]"
```

### Task 4: 实现真正的 TTY 隐藏输入

**Files:**
- Create: `scripts/text-ai-preview-setup-prompt.mjs`
- Create: `scripts/text-ai-preview-setup-prompt.test.mjs`

- [ ] **Step 1: 写 TTY、回显、恢复 raw mode 和长度红灯测试**

用 `EventEmitter` 构造 fake TTY，覆盖：

```js
test('hidden prompts never echo secret bytes and always restore raw mode', async () => {
  const input = fakeTty();
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'Cloudflare API Token', hidden: true });
  input.emit('data', Buffer.from('secret-sentinel\r'));
  const value = await pending;
  assert.equal(value.toString('utf8'), 'secret-sentinel');
  assert.equal(output.text.includes('secret-sentinel'), false);
  assert.deepEqual(input.rawTransitions, [true, false]);
});

test('visible email supports backspace but rejects controls, overflow and non-TTY', async () => {
  const input = fakeTty();
  const output = fakeOutput();
  const pending = readTtyLine({ input, output, label: 'user-1 email', hidden: false });
  input.emit('data', Buffer.from('owner@examplx\x7fe.com\r'));
  const value = await pending;
  assert.equal(value.toString('utf8'), 'owner@example.com');
  assert.deepEqual(input.rawTransitions, [true, false]);

  for (const chunk of [
    Buffer.from([0x03]),
    Buffer.from([0x80]),
    Buffer.alloc(4097, 0x61),
  ]) {
    const rejectedInput = fakeTty();
    const rejected = readTtyLine({
      input: rejectedInput,
      output: fakeOutput(),
      label: 'user-1 email',
      hidden: false,
    });
    rejectedInput.emit('data', chunk);
    await assert.rejects(rejected, /Text preview setup failed/);
    assert.deepEqual(rejectedInput.rawTransitions, [true, false]);
  }

  const nonTty = fakeTty();
  nonTty.isTTY = false;
  await assert.rejects(
    readTtyLine({ input: nonTty, output: fakeOutput(), label: 'user-1 email', hidden: false }),
    /Text preview setup failed/,
  );
});
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/text-ai-preview-setup-prompt.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现单一 raw-mode line reader 和四项 prompt**

```js
const FAILURE = 'Text preview setup failed';
const PROMPT_LABELS = new Set([
  'Cloudflare API Token',
  'ARK_API_KEY',
  'user-1 email',
  'user-2 email',
  'Continue? [y/N]',
]);
function fail() { throw new Error(FAILURE); }

export async function readTtyLine({ input, output, label, hidden, maxBytes = 4096 }) {
  if (
    input?.isTTY !== true
    || output?.isTTY !== true
    || typeof input.setRawMode !== 'function'
    || typeof input.on !== 'function'
    || typeof input.once !== 'function'
    || typeof input.off !== 'function'
    || typeof input.resume !== 'function'
    || typeof input.pause !== 'function'
    || typeof output.write !== 'function'
    || !PROMPT_LABELS.has(label)
    || typeof hidden !== 'boolean'
    || !Number.isInteger(maxBytes)
    || maxBytes < 1
    || maxBytes > 4096
  ) fail();
  output.write(`${label}: `);
  const bytes = [];
  const wasRaw = input.isRaw === true;
  try {
    input.setRawMode(true);
    input.resume();
    return await new Promise((resolve, reject) => {
      const finish = (error, value) => {
        input.off('data', onData);
        input.off('error', onError);
        input.off('end', onEnd);
        if (error) reject(error); else resolve(value);
      };
      const onError = () => finish(new Error(FAILURE));
      const onEnd = () => finish(new Error(FAILURE));
      const onData = (chunk) => {
        if (!Buffer.isBuffer(chunk)) return finish(new Error(FAILURE));
        for (const byte of chunk) {
          if (byte === 0x03) return finish(new Error(FAILURE));
          if (byte === 0x0d || byte === 0x0a) {
            output.write('\n');
            return finish(undefined, Buffer.from(bytes));
          }
          if (byte === 0x08 || byte === 0x7f) {
            if (bytes.length > 0) bytes.pop();
            if (!hidden) output.write('\b \b');
            continue;
          }
          if (byte < 0x20 || byte > 0x7e || bytes.length >= maxBytes) {
            return finish(new Error(FAILURE));
          }
          bytes.push(byte);
          if (!hidden) output.write(Buffer.from([byte]));
        }
      };
      input.on('data', onData);
      input.once('error', onError);
      input.once('end', onEnd);
    });
  } finally {
    bytes.fill(0);
    input.setRawMode(wasRaw);
    input.pause();
  }
}

export async function promptSetupInputs(input, output) {
  const buffers = [];
  try {
    for (const [label, hidden] of [
      ['Cloudflare API Token', true],
      ['ARK_API_KEY', true],
      ['user-1 email', false],
      ['user-2 email', false],
    ]) buffers.push(await readTtyLine({ input, output, label, hidden }));
    return Object.freeze({
      cloudflareApiToken: buffers[0].toString('utf8'),
      arkApiKey: buffers[1].toString('utf8'),
      user1Email: buffers[2].toString('utf8'),
      user2Email: buffers[3].toString('utf8'),
    });
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}

export async function confirmSetup(input, output) {
  const answer = await readTtyLine({ input, output, label: 'Continue? [y/N]', hidden: false, maxBytes: 1 });
  try { return answer.toString('utf8') === 'y'; }
  finally { answer.fill(0); }
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

```bash
node --test scripts/text-ai-preview-setup-prompt.test.mjs
```

Expected: PASS，fake output 不含任何 secret sentinel。

- [ ] **Step 5: 提交**

```bash
git add scripts/text-ai-preview-setup-prompt.mjs scripts/text-ai-preview-setup-prompt.test.mjs
git commit -m "feat: add hidden setup prompts [skip ci]"
```

### Task 5: 实现固定 GitHub adapter 与关闭态 preflight 绑定

**Files:**
- Create: `scripts/text-ai-preview-setup-github.mjs`
- Create: `scripts/text-ai-preview-setup-github.test.mjs`

- [ ] **Step 1: 写命令 allowlist、stdin 和 run 绑定红灯测试**

Fake runner 的签名固定为 `(command, args, options) → { code, stdout, stderr }`。测试必须断言：

```js
test('writes values only through stdin with fixed repo and environment argv', async () => {
  const runner = fakeRunner();
  const github = createGitHubSetupClient(runner);
  const sentinel = Buffer.from('secret-sentinel');
  await github.setSecret('ARK_API_KEY', sentinel);
  assert.deepEqual(runner.calls[0], {
    command: 'gh',
    args: ['secret', 'set', 'ARK_API_KEY', '--env', 'text-ai-preview', '--repo', 'nuts-and-bytes/tiezheng'],
    input: Buffer.from('secret-sentinel'),
  });
  assert.equal(runner.calls[0].args.join(' ').includes('secret-sentinel'), false);
  assert.ok(sentinel.every((byte) => byte === 0));
});

test('read-only inspection requires clean protected main and empty setup targets', async () => {
  const runner = validInspectionRunner();
  const github = createGitHubSetupClient(runner);
  assert.deepEqual(await github.inspectFirstRun(), {
    accountId: 'a'.repeat(32),
    expectedSha: 'b'.repeat(40),
  });
  assert.equal(runner.calls.every(({ args }) => !['set', 'delete', 'run'].includes(args[1])), true);
});

test('dispatches exact preflight SHA and accepts one canonical false log line', async () => {
  const runner = validPreflightRunner();
  const github = createGitHubSetupClient(runner);
  await assert.doesNotReject(github.runDisabledPreflight('b'.repeat(40)));
  const dispatch = runner.calls.find(({ args }) => args[0] === 'workflow' && args[1] === 'run');
  assert.ok(dispatch.args.includes('expected_sha=' + 'b'.repeat(40)));
  assert.equal(runner.calls.some(({ args }) => args[0] === 'run' && args[1] === 'list' && args.includes('--limit') && args.includes('1')), false);
});
```

`validInspectionRunner()` 按 Step 4 的命令顺序返回：已登录、空 `git status --porcelain=v1`、`main`、本地/远端同一 40 位 SHA、Environment reviewer 数为 0、唯一 `main` deployment policy、secret 空集合、variable 精确 `['CLOUDFLARE_ACCOUNT_ID']`以及 32 位小写 account ID。`validPreflightRunner()` 按 Step 5 返回单次稳定 inventory 快照（长度小于 100，每条 status 精确为 `completed`）、唯一 canonical run URL、watch 成功、精确 metadata 与唯一 false JSON 日志行。Fake runner 记录 `input` 时必须 `Buffer.from(input)`，以便同时证明 stdin 内容正确且原 Buffer 已清零。

增加表驱动失败矩阵：工作树非空、分支非 `main`、本地/远端 SHA 不同、reviewer 非 0、branch policy 非唯一 `main`、目标 secret/variable 已存在、account ID 非 32 位小写十六进制、单次稳定 inventory 快照中任一活动或未知状态、长度达到 100、畸形 exact record、dispatch URL 为 0/2 个、SHA/job/step 漂移、false JSON 缺失/重复/额外 key/true。每个失败 case 断言固定错误、无后续写命令且无 sentinel 出现。源码 mutation 再锁定 `shell:true`、`--body`、`GH_TOKEN` env、`gh run list --limit 1`、遗漏 `expected_sha`、接受 `workerTextEnabled=true` 或用“最近一次 run”回退时必须失败。

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/text-ai-preview-setup-github.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 bounded subprocess runner**

```js
import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';

const MAX_OUTPUT = 262_144;
const ALLOWED_ENV = ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL'];

async function runBoundedCommand(command, args, { input, timeoutMs = 20_000 } = {}) {
  if (
    !['git', 'gh'].includes(command)
    || !Array.isArray(args)
    || args.length === 0
    || args.some((arg) => typeof arg !== 'string' || arg.length === 0 || arg.length > 4096 || /[\u0000-\u001f\u007f]/u.test(arg))
    || (input !== undefined && (!Buffer.isBuffer(input) || input.length === 0 || input.length > 4096))
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 300_000
  ) {
    throw new Error('Text preview setup failed');
  }
  const env = Object.fromEntries(ALLOWED_ENV
    .filter((name) => typeof process.env[name] === 'string')
    .map((name) => [name, process.env[name]]));
  env.NO_COLOR = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const failCommand = () => {
      child.kill('SIGKILL');
      finish(reject, new Error('Text preview setup failed'));
    };
    const timer = setTimeout(failCommand, timeoutMs);
    const collect = (target) => (chunk) => {
      if (!Buffer.isBuffer(chunk) || (bytes += chunk.length) > MAX_OUTPUT) {
        failCommand();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.stdin.on('error', failCommand);
    child.once('error', failCommand);
    child.once('close', (code) => {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        finish(resolve, Object.freeze({
          code,
          stdout: decoder.decode(Buffer.concat(stdout)),
          stderr: decoder.decode(Buffer.concat(stderr)),
        }));
      } catch { failCommand(); }
    });
    try {
      if (input === undefined) child.stdin.end();
      else child.stdin.end(input);
    } catch { failCommand(); }
  });
}
```

所有 public adapter 方法把原始 stderr/stdout 解析后丢弃；异常只抛 `Text preview setup failed`。普通命令使用 20 秒，唯一 `gh run watch` 显式使用 300 秒。`setSecret`/`setVariable` 在 runner settle 后的 `finally` 清零传入 Buffer。

- [ ] **Step 4: 实现 read-only inspect、写入、补偿与核验**

`createGitHubSetupClient` 暴露且只暴露：

```js
Object.freeze({
  inspectFirstRun,
  setSecret,
  setVariable,
  deleteSecret,
  deleteVariable,
  verifyNames,
  runDisabledPreflight,
});
```

固定命令：

```js
await run('gh', ['auth', 'status', '--hostname', 'github.com']);
await run('git', ['status', '--porcelain=v1']);
await run('git', ['branch', '--show-current']);
await run('git', ['remote', 'get-url', '--push', 'origin']);
await run('git', ['rev-parse', 'HEAD']);
await run('gh', ['api', 'repos/nuts-and-bytes/tiezheng/git/ref/heads/main', '--jq', '.object.sha']);
await run('gh', ['api', 'repos/nuts-and-bytes/tiezheng/environments/text-ai-preview']);
await run('gh', ['api', '--paginate', '--slurp', 'repos/nuts-and-bytes/tiezheng/environments/text-ai-preview/deployment-branch-policies']);
await run('gh', ['secret', 'list', '--repo', SETUP_POLICY.repo, '--env', SETUP_POLICY.environment, '--json', 'name']);
await run('gh', ['variable', 'list', '--repo', SETUP_POLICY.repo, '--env', SETUP_POLICY.environment, '--json', 'name']);
await run('gh', ['variable', 'get', 'CLOUDFLARE_ACCOUNT_ID', '--repo', SETUP_POLICY.repo, '--env', SETUP_POLICY.environment]);
```

本地 `origin` 只接受 `https://github.com/nuts-and-bytes/tiezheng.git` 或 `git@github.com:nuts-and-bytes/tiezheng.git`。Environment 元数据要求 required reviewer 数为 0；分页结果展平后 branch policy 只能有唯一 `main`。首次 inspect 只接受 secret 空集合和 variable 精确 `['CLOUDFLARE_ACCOUNT_ID']`。写入方法使用 `gh secret set` / `gh variable set` 的 stdin；补偿只使用精确名称的 `gh secret delete` / `gh variable delete`。

- [ ] **Step 5: 实现 exact run URL/job/step/log 核验**

`runDisabledPreflight(expectedSha)` 必须：

1. 只执行一次 `gh run list --workflow text-ai-preview.yml --event workflow_dispatch --limit 100 --json databaseId,status --repo nuts-and-bytes/tiezheng`，得到单次稳定 inventory 快照。要求普通稠密数组且长度小于 100，每条只有 `databaseId` 和 `status` 两个 key，`databaseId` 是正安全整数，并且每条 status 精确为 `completed`。长度达到 100、任何活动或未知状态、稀疏数组或畸形 record 都 fail closed；
2. 执行：

```js
['workflow', 'run', 'text-ai-preview.yml', '--ref', 'main', '--repo', SETUP_POLICY.repo,
 '-f', 'operation=preflight', '-f', 'target=user-1',
 '-f', `expected_sha=${expectedSha}`, '-f', 'confirmation=']
```

3. 从本次 stdout 提取唯一 `https://github.com/nuts-and-bytes/tiezheng/actions/runs/<digits>`；无 URL 或多 URL 均停止，绝不 `gh run list --limit 1` 回补；
4. 以 300 秒 timeout watch 精确 run ID；随后执行 `gh run view <run-id> --repo nuts-and-bytes/tiezheng --json event,headBranch,headSha,status,conclusion,workflowName,jobs`，要求 `workflow_dispatch/main/<expectedSha>/completed/success`、workflow name 精确 `Text AI Preview Control`、唯一 `text-ai-preview` job success、唯一 `Dispatch fixed operation` step success；
5. 从 metadata 取得该唯一 job 的纯数字 `databaseId`，执行 `gh run view <run-id> --repo nuts-and-bytes/tiezheng --job <job-id> --log`。逐行以 tab 分割，只接受 step 名精确 `Dispatch fixed operation` 且最后一列精确为 `{"command":"preflight","status":"ready","workerTextEnabled":false}` 的唯一行；true、缺失、重复、额外 key 或来自其他 step 均 BLOCKED。

- [ ] **Step 6: 运行 GitHub adapter 测试**

```bash
node --test scripts/text-ai-preview-setup-github.test.mjs
```

Expected: PASS；fake runner 证明没有真实 `gh`/`git` 调用。

- [ ] **Step 7: 提交**

```bash
git add scripts/text-ai-preview-setup-github.mjs scripts/text-ai-preview-setup-github.test.mjs
git commit -m "feat: add bounded GitHub setup adapter [skip ci]"
```

### Task 6: 编排状态机、失败补偿和固定输出

**Files:**
- Create: `scripts/text-ai-preview-setup.mjs`
- Create: `scripts/text-ai-preview-setup.test.mjs`

- [ ] **Step 1: 写成功路径和逐边界失败矩阵 RED**

依赖对象固定为：

```js
{
  github,
  promptInputs,
  confirm,
  createCloudflareClient,
  inspectCloudflare,
  createServiceToken,
  deleteServiceToken,
  generateKeys,
  stdout,
  stderr,
}
```

测试必须注入每个边界失败并断言：

```js
test('success writes nine plus one, verifies names, runs one false preflight', async () => {
  const fake = setupDependencies();
  const code = await runTextPreviewSetup(fake.dependencies);
  assert.equal(code, 0);
  assert.deepEqual(fake.events, [
    'github.inspect', 'prompt', 'cloudflare.inspect', 'keys.generate', 'confirm',
    'cloudflare.create',
    ...SETUP_POLICY.secretNames.map((name) => `github.secret:${name}`),
    'github.variable:TEXT_AI_TEAM_DOMAIN',
    'github.verify-names', 'github.preflight',
  ]);
  assert.equal(fake.stdout.text, 'SETUP COMPLETE\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\n');
  assert.equal(fake.stderr.text, '');
});

test('partial write compensates every attempted name then the service token', async () => {
  const ordered = [
    ...SETUP_POLICY.secretNames.map((name) => `github.secret:${name}`),
    'github.variable:TEXT_AI_TEAM_DOMAIN',
  ];
  for (let failWriteAt = 0; failWriteAt < ordered.length; failWriteAt += 1) {
    const fake = setupDependencies({ failWriteAt });
    assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
    assert.deepEqual(fake.deleted, [
      ...ordered.slice(0, failWriteAt + 1).reverse(),
      'cloudflare.service-token',
    ]);
    assert.equal(fake.events.includes('github.verify-names'), false);
    assert.equal(fake.events.includes('github.preflight'), false);
    assert.equal(fake.stderr.text, 'SETUP FAILED\n');
  }
});

test('preflight failure preserves complete credentials and reports blocked', async () => {
  const fake = setupDependencies({ failAt: 'preflight' });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.deleted, []);
  assert.equal(fake.stderr.text, 'SETUP BLOCKED preflight\n');
});

test('missing token permissions print only fixed official names and perform no writes', async () => {
  const fake = setupDependencies({
    missingPermissions: ['Access: Service Tokens Write'],
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.deepEqual(fake.events, ['github.inspect', 'prompt', 'cloudflare.inspect']);
  assert.deepEqual(fake.deleted, []);
  assert.equal(
    fake.stderr.text,
    'SETUP FAILED missing_permissions=Access: Service Tokens Write\n',
  );
});

test('compensation failure reports only resource names, never values or IDs', async () => {
  const sentinels = ['cf-token-sentinel', 'ark-key-sentinel', 'service-secret-sentinel', 'created-token-id'];
  const fake = setupDependencies({
    failWriteAt: 0,
    failDeleteResources: new Set([
      'github.secret:CLOUDFLARE_API_TOKEN',
      'cloudflare.service-token',
    ]),
    thrownValues: sentinels,
  });
  assert.equal(await runTextPreviewSetup(fake.dependencies), 1);
  assert.equal(
    fake.stderr.text,
    'SETUP BLOCKED cleanup=github.secret:CLOUDFLARE_API_TOKEN,cloudflare.service-token\n',
  );
  for (const sentinel of sentinels) {
    assert.equal((fake.stdout.text + fake.stderr.text).includes(sentinel), false);
  }
});
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/text-ai-preview-setup.test.mjs
```

Expected: FAIL，`runTextPreviewSetup` 不存在。

- [ ] **Step 3: 实现单向阶段状态机**

核心控制流必须保持如下顺序：

```js
import { TEXT_PREVIEW_SETUP_PERMISSION_NAMES } from './text-ai-preview-control.mjs';

function renderMissingPermissions(value) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || new Set(value).size !== value.length
    || value.some((name) => !TEXT_PREVIEW_SETUP_PERMISSION_NAMES.includes(name))
  ) {
    throw new Error('Text preview setup failed');
  }
  const ordered = TEXT_PREVIEW_SETUP_PERMISSION_NAMES.filter((name) => value.includes(name));
  return `SETUP FAILED missing_permissions=${ordered.join(',')}\n`;
}

export async function runTextPreviewSetup(dependencies) {
  const attempted = { serviceTokenId: null, secrets: [], variables: [] };
  let keys;
  let writes;
  let phase = 'read-only-checks';
  try {
    const githubState = await dependencies.github.inspectFirstRun();
    phase = 'collect';
    const inputs = parseSetupInputs(await dependencies.promptInputs());
    phase = 'validate';
    const cloudflare = dependencies.createCloudflareClient({
      accountId: githubState.accountId,
      apiToken: inputs.cloudflareApiToken,
    });
    const cloudflareState = await dependencies.inspectCloudflare(
      githubState.accountId,
      cloudflare,
    );
    if (cloudflareState.status === 'missing-permissions') {
      dependencies.stderr.write(renderMissingPermissions(cloudflareState.missingPermissions));
      return 1;
    }
    if (cloudflareState.status !== 'ready') throw new Error('Text preview setup failed');
    keys = dependencies.generateKeys();
    dependencies.stdout.write(renderSetupPreview());
    phase = 'confirm';
    if (await dependencies.confirm() !== true) {
      dependencies.stderr.write('SETUP CANCELLED\n');
      return 1;
    }

    phase = 'create-token';
    const credential = await dependencies.createServiceToken(cloudflare);
    attempted.serviceTokenId = credential.id;
    writes = assembleSetupWrites({
      inputs,
      teamDomain: cloudflareState.teamDomain,
      serviceClientId: credential.clientId,
      serviceClientSecret: credential.clientSecret,
      keys,
    });

    phase = 'write-github';
    for (const item of writes.secrets) {
      attempted.secrets.push(item.name);
      await dependencies.github.setSecret(item.name, item.value);
    }
    for (const item of writes.variables) {
      attempted.variables.push(item.name);
      await dependencies.github.setVariable(item.name, item.value);
    }
    phase = 'verify-names';
    await dependencies.github.verifyNames();

    phase = 'preflight';
    await dependencies.github.runDisabledPreflight(githubState.expectedSha);
    phase = 'report';
    dependencies.stdout.write('SETUP COMPLETE\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\n');
    phase = 'complete';
    return 0;
  } catch (error) {
    if (
      phase === 'create-token'
      && error instanceof Error
      && error.message === 'Text preview setup blocked: cloudflare.service-token'
    ) {
      dependencies.stderr.write('SETUP BLOCKED cleanup=cloudflare.service-token\n');
      return 1;
    }
    if (phase === 'preflight' || phase === 'report') {
      dependencies.stderr.write(phase === 'preflight'
        ? 'SETUP BLOCKED preflight\n'
        : 'SETUP BLOCKED output\n');
      return 1;
    }
    const blocked = await compensateAttemptedResources(attempted, dependencies);
    dependencies.stderr.write(blocked.length === 0
      ? 'SETUP FAILED\n'
      : `SETUP BLOCKED cleanup=${blocked.join(',')}\n`);
    return 1;
  } finally {
    if (writes !== undefined) wipeSetupWrites(writes);
    if (Buffer.isBuffer(keys?.aesKey)) keys.aesKey.fill(0);
    if (Buffer.isBuffer(keys?.hmacKey)) keys.hmacKey.fill(0);
  }
}
```

`compensateAttemptedResources` 必须按 variables 逆序、secrets 逆序、service token 最后执行；每个名称在调用 set 之前就记录，因为 CLI 失败时远端效果可能已发生。这些名称在首次 inspect 时均已证明不存在，因此删除尝试不会触碰旧值。每个 delete 都继续尝试，最终只返回失败的固定资源名称。它不得接受或打印值、Cloudflare token ID 或原始异常。

- [ ] **Step 4: 实现 CLI main guard 与真实依赖组装**

```js
export async function runTextPreviewSetupCli(argv, io = process, overrides = {}) {
  if (!Array.isArray(argv) || argv.length !== 0 || io.stdin?.isTTY !== true || io.stdout?.isTTY !== true) {
    io.stderr.write('SETUP FAILED\n');
    return 1;
  }
  return runTextPreviewSetup(createRealDependencies(io, overrides));
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runTextPreviewSetupCli(process.argv.slice(2));
}
```

Import 模块时必须零副作用；测试用 dependency injection，不能 mock 全局网络或启动真实 `gh`。

- [ ] **Step 5: 跑 orchestrator、prompt、Cloudflare、GitHub 全部 setup tests**

```bash
node --test scripts/text-ai-preview-setup*.test.mjs
```

Expected: 所有 setup tests PASS，0 failures。

- [ ] **Step 6: 提交**

```bash
git add scripts/text-ai-preview-setup.mjs scripts/text-ai-preview-setup.test.mjs
git commit -m "feat: orchestrate safe text preview setup [skip ci]"
```

### Task 7: 静态锁定向导不可部署、启用、调用模型或泄漏 secret

**Files:**
- Create: `scripts/verify-text-ai-preview-setup.mjs`
- Create: `scripts/verify-text-ai-preview-setup.test.mjs`
- Modify: `package.json:6-21`

- [ ] **Step 1: 写 verifier mutation RED**

```js
test('accepts only the fixed setup modules and returns the redacted contract', () => {
  assert.deepEqual(verifyTextPreviewSetup(readSources()), {
    fourInputs: true,
    stdinOnlySecrets: true,
    firstRunOnly: true,
    deploymentDisabled: true,
    modelCalls: 0,
  });
});

for (const mutation of [
  ['shell: false', 'shell: true'],
  ["['secret', 'set'", "['secret', 'set', '--body'"],
  ["duration: SETUP_POLICY.serviceTokenDuration", "duration: 'forever'"],
  ['operation=preflight', 'operation=deploy-disabled'],
  ["target=user-1", "target=user-2"],
  ['workerTextEnabled":false', 'workerTextEnabled":true'],
]) {
  assert.throws(() => verifyTextPreviewSetup(mutatedSources(...mutation)), /Setup policy failed/);
}
```

另加插入型 mutation：`wrangler deploy`、`pages deploy`、`enable-admin-preview`、`enable-account`、`/api/nutrition/text/estimate`、`console.log(secret)`、`process.env.ARK_API_KEY`、`writeFile`、`createWriteStream`、`exec(`、`eval(`、`curl`、`wget` 都必须失败。

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/verify-text-ai-preview-setup.test.mjs
```

Expected: FAIL，verifier 不存在。

- [ ] **Step 3: 实现精确文件清单、命令族和禁止项 verifier**

Verifier 必须：

```js
const EXPECTED_FILES = Object.freeze([
  'scripts/text-ai-preview-setup-values.mjs',
  'scripts/text-ai-preview-setup-prompt.mjs',
  'scripts/text-ai-preview-setup-cloudflare.mjs',
  'scripts/text-ai-preview-setup-github.mjs',
  'scripts/text-ai-preview-setup.mjs',
]);

const FORBIDDEN = /wrangler\s+(?:deploy|pages)|deploy-disabled|enable-admin-preview|enable-account|\/api\/nutrition\/text\/(?:session|estimate)|shell:\s*true|--body|\b(?:eval|exec|curl|wget)\b|\b(?:writeFile|createWriteStream)\b|process\.env\.(?:ARK_API_KEY|CLOUDFLARE_API_TOKEN)|console\.(?:log|dir|table)/u;
```

它还要精确计数四项 prompt、9 个 secret 名、2 个 variable 名、唯一 service token name、`8760h`、`shell:false`、`operation=preflight`、`expected_sha` 和固定成功/BLOCKED 输出。任何未知 setup source、额外 executable family 或 digest 漂移失败。

CLI 输出：

```json
{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}
```

- [ ] **Step 4: 增加 package scripts**

```json
"setup:text-preview": "node scripts/text-ai-preview-setup.mjs",
"test:text-preview-setup": "node --test scripts/text-ai-preview-setup*.test.mjs scripts/verify-text-ai-preview-setup.test.mjs",
"verify:text-preview-setup": "node scripts/verify-text-ai-preview-setup.mjs"
```

把 setup tests 加入 `test:text-preview-control`，使控制面总门禁无法漏跑新向导。

- [ ] **Step 5: 运行 mutation tests 与 verifier**

```bash
npm run test:text-preview-setup
npm run verify:text-preview-setup
npm run test:text-preview-control
```

Expected: 三条命令 exit 0；verifier 输出上面的单行 JSON。

- [ ] **Step 6: 提交**

```bash
git add package.json scripts/verify-text-ai-preview-setup.mjs scripts/verify-text-ai-preview-setup.test.mjs
git commit -m "test: lock text preview setup policy [skip ci]"
```

### Task 8: 更新 runbook、checklist 和 release plan

**Files:**
- Modify: `docs/operations/text-ai-preview-runbook.md:38-105, 129-242`
- Modify: `docs/operations/text-ai-preview-release-checklist.md:13-55`
- Modify: `docs/superpowers/plans/2026-08-24-tiezheng-text-ai-preview-release.md:1245-1280`
- Modify: `scripts/verify-text-ai-preview-setup.test.mjs`

- [ ] **Step 1: 先写文档合同 RED**

在 verifier test 读取三份文档并要求：

```js
for (const required of [
  'npm run setup:text-preview',
  '本地 TTY 隐藏输入',
  '单个 `gh` 子进程 stdin',
  '禁止 `--body`',
  '首次运行不覆盖任何已有 secret 或 variable',
  '不会部署、不会启用、不会调用模型',
  'SETUP BLOCKED preflight',
]) assert.ok(runbook.includes(required) || checklist.includes(required) || plan.includes(required));

assert.equal(plan.includes('用户直接输入 9 个 Environment secrets'), false);
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test scripts/verify-text-ai-preview-setup.test.mjs
```

Expected: FAIL，旧文档仍要求 GitHub UI 逐项填 9 个 secrets。

- [ ] **Step 3: 更新运维边界**

文档必须明确：

1. 唯一放行的 CLI secret 路径是 `npm run setup:text-preview` 的真实 TTY 隐藏输入/进程内生成 → `shell:false` 单项 stdin → 固定 repo/environment；
2. 聊天、argv、shell history、`--body`、环境变量、文件、workflow input 和日志仍禁止；
3. 首次运行前 9 个 secret 和 `TEXT_AI_TEAM_DOMAIN` 必须不存在，`CLOUDFLARE_ACCOUNT_ID` 必须已存在；
4. 向导只创建固定一年 service token，写入 9+1，随后 preflight；不运行 `deploy-disabled` 或 enable；
5. partial-write 补偿与 preflight-failure 保留策略和设计一致；
6. evidence 只记 commit、名称、布尔结果和固定状态。

- [ ] **Step 4: 跑文档合同、diff check**

```bash
npm run test:text-preview-setup
git diff --check
```

Expected: PASS，无空白错误。

- [ ] **Step 5: 提交**

```bash
git add docs/operations/text-ai-preview-runbook.md docs/operations/text-ai-preview-release-checklist.md docs/superpowers/plans/2026-08-24-tiezheng-text-ai-preview-release.md scripts/verify-text-ai-preview-setup.test.mjs
git commit -m "docs: simplify text preview first setup [skip ci]"
```

### Task 9: 全量本地验证、泄漏扫描和独立审查

**Files:**
- Verify only: all files changed in Tasks 1–8

- [ ] **Step 1: 运行 setup 和控制面门禁**

```bash
npm run test:text-preview-setup
npm run verify:text-preview-setup
npm run test:text-preview-control
npm run verify:text-preview-workflow
```

Expected: 全部 exit 0；两个 verifier 各输出唯一脱敏 JSON。

- [ ] **Step 2: 运行全量 Node、类型、Edge 和 build**

```bash
npm test
npm run typecheck
npm run typecheck:edge
npm run test:edge
VITE_ENABLE_TEXT_AI=true VITE_ENABLE_PHOTO_AI=false npm run build
npm run deploy:photo-worker -- --dry-run
```

Expected: 所有测试 0 failures；typecheck/build exit 0；Wrangler 明确 `--dry-run: exiting now`，不得登录或部署。

- [ ] **Step 3: 做静态 secret/危险命令扫描**

```bash
rg -n "shell:\s*true|--body|process\.env\.(ARK_API_KEY|CLOUDFLARE_API_TOKEN)|wrangler deploy|pages deploy|enable-admin-preview|enable-account|/api/nutrition/text/(session|estimate)|console\.(log|dir|table)|writeFile|createWriteStream|\beval\b|\bexec\b|\bcurl\b|\bwget\b" scripts/text-ai-preview-setup*.mjs scripts/verify-text-ai-preview-setup.mjs
git diff --check
git status --short
```

Expected: `rg` 只命中 verifier/test 中用于拒绝的字符串；工作树只有预期文件或干净。

- [ ] **Step 4: 请求独立 code review**

使用 `superpowers:requesting-code-review`，审查基线为本计划开始前 commit，重点检查：TTY 恢复、子进程 env/argv/stdin、Cloudflare token scope、一次性 client secret、部分补偿、preflight 保留、无 latest-run race、无部署/enable/model 路径。

Expected: Critical 0 / Important 0；Minor 必须在收尾前处理或明确接受。

- [ ] **Step 5: 完成验证并提交收尾修正**

若审查产生修正，先写/更新 RED test，再实现并重跑 Steps 1–3。最后：

```bash
git add scripts/text-ai-preview-control.mjs scripts/text-ai-preview-control.test.mjs scripts/text-ai-preview-setup-values.mjs scripts/text-ai-preview-setup-values.test.mjs scripts/text-ai-preview-setup-prompt.mjs scripts/text-ai-preview-setup-prompt.test.mjs scripts/text-ai-preview-setup-cloudflare.mjs scripts/text-ai-preview-setup-cloudflare.test.mjs scripts/text-ai-preview-setup-github.mjs scripts/text-ai-preview-setup-github.test.mjs scripts/text-ai-preview-setup.mjs scripts/text-ai-preview-setup.test.mjs scripts/verify-text-ai-preview-setup.mjs scripts/verify-text-ai-preview-setup.test.mjs package.json docs/operations/text-ai-preview-runbook.md docs/operations/text-ai-preview-release-checklist.md docs/superpowers/plans/2026-08-24-tiezheng-text-ai-preview-release.md
git diff --cached --check
git commit -m "fix: finalize text preview setup wizard [skip ci]"
```

若没有新差异，不创建空 commit。

### Task 10: 真实首次配置执行门禁（不属于本地完成声明）

**Files:**
- Remote: GitHub Environment `text-ai-preview`
- Remote: Cloudflare Access service token inventory
- Evidence update: `docs/operations/text-ai-preview-release-checklist.md`（只记录脱敏状态；需单独 commit）

- [ ] **Step 1: 分支收尾和 main 发布决策**

使用 `superpowers:finishing-a-development-branch`。只有全量验证、独立 review 和用户明确授权后，才把实现 fast-forward/merge 到 `main` 并以 `[skip ci]` 推送；推送后核对 remote SHA 和该 SHA 的 Actions run 集合为空。

- [ ] **Step 2: 核对 Cloudflare token 准备要求**

用户在 Cloudflare Dashboard 准备 token；资源只选精确 account，权限为：

```text
Account API Tokens Read
Workers Scripts Edit
Cloudflare Pages Edit
Access: Apps and Policies Edit
Access: Organizations, Identity Providers, and Groups Read
Access: Service Tokens Read
Access: Service Tokens Write
```

不在聊天中粘贴 token。若现有 token 缺权限，用户在 Dashboard 修改/新建后只在 TTY 中使用。

- [ ] **Step 3: 用户运行唯一命令并输入四项**

```bash
npm run setup:text-preview
```

用户依次输入 Cloudflare token、ARK key、user-1 邮箱、user-2 邮箱，查看无值预览后输入 `y`。Codex 不代填、不读取、不复述四个值。

Expected:

```text
SETUP COMPLETE
secrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false
```

任何 `SETUP FAILED` 或 `SETUP BLOCKED` 都立即停止，不运行部署或 enable。

- [ ] **Step 4: 只读远端复核**

只核对：reviewer=0、唯一 branch policy=`main`、secret 名称精确 9 个、variable 名称精确 2 个、固定 service token 名称唯一、exact preflight run/SHA/job/step success、Worker text=false 且 photo=false。不得读取或输出值。

- [ ] **Step 5: 更新脱敏 checklist 并回到原 Task 11**

记录向导 commit SHA、执行时间、名称集合 PASS、preflight run ID 与布尔结果；commit message：

```bash
git add docs/operations/text-ai-preview-release-checklist.md
git diff --cached --check
git commit -m "docs: record text preview setup evidence [skip ci]"
```

此时只能声称“首次配置完成且关闭态通过”。下一步仍是原 runbook 的 `deploy-disabled`，再到 user-1 唯一真实模型调用；不能直接声称 AI 已可用。
