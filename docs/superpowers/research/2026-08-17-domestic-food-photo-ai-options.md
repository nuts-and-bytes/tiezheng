# 铁证 Stage 2：国内食物照片识别、三账号登录与无备案域名内测方案

- 核对日期：2026-08-17（Asia/Shanghai）
- 决策状态：Stage 2 内测技术选型建议，不是生产上线批准
- 适用范围：仅 3 个预先登记的白名单测试账号；中国大陆网络无需代理；用户目前没有自有备案域名
- 证据门槛：仅使用厂商官方产品文档、价格页、服务协议、隐私说明和备案说明
- 证据边界：厂商宣称的中国大陆地域或端点不等于三网、所有设备均可稳定访问；价格、免费额度和控制台条件会上线前再次核对

## 一页结论

### 推荐组合

| 层 | Stage 2 推荐 | 原因 | 仍需验证 |
|---|---|---|---|
| 食物照片模型 | 火山方舟 doubao-seed-2-1-pro-260628 | 中国大陆北京端点、支持 Base64 图像、日期化模型 ID、支持严格 JSON Schema（Beta） | 用铁证真实食物照片做准确率/拒识率测试；结构化输出仍须本地校验 |
| 备选模型 | 阿里云百炼 qwen3.7-plus-2026-05-26 | 中国大陆北京地域、日期化快照、图像输入和有效 JSON 输出、隐私说明明确不使用用户数据训练 | Qwen 的 JSON Schema 约束不是严格执行；若成本优先再评估 qwen3-vl-flash-2026-01-22 |
| 条件备选 | 腾讯 TokenHub hy-vision-2.0-instruct | 中国大陆服务、价格与免费额度明确、可在同一腾讯云体系内采购 | 当前视觉模型文档未确认严格 JSON Schema、Base64 输入和不可变快照 |
| 前端与 HTTPS | 腾讯云 CloudBase 静态托管的系统默认 HTTPS 域名 | 官方提供 tcloudbaseapp.com 默认域名，定位为开发/测试；无需先拥有自有域名 | 默认域名有频率、有效性检查和浏览器行为限制；须对正式构建做三网真机验证 |
| 登录 | CloudBase 邮箱 6 位验证码；只允许已预建的 3 个用户 | 验证码 10 分钟、一次性、同邮箱 60 秒一次、同 IP 每小时最多 10 次，并支持异常图形验证码 | 当前套餐是否启用内置邮件代理、3 个测试邮箱能否稳定收信 |
| AI 网关 | CloudBase 服务端函数；密钥只放服务端 | 便于强制白名单、原子配额、成本熔断和删除流程 | 默认 HTTP 域名对接口响应的限制、函数调用路径和日志脱敏须实测 |

Stage 2 可以在没有自有备案域名的情况下进行，但只能按封闭开发/测试运行：使用 CloudBase 的系统默认 HTTPS 域名、预建 3 个账号、关闭公开注册，并在服务端调用火山方舟。CloudBase 官方把默认域名定位为开发/测试；公开生产仍应使用已经完成 ICP 备案的自定义域名。

“无需用户自有 ICP 域名”是根据厂商向环境分配系统域名、且官方把 ICP 要求写在自定义生产域名流程中的工程推断，不是法律意见，也不代表默认域名可长期公开运营。

## 1. 铁证不可放松的产品与安全约束

1. 手工记录和预设食物必须继续离线可用；拍照识别是可选增强，不得成为记录饮食的唯一入口。
2. 只有已登录的 3 个白名单测试账号能发起照片识别；关闭自助注册、匿名识别和分享链接。
3. 每张照片发送前单独同意；同意记录绑定照片哈希、请求 ID、供应商政策版本和短时有效期。若同一照片改发另一家供应商，必须再次明确同意。
4. 原始照片不进入对象存储，不写数据库，不写日志；服务端在内存中压缩/转发后释放。客户端只保留用户已知的压缩缩略图。
5. 模型只返回食物候选、可能份量/区间和需用户确认的问题。卡路里、蛋白质等营养值只能在用户确认食物和份量后，由版本化食物目录计算。
6. 不能把单张照片识别宣传为精确称重或营养诊断；混合菜、油酱、遮挡和剩余量都必须让用户确认。
7. 固定模型 ID、系统提示版本/哈希、JSON Schema 版本、食物目录版本和网关版本；历史记录不得随模型更新静默重算。
8. 图像内文字、文件名和模型输出均为不可信输入；禁止模型输出直接生成 HTML、链接、数据库查询或后续工具调用。
9. 供应商的 RPM/TPM 不是铁证的用户配额。铁证仍需原子的账号/全局限额、并发限制、幂等键和成本熔断。
10. 账号删除必须同时停止登录、撤销刷新令牌，并清除铁证云端的识别请求元数据；供应商依法或按协议保留的数据不能被描述为“立即零保留”。

## 2. 国内视觉模型对比

### 2.1 能力与集成

| 项目 | 火山方舟 Doubao（推荐） | 阿里云百炼 Qwen（备选） | 腾讯 TokenHub HY Vision（条件备选） |
|---|---|---|---|
| 建议模型 | doubao-seed-2-1-pro-260628 | qwen3.7-plus-2026-05-26 | hy-vision-2.0-instruct |
| 中国大陆服务端点 | 北京：ark.cn-beijing.volces.com | 北京工作空间：cn-beijing.maas.aliyuncs.com | TokenHub 中国大陆端点：tokenhub.tencentmaas.com |
| 服务端 API | Chat Completions/Responses，Bearer API Key | OpenAI 兼容 API，工作空间 API Key | OpenAI 兼容 API，TokenHub API Key |
| 图像输入 | URL、Base64；SDK 还支持本地路径/Files | URL、本地文件、Base64 | 当前 HY Vision 专页明确 URL；Base64 未获该模型官方确认 |
| 结构化输出 | json_schema + strict=true，官方标 Beta | 可要求有效 JSON；Qwen 的 schema 约束不作严格执行 | 通用语言模型文档有 JSON Schema，但 HY Vision 专页未确认适用 |
| 模型固定 | 日期化模型 ID | 日期化快照 ID | 未见日期化不可变快照保证 |
| 提示固定 | 均需铁证自行保存 prompt_version、prompt_hash 和 schema_version；没有发现供应商替铁证固定业务提示版本的官方能力 |
| 本轮主要阻断 | Beta 结构化输出仍可能失败；精确留存时长不公开 | 无严格 schema；精确留存时长不公开 | schema、Base64、快照稳定性、模型级限额均待确认 |

官方依据：

- 火山方舟的[模型列表](https://docs.volcengine.com/docs/82379/1330310)列出日期化 Seed 模型；[Chat Completions API](https://api.volcengine.com/api-docs/view?action=ChatCompletions&serviceCode=ark&version=2024-01-01)给出北京端点和服务端鉴权方式。
- 火山方舟的[视觉理解输入说明](https://docs.volcengine.com/docs/82379/1362931)列出 URL、Base64、SDK 本地文件/Files 等图像方式；[结构化输出说明](https://docs.volcengine.com/docs/82379/1568221)支持 json_schema 和 strict，但明确仍须处理模型未完全遵循结构的情况，且该能力为 Beta。
- 阿里云百炼的[视觉理解模型说明](https://help.aliyun.com/zh/model-studio/vision-model/)推荐新视觉项目使用 Qwen3.7 Plus，并列出图像数量、像素和 token 规则；[Qwen3.7 Plus 模型页](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)列出 qwen3.7-plus-2026-05-26、图像输入、结构化输出与上下文能力。
- 阿里云的[结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)证明 Qwen 可返回有效 JSON；但[Anthropic Messages 兼容文档](https://help.aliyun.com/zh/model-studio/anthropic-api-messages)说明严格 JSON Schema 只对其中列出的 DeepSeek/GLM 型号生效，Qwen 会回落为普通 JSON 模式，不能把“接受 schema 参数”写成“严格按 schema 生成”。
- 阿里云的[地域与端点说明](https://help.aliyun.com/zh/model-studio/regions/)列出中国大陆北京工作空间端点、地域内推理和数据驻留说明。
- 腾讯云的[TokenHub 模型列表](https://cloud.tencent.com/document/product/1823/130051)列出 hy-vision-2.0-instruct；[多模态 API 文档](https://cloud.tencent.com/document/product/1823/130988)说明 HY Vision 的图片格式、大小、数量和 URL 输入。
- 腾讯云的[旧混元平台迁移通知](https://cloud.tencent.com/document/product/1729/131925)说明旧平台计划于 2026-09-30 下线，因此本轮只考虑 TokenHub 新端点，不建议新接旧接口。

### 2.2 请求与文件限制

| 供应商 | 官方限制摘要 | 铁证 Stage 2 自设上限 |
|---|---|---|
| 火山方舟 | URL/Base64 单图小于 10 MB；Base64 请求体合计不超过 64 MB；SDK 本地文件上限 512 MB；宽高均大于 14 px，总像素 196–36,000,000，长宽比 1:150 至 150:1；格式含 JPEG/PNG/WebP 等；多图数量受上下文限制 | 每次仅 1 张；JPEG/PNG/WebP；压缩后不超过 5 MB；去 EXIF；异常尺寸/长宽比拒绝 |
| 阿里云百炼 | Qwen3.7 URL 图像不超过 20 MB，本地/Base64 不超过 10 MB；URL/本地最多 2048 张，Base64 最多 250 张；多数视觉模型单图最高 16M 像素 | 同左侧统一自设上限，不使用供应商的超大批量能力 |
| 腾讯 HY Vision | JPG/JPEG/PNG/WebP；单图不超过 10 MB；通用接口最多 20 图，但 HY Vision 型号限制 1 图 | 每次 1 张；若选择腾讯，先确认安全的 Base64 或一次性私有 URL 方案 |

铁证的 5 MB/单图上限是产品风控政策，不是供应商要求。它减少上传耗时、成本和解码攻击面，但仍须在服务端验证 MIME 魔数、实际像素、解码成功、压缩后大小和超时；不能只信文件扩展名或客户端声明。

### 2.3 价格、免费额度与平台限额

以下均为 2026-08-17 官方页面显示的人民币公开价或活动额度；最终以同日控制台、具体地域、计费方式和主账号资格为准。

| 供应商/模型 | 输入价（每百万 token） | 输出价（每百万 token） | 免费额度 | 官方平台限额/配额 |
|---|---:|---:|---|---|
| 火山方舟 doubao-seed-2.1-pro | ¥6 | ¥30 | 产品页显示每模型 50 万 token；资格和有效期需控制台确认 | 模型文档列 500 RPM、1,000,000 TPM；上限不等于承诺容量，仍可能 429 |
| 阿里云 qwen3.7-plus-2026-05-26（输入不超过 256K） | ¥2 | ¥8 | 通常每模型 100 万 token、开通后 90 天；精确额度看控制台 | 当前模型页列 30,000 RPM、5,000,000 TPM；快照/地域需控制台复核 |
| 阿里云 qwen3-vl-flash-2026-01-22（输入不超过 32K） | ¥0.15 | ¥1.5 | 通常 100 万 token、90 天 | 快照页列 60 RPM、100,000 TPM |
| 腾讯 hy-vision-2.0-instruct | ¥7.5 | ¥17.5 | 多模态理解模型 100 万 token、1 年；官方活动页显示活动至 2026-12-31 | HY Vision 的精确模型级 QPM/TPM 未公开；在线服务可配置 QPM/TPM 上限，须控制台确认 |

来源：

- 火山引擎[豆包大模型产品价格页](https://www.volcengine.com/product/doubao)；火山方舟[模型限流说明](https://docs.volcengine.com/docs/82379/1848593)。
- 阿里云百炼[模型价格页](https://help.aliyun.com/zh/model-studio/model-pricing)、[新用户免费额度](https://help.aliyun.com/zh/model-studio/new-free-quota/)、[Qwen3.7 Plus 模型页](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)和[Qwen3-VL Flash 模型页](https://help.aliyun.com/zh/model-studio/qwen3-vl-flash)。
- 腾讯 TokenHub[模型价格](https://cloud.tencent.com/document/product/1823/130055)、[免费额度](https://cloud.tencent.com/document/product/1823/130053)和[在线推理限额配置](https://cloud.tencent.com/document/product/1823/130087)。

#### Doubao 粗略成本示例

火山方舟文档给 Seed 2.0 以上模型的 high 图像细节约 1,280 token/图。若一次请求另含约 200 个输入文本 token，并输出 300–500 token：

- 输入：约 1,480 × ¥6 / 1,000,000 ≈ ¥0.0089；
- 输出：300–500 × ¥30 / 1,000,000 ≈ ¥0.009–0.015；
- 单次约 ¥0.018–0.024，可按 ¥0.02–0.03 预留；
- 全局每天最多 30 次时，纯模型费约 ¥0.6–0.9/日。

这是基于 token 假设的预算估算，不是账单承诺；重试、文本长度、图像细节档位、税费和其他云资源会改变实际成本。

### 2.4 数据训练、地域与留存

| 供应商 | 官方可确认 | 不能据此宣称 |
|---|---|---|
| 火山方舟 | 视觉输入文档称处理后的图像/视频会被删除，提交的媒体/文本不用于训练；服务协议称除非另行同意或参加奖励计划，不将客户数据用于训练、再训练或改进模型 | 没有找到统一、精确的日志/合规留存天数；不能宣称零留存或请求结束立即删除全部记录 |
| 阿里云百炼 | 隐私说明明确不使用用户数据进行模型训练；北京地域说明称静态数据存北京、过程数据不持久化、推理在中国大陆进行 | 隐私说明也写明会按法律要求保存模型/应用调用数据，未给统一精确期限；不能把过程数据不持久化扩大为所有日志零留存 |
| 腾讯 TokenHub | 中国服务条款称在中国境内处理，仅按客户指示处理，在必要期间保留，并在处理停止后停止使用、返还或删除 | 中国条款没有给精确天数；不能把腾讯国际版材料中的期限套用到中国 TokenHub |

官方依据：

- 火山方舟[视觉理解输入说明](https://docs.volcengine.com/docs/82379/1362931)和[大模型服务协议](https://docs.volcengine.com/docs/82379/1142195)。
- 阿里云百炼[隐私政策](https://help.aliyun.com/zh/model-studio/privacy-notice)和[地域与端点说明](https://help.aliyun.com/zh/model-studio/regions/)。
- 腾讯 TokenHub[服务条款](https://cloud.tencent.com/document/product/301/129852)。

Stage 2 应在开通日保存实际主账号看到的协议版本和控制台截图，关闭可选的数据授权/奖励计划。若铁证隐私标准要求精确留存天数，应先向供应商提交工单并获得书面答复；本轮官方公开材料不足以证明任何一家绝对零留存。

### 2.5 中国大陆开通与可达性

| 供应商 | 开通要求 | 大陆证据 | 仍需真机验证 |
|---|---|---|---|
| 火山方舟 | 注册、实名认证、开通方舟并开通具体模型 | 官方提供北京端点和中国大陆服务；可选北京 PrivateLink | 中国移动/联通/电信，iOS/Android/桌面，家庭网/蜂窝网 |
| 阿里云百炼 | 按地域开通；使用付费资源需实名认证与充值，API Key 可限制 IP/模型 | 官方提供北京工作空间端点，并说明地域内推理/数据驻留 | 同上；还要确认工作空间 endpoint、DNS、TLS |
| 腾讯 TokenHub | 腾讯云账号实名认证、开通 TokenHub、创建 API Key | 官方提供中国 TokenHub 服务与中国境内数据处理条款 | 同上；不得因与 CloudBase 同厂商就跳过网络测试 |

开通资料：

- 火山方舟[注册、实名认证与模型开通](https://www.volcengine.com/docs/82379/1326340)及[PrivateLink 访问](https://docs.volcengine.com/docs/82379/1339360)。
- 阿里云百炼[常见问题与开通要求](https://help.aliyun.com/zh/model-studio/faq-about-alibaba-cloud-model-studio)和[API Key 权限控制](https://help.aliyun.com/zh/model-studio/get-api-key/)。
- 腾讯云[实名认证说明](https://cloud.tencent.com/document/product/378/3629)。

这些材料证明厂商在中国大陆提供服务与端点，不证明用户所在三家运营商的最后一公里体验。Stage 2 的 Go/No-Go 必须包含真实网络测试。

## 3. 三账号登录方案

### 3.1 方案比较

| 方案 | 三账号白名单 | 邮箱 OTP/魔法链接 | 无自有域名 | 大陆可用证据 | 结论 |
|---|---|---|---|---|---|
| 腾讯 CloudBase 身份认证 | 可由管理员预建用户；发送接口 target=USER 可仅面向已有用户 | 6 位邮箱/短信验证码和邮件 Magic Link；10 分钟、一次性 | Magic Link 回调官方示例可使用 CloudBase 默认域名；数字 OTP 不依赖回调链接 | 腾讯云中国服务与国内默认域名；仍无三网永远可达承诺 | 推荐 |
| 阿里云 IDaaS EIAM/CIAM | 支持账号、组、应用授权和删除 | 官方支持邮箱/短信验证码、OIDC/OAuth、CAPTCHA/风险控制 | 通用登录页可托管；本轮未找到足够官方证据证明面向 3 个消费者账号的零域名、零自备发信配置和低成本组合 | 中国云服务 | 能做但明显过重；询价和 PoC 后再考虑 |
| 自建邀请码 + 邮箱 OTP | 可以完全自定义 | 需自行生成、哈希、过期、重放防护、限流和邮件送达 | 阿里云 DirectMail 要求配置发信域名/DNS，用户当前无域名；个人 QQ/163 SMTP 可绕过自有域名，但可靠性和账号安全由铁证承担 | 取决于邮件提供方与部署 | 不优先；CloudBase 内置身份已覆盖 |
| Supabase Auth | 可用后台/数据库实现 allowlist | 支持 OTP、Magic Link、Invite | Auth 本身不托管铁证前端；生产邮件需自定义 SMTP | 官方地域列表没有中国大陆，未提供中国大陆网络可达 SLA | 不作为当前首选 |

### 3.2 CloudBase 登录证据与实现边界

CloudBase 的[发送验证码接口](https://docs.cloudbase.net/http-api/auth/auth-send-verification)可发送 6 位邮箱/短信验证码和邮件 Magic Link：

- 验证码/链接有效 600 秒且一次性；
- 同一邮箱 60 秒内只能发送一次；
- 同一 IP 每小时最多 10 次；
- 异常发送会要求图形验证码；
- target=USER 时仅向已经存在的用户发送；
- Magic Link 的 email_redirect_to 官方示例允许使用环境默认 tcloudbaseapp.com 域名。

因此 Stage 2 应先由管理员创建 3 个用户，关闭公开注册，发送时固定 target=USER，并在业务网关再次校验规范化邮箱是否在 allowlist。不能只依赖页面没有注册按钮。

[登录接口](https://docs.cloudbase.net/http-api/auth/auth-sign-in)返回访问/刷新令牌；[登录态文档](https://cloud.tencent.com/document/product/876/121347)给出的默认有效期为访问令牌约 2 小时、刷新令牌约 30 天。退出、删号和管理员封禁后必须撤销或拒绝刷新令牌。

CloudBase 在 2025-12-18 的[产品动态](https://cloud.tencent.com/document/product/876/48508)记录了身份认证增加零配置内置邮件代理；[邮件提供方配置结构](https://cloud.tencent.com/document/product/876/34822)也区分默认代理与自定义邮件服务。但实际套餐、地域和账号是否能启用，必须在控制台核对并向 3 个目标邮箱实投。若不可用，[邮箱登录配置](https://docs.cloudbase.net/authentication/method/email-login)提供 QQ 邮箱 SMTP 示例；此时须使用专用发信账号和应用密码，不得使用个人主邮箱密码。

CloudBase 的[功能和优势页](https://cloud.tencent.com/document/product/876/40406)列出个人版新用户免费期及其后 ¥19.9/月的公开说明；[套餐与计费页](https://cloud.tencent.com/document/product/876/75213)把基础身份登录列为套餐能力。活动资格、免费期、资源量和邮件额度仍须以开通日控制台为准，不能把 ¥19.9/月写成完整 Stage 2 总成本。

CloudBase 提供[用户自助删除](https://docs.cloudbase.net/http-api/auth/user-delete-me)和[管理员批量删除](https://cloud.tencent.com/document/product/876/127960)。铁证仍需把身份删除与自己的识别请求元数据、配额记录和本地数据导出/删除流程串联，不能把两者当成自动完成。

数字 OTP 优先于 Magic Link。Supabase 的[生产上线指南](https://supabase.com/docs/guides/deployment/going-into-prod)提醒邮件安全扫描器可能提前访问一次性链接；这是通用邮件链路风险。CloudBase 文档未承诺免疫该风险，因此三账号内测优先使用 6 位验证码，减少回调和预取问题。

### 3.3 为什么当前不选 Supabase

Supabase 的[官方地域列表](https://supabase.com/docs/guides/platform/regions)没有中国大陆区域，最近可选地域之一为新加坡；官方没有提供中国大陆三网可达性或 SLA。因此不能仅凭个人访问成功就声称大陆无需代理稳定可用。

Supabase 的[Auth SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)说明默认发信只适合试用：只向团队预授权地址发送、约每小时 2 封且 best-effort、无 SLA；生产需要自定义 SMTP，默认 Auth 发送限额约每小时 30 封。它也不解决前端的国内 HTTPS 承载。只有在三网实测、邮件链路和数据地域风险另行通过评审后，才应重新考虑。

### 3.4 阿里云 IDaaS 与自建 OTP 的边界

阿里云 IDaaS 的[通用登录页](https://help.aliyun.com/zh/idaas/eiam/user-guide/general-logon-page)支持邮箱/短信验证码并限制重试；[CIAM 功能说明](https://help.aliyun.com/zh/idaas/product-overview/product-function-node-idaas)包含 OIDC/OAuth、邮箱/短信登录、账号授权、删除、验证码和风险控制。能力上可以覆盖，但[CIAM 计费](https://help.aliyun.com/zh/idaas/product-overview/product-billing)采用平台基础费/MAU 等企业计费并提示以询价为准，三账号内测的复杂度与成本不成比例。

阿里云 IDaaS 的[自定义邮件网关](https://help.aliyun.com/zh/idaas/eiam/user-guide/custom-email-gateway)说明实例有初始化邮件网关，也可配置自定义发信地址；但本轮官方证据不足以确认该初始化网关对当前所需 CIAM 套餐、3 个消费者账号、无自有发信域名的完整可用性，不能把它写成已验证方案。

阿里云[邮件推送 DirectMail 文档](https://help.aliyun.com/zh/direct-mail/)要求配置发信域名并完成 DNS 验证。用户没有域名，因此自建 OTP + DirectMail 当前被域名条件阻断。

## 4. 无备案域名的 HTTPS 承载

### 4.1 可用于封闭 Stage 2 的默认域名

腾讯 CloudBase 的[静态网站托管文档](https://cloud.tencent.com/document/product/876/46900)明确提供系统默认 tcloudbaseapp.com 域名、HTTPS 和 CDN，并把系统域名定位为开发/测试。CloudBase 的[HTTP 访问服务文档](https://cloud.tencent.com/document/product/876/130728)提供 app.tcloudbase.com 环境默认域名，同时提示：

- 默认域名只适合开发/测试，有访问频率和部分能力限制；
- 浏览器可能出现安全有效性提示；
- 生产环境应绑定已完成 ICP 备案的自定义域名；
- 可在服务侧配置身份认证和路由限流。

腾讯云的[默认域名安全能力调整公告](https://cloud.tencent.com/announce/detail/2119)进一步说明，2025-10-09 后默认域名有有效性检查；某些非普通浏览器导航请求可能被附加 Content-Disposition 下载响应；默认域名到期后需续期。

这使 CloudBase 默认域名适合 3 人、短期、封闭的 Stage 2，但不能只看到首页能打开就算通过。必须用正式构建的 SPA/PWA 验证：

1. HTML、JS chunk、CSS、字体、图标和 manifest 均正常加载，不被强制下载；
2. 登录/刷新令牌、Service Worker、路由刷新和深链正常；
3. 前端到函数/HTTP 网关的 POST、CORS、JSON 响应和超时正常；
4. 中国移动/联通/电信，iPhone Safari、Android 主流浏览器和桌面浏览器均通过；
5. 域名有效期、套餐、默认域名开关和异常告警可被项目管理员维护。

CloudBase 的[产品能力说明](https://cloud.tencent.com/document/product/876/18431)与[静态托管/云函数说明](https://cloud.tencent.com/document/product/876/46894)证明其可承载静态前端、函数与身份能力；但它们不构成最后一公里 SLA。

### 4.2 仍然需要 ICP 备案的情况

CloudBase 的[自定义域名与备案 FAQ](https://cloud.tencent.com/document/faq/876/128405)明确要求中国大陆生产自定义域名完成 ICP 备案，并说明备案可能需要 1–20 个工作日及相应环境条件。公开生产、品牌域名、稳定回调和长期运营应按这个路径准备，不能永久依赖系统默认域名。

阿里云函数计算也提供 fcapp.run 默认公网域名，但官方[默认域名限制公告](https://help.aliyun.com/zh/functioncompute/the-default-public-network-domain-name-of-function-compute-is-not-allowed-in-the-production-environment)明确禁止把它用于生产；[配置自定义域名](https://help.aliyun.com/zh/functioncompute/fc/configure-custom-domain-names)要求中国大陆域名已完成 ICP 备案。它可做短期 API 测试，但没有 CloudBase 同等集成的三账号身份闭环，因此不是首选。

### 4.3 本轮不能证明的承载方案

- 没有官方证据证明 CloudBase 默认域名对所有中国大陆运营商、所有时段和所有浏览器都稳定；只能通过实际三网测试降低风险。
- 没有证据允许把开发/测试默认域名视为长期公开生产域名。
- 没有证据证明 Supabase、新加坡区或其他境外托管在中国大陆无需代理且具有稳定 SLA。
- 没有自有域名时，无法完成需要自定义发信域名/DNS 的 DirectMail 正式发信路径。

## 5. Stage 2 推荐架构

    CloudBase 默认 HTTPS 静态域名
            |
            +-- CloudBase 邮箱 6 位 OTP
            |      +-- 仅 3 个预建用户
            |      +-- target=USER
            |      +-- allowlist 二次校验
            |
            +-- 已认证的照片识别请求
                   +-- 每图单独同意 + photo_hash + idempotency_key
                   +-- 服务端解码、魔数/像素校验、去 EXIF、压缩 <= 5 MB
                   +-- 不落对象存储、不记录原图/Base64
                   +-- CloudBase 函数调用火山方舟北京端点
                           model_id = doubao-seed-2-1-pro-260628
                           prompt_hash + schema_version 固定
                           strict JSON Schema + 本地 Ajv/Pydantic 校验
                   +-- 只返回候选食物/份量范围/澄清问题
                   +-- 用户确认后，由版本化食物目录计算营养

选择 Base64 服务端直传 Doubao，可避免为了腾讯 HY Vision 的 URL 输入而创建公网图片 URL，也减少 SSRF、临时签名 URL 泄露和对象存储清理失败的风险。若以后必须使用 URL，需采用私有桶、极短一次性签名、精确对象键、禁止列表、下载次数/时长限制和确认删除；不能把原图暴露在永久公网地址。

## 6. 防滥用与成本控制

### 6.1 Stage 2 建议初始策略

| 控制点 | 建议起始值 | 目的 |
|---|---:|---|
| 白名单账号 | 固定 3 个 | 杜绝公开注册与匿名消耗 |
| 每账号每天成功识别 | 10 次 | 三人最多 30 次/日 |
| 全局每天成功识别 | 30 次 | 固定最大日成本 |
| 每账号每分钟发起 | 2 次 | 抑制脚本突发 |
| 全局并发模型调用 | 2 | 控制资源与重试风暴 |
| 同图去重 | 同账号、同 photo_hash 在 10 分钟内复用结果 | 避免双击/网络重试重复计费 |
| 失败重试 | 只对超时/429/5xx 自动重试 1 次；指数退避和抖动 | 防止放大故障 |
| 每日成本熔断 | 按实际 token/账单事件累计；达到管理员阈值立即关闭 AI | 控制不可预期费用 |
| 账号/全局开关 | 可即时撤销单账号或全局 feature flag | 事故止损 |

成功识别与供应商已计费请求要分开计数：用户配额可在确定失败时返还，但成本账必须记录供应商实际调用。配额扣减、幂等键占位和并发令牌应在同一原子事务/脚本中完成；先查后写会被并发绕过。

### 6.2 鉴权与邮件防滥用

1. target=USER 只给现有 CloudBase 用户发送验证码。
2. 服务端再次检查规范化邮箱/uid allowlist；不信任客户端传入邮箱或角色。
3. 沿用 CloudBase 同邮箱 60 秒、同 IP 每小时 10 次和异常图形验证码，再加账号级日发送上限。
4. 登录错误使用统一文案，不暴露邮箱是否在白名单。
5. 管理员创建/删除用户、调整配额、查看成本均要求独立管理员权限与审计日志。
6. 刷新令牌只放安全存储；Web 端优先评估 HttpOnly/SameSite Cookie 或 CloudBase 推荐的安全会话方式，避免写普通日志和 URL。

### 6.3 AI 网关防滥用

1. API Key 仅存在服务端密钥管理；前端包、浏览器存储、Git、日志均不得出现。
2. 只接受认证后、CSRF/CORS 检查通过的 POST；限制 Content-Type、Content-Length、解码时间和总处理时间。
3. 校验图片魔数并重新编码；去 EXIF；拒绝动画、多页、异常像素、损坏文件和压缩炸弹。
4. 模型输出先做大小上限、JSON 解析、严格本地 schema 校验、枚举/数值范围校验；失败时拒绝并允许用户手工记录，不把脏数据写库。
5. 不执行模型返回的 URL、指令或食物目录外 ID；候选名称只作纯文本展示。
6. 日志只保留 request_id、uid 的不可逆/内部标识、模型/提示/schema 版本、token、耗时、状态码和配额结果；不写照片、Base64、完整提示、邮箱或模型自由文本。
7. 供应商 API Key 同时开启可用的来源 IP/模型权限和账号预算告警，但不得用它替代铁证的 per-user 配额。

## 7. Go/No-Go 清单

### 7.1 允许三账号开始真实照片测试前

- [ ] 明确腾讯云与火山引擎主账号归属、管理员、实名认证、付款方式和丢失恢复人。
- [ ] 开通 CloudBase、方舟及指定日期化模型；在控制台保存当日价格、免费额度、模型限制和协议版本。
- [ ] 用正式构建产物完成 CloudBase 默认域名的 HTML/JS/CSS/PWA/API 测试，不以开发服务器 localhost 代替。
- [ ] 在中国移动、联通、电信及 iOS/Android/桌面完成登录、刷新、上传、超时、重试、手工回退和删号测试。
- [ ] 验证 CloudBase 当前套餐的内置邮件代理；向 3 个真实邮箱分别测试正常、延迟、垃圾箱、重发和验证码过期。
- [ ] 预建准确的 3 个用户，关闭公开注册，启用 target=USER 和服务端 allowlist。
- [ ] 上线每图同意、隐私说明、模型供应商说明、账号删除和 AI 仅供候选、需确认的界面。
- [ ] 固定 model_id、prompt_hash、schema_version、catalog_version，并有回滚值。
- [ ] 完成本地 JSON Schema 校验、图片解码/重编码、幂等、原子配额、并发限制、成本熔断和全局关闭开关。
- [ ] 证明原图不进入对象存储、数据库和日志；用日志扫描/故障注入验证失败路径也不泄露。
- [ ] 用单独获同意的测试集测中文家常菜、混合菜、包装食品、遮挡、模糊、多人份和拒识；不得把同一张真实用户照片静默发给多个供应商。
- [ ] 向供应商工单询问精确日志/合规留存期；若未答复，在隐私说明中如实写官方未提供精确期限，不能宣称零留存。

### 7.2 关键阻断

1. **默认域名尚未真机验收。** CloudBase 官方明确存在开发/测试限制、有效性检查和可能的下载响应行为；验证前不能保证正式 SPA/PWA 与 API 可访问。
2. **邮件代理尚未按当前账号/套餐核实。** 若内置邮件不可用，需专用 QQ SMTP 或重新选身份方案；不能用未验证的发信链路邀请测试用户。
3. **供应商留存没有精确天数。** 三家公开中国材料都不足以证明所有日志零留存；高隐私承诺需工单书面答复。
4. **真实食物准确率未知。** 通用视觉能力、JSON 能力和价格都不能证明中国家常菜、油酱与份量准确；候选制和用户确认不可取消。
5. **生产域名仍被 ICP 阻断。** 默认域名只批准封闭 Stage 2；公开生产前须取得自有域名并完成中国大陆 ICP 备案，或重新做经法律与三网验证的部署决策。
6. **旧版 Turnstile 方案需另立 ADR。** 本轮没有官方材料证明 Cloudflare Turnstile 在中国大陆无需代理、三网稳定；Stage 2 应使用 CloudBase 的异常图形验证码、白名单和服务端配额，不能在未验证时保留 Turnstile 作为硬依赖。

## 8. 最终建议

1. 以 CloudBase 默认 HTTPS 域名 + CloudBase 邮箱数字 OTP + 3 个预建账号，完成无自有备案域名的封闭 Stage 2。
2. 服务端只接 doubao-seed-2-1-pro-260628；固定模型/提示/schema，严格 JSON Schema 后再做本地校验。不要把结构化输出 Beta 当成安全边界。
3. AI 只负责食物候选和份量询问；营养值由用户确认后的版本化目录计算。
4. 初始配额设每人 10 次/日、全局 30 次/日、全局并发 2，并上线幂等、成本熔断和一键停用。
5. 同一批获独立同意的测试照片可用于离线比较 Qwen3.7 Plus；只有当准确率/拒识/延迟显著更优时再换。腾讯 HY Vision 在 schema、Base64、版本固定和模型限额获得官方确认前不进入主链路。
6. 默认域名只作为内测过渡。公开生产不通过，直到备案自定义域名、稳定邮件发送、精确隐私承诺、三网回归和真实菜品验收全部完成。
