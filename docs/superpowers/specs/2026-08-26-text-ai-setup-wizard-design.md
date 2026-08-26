# 铁证文字 AI Preview：四项输入首次配置向导设计

- 日期：2026-08-26
- 状态：设计自查通过，待用户审阅书面规格
- 依据：[首次配置向导最小输入研究](../research/2026-08-26-text-ai-setup-wizard-inputs.md)

## 1. 背景与目标

当前 `text-ai-preview` 首次配置要求人工在 GitHub Environment 中填写 9 个 secrets 和 2 个 variables。该流程安全但认知负担高，也容易出现名称、格式或账号边界填错。

本设计把首次配置压缩成一个本地交互向导。用户只提供 4 项，向导自动发现、派生或生成其余 7 项，并完成名称核对与关闭态 preflight。

成功标准：

1. 用户只运行一个固定命令并输入 4 项；
2. secret 不进入聊天、命令参数、shell history、环境变量、普通日志、临时文件或 Git；
3. 向导完成后，GitHub Environment 的名称集合与现有 workflow 契约完全一致；
4. 最终只证明 Preview 仍处于关闭态，不部署、不启用账号、不调用模型；
5. 任一步失败都失败关闭，不留下可继续启用的半配置状态。

## 2. 已批准决策

- 采用“最简四项输入”方案，不继续要求用户在 GitHub UI 逐项填写 11 个值。
- 允许把现有“secret 只能在 GitHub UI 输入”边界收窄改为：本地 TTY 隐藏输入或进程内生成，经单个子进程 stdin 写入固定 GitHub Environment。
- 仍禁止通过 CLI 参数、shell 拼接、聊天、剪贴板日志、环境变量、文件或 workflow input 传递 secret。
- GitHub Environment 继续采用单人受保护模式，不重新引入 required reviewer。
- 本向导只做首次配置与关闭态 preflight；部署、账号启用、真实模型验收和生产发布仍是独立授权步骤。

## 3. 用户体验

固定入口：

```bash
npm run setup:text-preview
```

向导只询问：

1. `Cloudflare API Token`：隐藏输入；
2. `ARK_API_KEY`：隐藏输入；
3. user-1 邮箱：可见输入，必须是规范小写邮箱；
4. user-2 邮箱：可见输入，必须是规范小写邮箱且与 user-1 不同。

随后只展示不含值的变更预览：固定仓库、Environment 名、将创建的 Cloudflare service token `tiezheng-text-ai-preview-github-actions`、9 个 secret 名称、1 个新增 variable 名称，以及“不会部署、不会启用、不会调用模型”。用户只需进行一次 `y/N` 确认。

成功时只输出：

```text
SETUP COMPLETE
secrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false
```

不得输出邮箱、token、密钥、account ID、team domain、Access audience、完整 API 响应或 workflow URL。

## 4. 输入、自动值与前置条件

### 4.1 四项用户输入

| 输入 | 校验 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 非空、无首尾空白/控制字符；只覆盖固定 account；权限集合满足下文要求 |
| `ARK_API_KEY` | 1–4096 字符，无首尾空白、CR、LF 或其他控制字符 |
| `TEXT_AI_USER_1_EMAIL` | 规范小写邮箱 |
| `TEXT_AI_USER_2_EMAIL` | 规范小写邮箱，且不等于 user-1 |

### 4.2 自动得到的七项

| 目标值 | 来源 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 读取既有 GitHub Environment variable；只在内存中校验，不打印、不重写 |
| `TEXT_AI_TEAM_DOMAIN` | 读取 Cloudflare organization 的 `auth_domain`，验证固定后缀后提取 slug |
| `TEXT_AI_CF_ACCESS_CLIENT_ID` | 创建固定名称 Access service token 的一次性响应 |
| `TEXT_AI_CF_ACCESS_CLIENT_SECRET` | 同上；捕获后立即经 stdin 写入 GitHub |
| `PHOTO_AI_CACHE_AES_KEY` | 密码安全随机生成 32 字节并转 canonical Base64 |
| `PHOTO_AI_ACCOUNT_HMAC_KEY` | 密码安全随机生成至少 32 字节 |
| `TEXT_AI_ADMIN_EMAIL` | 精确复用 user-1 邮箱 |

### 4.3 Cloudflare Token 权限

Token 必须只绑定既有 `CLOUDFLARE_ACCOUNT_ID` 指向的精确 account，并覆盖：

- `Account API Tokens Read`；
- `Workers Scripts Edit` 或 `Workers Scripts Write`；
- `Cloudflare Pages Edit` 或 `Pages Write`；
- `Access: Apps and Policies Edit` 或 `Access: Apps and Policies Write`；
- `Access: Organizations, Identity Providers, and Groups Read`；
- `Access: Service Tokens Read`；
- `Access: Service Tokens Write`。

禁止 all accounts、其他 account、zone、user、R2 或混合资源 scope。缺任一权限时在任何远端写入前退出，并只显示缺失的官方权限名。

### 4.4 运行前置条件

- 当前仓库精确为 `nuts-and-bytes/tiezheng`；
- 工作树干净，当前分支精确为 `main`，本地 `HEAD` 精确等于 GitHub 远端 `main`；向导不会自动 merge、pull、commit 或 push；
- 本地 `HEAD` 是本次批准 SHA，后续 workflow dispatch 将同一 SHA 传入必填 `expected_sha`；
- `gh` 已登录且有目标 Environment 写权限；
- GitHub Environment `text-ai-preview` 已存在，deployment branch 唯一为 `main`；
- `CLOUDFLARE_ACCOUNT_ID` 已存在且格式正确；
- Cloudflare Zero Trust organization 已存在；
- 9 个目标 secret 与 `TEXT_AI_TEAM_DOMAIN` 在首次运行前均不存在；存在任一项时拒绝覆盖，进入单独的恢复/轮换流程。

## 5. 组件与边界

### 5.1 交互入口

新增一个 Node CLI 入口，只负责 TTY 检查、四项输入、无值预览和一次确认。非交互 stdin、重定向输入、CLI secret flags、额外位置参数和未知选项全部拒绝。

### 5.2 配置编排器

编排器维护显式阶段：`read-only-checks → collect → validate → confirm → create-token → write-github → verify-names → preflight → complete`。每个阶段只接收完成自身职责所需的最小数据，并返回固定结果类型。

它复用现有 Cloudflare 请求边界与文字 Preview 校验规则，不复制第二套邮箱、account ID、key 或权限校验。创建 service token 和读取 organization 作为新的窄接口加入，接口只能命中固定 account 路径。

### 5.3 Secret sink

GitHub 写入封装为一个只接受 `name + Buffer` 的 sink：

- 子进程使用 `shell: false`；
- argv 只包含固定 secret 名、`--env text-ai-preview`、`--repo nuts-and-bytes/tiezheng`；
- 值只写入该子进程 stdin；
- 禁止 `--body`、环境变量注入和 shell 管道；
- stdout/stderr 不原样转发，失败只映射为固定错误码；
- 写完后尽力清零 Buffer，主进程立即结束，不声称能消除运行时内部所有内存副本。

Variable sink 使用相同子进程约束。它只新增 `TEXT_AI_TEAM_DOMAIN`，不重写既有 `CLOUDFLARE_ACCOUNT_ID`。

### 5.4 随机值生成器

随机值只使用系统密码学随机源。AES key 精确生成 32 字节并编码为 canonical Base64；HMAC key 生成独立随机字节，不复用 AES key、API token、邮箱或 service token secret。

### 5.5 只读核验与 preflight

写入完成后只列 GitHub Environment secret/variable 名称，不读取 secret 值。名称集合精确匹配后，向导按当前 `main` 的批准 SHA 调用现有 manual-only workflow 的 `preflight` operation，并复用 runbook 的精确 run ID 与结果核验逻辑。

preflight 必须证明 Worker text=false、photo=false；它不得部署 Pages/Worker、配置 Access app、启用账号或调用方舟模型。

## 6. 数据流

1. 只读检查本机、仓库、干净工作树、本地/远端 `main` 精确 SHA、Environment、现有名称集合和 account ID；
2. 通过 TTY 读取两个 secret 和两个邮箱；
3. 使用 Cloudflare token 验证自身、精确 account scope、权限、organization 和同名 `tiezheng-text-ai-preview-github-actions` service token 不存在；
4. 本地生成 AES/HMAC，组装 9 secrets 与 team-domain variable；
5. 展示无值预览并请求一次确认；
6. 创建固定名称 Cloudflare Access service token；
7. 捕获一次性 client ID/secret，逐项经 stdin 写入 GitHub Environment；
8. 只读核对 9 个 secret 名称和 2 个 variable 名称；
9. 运行关闭态 preflight；
10. 清零可控 Buffer，输出固定成功摘要并退出。

任何值都不得反向进入 UI、普通日志、测试快照、异常字符串或 evidence。

## 7. 失败、补偿与重跑

### 7.1 写入前失败

TTY、登录、仓库、已有名称、输入格式、权限、scope、organization 或同名 service token 任一检查失败时，不执行任何远端写入。

### 7.2 创建 service token 后失败

确认范围同时授权对“本次新建资源”执行失败补偿。向导逐项记录本次成功创建的资源名称，但不记录值：

1. 删除本次已写入且运行前确认不存在的 GitHub secret/variable 名称；
2. 删除本次创建的精确 Cloudflare service token ID；
3. 不触碰既有 `CLOUDFLARE_ACCOUNT_ID`、其他 service token、Access app、Pages/Worker、生产或账号开关。

补偿任一步失败时输出 `SETUP BLOCKED` 和未清理的资源名称，不自动重试写入、不运行 preflight、不继续启用。后续恢复需要单独确认。

### 7.3 preflight 失败

若 9+2 名称已完整但关闭态 preflight 失败，保留完整配置以便诊断，不删除凭证，不部署、不启用，并输出 `SETUP BLOCKED preflight`。原因是删除已完整写入的凭证不会恢复 Cloudflare 原有运行态，反而会失去安全关闭所需的控制凭证。

### 7.4 重跑与轮换

v1 是首次配置向导，不是轮换器。发现任一目标名称或同名 service token 已存在时停止，不读取、不覆盖、不删除。service token 轮换、API key 更新和清理半配置状态作为独立操作设计，不能通过 `--force` 绕过。

## 8. 不变的安全与产品边界

- 生产 Pages、生产域名和生产功能开关不变；
- `VITE_ENABLE_PHOTO_AI=false`、Worker photo=false；
- 文字 global、两个 account flag 和 Access app 不因向导而开启；
- 不部署 disabled Preview；部署仍由 `deploy-disabled` 独立操作完成；
- 不执行真实文字估算，不消耗模型预算；
- 不新增第三账号；
- 不降低 manual-only、protected `main`、approved SHA、固定 operation/confirmation 和回滚门禁；
- 不把“配置完成”表述成“AI 已可用”。

## 9. 测试设计

### 9.1 纯函数与输入测试

- 四项输入的正常值、空值、空白、控制字符、大小写和邮箱重复；
- account ID、team domain、service client ID、AES/HMAC 格式；
- 只允许固定仓库、Environment、资源名称和权限集合；
- 任何 secret 都不出现在错误、摘要或序列化结果中。

### 9.2 进程与泄漏测试

- 非 TTY、重定向输入、CLI secret 参数和 shell tracing 失败；
- 子进程 `shell:false`，argv/env/stdout/stderr 不含 secret；
- GitHub secret/variable 只经 stdin 传递；
- 测试注入每一项敏感值，扫描日志、异常、快照和报告均无匹配；
- 不创建 `.env`、临时 secret 文件或 artifact。

### 9.3 Cloudflare 与 GitHub 契约测试

- 所有 Cloudflare API 使用假 fetch，固定方法、路径、account 和响应上限；
- service token 创建只发生一次，organization 只读且 team slug 严格解析；
- 缺权限、混合 scope、重复 token、畸形响应和网络失败均在预期边界停止；
- GitHub sink 使用假子进程，验证固定 argv、逐项 stdin 和补偿顺序；
- 运行前已有任一名称时零写入。

### 9.4 状态机与补偿测试

- 在创建 token、9 个 secret、team variable 和名称核验的每一个边界注入失败；
- 写入前失败零补偿，部分写入只删除本次新建资源；
- 补偿失败输出固定 BLOCKED，不触碰既有资源；
- 完整写入后的 preflight 失败保留配置但绝不部署/启用；
- 成功路径只运行一次 preflight，模型调用计数为 0。

### 9.5 回归验证

- 向导定向测试；
- 现有 workflow verifier 和 mutation tests；
- 文字 Preview control tests；
- Node、Edge、typecheck、text-only build 和 Worker dry-run；
- 独立审查确认 secret 边界、外部写入补偿和生产不变。

## 10. 运维文档变化

实施时同步更新：

- runbook：新增唯一允许的本地 TTY/stdin secret 路径，其他泄漏路径继续禁止；
- release checklist：记录向导版本、名称集合、布尔 preflight 结果和补偿状态；
- release plan：首次配置改用固定向导，不再要求逐项 UI 输入；
- workflow verifier tests：锁定向导不会调用部署、enable 或模型路径。

证据只允许记录 commit SHA、向导版本、资源名称、测试结果、布尔状态和时间范围。

## 11. 拒绝的替代方案

- **6 项半自动方案**：让用户额外创建并填写 Access client ID/secret；权限更窄，但仍需多次 UI 操作，不符合“越简单越好”。
- **继续手工填写 11 项**：不改变现有边界，但正是本次要解决的复杂度。
- **把 secret 放入 `.env` 后批量上传**：会产生持久明文文件和备份/索引泄漏面，拒绝。
- **通过 CLI flags 或 shell 管道传值**：会进入历史、进程列表或调试输出，拒绝。
- **浏览器直连方舟**：会把供应商密钥暴露给客户端，拒绝。
- **自动创建 Zero Trust organization**：涉及 team 命名和身份边界，不属于最小向导。

## 12. 完成定义

- 用户只输入两个 secret 和两个邮箱；
- 其余七项自动得到且全部通过现有格式边界；
- 9 个 Environment secrets 与 2 个 variables 名称集合精确；
- 全流程无 secret 参数、日志、落盘或 Git 痕迹；
- 首次运行具备确定性补偿，重跑不会覆盖已有凭证；
- 最终关闭态 preflight 通过且文字/照片均为 false；
- 没有部署、启用、生产变更或模型调用；
- 全量验证和独立审查通过后，才可把向导用于真实首次配置。
