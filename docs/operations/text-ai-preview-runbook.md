# 文字餐食 AI Preview 运维手册

本文只适用于受保护的双账号文字 AI Preview。它不授权生产发布、照片 AI、额外账号、第二次真实模型请求或任何凭证外传。

## 1. 固定边界

- GitHub workflow：`.github/workflows/text-ai-preview.yml`，只能从受保护的 `main` 手动触发。
- GitHub Environment：`text-ai-preview`。
- Cloudflare Pages 项目：`tiezheng`；`production_branch` 必须精确为 `main`。
- Pages Preview branch：固定为 `text-ai-preview`。
- Preview origin：`https://text-ai-preview.tiezheng.pages.dev`。
- Worker：`tiezheng-photo-ai-gateway`。
- 文字模型：`doubao-seed-2-1-pro-260628`；`TEXT_AI_MAX_PROVIDER_ATTEMPTS=1`。
- Preview 前端：文字入口开启、照片入口关闭；Worker 端 `PHOTO_AI_GATEWAY_ENABLED=false`。
- 当前允许账号数由 workflow 内部常量精确锁定为 `2`，不是 GitHub Environment variable。
- workflow 不发送餐食请求。唯一真实模型请求只能在 Task 12 的 user-1 浏览器验收中发生一次；user-2 只做 OTP、session 与 `status` 验证。

生产 Pages 配置、生产入口和照片 AI 必须始终不变且关闭。任一检查不能证明该边界时，停止并把对应 checklist 项标为 `BLOCKED`。

## 2. GitHub 保护配置

在仓库 **Settings → Environments → text-ai-preview** 中完成以下外部配置：

1. **Deployment branches and tags** 选择 **Selected branches and tags**。
2. 只添加一个 `Branch` 规则：`main`；不要添加 tag 规则或通配规则。
3. 不得使用存在空规则歧义的 **Protected branches only**。GitHub 官方说明：如果仓库没有任何 branch protection rule，该选项会允许所有分支部署。
4. 配置至少一名 required reviewer，并启用 **Prevent self-review**；触发 workflow 的人不能批准自己的部署。
5. 关闭管理员绕过 protection rules 的能力。
6. `main` 必须被 branch protection 或 ruleset 实际覆盖。workflow 自身还会校验 `github.ref == 'refs/heads/main'` 与 `github.ref_protected == true`。

如果当前仓库可见性或 GitHub 套餐不支持 required reviewer、Prevent self-review、Environment secrets 或精确 deployment branch rule，结论是 `BLOCKED`；不得用无 reviewer、允许自批或宽化分支规则替代。GitHub 当前文档指出，部分套餐下 private repository 的 required reviewers 不可用。

官方依据：

- [管理 GitHub Environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Deployment protection、reviewer、分支规则与 Environment secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Branch protection rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 3. Environment secrets 与 variables

所有值只能由授权人员在 **Settings → Environments → text-ai-preview → Environment secrets / Environment variables** 的 GitHub UI 中输入。不得经聊天、命令行参数、shell history、workflow input、提交文件或 evidence 传递值；本文不提供示例值。

Environment secrets 名称必须恰好包含以下 9 个：

1. `CLOUDFLARE_API_TOKEN`
2. `ARK_API_KEY`
3. `PHOTO_AI_CACHE_AES_KEY`
4. `PHOTO_AI_ACCOUNT_HMAC_KEY`
5. `TEXT_AI_USER_1_EMAIL`
6. `TEXT_AI_USER_2_EMAIL`
7. `TEXT_AI_ADMIN_EMAIL`
8. `TEXT_AI_CF_ACCESS_CLIENT_ID`
9. `TEXT_AI_CF_ACCESS_CLIENT_SECRET`

Environment variables 名称必须恰好包含以下 2 个：

1. `CLOUDFLARE_ACCOUNT_ID`
2. `TEXT_AI_TEAM_DOMAIN`

不要创建 `TEXT_AI_ALLOWED_EMAIL_COUNT` Environment variable；workflow 固定注入精确值 `2`。

Worker secret 名称只有 `ARK_API_KEY` 与 `PHOTO_AI_CACHE_AES_KEY`。`PHOTO_AI_ACCOUNT_HMAC_KEY` 由受保护控制面写入 Pages Preview 的 secret binding，不属于 Worker secret 文件。

只允许检查 secret 名称集合，不允许读取或输出值。API key 的设置路径仅为上述 GitHub UI；禁止使用带值的 CLI 命令或示例密钥。

## 4. Cloudflare token 与只读 preflight

`CLOUDFLARE_API_TOKEN` 必须是目标 Cloudflare account 拥有的 account token，并且所有 allow policy 都只覆盖 Environment variable 指向的那个精确 account；不接受全账号通配、其他 account、user、zone、R2 或混合 scope。

权限名称必须覆盖下表。出现别名时，每行任选一个受支持名称即可。

| 能力 | 接受的官方权限名 |
| --- | --- |
| 检查 account token | `Account API Tokens Read` |
| Worker 读取与部署 | `Workers Scripts Edit` 或 `Workers Scripts Write` |
| Pages 读取与更新 | `Cloudflare Pages Edit` 或 `Pages Write` |
| Access 应用与策略 | `Access: Apps and Policies Edit` 或 `Access: Apps and Policies Write` |
| OTP identity provider | `Access: Identity Providers Read` 或 `Access: Organizations, Identity Providers, and Groups Read` |
| Access service token | `Access: Service Tokens Read` |

`preflight` 先验证 token 为 active，再读取 token detail 与 permission-group catalog；它通过 permission group ID 关联官方名称与 scope，并要求资源键只指向精确 account。之后只读检查：

- Pages 项目存在且 `production_branch` 精确为 `main`；
- Worker 唯一存在，照片开关精确为 false，文字开关是规范布尔值；
- 唯一 OTP provider 存在；
- 配置的 Access service token 唯一存在；
- 所有列表都完整且没有歧义。

任一项失败时，`preflight` 使用固定错误退出，不执行 Cloudflare 写入，也不打印远端响应或凭证。

官方依据：

- [Cloudflare API token 权限目录](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [验证 account token](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/)
- [读取 account token detail](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/get/)
- [Pages production / preview branch control](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

## 5. 本地确定性门禁

任何远程操作前，在目标 commit 上运行：

```bash
npm test
npm run typecheck
npm run build
npm run test:edge
npm run typecheck:edge
npm run test:text-preview-control
npm run verify:text-preview-workflow
npm run deploy:photo-worker -- --dry-run
git diff --check
```

只接受全部退出码为 0。`deploy:photo-worker` 必须带 `--dry-run`；本步骤不登录 Cloudflare、不触发 workflow、不调用模型。

## 6. 首次配置与启用顺序

以下命令只是受保护操作的调用格式。只有 Task 11/12 获得单独远程授权、workflow 已在受保护 `main`、Environment 审批通过后才能运行。不得依赖当前目录、默认仓库或“最近一次 run”。先由审批人把本次允许部署的 40 位 commit SHA 写入当前 shell；它不是 secret，但必须与远端 `main` 完全一致：

```bash
export TEXT_AI_REPO='nuts-and-bytes/tiezheng'
export TEXT_AI_EXPECTED_SHA='<批准的40位SHA>'
```

每个 operation 都必须使用下面的同一套精确绑定函数。`gh workflow run` 必须返回当前 dispatch 的精确 URL；函数只从该 URL 提取纯数字 run ID，然后依次等待该 ID，并验证 event、branch、head SHA、状态、结论和 workflow 名。URL 缺失、格式不符、远端 `main` 漂移、等待超时或任一 metadata 不符都立即 `BLOCKED`；严禁回退到 `gh run list` 的 latest run。

```bash
verify_text_preview_run() (
  set -euo pipefail
  run_id="$1"
  expected_sha="$2"
  repo='nuts-and-bytes/tiezheng'

  if [[ ! "$run_id" =~ ^[0-9]+$ ]] || [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'BLOCKED: invalid run binding' >&2
    return 1
  fi

  watch_exit=0
  gh run watch "$run_id" --exit-status -R "$repo" || watch_exit=$?
  if ! run_json="$(gh run view "$run_id" -R "$repo" \
    --json event,headBranch,headSha,status,conclusion,workflowName)"; then
    printf '%s\n' 'BLOCKED: run metadata unavailable' >&2
    return 1
  fi
  if ! jq -e --arg sha "$expected_sha" '
    .event == "workflow_dispatch"
    and .headBranch == "main"
    and .headSha == $sha
    and .status == "completed"
    and .conclusion == "success"
    and .workflowName == "Text AI Preview Control"
  ' >/dev/null <<<"$run_json"; then
    printf '%s\n' 'BLOCKED: run metadata mismatch' >&2
    return 1
  fi
  if [ "$watch_exit" -ne 0 ]; then
    printf '%s\n' 'BLOCKED: run did not succeed' >&2
    return 1
  fi
  printf 'run_id=%s\nhead_sha=%s\nconclusion=success\n' "$run_id" "$expected_sha"
)

run_text_preview_operation() (
  set -euo pipefail
  operation="$1"
  target="$2"
  confirmation="${3-}"
  repo='nuts-and-bytes/tiezheng'
  expected_sha="${TEXT_AI_EXPECTED_SHA-}"

  if [ "${TEXT_AI_REPO-}" != "$repo" ] || [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'BLOCKED: unapproved repository or SHA' >&2
    return 1
  fi
  remote_main_sha="$(gh api "repos/$repo/commits/main" --jq '.sha')"
  if [ "$remote_main_sha" != "$expected_sha" ]; then
    printf '%s\n' 'BLOCKED: remote main SHA drifted' >&2
    return 1
  fi

  dispatch_output="$(gh workflow run text-ai-preview.yml --ref main -R "$repo" \
    -f operation="$operation" -f target="$target" -f confirmation="$confirmation")"
  run_id=''
  run_url_count=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^https://github\.com/nuts-and-bytes/tiezheng/actions/runs/([0-9]+)(/attempts/[0-9]+)?$ ]]; then
      run_id="${BASH_REMATCH[1]}"
      run_url_count=$((run_url_count + 1))
    fi
  done <<<"$dispatch_output"
  if [ "$run_url_count" -ne 1 ] || [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
    printf '%s\n' 'BLOCKED: exact dispatch run URL unavailable' >&2
    return 1
  fi
  verify_text_preview_run "$run_id" "$expected_sha"
)
```

只允许把函数最后输出的 run ID、SHA 与固定成功结论写入 evidence，不记录 dispatch URL。若 dispatch 已发出但 URL 缺失或格式不符，本次操作立即结束为 `BLOCKED`；不得从 GitHub UI、`gh run list` 或任何“最近一次”结果补绑 run ID，也不得继续后续启用步骤。若该 operation 具有写入性，还必须按下文将其视为结果未知，并立即发起一次可精确绑定的 `disable-all`。

每次等待前一精确 run 成功结束后才能进入下一步，不得并行；workflow 的固定 concurrency group 也不取消正在运行的操作。对 `deploy-disabled`、`enable-admin-preview`、`enable-second-account`、`disable-account`、`delete-account` 或 `disable-all`，任何非成功、超时或结果未知都视为可能已经部分写入。除失败操作本身就是 `disable-all` 外，必须立即精确派发、等待并核验 `disable-all`；若 `disable-all` 失败则修复后重跑。只有关闭 summary 证明 global 与 Worker 两段都成功，且关闭复核证明 global=false、Worker text=false、photo=false，才可称安全关闭。未确认关闭时状态为 `BLOCKED`，禁止直接重试 enable。

### 6.1 `preflight`

```bash
run_text_preview_operation preflight user-1 ''
```

预期：只读检查通过；日志只出现安全的 `command/status/workerTextEnabled` 结果，不出现远端对象正文或敏感值。

### 6.2 `deploy-disabled`

```bash
run_text_preview_operation deploy-disabled user-1 ''
```

它按固定配置执行：

- 创建或校正两个专用 Access Application 及 policy，session duration 均为 `30m`；
- 用户应用仅允许两个固定用户经 OTP 访问；管理应用分别使用管理员 OTP policy 与精确 service token policy；
- Pages 只修改 Preview 配置，建立 `PHOTO_AI_GATEWAY` → `tiezheng-photo-ai-gateway` Service Binding；
- Pages Preview branch 固定为 `text-ai-preview`，`production_branch` 仍为 `main`；
- 部署 Worker 时管理端点开启，但文字模型通道关闭；照片通道关闭，provider attempts 为 1；
- 部署 Preview 前端时文字入口开启、照片入口关闭。

预期 disabled smoke：Preview 静态站可达；未登录 API 被 Access 拦截；允许用户登录后文字 session 返回 `service-disabled`；生产入口、照片入口和供应商用量不变。

### 6.3 `enable-admin-preview`

```bash
run_text_preview_operation enable-admin-preview user-1 ENABLE_ONE_TEXT_PREVIEW_ACCOUNT
```

workflow 在任何启用写入前，先静默捕获 user-1 与 user-2 的管理状态并严格验证：

- Worker 文字开关为 false；
- 文字 global 为 false；
- user-1 与 user-2 的 account flag 都为 false。

这些启用前状态只写入权限为 `0600` 的 runner 临时文件，退出时删除，不打印到日志。门禁通过后才配置 Access、启用 user-1、启用文字 global、写入两个 Worker secret，并把 Worker 文字开关部署为 true。任一前置状态不符时退出，不尝试“修正后继续”。

从 `enable-admin-preview` dispatch 开始，不能再假定闸门保持关闭。其后任何 workflow、OTP/session、显式 `status`、浏览器请求或第二账号门禁出现非成功、超时或结果未知，都必须立即发起一次精确绑定的 `disable-all` 并完成第 8 节关闭复核。关闭未确认成功就是 `BLOCKED`，不得继续验收或直接重试 enable。

### 6.4 唯一真实请求与第二账号

唯一真实餐食请求只能由 user-1 在 Task 12 的受控浏览器验收中手动点击一次。请求前后各运行一次显式 `status` 形成差值；失败、超时或结果未知时禁止刷新、重试或换账号重发，必须立即运行并完整核验第 8 节的 `disable-all` 与关闭复核。关闭未确认成功就标为 `BLOCKED`。

user-2 只能完成 OTP 登录、session 与 `status` 验证，不得输入或发送餐食内容。启用 user-2：

```bash
run_text_preview_operation enable-second-account user-2 ''
```

第二账号启用前，workflow 会静默验证：Worker 文字开关为 true、文字 global 为 true、user-1 已启用、user-2 未启用；目标必须精确为 `user-2`。门禁不符即退出。

## 7. `status` 与账号管理边界

### 7.1 显式 `status`

用户已经授权显式 `status` 将下列 7 个 canonical metadata 字段写入 GitHub Actions 日志：

1. `textGlobalEnabled`
2. `accountEnabled`
3. `accountRemaining`
4. `globalRemaining`
5. `budgetSpentMicros`
6. `budgetReservedMicros`
7. `resetAt`

```bash
run_text_preview_operation status user-1 ''
```

目标也可精确改为 `user-2`。`status` 不直接改变 global/account gate、不发供应商请求，也不新增一次模型消费；但管理协调器会保留短期 operation replay 记录并清理到期 lease/counter 状态，因此不要把它描述为无任何内部写入。workflow 会先严格验证响应结构，再只打印上述 7 字段。

这些数值只用于同一验收 run 前后比较。evidence 不复制数值，只把“account/global 各减少一次”“预算只结算一次”“照片不变”等差值判断记为 `PASS` 或 `FAIL`。

### 7.2 `disable-account`

```bash
run_text_preview_operation disable-account user-2 ''
```

- 目标只能是 `user-1` 或 `user-2`。
- 无额外确认短语，但仍必须通过受保护 Environment reviewer；它的直接业务动作把文字与照片通道共用的目标 account flag 设为 false，因此也会取消该账号的照片 AI 资格。它不关闭文字 global、Worker、Access，也不主动清除既有计数或浏览器本地餐食。与其他管理操作相同，协调器会先执行到期 lease/counter 清理并写短期 operation replay，因此可能观察到正常的到期状态结算，但不会发供应商请求。
- 禁用 user-2 后，在 user-1/global/Worker 都满足门禁时可用 `enable-second-account` 恢复。
- 禁用 user-1 后没有直接的单步恢复操作；按第 9 节完整恢复顺序重新建立首次启用状态。

### 7.3 `delete-account` 不在标准流程内

标准 Preview 发布、回滚与恢复禁止运行 `delete-account`；release checklist 必须证明本次没有批准、派发或执行该 operation。它会删除文字与照片共用状态，因此不能作为日常账号管理、发布回滚或计数修复手段。只有另行取得明确的破坏性跨通道授权后，才能进入附录 A；该附录不参与本次标准 GREEN 判定。

## 8. 紧急关闭：`disable-all`

```bash
run_text_preview_operation disable-all user-1 ''
```

`disable-all` 不依赖完整 preflight，也不需要 Ark/AES secret。其安全语义固定如下：

1. 总是尝试通过管理端点关闭文字 global。
2. 无论第 1 步是否成功，总是另行尝试部署 `TEXT_AI_GATEWAY_ENABLED=false`、`PHOTO_AI_GATEWAY_ENABLED=false`、attempts 1 的 Worker。
3. 只有第 1、2 步都成功，才尝试删除两个专用 Access Application。
4. 第 1 或第 2 步任一失败时，不尝试删除 Access；现有 Access 继续作为保护层。
5. 任一步失败都会输出固定的三步 summary 并以非零退出；修复失败原因后重跑 `disable-all`，不得把部分成功当成完成。

固定 summary 只包含 `failureMask` 以及以下三个固定步骤的 `attempted/failed` 布尔值：`disable-text-global`、`deploy-worker-disabled`、`disable-access`。不得把错误响应、标识符或 secret 拼入 summary。

单次 workflow success 仍不能单独作为关闭证据。固定关闭复核为：

1. 首次 `disable-all` 的精确 run 必须成功，summary 中 global/Worker 两步均 attempted 且 failed=false，Access 步骤也成功。
2. 运行 `deploy-disabled`，只在关闭状态下重建 Access 与管理通路。
3. 运行 `preflight`，要求 `workerTextEnabled=false`；preflight 成功同时证明 photo=false。
4. 对 user-1 运行显式 `status`，要求其授权字段中的 `textGlobalEnabled=false`。不把字段值复制到 evidence，只记录布尔判断。
5. 再次运行并精确核验 `disable-all`，移除为复核临时重建的 Access。

上述任一步失败、超时或结果不明，均不得宣称安全关闭；状态保持 `BLOCKED`，并用可用的可信凭证继续修复和重跑 `disable-all`。成功预期：文字 global 关闭、Worker 文字与照片开关均关闭、两个专用 Access Application 已删除；account flag 和 Pages Preview 静态部署不会被 `disable-all` 删除。若还要撤下 Pages Preview/alias，必须在前三道闸门已确认安全且获得单独远程授权后执行；不属于该 workflow 的自动动作。

## 9. 关闭后恢复

`disable-all` 保留 account flag，因此不能在关闭后直接运行 `enable-admin-preview`。固定恢复顺序为：

1. 修复导致关闭失败的原因，并重跑 `disable-all`，直到三步 summary 成功。
2. 运行 `deploy-disabled`，以关闭状态重新创建 Access、Service Binding、Pages Preview 与管理端点。
3. 分别对 `user-1`、`user-2` 运行 `disable-account`，把两个 account flag 明确归零。
4. 运行显式 `status` 只做门禁确认；evidence 仅记录布尔判断，不复制 metadata 值。
5. 运行 `enable-admin-preview`，使用精确 target 与确认短语。
6. 不再发送真实餐食请求；此前的一次真实请求预算不可重置。
7. 运行 `enable-second-account`，然后 user-2 只做 OTP/session/status。
8. 第 2、3、5、7 步属于 mutating run；任一非成功、超时或结果未知都必须立即运行并完成第 8 节的 `disable-all` 与关闭复核，禁止直接重试 enable。
9. 特别是第 5 步开始后，global/Worker 可能已经部分或全部开启；只有新的关闭复核全部成功，才能写“已保持关闭”。回滚未确认成功时只能标记 `BLOCKED`，不得推断当前开关状态。

## 10. Evidence 与隐私扫描

允许写入 checklist/evidence 的内容只有：workflow run ID、commit SHA、固定的 workflow 成功结论、资源存在性或开关的布尔判断，以及计数、预算和隔离差值的 `PASS/FAIL`。本地测试数只在 Task 10 的即时脱敏验证回复中报告，不写入远程 release evidence。

严禁记录或复制：

- Access audience；
- 邮箱或派生 account key；
- JWT、OTP、任何 API/Access/AES/HMAC secret；
- Cloudflare account ID；
- URL token；
- IP、Cookie、浏览器认证存储；
- 餐食正文、模型候选、供应商请求/响应原文。

### 10.1 静态扫描

在目标 SHA 的干净 worktree 根目录运行，不把原始匹配保存为 release evidence：

```bash
node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';

const sourceRoots = Object.freeze(['src', 'edge', 'functions', 'workers', 'scripts', '.github']);
const scans = Object.freeze([
  { category: 'log-or-sensitive-flow', pattern: 'console\\.|ARK_API_KEY|CF-Access-Client-Secret|targetEmail|description' },
  { category: 'secret-or-cli-writer', pattern: 'PHOTO_AI_CACHE_AES_KEY|process\\.(stdout|stderr)|writeStdout|writeStderr' },
  { category: 'access-secret-header', pattern: 'cf-access-client-secret', rgArgs: ['-i'] },
  {
    category: 'production-ci-text-flag',
    pattern: 'VITE_ENABLE_TEXT_AI',
    rgArgs: ['--glob', '!**/text-ai-preview.yml'],
    roots: ['.github'],
    forbidden: true,
  },
]);

let failed = false;
for (const scan of scans) {
  const result = spawnSync('rg', [
    '--json',
    '-n',
    ...(scan.rgArgs ?? []),
    '--',
    scan.pattern,
    ...(scan.roots ?? sourceRoots),
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    process.stdout.write(`${JSON.stringify({ staticSourceScan: 'FAIL', category: scan.category, reason: 'scanner-error' })}\n`);
    failed = true;
    continue;
  }

  const locations = [];
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    const event = JSON.parse(line);
    if (event.type !== 'match') continue;
    locations.push(`${event.data.path.text}:${event.data.line_number}`);
  }
  process.stdout.write(`${JSON.stringify({ staticSourceScan: 'REVIEW', category: scan.category, locations })}\n`);
  if (scan.forbidden && locations.length !== 0) failed = true;
}

process.stdout.write(`${JSON.stringify({ staticSourceScan: failed ? 'FAIL' : 'REVIEW_COMPLETE' })}\n`);
if (failed) process.exitCode = 1;
NODE
```

扫描器只输出安全的 category、文件路径与行号，不回显匹配正文；`scanner-error` 或 `production-ci-text-flag` 有命中时直接失败。其余位置必须在本地编辑器逐条分类，不得把原始行复制到聊天、issue 或 evidence。扫描范围必须完整覆盖 `src`、`edge`、`functions`、`workers`、`scripts`、`.github`；只有零越界命中才为 `PASS`：

- `ARK_API_KEY` 与 `PHOTO_AI_CACHE_AES_KEY` 只允许出现在 Worker env/adapter、受保护 workflow 的 secret 名称映射和测试；真实值绝不允许出现。`*.test.*` 中可保留明显的 test-only placeholder 与用于证明 verifier 会拒绝泄露写法的负向字符串，但这些字符串只能作为测试数据，且相应 verifier 测试必须通过。
- Access service secret 只允许作为 env 名或请求 header 名；禁止进入 stdout/stderr、日志、错误或响应。
- `targetEmail` 只允许存在于严格 admin contract、Pages 内存转换与 fixture；禁止进入日志。
- 餐食正文的 `description` 可存在于产品输入/领域代码与测试，但不得进入管理路由、workflow dispatch payload、控制面或日志输出。workflow YAML input schema 中固定的英文说明元数据（例如 `description: Fixed preview control operation`）及其 verifier fixture 可保留；它们不能来自用户餐食正文，也不能被当作餐食字段传递。
- `console.*`、stdout/stderr 与 CLI writer 只允许固定字面量或已经授权的 canonical whitelist；不得输出 body、candidate、email、`targetEmail`、`description`、远端响应或 secret。
- `VITE_ENABLE_TEXT_AI` 只允许存在于受保护的 `text-ai-preview.yml`；任何生产 CI 命中都失败。

### 10.2 精确 run 的 Actions 日志扫描

只扫描已由第 6 节绑定的纯数字 `RUN_ID`。下面的扫描器由 Node 直接等待精确 `gh run view` 完成，再只输出安全类别与 `PASS/FAIL`，不回显命中正文：

```bash
set -euo pipefail
if [[ ! "${RUN_ID-}" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'BLOCKED: invalid run binding' >&2
  exit 1
fi
node --input-type=module - "$RUN_ID" <<'NODE'
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';

const MAX_LOG_BYTES = 50 * 1024 * 1024;
const runId = process.argv[2] ?? '';
const fail = (category) => {
  process.stdout.write(`${JSON.stringify({ runtimePrivacyScan: 'FAIL', categories: [category] })}\n`);
  process.exit(1);
};

if (!/^[0-9]+$/u.test(runId)) fail('run-binding');
const fetched = spawnSync('gh', [
  'run',
  'view',
  runId,
  '--log',
  '-R',
  'nuts-and-bytes/tiezheng',
], { encoding: null, maxBuffer: MAX_LOG_BYTES + 1 });
if (fetched.error) fail(fetched.error.code === 'ENOBUFS' ? 'log-size' : 'log-fetch');
if (fetched.status !== 0) fail('log-fetch');

const bytes = Buffer.isBuffer(fetched.stdout) ? fetched.stdout : Buffer.alloc(0);
if (bytes.byteLength > MAX_LOG_BYTES) fail('log-size');
let text;
try {
  text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
  fail('log-encoding');
}
if (text.trim().length === 0) fail('log-empty');

const ipv6Candidates = [...text.matchAll(
  /(?<![0-9A-Za-z])(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f:.]{0,45}(?![0-9A-Za-z])/gu,
)];
const hasIpv6 = ipv6Candidates.some((match) => {
  const candidate = match[0].replace(/^\.+|\.+$/gu, '').split('%', 1)[0];
  if (isIP(candidate) !== 6) return false;
  if (candidate !== '::') return true;
  const start = match.index ?? 0;
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(start + match[0].length, start + match[0].length + 2);
  return /(?:\b(?:ip|client_ip|remote_ip|address|host)\b\s*[:=]\s*|\[)\s*$/iu.test(before)
    || /^\s*\]/u.test(after);
});
const rules = Object.freeze([
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu],
  ["jwt", /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u],
  ["cookie", /\b(?:set-cookie|cookie)\s*:/iu],
  ["ipv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/u],
  ["access-audience", /(?:\baccess[-_ ]?audience\b|["']?\baud(?:ience)?\b["']?)\s*[:=]\s*\S+/iu],
  ["url-token", /[?&](?:access_token|token|jwt|code|key)=[^&\s]+/iu],
  ["otp-value", /\b(?:otp|one[- ]time(?: password| pin)?)\b[^\n]{0,20}\b\d{4,10}\b/iu],
  ["identity-value", /"?(?:targetEmail|accountId|accountKey|account_id|account_key)"?\s*[:=]\s*\S+/u],
  ["meal-or-model-body", /"?(?:description|candidates?|mealText|providerRequest|providerResponse)"?\s*[:=]/iu],
  ["access-secret-value", /cf-access-client-secret\s*[:=]\s*(?!"?\*{3,})\S+/iu],
  ["secret-assignment", /\b(?:ARK_API_KEY|PHOTO_AI_CACHE_AES_KEY|PHOTO_AI_ACCOUNT_HMAC_KEY|CLOUDFLARE_API_TOKEN|TEXT_AI_CF_ACCESS_CLIENT_SECRET)\b\s*[:=]\s*(?!"?\*{3,})\S+/u],
]);
const categories = rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
if (hasIpv6) categories.push("ipv6");
process.stdout.write(`${JSON.stringify({ runtimePrivacyScan: categories.length === 0 ? "PASS" : "FAIL", ...(categories.length === 0 ? {} : { categories }) })}\n`);
if (categories.length !== 0) process.exitCode = 1;
NODE
```

`gh` 获取失败只输出 `FAIL/log-fetch`；成功但空白的日志输出 `FAIL/log-empty`；超限或无效 UTF-8 分别输出 `FAIL/log-size`、`FAIL/log-encoding`。只有完整取得非空日志后才可能输出 `PASS`。扫描器 `PASS` 后仍需在可信 UI 内完成同一精确 run/session 的人工核对；不要下载或复制原文：

- 时间范围：用 `gh run view "$RUN_ID" -R 'nuts-and-bytes/tiezheng' --json createdAt,updatedAt` 取得当前 run 窗口，只在本地查看，不写入 evidence。
- GitHub Actions：只允许测试/资源/secret 名称、preflight 固定字段、已授权显式 `status` whitelist、`disable-all` 固定 summary 与普通构建输出；零敏感值。
- Cloudflare Worker/Pages：窗口内的 application-controlled message 不得含身份、认证、餐食、candidate 或供应商正文。Cloudflare 托管的 Access audit metadata 可能原生包含身份/IP；只能在受信 Dashboard 内查看，禁止导出或写入 evidence，且不能把它误当作应用可自由记录的 allowlist。
- Durable Object：只通过授权 `status` 的 canonical whitelist 做计数/预算差值判断，不导出表、key 或原始状态。
- 浏览器：只检查 Task 12 的精确 session。允许用户明确确认后的一条产品记录留在预期 IndexedDB，以及 Cloudflare 管理的 HttpOnly 认证状态；禁止 console/network/localStorage/sessionStorage/临时候选区出现 JWT、OTP、Cookie 值、原始描述或候选正文。预期产品记录也不得复制到 evidence。
- 供应商 Dashboard：只核对调用次数/预算差值，不查看或复制 prompt/response 原文。

上述任一范围发现未授权命中即为 `FAIL`。只记录安全类别和 `FAIL`，不得把正文、行号上下文、URL 或 provider payload 复制到 issue、聊天或 evidence。

## 11. 泄露响应

先判断暴露类型；不得对所有 secret 使用同一顺序，也不得继续使用已经泄露的 bearer credential 执行关闭。

### 11.1 Cloudflare token、Ark key 或 Access service credential

1. 立即在可信 provider Dashboard/UI 中 revoke 泄露凭证并生成替换凭证；Cloudflare token 必须恢复第 4 节的精确 account scope。`ARK_API_KEY` 可绕过本系统直接产生供应商消费；Access service credential 可调用管理路由，因此都必须先 revoke。
2. 只在 GitHub **Settings → Environments → text-ai-preview** UI 更新对应 Environment secret，不通过 CLI、聊天或 shell history传值。
3. Cloudflare token 或 Ark key 替换后，用替换凭证运行并精确核验 `disable-all` 与关闭复核；禁止使用旧值。
4. Access service credential 替换后，不得假定新 token 已被旧 policy 接受，也不得把 global 先验写成 false。先用替换后的 Cloudflare token 与新 service credential 精确派发一次 `disable-all`：管理 global 步可能因 policy 尚未绑定而失败，但 Worker disabled 步必须被尝试且成功；该 run 仍是失败/`BLOCKED`，不能称为关闭完成。随后运行只读 `preflight`，要求 Worker text=false、photo=false；此时 global 只能记录为 unknown、被 disabled Worker 隔离。只有这两项成立，才运行 `deploy-disabled` 绑定新的 service token policy；之后立即用新 credential 重新运行 `disable-all` 并完成第 8 节全部关闭复核，最终证明 global=false。首次 `disable-all` 的 Worker 步失败、`preflight` 不能证明双通道关闭或后续任一步失败时都保持 `BLOCKED`，不得先重建或重开。
5. 任一步无法完成即保持 `BLOCKED`，并在可信 UI 中维持 provider revoke/Worker disabled；不得重开。

### 11.2 HMAC

`PHOTO_AI_ACCOUNT_HMAC_KEY` 决定邮箱到共用 account key 的映射。疑似泄露时先用其他仍可信的控制凭证完成 `disable-all` 与关闭复核，但禁止盲目轮换 HMAC；直接换值会让既有文字/照片状态变成另一身份空间。必须另开身份迁移/旧状态处置设计，明确旧新映射、不可恢复数据和回滚，获得单独批准后才能在 GitHub UI 更新并重开。

### 11.3 AES

`PHOTO_AI_CACHE_AES_KEY` 疑似泄露时先关闭全部闸门。禁止在仍开放时直接换值，因为旧缓存会变成不可解。单独选择并记录一种关闭态处置：等待至少当前 `resultCacheMs`（现为 10 分钟）自然过期并确认 reserved budget 为 0，或使用另行批准的缓存清除/迁移流程；之后才可在 GitHub UI 更新并从 disabled smoke 重新验证。

若命中只是餐食/身份/认证内容进入日志而凭证本身未暴露，立即使用仍可信的凭证执行 `disable-all` 与关闭复核，再修复日志并重跑静态、运行时扫描。所有 incident evidence 仍只记录安全类别、run ID、SHA、布尔判断与 `PASS/FAIL`。

## 12. 远程完成定义

标准双账号 Preview 的绿色结论要求 release checklist 的 A–G 全部为 `PASS`，H 节“标准流程未执行 `delete-account`”保护项为 `PASS`，H 节其余破坏性条件项保持 `NOT_RUN`，并且 I 节最终决策全部为 `PASS`。H 的条件项默认不适用，不属于标准 GREEN 必需项；任一条件项被激活就必须暂停标准结论，转入另行批准的跨通道变更流程。A–G、H 第一项或 I 任一项为 `FAIL`、`BLOCKED` 或 `NOT_RUN` 都不能宣布完成。最终结论必须明确记录 `GREEN_FOR_TWO_ACCOUNT_TEXT_PREVIEW`，并同时写明：生产和照片 AI 未启用。

## 附录 A：另行明确批准的破坏性跨通道删除

本附录默认未授权，不得因为它出现在 runbook 中而执行。新的授权必须精确指定 target slot，并明文接受“文字与照片共用状态不可恢复”。没有这两项时状态始终为 `BLOCKED`。

即使取得单独授权，也必须先全部证明：

- 文字 global=false；
- Worker text=false 且 photo=false；
- 照片 global=false；
- 没有在途 workflow、浏览器请求、供应商请求或 active lease；
- 目标账号的 `budgetReservedMicros=0`；
- 目标 slot 与当前批准 SHA 仍精确绑定。

任何一项无法证明都必须保持 `BLOCKED`；不得通过删除来“修复”计数或回滚发布。本手册不提供可直接复制的调用命令。单独变更单必须在执行当次明确写出 `operation=delete-account`、获批的唯一 target slot 与精确确认短语 `DELETE_TEXT_PREVIEW_ACCOUNT_STATE`，大小写或内容不符必须拒绝；然后重新走第 6 节的固定仓库、固定 SHA、精确 run ID、等待和复核流程。

该操作会原子删除目标 account 在所有通道的 active lease、幂等键、文字/照片分钟与日计数、共用 account flag 和缓存状态；已调用供应商的 active lease 会把 reserved 成本保守计入共享 spent。它保留 global gate、其他账号、共享已结算预算和浏览器本地餐食。

与所有写入性 operation 相同，该 run 任何非 success、超时或结果未知都必须立即执行并完整核验第 8 节 `disable-all`；回滚未确认成功即 `BLOCKED`。若删除已成功，只能按第 9 节从 disabled 状态恢复相应账号，不得重做唯一真实请求。
