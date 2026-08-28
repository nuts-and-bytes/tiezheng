# 文字餐食 AI Preview 运维手册

本文是文字餐食 AI Preview 的当前执行依据，适用于固定仓库 `nuts-and-bytes/tiezheng`、固定 GitHub Environment `text-ai-preview` 和两个逻辑账号槽位 `user-1` / `user-2`。

当前方案以 2026-08-27 的访问码认证设计为准。2026-08-24 与 2026-08-26 的 Access 方案、spec 和 plan 仅保留为决策历史，不能用于当前首次配置。文字路径不需要银行卡，不开通 Zero Trust，不使用邮箱、OTP、Access Application 或 Access service token。照片 AI 仍保留自己的既有认证边界，不得因为文字方案迁移而删除或放宽。

## 1. 固定边界

- Pages 项目：`tiezheng`，Preview host：`text-ai-preview.tiezheng.pages.dev`。
- 私有 Worker：`tiezheng-photo-ai-gateway`；Pages 只通过固定 `PHOTO_AI_GATEWAY` service binding 调用它。
- 用户身份只有 `user-1` 和 `user-2` 两个槽位，不接收邮箱或任意目标字符串。
- 文字用户以随机访问码登录；GitHub 管理请求以独立 HMAC 签名。
- workflow 只允许 `workflow_dispatch`，必须来自受保护 `main`，并绑定用户输入的 40 位远端 `main` SHA。
- setup 只完成关闭态配置与关闭态 preflight，不部署、不启用、不调用模型。
- Preview 部署需要新的明确授权；任何真实模型调用还需要另一份明确授权。
- 生产文字 AI、生产照片 AI 和其他账号不在本文授权范围内。

## 2. GitHub 与 Cloudflare 前置条件

GitHub 必须满足：

- 当前 checkout 无未提交变更，分支为 `main`，push remote 精确指向 `nuts-and-bytes/tiezheng`；
- 本地 `HEAD`、远端 `main` 与本次批准 SHA 三者一致；
- `text-ai-preview` Environment 已存在，只允许 `main` deployment branch policy；
- Environment 无 reviewer 要求；单人模式的替代门禁是受保护分支、固定 SHA、固定 operation、固定确认短语和关闭态验证；
- `CLOUDFLARE_ACCOUNT_ID` 已存在，向导只读取和校验，不覆盖、不输出值；
- 首次运行前，目标 11 个 Environment secret 全部不存在。任一已存在即失败关闭，不提供 `--force`。

Cloudflare API token 必须只覆盖目标 account，并且权限精确为：

1. `Account API Tokens Read`
2. `Workers Scripts Edit`
3. `Cloudflare Pages Edit`

不接受 all accounts、zone、user、R2 或任何 Access 权限。向导只读取 token verify/detail/catalog、Pages 项目和 Worker inventory；不会创建、更新或删除 Cloudflare 资源。

迁移旧配置时，先用新窄权限 token 完成上述验证，再撤销旧的 `tiezheng-text-ai-preview-setup` Access setup token。顺序不能颠倒，也不能在验证新 token 之前用旧 token 部署。

## 3. 首次配置向导

唯一入口：

```bash
npm run setup:text-preview
```

向导只在真实本地 TTY 隐藏读取两项：

1. Cloudflare API Token
2. `ARK_API_KEY`

不得把值放入聊天、剪贴板自动化、argv、shell history、环境变量、文件、workflow input 或日志。向导通过 `shell:false` 的有界 `gh` 子进程 stdin 写入 GitHub，每次只写一个固定 secret 名称。

### 3.1 精确 inventory

11 个 Environment secret 必须恰好为：

1. `CLOUDFLARE_API_TOKEN`
2. `ARK_API_KEY`
3. `PHOTO_AI_CACHE_AES_KEY`
4. `PHOTO_AI_ACCOUNT_HMAC_KEY`
5. `TEXT_AI_USER_1_ACCESS_CODE_PEPPER`
6. `TEXT_AI_USER_1_ACCESS_CODE_DIGEST`
7. `TEXT_AI_USER_2_ACCESS_CODE_PEPPER`
8. `TEXT_AI_USER_2_ACCESS_CODE_DIGEST`
9. `TEXT_AI_SESSION_SIGNING_KEY`
10. `TEXT_AI_RATE_LIMIT_HMAC_KEY`
11. `TEXT_AI_ADMIN_SIGNING_KEY`

唯一 Environment variable 是既有的 `CLOUDFLARE_ACCOUNT_ID`。向导不创建或修改 variable。

向导按固定顺序请求两份 24-byte 随机材料和七份 32-byte 随机材料：

- 两个 24-byte 值编码为两个独立的 32 字符 URL-safe 访问码；
- 七个 32-byte 值分别用于缓存 AES、账号 HMAC、两个独立 pepper、会话签名、限流 HMAC 和管理签名；
- 每个访问码摘要为 `HMAC-SHA-256(该账号 pepper, 该账号访问码)`；
- 远端只保存 pepper 和 digest，不保存明文访问码。

### 3.2 执行顺序与输出

1. 只读检查 GitHub。
2. 隐藏读取两项输入。
3. 只读检查 Cloudflare token、Pages 和 Worker inventory。
4. 生成两个访问码与七个独立密钥。
5. 显示无值预览，等待小写 `y` 确认。
6. 写入 11 个 GitHub Environment secret，并核对 11+1 名称集合。
7. 在真实 TTY 中各显示一次 `user-1` 和 `user-2` 访问码，随后立即擦除本地 Buffer。
8. 派发绑定批准 SHA 的关闭态 `preflight`。

访问码只显示一次。操作者必须在当场分别保存并标明账号；不要截图到工单、复制到聊天或写入 evidence。向导不会再次读取或恢复它们。

成功输出只允许：

```text
SETUP COMPLETE
secrets=11 variables=1 preflight=pass workerTextEnabled=false photoEnabled=false
```

失败规则：

- 确认前失败或取消：零 GitHub 写入，所有本地 secret Buffer 归零。
- GitHub 部分写入、名称核对失败、访问码未能完整显示或关闭态 preflight 失败：逆序删除本次尝试写入的 secret；不删除既有 account variable，不写 Cloudflare。
- 补偿删除失败：输出固定 `SETUP BLOCKED cleanup=...`，停止并在 GitHub Settings 中只核对名称；不得继续部署。
- 任何错误输出不得包含输入值、访问码、摘要、远端响应或自由文本底层异常。

## 4. 三段授权 gate

### Gate A：关闭态 setup

只授权运行向导、写入 11 个 GitHub secret、显示两个访问码一次和派发关闭态 preflight。它不授权部署、启用或模型调用。

### Gate B：Preview 部署

必须另行明确授权后，才能派发 `deploy-disabled` 或 `rotate-user-code`。部署必须绑定当前受保护 `main` SHA；生产开关和模型开关保持关闭。

### Gate C：真实模型调用

必须在关闭态部署、双账号登录验证、限流验证和安全扫描通过后，再取得明确的真实调用授权。默认最多只允许 `user-1` 一次真实请求；`user-2` 只验证登录、session、状态与额度隔离。

任一 gate 的成功都不能自动授权下一段。

## 5. 访问码、Cookie 与限流

- Cookie 名称固定为 `__Host-tiezheng-text-ai-session`。
- 属性固定为 `HttpOnly; Secure; SameSite=Strict; Path=/`，无 `Domain`。
- `Max-Age=2592000`，即 30 天 Cookie。
- JWT 只使用 `HS256`，固定 issuer/audience，subject 只能是 `user-1` 或 `user-2`；不得包含邮箱、访问码、账号键、额度或餐食正文。
- JWT 的凭据版本由该账号当前 digest 派生；单账号访问码轮换后，该账号旧 Cookie 立即失效，另一账号不受影响。
- 登录失败采用 10 分钟计数窗口：正常 IP 盲化桶允许 5 次失败，第 6 次进入 15 分钟冷却；匿名桶允许 3 次失败，第 4 次进入 30 分钟冷却。
- 成功登录清除对应失败状态。原始 IP 只在 Pages 内存中出现，进入 Worker/存储前用独立 HMAC 密钥盲化；日志和 evidence 不记录 IP 或 attempt key。

## 6. 管理 HMAC 与重放边界

GitHub 管理调用固定签名材料为：

```text
v1 + POST + canonical path + timestamp + operationId + SHA-256(exact body bytes)
```

- secret 为 `TEXT_AI_ADMIN_SIGNING_KEY`，不得与用户 pepper、session key 或 rate-limit key 复用。
- Pages 要求同源 `Origin`、`Sec-Fetch-Site: same-origin`、精确 JSON、精确 Content-Length 和三项管理签名 header。
- timestamp 允许的最大时钟偏差为正负 5 分钟。
- operation ID 为 32 位小写 hex；请求体内 ID 必须与签名材料一致。
- Worker 保存 operation ID 与 fingerprint 24 小时：同 ID、同 fingerprint 可幂等返回；同 ID、不同 fingerprint 必须拒绝。
- 管理目标只能是 `user-1` 或 `user-2`，不能接受邮箱或任意字符串。

## 7. 单账号访问码轮换

只在真实 TTY 运行：

```bash
npm run rotate:text-preview-code -- --target=user-1
npm run rotate:text-preview-code -- --target=user-2
```

命令只生成目标账号的新 24-byte code、32-byte pepper 和 digest，显示该 code 一次，并要求小写 `y` 确认已经保存。随后只覆盖目标账号的 PEPPER 与 DIGEST 两个 GitHub secret，并派发：

- `operation=rotate-user-code`
- 精确 target
- `confirmation=ROTATE_ONE_TEXT_ACCESS_CODE`
- 精确批准 SHA

它不读取、不命名、不改写另一账号 secret，也不修改 Worker 或账号开关。

若两个 secret 已写完但 dispatch 或 Pages deployment 失败，旧 Pages deployment 与旧访问码继续有效。不要生成第二个新 code；使用固定恢复命令：

```bash
npm run rotate:text-preview-code -- --resume=user-1
npm run rotate:text-preview-code -- --resume=user-2
```

`--resume` 不读取、不生成、不显示、不重写任何 secret，只重新派发同一固定 workflow。部分 secret 写入失败时不得使用 resume；重新运行目标账号的普通轮换。

## 8. 全 session key 轮换

`TEXT_AI_SESSION_SIGNING_KEY` 泄露或需要强制退出全部用户时：

1. 先派发并核验 `disable-all`，证明文字 global=false、Worker text=false、photo=false。
2. 在可信 GitHub Environment UI 中替换为新的独立 32-byte canonical base64url key；不要把值放入 CLI、聊天或文件。
3. 在单独部署授权下，重新应用 Pages Preview secret bindings 并部署固定 SHA。
4. 重新运行关闭态 preflight，再分别验证两个账号必须重新登录。

该操作使两个账号全部旧 JWT 失效。它不是单账号访问码轮换，不得用来只处理一个账号。

## 9. 紧急关闭与泄露响应

`disable-all` 固定尝试两步，即使第一步失败也继续第二步：

1. `disable-text-global`
2. 部署 Worker disabled（文字与照片开关均为 false）

summary 只允许 `failureMask` 与两个固定步骤的 `attempted/failed` 布尔值。任一步失败、超时或结果未知都为 `BLOCKED`；不得声称已安全关闭。

发现任何文字认证或管理 secret 泄露时，先使用仍可信的控制凭证执行并核验 `disable-all`，再轮换对应 secret：

- 单个访问码：轮换对应槽位 code、pepper、digest；旧 code 和该账号旧 JWT 失效。
- session key：按第 8 节全量轮换；两个账号旧 JWT 全失效。
- admin signing key：关闭全局文字 AI 后替换 key，重新应用 Pages binding，并完成关闭态 preflight。
- rate-limit HMAC key：关闭后替换；接受旧限流桶不再可寻址，并重新验证匿名/正常限流。
- Cloudflare token 或 Ark key：先在可信 provider UI revoke，再写入替换值；`ARK_API_KEY` 可直接产生费用，不能继续使用泄露值。
- `PHOTO_AI_ACCOUNT_HMAC_KEY`：不要盲目轮换。它决定逻辑槽位到既有状态的映射，必须另开身份迁移与旧状态处置设计。
- cache AES key：按既有密文缓存迁移/作废流程处理，不得把解密失败当作“无缓存”静默继续。

## 10. 本地验证与敏感信息扫描

完整本地门禁：

```bash
npm test
npm run test:edge
npm run typecheck
npm run typecheck:edge
npm run build
npm run verify:text-preview-setup
npm run verify:text-preview-workflow
git diff --check
```

文字运行时旧身份形状扫描：

```bash
rg -n -i \
  'TEXT_AI_TEAM_DOMAIN|TEXT_AI_USER_[12]_EMAIL|TEXT_AI_ADMIN_EMAIL|TEXT_AI_CF_ACCESS|cf-access-client|cloudflareaccess[.]com|/access/' \
  edge functions workers scripts .github src \
  --glob '!**/*.test.*'
```

文字运行时、控制脚本和 workflow 应为零命中。`edge/photo-ai/access.ts` 中的 `cloudflareaccess.com` 属于照片认证保留项，必须用精确 allowlist 单独解释，不能全局删除。

明文密钥形状扫描：

```bash
rg -n \
  'ARK_API_KEY\s*[:=]\s*[^*{]|TEXT_AI_(ACCESS_CODE|SESSION_SIGNING|RATE_LIMIT_HMAC|ADMIN_SIGNING).*\s*[:=]\s*[^*{]|eyJ[A-Za-z0-9_-]+[.]eyJ' \
  edge functions workers scripts .github src dist
```

只允许明显 test-only placeholder 或固定 secret 名映射，且必须由 verifier 分类通过；真实值、访问码、JWT、Cookie、IP、账号键、餐食正文和供应商原文均为 `FAIL`。

## 11. Evidence 与完成定义

允许记录：commit SHA、run ID、固定资源名称或名称集合结论、固定 `SETUP` / `ROTATION` 状态、布尔结果和测试命令 exit 0。

禁止记录：任何 secret 值、两个访问码、JWT、Cookie、IP、账号键、Cloudflare account ID、远端响应、workflow URL、模型正文、餐食正文或自由文本底层错误。

只有以下全部成立才可把本地实现标为完成：

- 文字用户与管理路径无 Zero Trust、邮箱、OTP、Access app/service token 依赖；
- setup 精确为两项隐藏输入、11 secrets、1 个既有 variable、双访问码一次显示、零 Cloudflare 写入；
- 30 天 Cookie、单账号轮换、全 session key 轮换、正常/匿名限流和管理 HMAC 重放边界均有测试；
- 完整本地验证与静态扫描通过；
- 远端 setup、部署和模型调用仍分别受独立授权 gate 控制。
