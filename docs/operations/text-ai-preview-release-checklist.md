# 文字餐食 AI Preview 发布检查表

本表与 `docs/operations/text-ai-preview-runbook.md` 配套使用。当前执行依据是 2026-08-27 访问码认证设计；旧 Access 配置文档只能作为历史记录，不能用于首次配置。

状态只有：

- `PASS`：有本次实际证据，且证据符合 allowlist。
- `NOT_RUN`：尚未执行，不能计入 GREEN。
- `BLOCKED`：缺权限、结果未知或补偿/关闭未确认。
- `FAIL`：实际违反固定边界。

Evidence 只允许 commit SHA、run ID、固定资源名称或名称集合结论、固定状态、布尔判断和命令 exit 0。不得记录访问码、secret、JWT、Cookie、IP、账号键、Cloudflare account ID、workflow URL、远端响应、餐食正文或供应商原文。

## A. 范围与授权 gate

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| 固定仓库为 `nuts-and-bytes/tiezheng`，Environment 为 `text-ai-preview`，账号槽位只有 `user-1` / `user-2` | NOT_RUN | 只记录 PASS/FAIL |
| 文字认证无 Zero Trust、邮箱、OTP、Access app/service token | NOT_RUN | 运行时代码与 workflow 零旧形状命中 |
| 照片 Access 边界未被删除、复用或放宽 | NOT_RUN | 精确 allowlist；不记录 identity metadata |
| Gate A 只批准关闭态 setup；不包含部署、启用或模型调用 | NOT_RUN | 记录批准边界，不复制凭证 |
| Gate B 的 Preview 部署有独立明确授权 | NOT_RUN | 没有授权必须保持 `NOT_RUN` |
| Gate C 的真实模型调用有另一份独立明确授权 | NOT_RUN | 没有授权不得发送餐食请求 |
| 任一 gate 的成功没有被当作下一段的自动授权 | NOT_RUN | 只记录 PASS/FAIL |

## B. 代码与完整本地门禁

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| `npm test` exit 0 | NOT_RUN | 记录实际 test 数量和 exit 0 |
| `npm run test:edge` exit 0 | NOT_RUN | 记录实际 test 数量和 exit 0 |
| `npm run typecheck` exit 0 | NOT_RUN | 不复制无关输出 |
| `npm run typecheck:edge` exit 0 | NOT_RUN | 不复制无关输出 |
| `npm run build` exit 0 | NOT_RUN | 构建不部署 |
| `npm run verify:text-preview-setup` exit 0 | NOT_RUN | 固定报告必须为 2 inputs / 11 secrets / 1 variable / 2 codes / 0 Cloudflare writes |
| `npm run verify:text-preview-workflow` exit 0 | NOT_RUN | 固定报告证明 manual-only、protected Environment、生产/照片关闭、单次 provider 尝试 |
| `git diff --check` exit 0 | NOT_RUN | 只记录 PASS/FAIL |
| 变更范围只含文字认证、管理 HMAC、setup/workflow/verifier 和本文档 | NOT_RUN | 照片模型、营养契约和生产开关无无关改动 |

## C. GitHub 与 Cloudflare 首次配置前置条件

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| checkout 干净、分支为 `main`、push remote 精确、受保护远端 `main` SHA 与本地 `HEAD` 相同 | NOT_RUN | 只记录 SHA 和 PASS/FAIL |
| `text-ai-preview` Environment 存在，只允许 `main` deployment branch policy，无 reviewer | NOT_RUN | 不记录 API 响应 |
| 既有 variable 名称集合精确为 `CLOUDFLARE_ACCOUNT_ID` | NOT_RUN | 只核对名称，不读取或记录值 |
| 首次运行前目标 11 个 secret 全部不存在 | NOT_RUN | 任一已存在即 `BLOCKED`；不读取值 |
| Cloudflare token 只覆盖目标 account | NOT_RUN | 禁止 all accounts、zone、user、R2 或混合 scope |
| `Account API Tokens Read` 已验证 | NOT_RUN | 只记录 PASS/FAIL |
| `Workers Scripts Edit` 已验证 | NOT_RUN | 只记录 PASS/FAIL |
| `Cloudflare Pages Edit` 已验证 | NOT_RUN | 只记录 PASS/FAIL |
| token 没有任何额外 Access 权限 | NOT_RUN | 只记录 PASS/FAIL |
| Pages 项目 `tiezheng` 与 Worker `tiezheng-photo-ai-gateway` 唯一存在 | NOT_RUN | 不记录资源 ID |
| 新窄 token 验证通过后才撤销旧 `tiezheng-text-ai-preview-setup` Access setup token | NOT_RUN | 顺序颠倒即 FAIL |

## D. 11+1 inventory 与向导执行

Environment secret 名称必须精确为：

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

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| 唯一入口是 `npm run setup:text-preview` | NOT_RUN | 真实本地 TTY |
| prompt 只隐藏读取 Cloudflare API Token 与 `ARK_API_KEY` | NOT_RUN | 不输入邮箱，不记录值 |
| 随机源依次请求 24、24、32、32、32、32、32、32、32 bytes | NOT_RUN | 只记录 PASS/FAIL |
| 两个访问码均为 32 字符 canonical base64url，互不相同，各只显示一次 | NOT_RUN | 操作者分别保存；evidence 不得含明文 |
| 七个 32-byte key 相互独立；两个 digest 分别为目标 code/pepper 的 HMAC-SHA-256 | NOT_RUN | 只记录 PASS/FAIL |
| 访问码明文未进入 GitHub stdin、preview summary、异常、补偿、文件或日志 | NOT_RUN | verifier 和故障测试通过 |
| GitHub 只通过 `shell:false` 的有界 `gh` stdin 写 11 个 secret | NOT_RUN | argv 与 shell history 无值 |
| 名称核对精确为 11 secrets + 1 existing variable | NOT_RUN | 只看名称集合 |
| Cloudflare setup 阶段零资源写入 | NOT_RUN | 不调用 Access API，不创建 token/app/policy |
| 关闭态 preflight 精确 run 成功，Worker text=false、photo=false | NOT_RUN | 只记录 run ID、SHA、成功结论 |
| 成功输出精确为 `SETUP COMPLETE` 和固定 11/1/preflight 布尔摘要 | NOT_RUN | 不允许额外自由文本 |
| success、cancel、validation failure、partial failure、output failure、preflight block 后所有本地 secret Buffer 归零 | NOT_RUN | 故障注入 PASS |
| partial failure 只逆序删除本次尝试写入的 GitHub secret | NOT_RUN | 不删除既有 variable，不写 Cloudflare |

## E. 关闭态部署 gate

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| setup 成功后仍未部署、未启用、未调用模型 | NOT_RUN | 固定状态与供应商用量差值 |
| `deploy-disabled` 获得单独授权并绑定受保护 `main` 的精确 SHA | NOT_RUN | 未授权保持 `NOT_RUN` |
| Pages Preview env 精确为 9 个文字/账号 binding + `PHOTO_AI_GATEWAY` service binding | NOT_RUN | 只核对名称、类型与目标，不读值 |
| Worker text=false、photo=false；文字 global=false；两个账号初始关闭 | NOT_RUN | 只记录布尔判断 |
| 未登录请求返回固定认证错误；登录成功但未启用时返回固定关闭状态 | NOT_RUN | 不记录 Cookie、JWT、访问码或正文 |
| 生产入口、照片入口与供应商用量不变 | NOT_RUN | 只记录差值 PASS/FAIL |

## F. 用户认证、限流与管理 HMAC

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| Cookie 为 `__Host-tiezheng-text-ai-session`，`HttpOnly; Secure; SameSite=Strict; Path=/`，无 Domain | NOT_RUN | 只记录 PASS/FAIL |
| 30 天 Cookie：`Max-Age=2592000`，JWT 有效期不超过 30 天 | NOT_RUN | 不记录 JWT |
| JWT 仅 HS256、固定 issuer/audience、subject 只能是两个槽位，含当前 credential version | NOT_RUN | 不记录 token |
| 单账号 code/digest 轮换只使该账号旧 JWT 失效 | NOT_RUN | 另一账号 session 仍有效 |
| 正常桶 5 次失败后第 6 次冷却 15 分钟；计数窗口 10 分钟 | NOT_RUN | 不记录 IP 或 attempt key |
| 匿名桶 3 次失败后第 4 次冷却 30 分钟；计数窗口 10 分钟 | NOT_RUN | 缺失/异常 IP 不绕过限流 |
| 成功登录清除对应失败状态；原始 IP 未进入 Worker、存储或日志 | NOT_RUN | 只记录 PASS/FAIL |
| 管理 HMAC 覆盖 version/method/path/timestamp/operationId/body hash | NOT_RUN | 不记录签名或 body |
| 管理 timestamp 最大偏差正负 5 分钟 | NOT_RUN | 过窗请求固定拒绝 |
| operation ID/fingerprint 防重放保留 24 小时；同 ID 不同 fingerprint 拒绝 | NOT_RUN | 只记录 PASS/FAIL |
| 管理目标只能是 `user-1` / `user-2`，无邮箱或任意字符串 | NOT_RUN | 只记录 PASS/FAIL |

## G. 轮换、紧急关闭与恢复

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| `npm run rotate:text-preview-code -- --target=user-N` 只显示目标 code 一次并要求已保存确认 | NOT_RUN | 不记录 code |
| 单账号轮换只写目标 PEPPER/DIGEST，另一槽位名称未进入 `gh set` | NOT_RUN | 只记录目标槽位和 PASS/FAIL |
| workflow 精确使用 `rotate-user-code`、target、`ROTATE_ONE_TEXT_ACCESS_CODE`、批准 SHA | NOT_RUN | 不记录 secret |
| deploy 失败只提供固定 `--resume=user-N`；resume 不生成/显示/重写 secret | NOT_RUN | 只记录固定状态 |
| 全 session key 轮换先关闭文字 AI，再替换 key、重新应用 Pages binding、关闭态 preflight | NOT_RUN | 两账号旧 JWT 均失效 |
| `disable-all` 总是尝试 global off 与 Worker disabled 两步 | NOT_RUN | 任一步失败均为 `BLOCKED` |
| disable summary 只含 0–3 failureMask 和两步 attempted/failed 布尔值 | NOT_RUN | 不含错误正文或标识符 |
| 泄露响应先使用仍可信凭证关闭全局文字 AI，再轮换对应 secret | NOT_RUN | 泄露 bearer 先在 provider UI revoke |
| 账号 HMAC 不被盲目轮换；需要独立身份迁移设计 | NOT_RUN | 防止既有状态失联 |

### G.1 `disable-all` 2² 故障矩阵

G=关闭 global，W=部署 Worker disabled。两步都必须尝试。

| G | W | 预期 | 状态 |
|---|---|---|---|
| 成功 | 成功 | failureMask=0，退出 0 | NOT_RUN |
| 失败 | 成功 | failureMask=1，退出非零 | NOT_RUN |
| 成功 | 失败 | failureMask=2，退出非零 | NOT_RUN |
| 失败 | 失败 | failureMask=3，退出非零 | NOT_RUN |

## H. 真实模型调用 gate

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| Gate C 获得明确批准，并写明允许的账号与请求次数 | NOT_RUN | 默认只允许 user-1 一次 |
| 真实请求前重新证明 global/user-1/Worker 已按批准启用，user-2 仍按边界处理 | NOT_RUN | 只记录布尔判断 |
| 供应商尝试次数不超过 1，预算与账号额度差值符合预期 | NOT_RUN | 不复制 prompt/response |
| 确认候选前不写入本地饮食记录；确认后只出现一条预期记录 | NOT_RUN | 不复制餐食正文 |
| user-2 未获得第二次模型调用授权 | NOT_RUN | 只验证登录/session/status/额度隔离 |
| 任一异常立即派发并核验 `disable-all` | NOT_RUN | 关闭未知时保持 `BLOCKED` |

## I. 最终决策

| 检查项 | 状态 | 证据边界 |
|---|---|---|
| 旧身份形状扫描按 runbook 执行，文字运行时/控制脚本/workflow 零命中 | NOT_RUN | 照片保留项使用精确 allowlist |
| 明文密钥/JWT 形状扫描无真实值 | NOT_RUN | test-only placeholder 必须被 verifier 分类 |
| GitHub、Cloudflare、浏览器、Durable Object 与构建产物无未授权敏感命中 | NOT_RUN | 只记录安全类别和 PASS/FAIL |
| Gate A 本地完成 | NOT_RUN | 不代表已部署 |
| Gate B Preview 部署完成 | NOT_RUN | 不代表已调用模型 |
| Gate C 授权范围内验收完成 | NOT_RUN | 未授权时保持 NOT_RUN |
| 最终结论为 GREEN / BLOCKED / FAIL | NOT_RUN | 任一必需项非 PASS，不得写 GREEN |
