# 铁证文字 AI 双访问码认证设计

日期：2026-08-27
状态：用户已确认设计，待实施计划

## 1. 背景

文字餐食 AI Preview 已具备 Pages Functions、私有 Worker、方舟模型适配、双账号额度、预算熔断和受保护运维工作流，但用户身份与机器管理身份都依赖 Cloudflare Zero Trust Access。Cloudflare 当前要求 Zero Trust Free onboarding 也填写付款信息，这不符合本次“不绑定银行卡、尽快让两个人可用”的约束。

本设计只替换文字 AI Preview 的身份边界。现有静态应用、Cloudflare Pages、Pages-to-Worker Service Binding、模型调用、双账号额度、缓存、预算熔断和本地确认入账流程继续保留。

## 2. 已确认决策

1. 首批只开放两个账号：`user-1` 与 `user-2`。
2. 每个账号使用一个独立的高强度访问码，不发送邮箱验证码。
3. 访问码验证成功后，服务端签发有效期 30 天的会话 JWT，并只通过安全的 `HttpOnly` Cookie 交付。
4. 账号继续拥有独立额度、启停状态和删除边界。
5. 不开通 Cloudflare Zero Trust，不创建 Access Application、OTP provider 或 Access Service Token。
6. GitHub 管理调用使用独立请求签名密钥，不复用用户访问码、会话密钥、Cloudflare API token 或模型密钥。
7. 本次只改变文字 AI Preview；照片 AI 的既有 Access 契约不放宽、不迁移，也不启用。

## 3. 目标与非目标

### 3.1 目标

- 两名已知测试用户无需 Cloudflare 登录即可分别进入文字 AI。
- 用户只需首次输入访问码；正常情况下 30 天内无需重复登录。
- 访问码、JWT、管理签名密钥和 `ARK_API_KEY` 不进入前端构建、仓库、命令参数、日志或发布证据。
- 任一账号可以单独停用、轮换访问码或删除运行状态，不影响另一账号。
- 保留当前同源检查、请求大小限制、原子额度、幂等、预算熔断和服务关闭开关。
- 首次配置与部署不要求 Zero Trust 付款资料。

### 3.2 非目标

- 不提供公开注册、邮箱验证、找回密码、社交登录或账号自助管理。
- 不建设通用用户数据库，也不把两个逻辑槽位扩展成动态用户目录。
- 不开放照片识别、生产 AI 开关或无限额度。
- 不改变模型、提示词、营养估算契约或本地饮食数据结构。
- 不承诺其他 Cloudflare 产品永远不要求付款方式；若现有免费资源之外出现付费前置条件，流程必须停止并再次取得用户授权。

## 4. 总体架构

```text
浏览器
  -> Pages 静态应用
  -> POST /api/nutrition/text/login
       -> 同源与请求边界校验
       -> 登录尝试限流
       -> 访问码摘要比对
       -> 签发 HttpOnly 会话 Cookie
  -> GET  /api/nutrition/text/session
  -> POST /api/nutrition/text/estimate
       -> 会话 JWT 校验
       -> user slot 派生 account key
       -> Pages Service Binding
       -> 私有 AI Worker / Durable Object / 方舟模型

GitHub Actions
  -> HMAC 签名的固定管理请求
  -> POST /api/nutrition/text-admin/account
  -> 私有 Worker 管理路由
```

Cloudflare Pages 仍是网站和同源 API 入口，私有 Worker 仍持有模型能力。Cloudflare API token 只用于部署及必要的资源配置；用户认证和机器管理认证都不再依赖 Zero Trust。

## 5. 组件边界

### 5.1 文字用户认证模块

新增独立的 text-auth 模块，负责：

- 严格解析双账号认证配置；
- 对输入访问码计算 HMAC-SHA-256 摘要；
- 使用恒定时间比较与两个配置摘要匹配；
- 生成和验证固定算法、issuer、audience 与 claims 的 JWT；
- 从账号槽位和现有账号 HMAC 密钥派生 64 位 `accountKey`；
- 生成、解析和清除唯一的会话 Cookie。

该模块不得复用或削弱 `edge/photo-ai/access.ts`。照片 Access JWT 验证保持原样，文字路由不再读取 `Cf-Access-Jwt-Assertion`。

### 5.2 登录端点

新增：

`POST /api/nutrition/text/login`

请求必须满足：

- URL、Host 与配置的 Preview origin 精确一致；
- `Origin` 精确同源，`Sec-Fetch-Site` 为 `same-origin`；
- `Content-Type` 精确为 `application/json`；
- 无 query、fragment、content encoding 或 transfer encoding；
- 请求体是唯一字段 `{ "accessCode": string }`；
- UTF-8 请求体和访问码长度均有固定上限。

成功响应只返回固定 `{ "ok": true }`，同时设置会话 Cookie。失败统一返回 `401 auth-required`，不说明访问码属于哪个账号、是否格式正确或是否已停用。临时限流返回 `429 rate-limited` 和有上限的重试时间，不回显 IP、摘要或尝试次数。

### 5.3 会话 Cookie 与 JWT

Cookie 固定为 `__Host-tiezheng-text-ai-session`，属性为：

- `HttpOnly`；
- `Secure`；
- `SameSite=Strict`；
- `Path=/`；
- 不设置 `Domain`；
- `Max-Age=2592000`，即 30 天。

JWT 只允许 `HS256`，并严格验证：

- `iss = tiezheng-text-ai`；
- `aud = tiezheng-text-ai-user`；
- `sub` 只能是 `user-1` 或 `user-2`；
- `iat`、`exp` 为有限整数且有效期不超过 30 天；
- `cv` 为当前账号凭据版本。

`cv` 由当前访问码摘要确定性派生。访问码轮换会改变摘要和 `cv`，因此该账号的旧 JWT 无需维护服务器 session 表即可立即失效。JWT 不包含邮箱、访问码、账号键、额度、餐食或其他用户资料。

### 5.4 账号键与额度隔离

现有邮箱到账号键的映射改为逻辑槽位到账号键：

```text
accountKey = HMAC-SHA-256(PHOTO_AI_ACCOUNT_HMAC_KEY, "text-ai:user-1")
accountKey = HMAC-SHA-256(PHOTO_AI_ACCOUNT_HMAC_KEY, "text-ai:user-2")
```

Worker 和 Durable Object 继续只接收 64 位账号键，不接收访问码、JWT 或用户槽位。现有单账号启停、额度、幂等、预算与删除操作继续以账号键为边界。

### 5.5 登录尝试限流

Pages 只在内存中读取 `CF-Connecting-IP`，立即使用独立限流 HMAC 密钥派生不可逆 `attemptKey`，然后通过现有私有 Worker binding 调用 Durable Object 执行原子限流。原始 IP 不进入 Worker 请求、存储或日志。

每个 `attemptKey` 使用短窗口失败计数和临时冷却。成功登录清除该 key 的失败状态。具体阈值在实施计划中固定为测试常量，不能通过前端输入或公开环境变量动态放宽。缺失或异常平台 IP 时使用单独的匿名桶并采用更严格阈值，不能跳过限流。

### 5.6 管理身份

GitHub Actions 不再发送 Cloudflare Access Service Token。管理请求改为以下固定签名材料：

```text
version + method + canonical path + timestamp + operationId + SHA-256(body)
```

工作流使用 `TEXT_AI_ADMIN_SIGNING_KEY` 计算 HMAC-SHA-256。Pages 验证固定签名版本、时间窗口、operation ID、请求体摘要和签名，随后沿用 Worker 现有 operation fingerprint 与防重放逻辑。

管理 API 的目标从邮箱改为 `user-1` 或 `user-2`。工作流 input、命令、日志和证据都不接收邮箱或任意目标字符串。用户访问码、会话签名密钥和管理签名密钥相互独立。

## 6. 配置与密钥

文字 Preview 需要以下认证材料，均由交互式向导生成或接收：

| 名称 | 用途 | 保存位置 |
|---|---|---|
| `TEXT_AI_USER_1_ACCESS_CODE_PEPPER` | 计算 `user-1` 访问码摘要 | GitHub Environment secret、Pages secret |
| `TEXT_AI_USER_1_ACCESS_CODE_DIGEST` | `user-1` 当前访问码摘要 | GitHub Environment secret、Pages secret |
| `TEXT_AI_USER_2_ACCESS_CODE_PEPPER` | 计算 `user-2` 访问码摘要 | GitHub Environment secret、Pages secret |
| `TEXT_AI_USER_2_ACCESS_CODE_DIGEST` | `user-2` 当前访问码摘要 | GitHub Environment secret、Pages secret |
| `TEXT_AI_SESSION_SIGNING_KEY` | 签发和验证用户 JWT | GitHub Environment secret、Pages secret |
| `TEXT_AI_RATE_LIMIT_HMAC_KEY` | 将原始 IP 盲化为限流键 | GitHub Environment secret、Pages secret |
| `TEXT_AI_ADMIN_SIGNING_KEY` | GitHub 管理请求签名 | GitHub Environment secret、Pages secret |
| `PHOTO_AI_ACCOUNT_HMAC_KEY` | 从逻辑槽位派生账号键 | 沿用既有名称；缺失时由向导生成并写入受保护 secret |
| `ARK_API_KEY` | 方舟模型调用 | 沿用 Worker secret |

访问码由系统密码学随机源分别生成至少 192 bit 熵并编码为 URL-safe 字符串。每个账号使用独立 pepper，使单账号轮换可以同时替换该账号的 code、pepper 和 digest，而不需要读取或改变另一个账号的材料。明文只在真实本地 TTY 中显示一次；不得写入文件、shell history、argv、环境变量、聊天、GitHub、Cloudflare Dashboard 可读变量或日志，向导也不得主动写入系统剪贴板。向导只把 pepper 和摘要写入远端。

现有带 Access 权限的设置 token 在新方案验证前不用于部署。迁移时创建或改用只包含 Pages、Workers、Durable Object 及必要账号读取能力的窄权限 token；新 token 验证成功后撤销旧 token。不得为了绕过付款页面扩大 token 权限。

## 7. 用户流程

1. 用户在文字餐食估算入口输入自然语言描述。
2. 前端调用 session；若返回 `auth-required`，保留日期、餐次和描述草稿并显示访问码输入层。
3. 用户输入自己的访问码。前端仅在当前请求内持有该值，不写入 React 持久状态、IndexedDB、localStorage 或 sessionStorage。
4. 登录成功后关闭输入层并重试 session；不在 URL 或页面中显示 JWT。
5. 用户提交估算，既有网关执行额度、幂等、预算、模型和候选校验。
6. 用户确认或修改候选后才写入本地饮食数据。
7. 用户主动退出时，服务端返回过期的同名 Cookie；客户端清理认证意图但不删除本地饮食或训练记录。

## 8. 错误与恢复

- 缺失、错误、伪造、过期或旧版本 JWT：返回 `401 auth-required`，不调用 Worker 模型路由。
- 错误访问码：统一 `401 auth-required`，不签发 Cookie。
- 登录尝试过多：返回 `429 rate-limited`，不执行访问码比较或模型调用。
- 账号已停用：认证可以保持有效，但 session/estimate 继续按现有账号开关返回关闭状态；这样管理员可在不轮换访问码的情况下紧急停用。
- 访问码疑似泄露：原子轮换该槽位的访问码、pepper 和摘要，旧访问码和旧 JWT 同时失效，另一账号不受影响。
- 会话签名密钥疑似泄露：轮换签名密钥，两个账号全部 JWT 失效。
- 管理签名密钥疑似泄露：先关闭文字 AI 全局开关，再轮换管理密钥并重新完成关闭态 preflight。
- 认证配置缺失、重复、格式错误或绑定异常：失败关闭，返回固定服务错误，不回退为匿名账号。

## 9. 工作流与迁移

现有 `text-ai-preview` GitHub Environment 和 Preview branch 保留。配置向导改为：

1. 验证固定仓库、Environment、分支策略、GitHub 登录和 Cloudflare account scope；
2. 验证目标认证 secret 名称不存在，拒绝覆盖；
3. 在真实 TTY 接收 `ARK_API_KEY`；
4. 生成两个访问码和相互独立的随机密钥，包括两个独立 pepper、缺失的账号 HMAC 与候选缓存 AES 密钥；
5. 写入固定名称的 GitHub Environment secrets 并核对名称集合；
6. 只显示一次两个明文访问码并立即擦除本地 buffer；
7. 显示失败时补偿删除本次 secrets，避免留下用户无法恢复的凭据；
8. 运行关闭态 preflight，不部署、不启用、不调用模型。

迁移后的 workflow 必须移除：

- `TEXT_AI_TEAM_DOMAIN`；
- user email 与 admin email secrets；
- Access audience；
- Access service client ID/secret；
- organization、identity provider、Access application 和 policy 操作；
- Access service-token 创建、调用、补偿与轮换逻辑。

workflow 继续保留固定 operation 枚举、`main` 与 SHA 绑定、Environment gate、关闭态部署、单账号启停、全局关闭、状态检查和删除账号运行状态。

单账号访问码轮换由独立本地 TTY 命令生成该槽位的新 code、pepper 和 digest，先让用户保存新 code，再通过 GitHub secret stdin 更新该槽位的两个 secret，最后精确派发固定的 Pages Preview 配置更新与部署操作。GitHub secret 更新后但部署前失败时，旧部署和旧访问码继续有效，运维者可使用已保存的新 code 重试部署；部署成功后旧 code 与旧 JWT 同时失效。轮换命令不得读取或改写另一账号的 secret。

## 10. 测试策略

### 10.1 确定性测试

- 配置字段数量、格式、重复、空白和最小熵边界；
- 两个访问码分别只映射到一个槽位；
- 摘要比较走恒定时间路径；
- JWT 固定算法、签名、issuer、audience、subject、时间和 `cv`；
- 访问码轮换只使对应账号旧 JWT 失效；
- Cookie 属性、覆盖防护和退出清除；
- login/session/estimate/logout 的精确 method、URL、Origin、Host、Fetch Metadata、body 与大小限制；
- 限流原子性、匿名桶、冷却和成功清除；
- 两账号 account key、额度、幂等和启停状态隔离；
- 管理 HMAC、时间窗、body digest、operation ID 与重放拒绝；
- Access headers、team domain、audience 和 service token 不再是文字路由依赖；
- 照片 Access 测试继续原样通过；
- 源码、构建产物、日志与 workflow 负向扫描不含真实访问码、JWT、密钥、邮箱或餐食正文。

### 10.2 Preview 验收

1. AI 全局开关与两个账号均保持关闭，部署 Preview。
2. 验证未登录、错误码、限流、两个正确访问码和退出流程，不调用模型。
3. 分别验证两个账号生成不同的内部账号状态，证据只记录布尔结论。
4. 启用 `user-1`，在用户明确授权真实调用后执行一次文字餐食估算，核对模型预算只增加一次且确认前不入账。
5. 启用 `user-2`，只验证 session 与独立额度；除非另行授权，不执行第二次真实模型调用。
6. 完成浏览器、Cloudflare、GitHub 和构建产物敏感信息扫描。

## 11. 发布与回滚

发布顺序固定为：代码与测试通过、关闭态 preflight、关闭态 Preview 部署、双账号登录验证、单账号真实模型验证、第二账号启用。生产 `main` 的 AI 开关继续关闭，除非用户另行明确批准生产启用。

回滚优先级：

1. 关闭 Worker 文字 AI 总开关；
2. 关闭两个账号；
3. 轮换会话签名密钥使全部 JWT 失效；
4. 轮换或删除对应账号的访问码 pepper 与摘要；
5. 必要时回滚 Preview deployment。

回滚不删除本地饮食或训练数据，也不启用 Cloudflare Access 作为隐式后备路径。

## 12. 完成标准

- 文字 AI 用户和管理路径不再依赖任何 Cloudflare Access 资源或 header。
- 两个独立访问码可以分别建立 30 天安全会话，并可单独轮换而不影响另一账号。
- 错误码、跨站请求、伪造 JWT、过期 JWT、旧凭据版本和重放管理请求全部失败关闭。
- 两账号额度、启停、删除和账号键严格隔离。
- 设置向导可在不进入 Zero Trust onboarding 的情况下完成关闭态配置。
- 全套单元、边缘、工作流 verifier、构建和敏感信息扫描通过。
- Preview 实际登录通过；真实模型调用只在单独授权后发生。
