# 铁证文字 AI Preview：首次配置向导最小输入研究

- 核对日期：2026-08-26（Asia/Shanghai）
- 目标：把 `text-ai-preview` 的首次配置压缩为一个本地向导，尽量减少人工填项
- 证据范围：Cloudflare、GitHub CLI/官方 REST 文档、火山方舟官方文档和当前仓库代码
- 操作边界：本记录未调用任何真实写 API，未读取或输出任何 secret 值

## 一页结论

当前首次配置可压缩为 **4 个用户输入**：

1. `CLOUDFLARE_API_TOKEN`；
2. `ARK_API_KEY`；
3. `TEXT_AI_USER_1_EMAIL`；
4. `TEXT_AI_USER_2_EMAIL`。

其余值可由向导自动得到：

| 目标值 | 自动化方式 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 从已有 GitHub Environment variable 读取，不再询问用户 |
| `TEXT_AI_TEAM_DOMAIN` | Cloudflare Organization API 返回 `auth_domain`，验证 `.cloudflareaccess.com` 后缀后取 team slug |
| `TEXT_AI_CF_ACCESS_CLIENT_ID` | Cloudflare API 创建 Access service token 后从响应取得 |
| `TEXT_AI_CF_ACCESS_CLIENT_SECRET` | 同上；仅在创建响应中捕获，立即通过 stdin 写入 GitHub |
| `PHOTO_AI_CACHE_AES_KEY` | 本地密码安全随机生成 32 字节，转 canonical Base64 |
| `PHOTO_AI_ACCOUNT_HMAC_KEY` | 本地密码安全随机生成 |
| `TEXT_AI_ADMIN_EMAIL` | 精确复用 user-1 邮箱 |

这个结论依赖两个前提：本机 `gh` 已登录并有目标仓库 Environment 管理权限；Cloudflare Zero Trust organization 已存在。

## 1. Cloudflare Access service token 可自动创建

Cloudflare 官方提供 `POST /accounts/{account_id}/access/service_tokens`。创建所需的账户级权限是 `Access: Service Tokens Write`；创建响应包含 `client_id` 与 `client_secret`。[Cloudflare Service token 指南](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) [Cloudflare Create service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/)

`client_secret` 只在生成时显示；丢失后不能用 list/get 重新取回，需轮换或新建 token。因此向导必须在同一进程内：

1. 创建 token；
2. 严格验证响应中 `client_id` 与 `client_secret`；
3. 不打印、不落盘、不放入命令行参数；
4. 立即把两个值分别通过子进程 stdin 写入 GitHub Environment。

当前仓库校验器要求 client ID 为小写并以 `.access` 结尾；Cloudflare 官方 Service token 示例也是该格式。[仓库校验逻辑](../../../scripts/text-ai-preview-control.mjs)

重跑不能无条件再创建一枚 token。向导应先按固定名称列出已有 token：若发现同名 token 但 GitHub 端尚无对应 secret，应失败关闭并要求单独确认轮换/重建，不得静默制造多枚长期凭证。

## 2. Team domain 可自动发现

`GET /accounts/{account_id}/access/organizations` 返回 `result.auth_domain`；官方定义是 Zero Trust organization 的唯一子域名。该只读调用可使用 `Access: Organizations, Identity Providers, and Groups Read` 权限。[Get your Zero Trust organization](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/list/)

仓库实际需要的是 slug，不是完整域名：例如 API 返回 `team-name.cloudflareaccess.com`，向导应只写入 `team-name`。必须校验精确后缀、小写 slug 格式且拒绝其他域名；仓库后续会自行组装 `https://<slug>.cloudflareaccess.com`。[仓库 team slug 校验](../../../scripts/text-ai-preview-control.mjs) [Cloudflare Access JWT issuer 说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

因此不需要再让用户手工填 `TEXT_AI_TEAM_DOMAIN`。若 organization 尚未创建，则会涉及 team 名称与 Zero Trust 身份边界；最小向导应停止并引导用户去 Cloudflare 控制台完成，不应静默新建 organization。

## 3. GitHub CLI 可通过 stdin 安全写入指定 Environment

GitHub CLI 的 `gh secret set` 和 `gh variable set` 在不传 `--body` 时都从 stdin 读值；`--env` 选定 deployment environment，`--repo` 选定仓库。`gh secret set` 还会先在本地加密 secret 再发送。[`gh secret set`](https://cli.github.com/manual/gh_secret_set) [`gh variable set`](https://cli.github.com/manual/gh_variable_set)

实现应由向导直接把每个值写入单个 `gh` 子进程的 stdin，命令只包含 secret 名称、`--env text-ai-preview` 和 `--repo nuts-and-bytes/tiezheng`。不使用 `--body` 传值，不使用 shell 拼接，不开启 tracing，不生成 `.env` 或临时 secret 文件，不把子进程输入/返回值写入日志。

GitHub 官方 REST 文档补充说明：Environment secret 在发送前必须用 Environment public key 加密，细粒度 token 需要仓库 `Environments: write`；classic token 对私有库需 `repo` scope。[`Create or update an environment secret`](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret)

当前 runbook 明确禁止 CLI 写 secret。所以实施向导前必须先更新运维规则：仅放行“本地隐藏输入/进程内生成 → 单项 stdin → 精确指定 Environment”这一条路径，其他命令行参数、聊天、日志和落盘传递仍禁止。[当前 runbook](../../operations/text-ai-preview-runbook.md)

## 4. Cloudflare API Token 最小权限变化

向导使用的 `CLOUDFLARE_API_TOKEN` 仍须覆盖当前部署/预检所需权限，但要把两个能力固定为：

- `Access: Service Tokens Write`：代替仅读要求，用于创建 service token；
- `Access: Organizations, Identity Providers, and Groups Read`：不能只选更窄的 Identity Providers Read，因为向导要读 organization 的 `auth_domain`。

其余仍按当前 runbook 的精确 account scope：`Account API Tokens Read`、`Workers Scripts Write/Edit`、`Pages Write/Edit`、`Access: Apps and Policies Write/Edit`，不扩大到所有 account、zone、user 或 R2。Cloudflare 官方权限目录将这些列为 account permissions，并建议通过 permission-group API 取得当前 ID。[Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) [当前 runbook 权限表](../../operations/text-ai-preview-runbook.md)

## 5. 为什么 `ARK_API_KEY` 仍需用户提供

火山方舟官方的长期推理调用说明要求从方舟 API Key 管理控制台取得 `ARK_API_KEY`，再以 Bearer token 调用模型。[火山方舟 Responses API 示例](https://www.volcengine.com/docs/82379/1795150) [方舟 API Key 管理](https://console.volcengine.com/ark/apiKey)

方舟确实有 `GetApiKey` 接口，但它生成的是限定资源、最长 30 天的临时 API Key，调用前还需要火山引擎 AK/SK、资源类型和资源 ID。这会把 1 个输入扩大为多个更高权限凭证/参数，还引入定期轮换，不符合“越简单越好”。[`GetApiKey` 临时密钥 API](https://api.volcengine.com/api-explorer/?action=GetApiKey&groupName=%E5%85%B6%E5%AE%83&serviceCode=ark&version=2024-01-01)

因此最小向导不自动生成方舟密钥，只接收用户已在方舟控制台创建的稳定 `ARK_API_KEY`。

## 6. 仍可能需要 UI 或人工决策的步骤

| 情况 | 处置 |
|---|---|
| Cloudflare API token 不存在、秘密值已丢失或权限不足 | 需在 Cloudflare Dashboard 创建/编辑并复制新 token。初始能创建其他 token 的 token 也必须先由 Dashboard 创建，不能无凭证自举。[Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/) |
| `ARK_API_KEY` 尚未创建或已丢失 | 需进入方舟 API Key 管理控制台创建/复制 |
| 本机 `gh` 未登录或当前账号无 Environment 写权限 | 需运行 `gh auth login` 完成浏览器/设备授权，或由仓库管理员授权 |
| Cloudflare Zero Trust organization 不存在 | 最小向导不静默创建；需由用户确认 team 名称与身份边界 |
| 同名 Access service token 已存在，但 client secret 无法取回 | 需显式选择轮换或新建；不能自动猜测/读回旧 secret |

## 7. 建议的一次性向导流程

1. 只读检查 `gh` 登录、仓库、Environment、已有 secret 名称与 `CLOUDFLARE_ACCOUNT_ID`；
2. 在 TTY 隐藏输入中读取 Cloudflare token 和 Ark key，再读取两个邮箱；
3. 只读验证 Cloudflare token 的精确 account scope/权限，自动读取 `auth_domain`；
4. 生成 AES/HMAC key，校验全部本地值；
5. 显示仅含名称和目标资源的变更预览，由用户一次确认“创建 Access service token 并写入 `text-ai-preview`”；
6. 创建 service token，将 9 个 secret 与 2 个 variable 逐项通过 stdin 写入 GitHub Environment；
7. 只检查远端名称集合，不读值；然后运行关闭态 `preflight`，不立即发起真实模型请求。

该流程将“创建外部凭证”与“启用 AI/发起真实模型请求”保持为两个独立门禁。
