# 铁证文字餐食 AI 双账号 Preview 上线设计

**日期：** 2026-08-24  
**状态：** 用户已批准  
**目标环境：** `text-ai-preview.tiezheng.pages.dev`

## 1. 背景

文字餐食 AI 的业务代码、严格契约、豆包 adapter、Pages Functions、Worker 路由、配额和本地确认保存已经进入 `main`，但生产与 Preview 都仍由多重开关失败关闭。现有仓库也没有旧照片 AI 发布方案曾假定存在的私有管理端点和受保护手动部署工作流，因此不能仅把 `TEXT_AI_GATEWAY_ENABLED` 或 `VITE_ENABLE_TEXT_AI` 改为 `true`。

本设计补齐一个只服务于文字餐食 AI 的双账号 Preview 闭环。先让两个确定的测试邮箱使用，其中一个同时担任唯一人工管理员。第三个账号尚未确定，不进入当前 Access 策略、密钥或验收范围。

## 2. 目标

- 在独立 Preview 地址启用“用户填写餐食描述，AI 估算整餐热量和蛋白质”的完整流程。
- 使用 Cloudflare Access One-time PIN，仅允许两个确定的邮箱进入文字 AI API。
- 首先只启用管理员账号并执行一次真实豆包调用；验证通过后再启用第二个账号。
- 提供文字总开关、账号启停、状态检查和账号状态删除能力。
- 通过受保护、只能手动触发的 GitHub Actions 工作流完成部署和运维。
- 保证生产 `tiezheng.pages.dev`、照片 AI、普通 push 部署和现有手动营养录入不受影响。
- 全流程不把邮箱、餐食描述、模型原文或密钥写入仓库、构建产物、日志和发布证据。

## 3. 非目标

- 不启用生产文字 AI。
- 不启用、验证或修改照片识别体验。
- 不提供公开注册、自助邀请或管理员可视化页面。
- 不增加第三个账号；以后增加时只扩充受保护配置和 Access 策略。
- 不以真实调用耗尽日额度、分钟额度或月预算来验证边界。
- 不更换模型；继续固定使用 `doubao-seed-2-1-pro-260628`。
- 不把 AI 结果作为医疗、减脂或疾病建议。

## 4. 固定安全边界

### 4.1 环境隔离

- Preview 分支固定为 `text-ai-preview`，Pages 别名固定为 `text-ai-preview.tiezheng.pages.dev`。
- Preview 构建只注入 `VITE_ENABLE_TEXT_AI=true`；不注入 `VITE_ENABLE_PHOTO_AI`。
- Worker Preview 部署只允许 `TEXT_AI_GATEWAY_ENABLED=true`，并强制 `PHOTO_AI_GATEWAY_ENABLED=false`。
- Preview 固定 `TEXT_AI_MAX_PROVIDER_ATTEMPTS=1`。一次用户请求最多产生一次豆包调用，不执行供应商重试；用户可以在明确看到失败后自行重新提交新的请求。
- Worker 的允许来源精确等于 Preview origin，不接受通配符、生产 origin、凭证 URL 或额外端口。
- Worker 保持 `workers_dev:false` 且无公网 route，只能由 Pages 的 `PHOTO_AI_GATEWAY` Service Binding 调用。保留该历史 binding 名是为了复用已实现的内部代理契约；它不代表照片功能被开启。
- 普通 `main` push 的现有生产工作流继续不注入文字或照片 AI 客户端开关，也不部署启用状态的 AI Worker。

### 4.2 身份与账号

- 用户 Access Application 只覆盖 `https://text-ai-preview.tiezheng.pages.dev/api/nutrition/text/*`。
- 用户策略使用 One-time PIN，当前允许名单必须恰好为两个不同、规范化后的邮箱。
- 管理 Access Application 只覆盖 `https://text-ai-preview.tiezheng.pages.dev/api/nutrition/text-admin/*`。
- 人工管理员邮箱必须与两个用户邮箱之一完全相同。
- 受保护工作流可使用一个只对管理 Application 有效的 Cloudflare Access Service Token 调用管理 API。它是机器身份，不新增第三个人工账号。
- Pages 层把目标邮箱规范化后立即使用共享 HMAC 密钥派生 64 位账号键；Worker、Durable Object、响应和日志都不得接收邮箱。
- 文字与未来照片通道继续共享同一账号键，以保持共享并发、预算和删除语义。照片总开关在本范围内始终关闭。

### 4.3 密钥存放

创建 GitHub Environment `text-ai-preview`。环境中仅保存以下敏感值，值不得进入 workflow input、命令行参数或日志：

- `ARK_API_KEY`
- `PHOTO_AI_CACHE_AES_KEY`（沿用 Worker 现有字段名）
- `PHOTO_AI_ACCOUNT_HMAC_KEY`（沿用共享账号键字段名）
- `TEXT_AI_USER_1_EMAIL`
- `TEXT_AI_USER_2_EMAIL`
- `TEXT_AI_CF_ACCESS_CLIENT_ID`
- `TEXT_AI_CF_ACCESS_CLIENT_SECRET`

Access audience 由 Cloudflare 创建 Application 时生成，工作流在内存中读取并直接写入 Pages Preview 的加密环境变量，不作为人工维护的 GitHub Secret。Cloudflare team domain 和账号 ID 可以使用 GitHub Environment variables；仓库已有的 `CLOUDFLARE_API_TOKEN` 继续只作为 GitHub Secret 使用。工作流不得读取或打印任何 Secret 的值，只能输出“存在/缺失”和经过白名单过滤的资源状态。

## 5. 组件设计

### 5.1 Access 配置适配

现有照片 Access 契约的“三邮箱”限制不能被放宽。提取一个可复用的 Access 验证核心，由调用方传入固定的配置映射和期望人数：

- 照片用户路由继续使用既有 `PHOTO_AI_*` 配置和固定人数 3。
- 文字用户路由使用独立的 audience、双邮箱清单和固定人数 2。
- 文字管理路由使用独立 audience、单一管理员邮箱和固定人数 1。

所有调用仍严格验证 Access JWT 的签名、issuer、audience、过期时间和邮箱归属。缺失、多余、重复、大小写未规范化或人数不符都失败关闭。这样既满足当前双账号 Preview，也不会削弱照片通道原有契约。

### 5.2 私有文字管理端点

新增无用户界面的 `POST /api/nutrition/text-admin/account`。它只接受同源 JSON、管理 Access JWT 和固定 schema，并提供以下动作：

- `status`
- `enable-text-global`
- `disable-text-global`
- `enable-account`
- `disable-account`
- `delete-account`

账号动作只接受 `user-1` 或 `user-2` 逻辑槽位。工作流在内存中把槽位映射到对应 Environment Secret，再提交给 Pages；命令、input 和日志中不出现邮箱。Pages 校验目标属于当前双邮箱清单，派生账号键后只把动作、账号键和随机 operation ID 转发到 Worker 的 `/internal/text-admin`。

Worker 管理路由只能通过 Service Binding 到达。协调器新增原子 `applyTextAdminOperation`：

- operation ID 保存 24 小时，重复操作幂等返回；
- 全局动作只修改 `text_global_enabled`，绝不修改照片 `global_enabled`；
- 账号启停沿用共享账号 flag；由于照片全局开关为 false，不会使照片调用可用；
- 删除动作清理该账号的文字/照片计数、lease、幂等缓存和账号 flag，但不触碰浏览器本地 Dexie 数据；
- `status` 只返回布尔开关、剩余额度、预算汇总和重置时间，不返回账号键、邮箱或历史餐食。

所有管理响应使用 `no-store` 和 `nosniff`。解析、鉴权、CSRF、重放或下游错误统一返回有限错误码，不返回底层正文。

### 5.3 受保护手动工作流

新增 `.github/workflows/text-ai-preview.yml`，只允许 `workflow_dispatch`，使用 GitHub Environment `text-ai-preview`。工作流提供固定枚举操作，不接受任意命令或任意邮箱：

- `preflight`
- `deploy-disabled`
- `enable-admin-preview`
- `status`
- `enable-second-account`
- `disable-account`
- `disable-all`
- `delete-account`

危险操作要求匹配固定确认短语；删除还要求选择 `user-1` 或 `user-2`。工作流每次先执行权限探测，确认 Cloudflare token 具备所需的 Workers、Pages 和 Access 能力。能力不足时在任何远端写入前退出。

部署任务固定执行：

1. `npm ci`
2. 前端与 Edge 类型检查
3. 全部前端与 Edge 测试
4. 生产构建
5. 密钥、日志和工作流策略静态扫描
6. Worker dry-run
7. 远端变更
8. 只包含布尔状态、版本、commit SHA 和资源存在性的脱敏证据

任何 ordinary push、pull request 或 schedule 都不能运行启用操作。现有生产 CI 不接收 Preview Environment Secrets。

### 5.4 Pages 与 Worker 数据流

用户请求路径固定为：

```text
浏览器
  -> Cloudflare Access 用户策略
  -> 同源 Pages Function
  -> PHOTO_AI_GATEWAY Service Binding
  -> Worker /text/session 或 /text/estimate
  -> Durable Object 原子预留
  -> 火山方舟 Responses API
  -> 严格 JSON Schema 与本地二次校验
  -> 浏览器确认编辑器
  -> 单条 Dexie 餐食记录
```

餐食描述只存在于本次 HTTPS 请求和豆包请求体中。它不进入 operation evidence、console、Access 配置、Durable Object、缓存明文或错误响应。模型只估算整餐总热量和蛋白质范围，不拆解食材、不调用工具、不访问 URL；用户确认并可人工修正后才写入本地数据库。

## 6. 部署和启用顺序

### 阶段 A：失败关闭的基础设施

1. 运行 `preflight`，只读验证 GitHub secrets、Cloudflare token 权限、Pages 项目和 Worker 资源状态。
2. 创建或更新两个 Access Application、精确路径和双账号策略。
3. 创建或更新 Pages Preview 的变量和 `PHOTO_AI_GATEWAY` Service Binding。
4. 把 Ark 与缓存密钥写入 Worker Secrets。
5. 部署 Worker，文字与照片环境开关都为 false。
6. 构建并部署 Preview UI，文字入口可见；此时 API 必须返回服务关闭，且不得调用豆包。

### 阶段 B：管理员单账号真实门禁

1. 通过管理操作启用管理员账号和 `text_global_enabled`，Worker 环境开关仍保持 false。
2. 重新部署 Worker，仅把文字环境开关设为 true；照片保持 false，origin 保持精确 Preview。
3. 管理员通过 OTP 登录。
4. 只提交一次固定描述“牛肉面一碗，少油，约 500 g”。
5. 验证模型返回完整热量与蛋白质范围，人工确认后只生成一条本地记录。
6. 验证文字账号与文字全局额度各扣 1、照片计数不变、月预算只结算一次。
7. 扫描 Worker、Pages、GitHub 和浏览器证据，确认没有邮箱、描述、候选原文或密钥。

### 阶段 C：第二账号

1. 只有阶段 B 全部通过，才运行 `enable-second-account`。
2. 第二账号验证 OTP、session enabled 和剩余额度展示。
3. 不再执行真实模型调用；业务模型链路已由管理员的单次调用证明。
4. 结果状态记为 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW` 或 `BLOCKED`，不能写成生产通过。

## 7. 配额、预算和并发

Preview 沿用已经实现并测试的文字策略：

- 每账号每天 10 次；
- 文字全局每天 30 次；
- 每账号每分钟 2 次；
- 每账号并发 1、全局并发 2；
- 文字与照片共享月度应用预算，当前上限 50,000,000 micros（¥50）；
- 照片与文字日额度独立，预算与并发共享；
- 真实验收最多调用豆包一次，其余边界使用确定性测试和只读状态验证。

## 8. 失败处理

- 权限探测失败：不创建或修改任何 Cloudflare 资源。
- Secret 缺失或格式错误：构建前退出，不打印值。
- Access 配置错误：Pages 返回 401/403，不调用 Worker。
- Service Binding、origin 或 Worker 配置错误：返回 `service-disabled`，不调用豆包。
- 模型不可用、超时或 schema 非法：按既有有限错误码结算，不泄漏供应商正文；Preview 受 `TEXT_AI_MAX_PROVIDER_ATTEMPTS=1` 约束，retryable 错误也不自动发起第二次供应商调用。
- 管理操作重放：按 operation ID 幂等处理；指纹冲突拒绝。
- 管理员真实门禁任一项失败：保持第二账号关闭，并立即执行回滚。
- 工作流上传证据前执行敏感字段扫描；发现命中则拒绝上传并按暴露类型轮换对应密钥。

## 9. 回滚

回滚顺序固定为：

1. 通过管理端点关闭 `text_global_enabled`；
2. 重新部署 Worker，设置 `TEXT_AI_GATEWAY_ENABLED=false`；
3. 禁用用户和管理 Access Application；
4. 撤下 `text-ai-preview` Pages 部署或别名；
5. 如怀疑泄露，轮换 Ark、AES、HMAC、Access Service Token 或 Cloudflare token。

Worker 可以保留在关闭状态，以便读取脱敏状态和后续修复。回滚不修改生产站，也不删除任何用户浏览器中的本地餐食记录。

## 10. 验证与验收

### 10.1 自动验证

- 前端、仓储、Edge 和 Worker 全量测试；
- 前端与 Edge 类型检查；
- 生产和 Preview 构建；
- Workflow policy 测试：仅手动触发、受保护环境、生产无开关、照片关闭、真实调用上限 1；
- Access 用户人数 2、管理员人数 1、管理员属于用户清单；
- 管理 schema、同源门禁、JWT、重放、槽位映射和下游失败测试；
- 协调器真实 SQLite 测试：文字总开关与照片开关隔离、账号启停、删除和幂等；
- `wrangler deploy --dry-run`；
- 静态扫描密钥名、console、餐食描述日志和构建产物。

### 10.2 浏览器验收

- 未登录访问触发 Access，不直接到 Worker；
- 两个邮箱以外的账号不能进入；
- 管理员 OTP 登录后恢复到原日期和餐次；
- 输入前不发请求；点击估算后显示热量和蛋白质范围；
- 可人工修改最终点值；确认后只保存一条记录；刷新后仍存在；
- 关闭未确认面板不保存；
- 第二账号 session enabled，但不做第二次真实模型调用；
- 照片入口不可见且照片 session/estimate 仍失败关闭；
- 生产站没有文字或照片 AI 入口。

### 10.3 脱敏证据

只允许记录：commit SHA、固定模型/契约版本、工作流 run ID、测试结果、部署环境名、资源存在性、布尔开关、额度差值、预算差值和时间范围。禁止记录邮箱、账号键、餐食描述、候选内容、JWT、OTP、密钥、Cookie、IP 和完整供应商响应。

## 11. 第三个账号的后续加入

第三个邮箱确定后，单独进行一次受保护配置变更：增加 `TEXT_AI_USER_3_EMAIL`、把文字用户 Access 期望人数从 2 调整为 3、更新 Access policy，然后先保持第三账号 disabled。完成 OTP 验证后再运行账号启用操作。该流程不改模型、业务 UI、生产配置或照片总开关。

## 12. 完成定义

只有以下条件全部成立，才能宣布 Preview 完成：

- 受保护手动工作流、Access、Service Binding、Worker Secrets 和双账号策略均已实际部署；
- 管理员单次真实调用通过且计数、预算、日志符合设计；
- 第二账号 OTP 和 session 通过；
- 照片与生产开关保持关闭；
- 回滚操作至少完成一次关闭后再恢复的演练；
- 发布结论明确写为 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW`，不宣称生产可用。
