# 铁证 Stage 2：三账号食物照片识别设计

**日期：** 2026-08-18

**状态：** 用户已批准，待实施计划

**代码基线：** `99115a5c702f212d15ca07c1e3964f799f4e4181`

**一级来源调研：** [`../research/2026-08-17-domestic-food-photo-ai-options.md`](../research/2026-08-17-domestic-food-photo-ai-options.md)

## 1. 文档地位

本文是 [`2026-08-14-tiezheng-nutrition-and-onboarding-design.md`](2026-08-14-tiezheng-nutrition-and-onboarding-design.md) 的 Stage 2 实施补充。原规范继续约束本地营养、候选确认、健康评价、备份和安全文案；本文只把照片识别阶段的身份、网关、模型、防滥用、数据边界和内测放行条件固定下来。

本文在以下三点覆盖旧规范的待定或过时选择：

1. Stage 2 身份采用 Cloudflare Access 邮箱一次性验证码，不引入独立密码系统。
2. Stage 2 网关采用现有 Cloudflare Pages 项目的 Pages Functions、Images Binding 和 Durable Object，不迁移现有站点。
3. 三账号内测不把 Turnstile 作为硬依赖；白名单身份、JWT 校验、原子配额、幂等和预算熔断构成主要防线。公开开放前必须重新评估 CAPTCHA、域名和中国大陆网络证据。

## 2. 目标与非目标

### 2.1 目标

- 仅向 3 个预先批准的邮箱开放真实食物照片识别。
- 用户可现场拍摄或从相册选择，并在清晰拍摄提示后逐图同意上传。
- AI 返回可编辑的食物、做法、份量和营养范围候选；用户确认后才写入当日饮食。
- 训练、体重、手动饮食和预设食物继续无账号、离线、本地可用。
- 原图不进入铁证的对象存储、数据库、Cache Storage 或应用日志。
- 每账号、全局和月度费用都有服务端硬限制，并支持紧急关闭。
- 失败、取消、登录过期、限流和模型异常不会生成半条饮食记录。

### 2.2 非目标

- 不向所有用户开放注册或照片识别。
- 不迁移 `tiezheng.pages.dev`、不购买域名、不做 ICP 备案。
- 不把训练、体重、营养计划或饮食历史同步到云端。
- 不让 AI 结果自动入账，不把分类置信度当作营养估算置信度。
- 不在本期建立公开中国菜准确率承诺、医疗建议或减重保证。
- 不接入 DeepSeek 作为图片模型；[DeepSeek 官方集成说明](https://api-docs.deepseek.com/quick_start/agent_integrations/github_copilot/)明确当前 V4 图片需由另一个视觉模型代理，增加该链路只会扩大延迟、费用和隐私边界。
- 不为三账号内测新增面向用户的管理后台。

## 3. 已批准决策

| 决策 | Stage 2 取值 |
|---|---|
| 开放范围 | 3 个白名单测试账号 |
| 登录 | Cloudflare Access 托管邮箱 OTP 页面 |
| 登录边界 | 只保护 AI 照片接口；核心 App 继续无账号可用 |
| 前端承载 | 保留现有 Cloudflare Pages |
| 网关 | 同一项目的 Pages Functions |
| 图片处理 | Cloudflare Images Binding 对原始字节解码、缩放、转 WebP |
| 原子协调 | 单个 Stage 2 Durable Object 协调三账号和全局状态 |
| 主模型 | 火山方舟 `doubao-seed-2-1-pro-260628` |
| 备选模型 | `qwen3.7-plus-2026-05-26` 仅作离线对比，不自动回退 |
| DeepSeek | 不进入图片识别链路 |
| 用户额度 | 每账号 10 次/日、2 次/分钟、1 个并发 |
| 全局额度 | 30 次/日、2 个并发 |
| 模型预算 | 每自然月 ¥50 硬上限 |
| 图片来源 | 现场拍摄与相册选择 |
| 同意 | 每张图片单独同意，默认 10 分钟失效 |
| 原图 | 请求结束或取消后释放，铁证服务端不保存 |
| 入账 | 用户确认后才写本地记录 |
| 复杂食物 | 宽范围与关键假设；过于不确定则拒绝数值 |
| 公开发布 | 不属于本阶段；另行审批 |

`¥50` 是模型调用的应用级硬上限。Cloudflare Workers、Access、Durable Objects 和 Images 的平台费用按 Cloudflare 账单另计，并设置账号级预算提醒；不得把模型熔断误写成整张云账单的绝对上限。

## 4. 用户流程与界面

### 4.1 入口

用户从今日页的“今日饮食”进入 `/health`。早餐、午餐、晚餐和加餐继续保留“选择食物”，并新增同级但强调更低的“拍照识别”。不新增底部标签，也不把 AI 做成首页主叙事。

生产界面延续铁证的冷黑金属底、暖白文字、暖灰辅助信息和铁橙单一强调色。预设食物继续使用已批准的真实食物图片；AI 候选优先显示本次餐食缩略图或匹配到的目录图片，不生成卡通食物图标。

### 4.2 登录与恢复

首次点击“拍照识别”时先检查 AI 功能开关和 Access 会话：

1. 已登录：进入拍摄提示。
2. 未登录：在本机保存日期、餐次和流程意图，然后导航到受 Access 保护的会话端点。
3. Cloudflare 托管页向白名单邮箱发送一次性验证码。
4. 验证成功后返回原日期和餐次；此时尚未选图，因此无需跨页面持久化上传副本。
5. 非白名单邮箱看到统一结果，不暴露白名单内容。

返回地址固定为同源 `/health`，日期和餐次从本机状态恢复；服务端不接受任意外部 `return` URL，避免开放重定向。

Access 会话在选图后失效时，保留日期、餐次和已编辑的文字候选；上传副本只保留在当前页面内存。需要整页跳转或页面已重载时，用户重新选择照片，铁证不为“无感恢复”把上传副本写入持久存储。

### 4.3 拍摄、预处理和同意

拍摄提示包含：

- 光线充足、食物完整入镜；
- 优先俯拍或 45°；
- 避免严重遮挡；
- 油、酱、糖和饮料需要单独核对；
- 需要更好份量估算时加入已知尺寸参照物。

用户选择现场拍摄或相册后，客户端创建两个临时副本：

- 上传副本：JPEG、PNG 或 WebP 解码后重编码，最长边不超过 `1600px`，目标不超过 `1 MB`；
- 本机缩略图：WebP，最长边不超过 `320px`，目标不超过 `100 KB`。

客户端计算上传副本 SHA-256。同意页必须展示本次缩略图，并说明：

- 图片经 Cloudflare 基础设施处理后发送给火山方舟；
- 用途仅为生成食物、做法、份量和营养范围候选；
- 铁证不把原图写入服务端存储或应用日志；
- 第三方供应商的精确合规日志留存天数未在公开资料中统一披露；
- AI 结果需要用户核对，取消后可使用本地手动记录；
- 提供当前供应商隐私政策链接和政策版本。

同意绑定现有 `MealEstimateConsentBinding`：

```ts
interface MealEstimateConsentBinding {
  uploadBlobSha256: string;
  requestId: string;
  providerPolicyVersion: string;
  consentedAt: number;
  expiresAt: number;
}
```

`expiresAt = consentedAt + 10 分钟`。重选图片、重编码后哈希变化、取消、超时、模型或供应商政策版本变化时立即清除绑定。

### 4.4 候选确认

AI 最多返回 6 项。确认页至少允许：

- 删除错误候选；
- 修改食物身份；
- 修改生熟、烹饪方式或复合菜说明；
- 修改实际吃下的份量和单位；
- 补充油、酱、糖、饮料和未吃完部分；
- 重新拍摄；
- 转到预设或手动记录。

候选阶段为 C 级，只存在 `mealEstimates`，不计入餐次、热量、蛋白质或目标评价。用户确认后写入 `mealItems`，方法为 `ai-confirmed`，质量为 B。分类置信度不展示为营养置信度。

## 5. 系统架构

```text
Cloudflare Pages 静态前端
  → Cloudflare Access 路径级 OTP
  → Pages Function 验证 Access JWT、Origin 和请求边界
  → Images Binding 解码、检查、缩放、WebP 重编码
  → Durable Object 原子预留幂等、额度、并发和预算
  → Pages Function 内存中 Base64 调用火山方舟北京端点
  → 固定模型、提示和 JSON Schema
  → 服务端结构与语义校验
  → 加密临时结果缓存
  → 浏览器本机候选确认
  → Dexie 单事务写确认条目和缩略图
```

### 5.1 Cloudflare Access

Access Application 只覆盖照片 AI API 路径，不保护静态 App。策略包含 3 个精确邮箱并启用 One-time PIN。前端不保存密码，代码和客户端包不包含邮箱白名单。

Pages Function 必须再次验证：

- `Cf-Access-Jwt-Assertion` 存在；
- RS256 签名来自配置的 Team Domain JWKS；
- `iss`、`aud`、`exp`正确；
- 邮箱经规范化后仍在服务端白名单；
- Access `sub` 能转换为内部伪匿名账号键。

仅检查请求头存在不构成鉴权。白名单和 Audience Tag 属于服务端配置；变更需要审计。

关键平台能力以 Cloudflare 官方文档为准：[One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[Access JWT 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Pages Functions](https://developers.cloudflare.com/pages/functions/)、[Images Binding](https://developers.cloudflare.com/images/optimization/binding/)和[图片元数据处理](https://developers.cloudflare.com/images/optimization/features/)。

### 5.2 Pages Functions API

Stage 2 暴露以下同源接口：

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/nutrition/photo/session` | 触发或确认 Access 会话，返回剩余额度、重置时间和服务状态 |
| `POST` | `/api/nutrition/photo/estimate` | 接收单张压缩图片并返回结构化候选 |
| `POST` | `/api/nutrition/photo/logout` | 生成 Access 退出流程，不删除本地饮食数据 |

所有 JSON 响应使用固定错误码，不返回供应商原始错误、堆栈、提示词或模型自由文本。接口仅接受 `https://tiezheng.pages.dev` 及批准的 Pages Preview Origin；其余 Origin 失败关闭。Preview Origin 必须是精确列表，不能使用任意 `*.pages.dev`。所有变更请求同时要求同源 `Origin`、预期的 `Sec-Fetch-Site` 和受 Access 保护的会话；不能只依赖 Cookie 的 SameSite 属性。

`POST /estimate` 使用单图 multipart 请求，元数据只包含：

- `requestId`；
- 至少 128 bit 随机 `idempotencyKey`；
- `uploadBlobSha256`；
- `modelVersion`；
- `promptVersion`；
- `schemaVersion`；
- `catalogVersion`；
- `locale=zh-CN`。

日期、餐次、体重、年龄、营养目标和历史记录不发送到网关。日期和餐次只在本机把返回候选关联到当前 `mealId`。

### 5.3 图片处理

服务器按以下顺序处理：

1. 在读取完整请求体前检查方法、Origin、Content-Type 和 Content-Length。
2. 对上传字节重新计算 SHA-256，并与同意绑定声明一致。
3. Images Binding `.info()` 验证真实格式、宽高、像素和文件大小。
4. 拒绝动画、多页、损坏文件、异常长宽比和解压炸弹。
5. Images Binding 从原始字节生成最长边不超过 `1600px` 的单帧 WebP；WebP 输出丢弃不可见元数据。
6. 不启用 Workers Cache，不把输入或输出写入 R2、KV、D1、Durable Object、日志或分析事件。
7. 只把重编码后的单张 WebP 在内存中转换为 Base64 并发送给模型。

服务端硬限制不信任客户端目标值。multipart 总体上限应略高于 `1 MB` 以容纳边界和元数据，但图像部分解码后仍须满足统一上限。

### 5.4 Durable Object 协调器

Stage 2 使用一个逻辑协调器统一管理三账号和全局状态，以避免跨对象事务缺口。协调器负责：

- 每账号分钟/日额度；
- 全局日额度；
- 每账号和全局并发；
- 自然月模型成本；
- 幂等键与请求指纹；
- 供应商调用是否已经发生；
- 加密临时候选缓存；
- 全局和单账号紧急开关。

请求指纹绑定：

```text
accountKey
+ uploadBlobSha256
+ transformVersion
+ modelVersion
+ promptVersion
+ schemaVersion
+ catalogVersion
```

同键同指纹合并到同一进行中任务或返回 10 分钟内的同一结果；同键不同指纹返回冲突。幂等状态为 `reserved | invoked | succeeded | failed`，保留 24 小时。

结构化结果使用应用级 AES-GCM 密钥加密后临时保存，最长 10 分钟；缓存包含候选内容，但不含图片、邮箱或健康资料，且不得进入可搜索日志或分析。密钥只存在 Workers Secret，轮换规则进入实施计划。

## 6. 模型与输出合同

### 6.1 固定调用

主链路只调用 `doubao-seed-2-1-pro-260628`。模型 ID、火山方舟地域、系统提示、提示哈希、Schema、目录版本、图片转换版本和网关版本都进入发布清单和请求指纹。模型别名或自动升级别名不得进入生产配置。

请求只包含：

- 一张已重编码 WebP；
- 固定中文系统提示；
- 有限的版本化食物目录标识、名称、别名和做法信息；
- 输出 Schema。

图片内文字、文件名和模型输出全部视为不可信文本。模型不能调用工具、访问 URL、执行图片内指令或决定服务端食物 ID。

火山结构化输出的 strict JSON Schema 仍是 Beta，因此服务端本地校验是安全边界。超时、截断、非 JSON、额外字段、枚举外值、非有限数值或越界值统一返回 `invalid-estimate`，不把半成品交给用户。

### 6.2 候选数据

现有 `MealEstimateCandidate` 在不新增 Dexie 索引的前提下扩展为：

```ts
type EstimateNutrientSource = 'catalog' | 'model-range' | 'none';

interface MealEstimateCandidate {
  id: string;
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
  nutrientSource: EstimateNutrientSource;
  energyKcalLow: number | null;
  energyKcalHigh: number | null;
  proteinGLow: number | null;
  proteinGHigh: number | null;
  assumptions: string[];
}
```

服务端再分配候选 ID，不信任模型提供的 ID。候选最多 6 项；文本、数组长度、份量和营养值使用显式上限并要求有限、非负、上下界有序。

三种营养来源的语义：

1. `catalog`：`catalogFoodId` 必须存在于当前版本目录。服务端丢弃模型营养值，客户端用目录密度和份量范围计算。
2. `model-range`：仅用于目录外或复合菜。必须同时包含能量、蛋白质范围和关键假设；界面始终显示范围和“估算不确定性较高”。服务端不接受模型给出的窄区间作为权威值，须经版本化的不确定性策略向外扩展并向外舍入。该策略通过真实餐食验证前，条目可进入摄入区间汇总，但不得生成精确“剩余量”、达标宣称或自动调低目标。
3. `none`：图片不足以给出安全范围。营养字段必须为空，用户重新拍摄、拆分或手动记录。

模型返回的范围不得变成精确完成度。内部需要单点字段时可保存经过明确舍入的区间中点，但所有 B 级展示和评价继续使用上下界；中点不构成精确声明。

### 6.3 确认与本地快照

所有照片确认条目使用现有：

```ts
method: 'ai-confirmed';
quality: 'B';
```

目录匹配条目从 `Food` 构造版本化快照；目录外条目的 `sourceVersion` 绑定模型、提示、Schema 和不确定性模型版本。`assumptions` 保存用户已核对的做法、份量和油酱等关键假设，不保存模型自由推理文本。

一个确认动作必须在单个 Dexie 事务中：

1. 校验目标餐次仍有效；
2. 创建或更新全部已确认 `mealItems`；
3. 写入最终本机 `mealPhoto` 缩略图和新的 `mealSnapshotHash`；
4. 把 `mealEstimate` 标记为 confirmed 后清理临时同意与候选状态。

任一步失败全部回滚。确认前不写 `mealItems`，确认后日汇总沿用现有 live query 自动更新。

`mealEstimates` 仍不进入 JSON 备份；`mealPhotos` 仍只在本机并遵守现有恢复清理合同。扩展候选没有新增索引需求，因此保持当前 Dexie schema version；如果实施发现需要新索引，必须独立审查 DB 与备份合同，不能顺手升级。

## 7. 状态与失败降级

```text
idle
  → auth-required
  → preprocessing
  → awaiting-consent
  → uploading
  → estimating
  → needs-confirmation
  → confirmed
```

`idle` 和 `auth-required` 是界面流程状态，不新增到持久化的 `MealEstimateStatus`；`MealEstimate` 从 `preprocessing` 开始记录，鉴权失败继续使用现有 `error='auth-required' | 'auth-expired'` 合同。

既有错误码继续作为客户端权威合同，并为 Stage 2 增加 `service-disabled`、`budget-exceeded` 和 `consent-expired`。这些字段只扩展临时 `mealEstimates`，不进入 JSON 备份：

- `unsupported-file`：重新选择或手动记录；
- `image-too-large` / `decode-failed`：不调用模型；
- `offline`：保留本机草稿并切回本地入口；
- `auth-required` / `auth-expired`：重新登录，保留日期、餐次和文字编辑；
- `quota-exceeded`：显示上海时区重置时间；
- `rate-limited`：显示可重试时间；
- `service-disabled`：全局或账号开关关闭，提供手动入口；
- `budget-exceeded`：显示下月重置且不调用模型；
- `consent-expired`：返回同意页，不复用旧绑定；
- `provider-timeout` / `provider-unavailable`：同一幂等键允许受控重试；
- `invalid-estimate`：拒绝模型半成品；
- `uncertain-food`：重新拍摄、拆分或手动记录。

错误使用页面内提示，不调用 `window.alert()`。任何失败都不得修改当日总量、删除既有餐次、留下上传副本或让同一幂等请求重复扣用户次数。

## 8. 防滥用、配额与预算

### 8.1 初始值

| 控制 | 值 |
|---|---:|
| 白名单邮箱 | 3 |
| 每账号逻辑识别请求 | 10 次/上海自然日 |
| 每账号速率 | 2 次/分钟 |
| 每账号并发 | 1 |
| 全局逻辑识别请求 | 30 次/上海自然日 |
| 全局并发 | 2 |
| 模型月预算 | ¥50/上海自然月 |
| 结果幂等缓存 | 10 分钟 |
| 幂等状态 | 24 小时 |
| 轮换 IP HMAC | 最长 48 小时 |
| 请求级运维日志 | 最长 30 天 |

额度由服务端配置，不进入客户端可修改状态。响应返回本账号剩余次数、重置时间和 AI 全局状态。

### 8.2 扣减语义

- 鉴权、同意、文件和图片处理失败发生在 `invoked` 前，不扣逻辑识别次数。
- 一旦向豆包发出请求，本次用户调用结算一次；成功、超时和非法模型输出都不能被免费无限重放。
- 客户端重试复用同一幂等键，不重复扣用户次数。
- 每次供应商尝试前先按配置的最大输入/输出 token 和当前价格原子预留最坏成本；余额不足即返回 `budget-exceeded`。响应成功后按实际用量结算并释放差额；超时或缺少用量时保留保守预留，避免并发请求突破 ¥50。
- 服务端只对 429、5xx 或超时自动重试最多 1 次；第二次供应商尝试必须再次预留成本，进入真实成本，但不再扣一次用户逻辑额度。
- 实际 token 用量、保守预留与价格版本进入成本台账。达到 ¥50 后全局 AI 失败关闭，手动记录继续工作。
- 价格配置缺失、过期或计算异常时失败关闭，不用“未知成本”继续调用。

### 8.3 IP 与设备边界

原始 IP 只在请求内存中与每日轮换密钥生成 HMAC；日志和 Durable Object 不保存原始 IP。设备侧只可使用本站随机 ID，用户清除站点数据后可删除；不采集 Canvas、字体、硬件或其他稳定指纹。

三账号阶段不依赖 Turnstile。若白名单扩大、出现验证码轰炸或公开注册需求，先写新 ADR，验证中国大陆可达性和一次性 token 语义后再引入 CAPTCHA。

Access 在请求到达铁证网关前发送 OTP，因此应用级 Durable Object 无法替代邮件发送侧限流。内测放行必须向三个邮箱实测发送频率、过期、重发和异常行为，并记录停用单账号与关闭 Access Application 的应急步骤；无法控制验证码轰炸时保持该账号关闭。

## 9. 隐私、日志与删除

### 9.1 不进入铁证 AI 网关长期存储的数据

- 原始照片；
- 上传 WebP 和缩略图；
- 食物名称、识别候选和营养数值，但允许第 5.4 节定义的 AES-GCM 加密 10 分钟幂等缓存；
- 体重、年龄、身高、目标和历史餐次；
- 完整邮箱和原始 IP，但 Cloudflare Access 作为身份供应商会按其自身条款处理邮箱、IP 和认证审计记录；铁证网关不复制这些字段到应用日志；
- 模型自由推理文本和完整提示。

### 9.2 可保留的运维数据

- request ID；
- 伪匿名账号键；
- 模型、提示、Schema、目录和转换版本；
- 状态、耗时、token 用量、估算成本和配额结果；
- 不可逆轮换 IP HMAC。

请求级运维数据默认不超过 30 天；聚合总量可长期保留，但不能反推出账号或餐食内容。账号从白名单移除时删除可关联的配额、幂等、缓存和运维键；本机训练和饮食数据不随 AI 账号移除自动删除。Cloudflare Access 自身的身份与审计数据遵循供应商控制面删除和留存规则，不能用应用数据库删除承诺替代。

供应商公开资料没有给出所有合规日志的统一精确留存天数。上线文案只能声明铁证自身不保存原图，并准确说明 Cloudflare 身份/基础设施与火山方舟模型的处理边界；开通时保存双方实际协议、隐私政策、地域、价格、数据授权和训练退出设置的版本证据。

## 10. 功能开关与部署

至少保留三个独立门：

1. 客户端构建开关：决定是否显示拍照入口；
2. 网关全局开关：决定是否允许任何模型调用；
3. 账号开关：决定单个白名单账号是否可用。

第一轮部署使用 Cloudflare Pages Preview 环境，客户端开关只在该环境打开。生产 `main` 可以合入代码，但拍照入口默认关闭；完成验收并获得明确放行后才修改生产环境开关。Preview Origin、Access Application 和 Worker 环境变量必须与生产隔离。

真实密钥只通过 Cloudflare Workers Secret 配置：

- 火山方舟 API Key；
- Access Team Domain 与 Audience；
- 白名单配置或其服务端引用；
- 账号伪匿名 HMAC 密钥；
- 结果缓存 AES-GCM 密钥；
- 价格与预算配置。

密钥不得进入 Git、前端变量、构建产物、测试快照或普通日志。

## 11. 验证与放行

正式编码前，单 Ticket 实施计划必须经过 Claude Code 与 Codex 的独立挑战/裁决并取得可验证的 GREEN receipt；设计获用户批准不替代该门禁。若共识生命周期不可用，停止执行并由用户明确决定等待还是豁免，不能把单方自审写成双模型共识。

### 11.1 自动化合同

实施必须以测试先行覆盖：

- Access JWT 缺失、过期、错误签名、错误 issuer/audience、非白名单邮箱；
- 精确 Origin allowlist 与跨站 POST；
- MIME/魔数不一致、损坏图片、动画、多页、异常像素和图片炸弹；
- EXIF/GPS 被去除且处理结果不进入 Cache/R2/日志；
- 同键同指纹并发合并、同键异指纹冲突、跨账号键隔离；
- 分钟/日/月边界、上海时区、并发 1/2 和 ¥50 熔断；
- `reserved/invoked/succeeded/failed` 的扣减与重试语义；
- 模型超时、429、5xx、截断、额外字段、非法枚举、NaN/Infinity 和越界范围；
- 目录营养覆盖模型值、复杂菜宽范围和 `none` 拒绝数值；
- 登录返回恢复原日期/餐次、取消不上传、确认前不入账；
- 多候选与缩略图原子保存和失败回滚；
- 功能开关关闭时本地记录继续工作；
- 网络与日志负向扫描不含图片、邮箱、食物、健康字段或密钥。

CI 默认使用假 Access/JWKS、假 Images Binding、假 Durable Object 和假豆包 adapter。真实供应商合同测试要求显式环境变量、独立预算和人工触发，不在普通 PR/CI 中计费。

### 11.2 真机与模型验收

放行顺序：

1. 本地假模型完成全流程；
2. 管理员账号在 Preview 环境完成真实模型合同测试；
3. iPhone Safari 与 Android Chrome 验证拍照、相册、OTP、返回、弱网和重试；
4. 再加入另外 2 个邮箱；
5. 三账号封闭内测；
6. 公开发布保持关闭。

建立一组称重且有人工作为真值的真实餐食验证集，覆盖单一基础食物、复合菜、汤汁、油酱、饮料、遮挡和空盘。分别记录食物身份、份量区间、热量区间和蛋白质区间表现；分类命中不能替代营养误差。内测用户照片只有在第二份、独立且可撤回的同意后才能进入验证集。

Stage 2 放行硬门：

- 所有确认前不入账和事务回滚测试通过；
- 鉴权、配额、并发、幂等和预算绕过测试通过；
- 网络与日志中未发现受禁数据；
- 三个邮箱 OTP 实投成功；
- 管理员可关闭全局 AI，关闭后手动记录正常；
- 当前模型价格、协议、隐私政策和数据授权设置已留证；
- 真实餐食测试中没有把模糊照片包装成精确结果的系统性行为。

三账号通过只证明封闭内测候选可用，不构成公开生产批准。公开开放仍需要中国真实餐食验证集的接受阈值、营养专业与法律复核、自有域名/ICP 方案、供应商留存答复和新的防滥用 ADR。

## 12. 实施前外部准备

代码可以先使用假适配器完成，但真实识别放行前需要用户在自己的账号中完成：

1. 提供 3 个测试邮箱，由 Cloudflare Access policy 管理，不写入仓库。
2. 在现有 Cloudflare 账号启用 Zero Trust OTP、Pages Functions、Images Binding 和 Durable Objects。
3. 开通火山方舟并创建最小权限 API Key；密钥只写 Workers Secret。
4. 在开通日确认 `doubao-seed-2-1-pro-260628` 可用、北京地域、实际价格、免费额度和限流。
5. 保存并审批火山方舟与 Cloudflare 的条款、隐私和数据处理设置。
6. 配置 Cloudflare 账单提醒；应用内模型预算继续以 ¥50 硬熔断。

任何一步未完成时，生产模型 adapter 保持关闭；本地假模型、界面、状态机和自动化测试仍可继续开发。

## 13. 成功标准

Stage 2 设计目标达成需同时满足：

- 3 个批准邮箱可以登录，其他邮箱不能调用 AI；
- 用户在手机完成拍摄/选图、逐图同意、候选修改和确认；
- 原图不进入铁证服务端持久存储和应用日志；
- 已知食物用目录计算，未知复杂菜只给宽范围或拒绝；
- 未确认结果不影响今日总量，确认后实时更新；
- 同一请求不会重复计费，额度和 ¥50 月预算不能被并发绕过；
- AI 关闭或失败时，训练和本地饮食功能继续完整可用；
- 生产公开用户仍看不到或不能使用未获放行的照片识别。
