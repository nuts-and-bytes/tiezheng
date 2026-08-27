# 文字餐食 AI Preview 发布检查表

本表只记录脱敏状态。每一项的 `状态` 只能是 `PASS`、`FAIL`、`BLOCKED` 或 `NOT_RUN`；初始全部为 `NOT_RUN`。

- `PASS`：已对当前适用的完整检查项取得可重复验证的通过结果。
- `FAIL`：检查已执行，但实际结果不符合预期。
- `BLOCKED`：必需能力不可用、结果不明、无法安全验证，或必需的回滚未确认成功。
- `NOT_RUN`：当前适用项还没有执行，不能解释为默认通过。

A–G 与 I 是标准双账号 Preview 的必需范围。H 是另行授权的条件性破坏流程：正常路径只把 H 的第一条标准保护项改为 `PASS`，其余条件项保持 `NOT_RUN`，并明确不计入标准 GREEN；任一条件项被激活就暂停标准 GREEN，转入单独变更决策。A–G 中带“若失败/失败时”的条件守卫，在前件未发生时，只有同时证明本次实际路径没有发生对应禁止行为，且 F 节故障注入或相应控制测试覆盖了该守卫，才记 `PASS`；前件发生时，只有脱敏运行证据证明规定响应完整执行才记 `PASS`。未评估为 `NOT_RUN`，无法证明为 `BLOCKED`，实际违约为 `FAIL`。

不得在备注中写入邮箱、account ID、派生 account key、Access audience、JWT、OTP、secret、URL token、IP、Cookie、餐食正文、模型候选或供应商原文。精确 run 的安全记录只允许 run ID、commit SHA 和固定成功结论；其他项只允许记录资源/开关布尔判断或差值 `PASS/FAIL`。

首次配置向导的 evidence 更窄：只记 commit SHA、固定资源名称或名称集合结论、布尔结果和固定 `SETUP` 状态；不记录输入值、account ID、team domain、service-token ID、workflow URL、远端响应或自由文本错误。

## A. 代码与本地门禁

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| 目标 commit SHA 是事先批准的 40 位 SHA，并与远程 `main` 一致 | NOT_RUN | 仅允许记录 SHA |
| 操作仓库固定为 `nuts-and-bytes/tiezheng`，不依赖 cwd 或默认仓库 | NOT_RUN | 仅记录 PASS/FAIL |
| workflow 只允许手动触发，目标 ref 为受保护 `main` | NOT_RUN | 仅记录布尔判断 |
| 开始每次 dispatch 前，单次稳定 inventory 快照长度小于 100，每条 exact record 仅含正安全整数 `databaseId` 和精确值 `completed` 的 `status`；活动/未知/畸形/满 100 条均 BLOCKED | NOT_RUN | 仅记录 PASS/FAIL；不记录旧 run ID 或输入 |
| 每个 dispatch 都从本次返回的精确 URL 提取唯一纯数字 run ID | NOT_RUN | URL 缺失/格式不符即 BLOCKED；不记录 URL |
| 唯一的 `gh run list` 只用于 dispatch 前的单次稳定 inventory 快照；未使用 `gh run list`、UI 或“最近一次”回退绑定新 run ID | NOT_RUN | 仅记录 PASS/FAIL |
| 单人模式已由用户明确批准；操作者在 dispatch 前核对 exact head SHA 与当时 `main`，并把同一 SHA 作为必填 workflow input | NOT_RUN | 仅记录 PASS/FAIL 与 SHA |
| 每个精确 run 都已 watch 并核对 workflow_dispatch/main/SHA/completed/success/workflowName、唯一 `text-ai-preview` job success、唯一 `Dispatch fixed operation` step success | NOT_RUN | 仅记录 run ID/SHA/成功结论 |
| checkout/setup-node 使用固定完整 SHA，checkout 不持久化凭证 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm test` 全量通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run typecheck` 通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run build` 通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run test:edge` 全量通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run typecheck:edge` 通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run test:text-preview-control` 全量通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run verify:text-preview-workflow` 通过 | NOT_RUN | 仅记录 PASS/FAIL |
| `npm run deploy:photo-worker -- --dry-run` 通过且未真实部署 | NOT_RUN | 仅记录 PASS/FAIL |
| `git diff --check` 通过 | NOT_RUN | 仅记录 PASS/FAIL |
| 按 runbook 精确 `rg` 命令扫描 `src edge functions workers scripts .github` 并完成 allowlist 分类 | NOT_RUN | 零越界命中才 PASS；不复制命中值 |
| ARK/AES、Access secret、`targetEmail`、`description` 与 console/stdout/stderr 全部符合 runbook allowlist | NOT_RUN | 只记录 PASS/FAIL |
| 生产 CI 无 `VITE_ENABLE_TEXT_AI`，该名称只存在于受保护 Preview workflow | NOT_RUN | 只记录 PASS/FAIL |

## B. GitHub 保护边界

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| `main` 被 branch protection 或 ruleset 覆盖 | NOT_RUN | 仅记录布尔判断 |
| Environment 名精确为 `text-ai-preview` | NOT_RUN | 仅记录 PASS/FAIL |
| Deployment branches 使用 Selected branches and tags | NOT_RUN | 不接受 Protected branches only |
| 唯一 deployment branch rule 为 `main`，无 tag/通配规则 | NOT_RUN | 仅记录 PASS/FAIL |
| 单人受保护模式不配置 required reviewer，reviewer 集合为空 | NOT_RUN | 仅记录布尔判断 |
| 不依赖 Environment reviewer 或 Prevent self-review；不存在 pending approval 放行步骤 | NOT_RUN | 仅记录 PASS/FAIL |
| 管理员绕过开关不作为放行依据；workflow 自身硬门禁 protected `main` 与批准 SHA | NOT_RUN | 仅记录 PASS/FAIL |
| 当前套餐支持 Environment secrets 与精确 deployment branch rule | NOT_RUN | 不支持时 BLOCKED |
| 首次运行前 9 个目标 secret 与 `TEXT_AI_TEAM_DOMAIN` 均不存在，`CLOUDFLARE_ACCOUNT_ID` 已存在 | NOT_RUN | 只记录名称集合结论；任一已有目标值即 BLOCKED |
| 唯一首次配置入口是 `npm run setup:text-preview`；两个 secret 经本地 TTY 隐藏输入，自动值在进程内生成 | NOT_RUN | 只记固定状态，不记输入 |
| 每个值只经 `shell:false` 的单个 `gh` 子进程 stdin 写入固定 repo/environment | NOT_RUN | 禁止 `--body`、argv、shell history、env、文件、workflow input、聊天与日志 |
| 向导只创建固定名称、固定一年（`8760h`）service token，写 9+1 并运行关闭态 preflight | NOT_RUN | 仅记名称/布尔/固定状态；不运行 deploy/enable/model call |
| partial-write 失败只逆序补偿本次尝试的 variable/secrets，最后删除本次 service token | NOT_RUN | 不触碰 account ID、旧 service token、Access、Pages/Worker 或开关 |
| 9+2 完整后 preflight 失败保留凭据并输出 `SETUP BLOCKED preflight` | NOT_RUN | 不补偿、不部署、不启用；只记固定状态 |
| 9 个 Environment secret 名称集合精确为 `CLOUDFLARE_API_TOKEN`、`ARK_API_KEY`、`PHOTO_AI_CACHE_AES_KEY`、`PHOTO_AI_ACCOUNT_HMAC_KEY`、`TEXT_AI_USER_1_EMAIL`、`TEXT_AI_USER_2_EMAIL`、`TEXT_AI_ADMIN_EMAIL`、`TEXT_AI_CF_ACCESS_CLIENT_ID`、`TEXT_AI_CF_ACCESS_CLIENT_SECRET` | NOT_RUN | 只检查名称，不读取值 |
| 2 个 Environment variable 名称集合精确为 `CLOUDFLARE_ACCOUNT_ID`、`TEXT_AI_TEAM_DOMAIN` | NOT_RUN | 不记录值 |
| allowed email count 由 workflow 精确锁定为 2 | NOT_RUN | 不创建同名 Environment variable |
| account ID 为 32 位小写 hex；team domain 是小写 slug，不含协议或完整 Access 域名 | NOT_RUN | 向导只在内存校验，不记录值 |
| user-1/user-2 为规范小写且不同，admin 精确等于 user-1 | NOT_RUN | 向导在写入前校验，不记录邮箱 |
| Access client ID 全小写并以 `.access` 结尾；HMAC 至少 32 字符且无空白 | NOT_RUN | 向导在进程内校验/生成，不记录值 |
| Ark key 为 1–4096、无首尾空白/Unicode 控制字符；AES 为 canonical Base64 且解码恰好 32 字节 | NOT_RUN | 只读 preflight 可先执行；workflow 在任何远端写入前验证，特别早于 status POST；不记录值 |

## C. Cloudflare 只读 preflight

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| 使用目标 account 拥有的 account token | NOT_RUN | 不记录 token/account ID |
| token 的资源范围只包含精确目标 account | NOT_RUN | 仅记录 PASS/FAIL |
| `Account API Tokens Read` 已验证 | NOT_RUN | 内部以 detail/catalog ID 关联；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Workers Scripts Edit` 或 `Workers Scripts Write` 已验证 | NOT_RUN | 内部以 detail/catalog ID 关联；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Cloudflare Pages Edit` 或 `Pages Write` 已验证 | NOT_RUN | 内部以 detail/catalog ID 关联；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Access: Apps and Policies Edit` 或 `Write` 已验证 | NOT_RUN | 内部以 detail/catalog ID 关联；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Access: Organizations, Identity Providers, and Groups Read` 已验证 | NOT_RUN | 向导用于读取 organization 与 OTP provider；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Access: Service Tokens Read` 已验证 | NOT_RUN | 内部以 detail/catalog ID 关联；仅记录 PASS/FAIL，不记录 ID/API 响应 |
| `Access: Service Tokens Write` 已验证 | NOT_RUN | 只用于首次向导创建固定 service token 与本次失败补偿；仅记 PASS/FAIL |
| token active、detail 与 permission catalog ID 关联通过 | NOT_RUN | 仅记录 PASS/FAIL，不记录 ID/API 响应 |
| Pages `production_branch` 精确为 `main` | NOT_RUN | 仅记录 PASS/FAIL |
| 首次 preflight 的 Worker 照片开关与文字开关都精确为 false | NOT_RUN | 只读 run 即使成功但文字为 true 仍 BLOCKED |
| OTP provider 与精确 service token 唯一存在 | NOT_RUN | 不记录资源 ID/client ID |
| `preflight` 精确 run 成功且零 Cloudflare 写入 | NOT_RUN | 仅记录 run ID/SHA/成功结论 |

## D. Disabled Preview

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| `deploy-disabled` 只在首次 `preflight` 成功且 `workerTextEnabled=false` 后以精确 run 执行 | NOT_RUN | 仅记录 run ID/SHA/成功结论 |
| `deploy-disabled` 在 configure/Worker/Pages 首次写入前，从本次拥有者正确、单链接、稳定的 `0600` 文件再次证明 Worker text=false | NOT_RUN | true/缺失/额外字段/权限或文件漂移均零写入退出 |
| Pages Preview branch 精确为 `text-ai-preview` | NOT_RUN | 仅记录 PASS/FAIL |
| Pages production 配置哈希在 Preview 配置前后不变 | NOT_RUN | 仅记录 PASS/FAIL，不记录哈希值 |
| 用户与管理 Access Application 均存在且 audience 隔离 | NOT_RUN | 不记录 audience/资源 ID |
| 用户 Access policy 精确允许 2 个账号 | NOT_RUN | 不记录邮箱 |
| 管理 human policy 精确允许 1 个管理员 | NOT_RUN | 不记录邮箱 |
| 用户与管理 Access session duration 均为 `30m` | NOT_RUN | 仅记录 PASS/FAIL |
| OTP policy 与 service-auth policy 均精确存在 | NOT_RUN | 不记录 provider/service token ID |
| Pages Preview Service Binding 为 `PHOTO_AI_GATEWAY` → `tiezheng-photo-ai-gateway` | NOT_RUN | 只记录名称与 PASS/FAIL |
| Worker secret 名称精确为 `ARK_API_KEY`、`PHOTO_AI_CACHE_AES_KEY` | NOT_RUN | 只能在可信 Cloudflare Dashboard UI 核对名称且不读值；workflow preflight 不能证明此项 |
| Worker disabled 配置为 text=false、photo=false、attempts=1 | NOT_RUN | 仅记录布尔判断 |
| Preview 前端 text=true、photo=false | NOT_RUN | 仅记录布尔判断 |
| disabled smoke：未登录被 Access 拦截 | NOT_RUN | 不记录 Cookie/IP |
| disabled smoke：允许用户登录后返回 `service-disabled` | NOT_RUN | 不记录 OTP/JWT/邮箱 |
| disabled smoke：供应商用量不变 | NOT_RUN | 只记录差值 PASS/FAIL |
| 生产站无文字/照片 AI 入口且未被修改 | NOT_RUN | 仅记录 PASS/FAIL |

## E. 单次真实门禁与第二账号

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| 首次启用先在本地验证 ARK/AES，再捕获状态；Worker text/global/user-1/user-2 均为 false | NOT_RUN | 无效 secret 必须零远端写入；内部 status 保持静默 |
| `enable-admin-preview` 只在 `deploy-disabled` 成功后以精确 run 执行，只启用 user-1/global，Worker text=true | NOT_RUN | 仅记录 run ID/SHA/成功结论与布尔判断 |
| 从 `enable-admin-preview` dispatch 开始，任一 workflow、OTP/session、`status`、浏览器或第二账号门禁异常都立即触发 `disable-all` 与关闭复核 | NOT_RUN | 无异常时仅在后续门禁全部成功且 F 全 PASS 后标 PASS；有异常时仅在关闭复核成功后标 PASS |
| user-1 OTP 与 30m session 通过 | NOT_RUN | 不记录邮箱/OTP/JWT |
| 唯一真实模型请求只在 Task 12 浏览器执行一次 | NOT_RUN | 不记录餐食/模型原文 |
| Task 12 餐食提交总数不超过 1；成功或失败都未刷新、重试或换账号重发 | NOT_RUN | 仅记录 PASS/FAIL |
| 同一 `requestId` 仅允许一次自动 in-flight 轮询；未刷新、未生成新 requestId、未人工重试 | NOT_RUN | 自动轮询只查询同一次操作，不算第二次供应商调用 |
| 若唯一请求失败、超时或结果未知，已立即精确执行 `disable-all` 并完成关闭复核 | NOT_RUN | 未触发时仅在唯一请求成功且 F 全 PASS 后标 PASS；触发时仅在关闭复核成功后标 PASS |
| 只新增一条本地餐次记录且刷新仍存在 | NOT_RUN | 不记录餐食正文 |
| 每次显式 `status` 只针对一个 target，且只输出 `textGlobalEnabled`、`accountEnabled`、`accountRemaining`、`globalRemaining`、`budgetSpentMicros`、`budgetReservedMicros`、`resetAt` | NOT_RUN | 不复制字段值到本表 |
| 文字 account/global 计数差均为一次 | NOT_RUN | 只记录差值 PASS/FAIL |
| budget spent/reserved 只结算一次 | NOT_RUN | 只记录差值 PASS/FAIL |
| 照片 counter 与照片 global flag 不变 | NOT_RUN | 只记录差值 PASS/FAIL |
| Actions 扫描固定精确 run ID 与 createdAt/updatedAt 窗口，仅匹配授权 whitelist，零未授权命中 | NOT_RUN | 只记录安全类别和 PASS/FAIL，不复制正文 |
| Cloudflare/DO/浏览器/供应商只在同一 run/session 时间窗内检查，日志与存储零未授权命中 | NOT_RUN | 只记录布尔/差值 PASS/FAIL，不导出原文 |
| 启用 user-2 前 Worker/global/user-1=true、user-2=false | NOT_RUN | 内部 status 保持静默 |
| `enable-second-account` 以精确 run 执行，目标只能是 user-2 | NOT_RUN | 仅记录 run ID/SHA/成功结论 |
| user-2 OTP、session 与 `status` 通过 | NOT_RUN | 不记录邮箱/OTP/JWT/metadata 值 |
| user-2 未提交餐食、未触发模型请求 | NOT_RUN | 仅记录 PASS/FAIL |
| 全程 provider attempts=1 | NOT_RUN | 仅记录 PASS/FAIL |
| 全程生产与照片 AI 保持关闭 | NOT_RUN | 仅记录 PASS/FAIL |

## F. `disable-all` 的 2^3 确定性门禁矩阵

本矩阵用于本地确定性故障注入/测试，不要求对远端执行 8 次破坏性操作。G=关闭 global，W=部署 Worker disabled，A=删除 Access。G 或 W 失败时 A 必须不尝试；表中的 A 注入结果应被忽略。

| G 注入 | W 注入 | A 注入 | 预期 | 状态 | 脱敏记录 |
| --- | --- | --- | --- | --- | --- |
| 成功 | 成功 | 成功 | A 被尝试；summary 成功；退出 0 | NOT_RUN | 仅记录 PASS/FAIL |
| 成功 | 成功 | 失败 | A 被尝试；summary 失败；退出非零 | NOT_RUN | 不复制错误正文 |
| 成功 | 失败 | 成功 | A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |
| 成功 | 失败 | 失败 | A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |
| 失败 | 成功 | 成功 | W 仍尝试；A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |
| 失败 | 成功 | 失败 | W 仍尝试；A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |
| 失败 | 失败 | 成功 | G/W 都被尝试；A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |
| 失败 | 失败 | 失败 | G/W 都被尝试；A 不尝试；Access 保留；退出非零 | NOT_RUN | 仅记录 PASS/FAIL |

## G. 远程关闭与恢复演练

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| 首次 `disable-all` 精确 run 成功；固定 summary 显示 global/Worker/Access 三步均按安全语义成功 | NOT_RUN | 仅记录 run ID/SHA/成功结论与布尔判断 |
| 任一实际写入性 run 若非 success、超时或结果未知，下一安全动作都是精确绑定的 `disable-all`，且未直接重试 enable | NOT_RUN | 未触发时仅在所有写入性 run success 且 F 全 PASS 后标 PASS；触发时仅在关闭复核成功后标 PASS |
| 关闭复核按 `deploy-disabled` → `preflight` → user-1 显式 `status` → 第二次 `disable-all` 顺序完成 | NOT_RUN | 每个 workflow 只记录 run ID/SHA/成功结论 |
| 关闭复核证明 text global=false、Worker text=false、photo=false，且临时重建的 Access 最终已删除 | NOT_RUN | 仅记录布尔判断 |
| 关闭过程未修改 account flag、生产或浏览器本地餐食 | NOT_RUN | 仅记录 PASS/FAIL |
| 恢复先以精确 run 执行 `deploy-disabled`，重建受保护关闭状态 | NOT_RUN | 仅记录 run ID/SHA/成功结论 |
| 恢复时分别以精确 run 禁用 user-1/user-2，把文字/照片共用 account flag 明确归零 | NOT_RUN | 不记录账号身份值；只记录 run ID/SHA/成功结论 |
| 恢复再以精确 run 运行 `enable-admin-preview`，且未重做真实请求 | NOT_RUN | 仅记录 run ID/SHA/成功结论与 PASS/FAIL |
| 恢复最后以精确 run 启用 user-2，且只做 OTP/session/status | NOT_RUN | 不记录 OTP/metadata 值；只记录 run ID/SHA/成功结论 |
| 恢复中所有写入性 run 成功；若有非 success、超时或结果未知，已立即完成 `disable-all` 与关闭复核 | NOT_RUN | 无异常时仅在全部精确 run success 后标 PASS；有异常时仅在关闭复核成功后标 PASS，否则 BLOCKED |

## H. `delete-account` 条件性破坏性跨通道门禁

标准 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW` 不执行 `delete-account`。正常成功路径只完成第一行，其余行保持 `NOT_RUN`；这组 `NOT_RUN` 是“条件流程未激活”的确定状态，不是遗漏。只有另行取得明确的破坏性跨通道批准后，才把第一行标为 `BLOCKED` 并开始评估后续条件项；在另行流程结束前，本检查表不能给出标准 GREEN。

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| 标准流程完全禁止 `delete-account`；本次未批准、未派发、未执行 | NOT_RUN | 正常成功路径必须为 PASS；只记录 PASS/FAIL |
| 另行批准明确唯一 target slot，并确认文字与照片共用状态不可恢复 | NOT_RUN | 不记录账号身份值；未批准不得继续 |
| 另行批准确认会删除所有通道 active lease、幂等键、分钟/日计数、共用 account flag 与缓存状态 | NOT_RUN | 只记录 PASS/FAIL |
| 文字 global=false、照片 global=false，且 Worker text=false、photo=false | NOT_RUN | 只记录布尔判断 |
| 没有在途 workflow、浏览器/供应商请求或协调器 active lease | NOT_RUN | 只记录 PASS/FAIL |
| `budgetReservedMicros=0` | NOT_RUN | 不复制预算值；只记录 PASS/FAIL |
| 变更单使用精确确认短语 `DELETE_TEXT_PREVIEW_ACCOUNT_STATE` | NOT_RUN | 不记录其他 input |
| 该操作不用于修复计数、回滚发布或替代标准恢复流程 | NOT_RUN | 只记录 PASS/FAIL |
| 精确 run ID/SHA/结论与删除后跨通道状态已按单独变更单复核 | NOT_RUN | 仅记录 run ID/SHA/成功结论与 PASS/FAIL |

## I. 最终决策

| 检查项 | 状态 | 脱敏记录 |
| --- | --- | --- |
| A–G 全部为 PASS，且 H 第一行 PASS、其余 H 行保持 NOT_RUN | NOT_RUN | 仅记录 PASS/FAIL |
| 最终结论记录为 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW` | NOT_RUN | 未满足前不得填写绿色结论 |
| 最终结论同时声明“生产和照片 AI 未启用” | NOT_RUN | 必须与绿色结论同时出现 |
