# 铁证 IRONPROOF · 视觉重塑 v2 设计规格（增量 + 修正）

日期：2026-07-12
状态：已定稿，作为实现的唯一基准
基线：`docs/superpowers/specs/2026-07-11-tiezheng-redesign-design.md`（下称 v1）

> **本文档优先级高于 v1。** 凡 v1 与本文冲突，以本文为准。
> v1 已通过视觉验收，但未通过**信息架构验收**与**可实现性验收**（对抗式审查发现 6 个 BLOCKER）。
> 本文只写 v1 之外的增量、以及对 v1 的硬修正。

依据：
- `docs/design-cards/**`（8 张 Claude Design 卡片）— **视觉母版，实现真相源**
- `docs/superpowers/research/2026-07-12-stats-first-principles.json`
- `docs/superpowers/research/2026-07-12-yearly-poster-design.json`
- `docs/superpowers/research/2026-07-12-adversarial-risks.json`

---

## 0. 对 v1 的硬修正（BLOCKER，不改必炸）

| # | v1 的错误 | 修正 |
|---|---|---|
| B1 | 指定在 `src/index.css` 写 token | **该文件不存在。** 真入口是 `src/styles/theme.css`（`main.tsx:6` import）。**禁止新建任何 .css 文件**，所有 token / `.etch` / `.display` / 噪点 / keyframes 一律写进 `src/styles/theme.css`。（jsdom 不解析 CSS → 写错文件后测试仍全绿、build 仍通过，只有真机才看到没样式的黑页。） |
| B2 | 直接删 `--color-card2` / `--color-iron2` | Tailwind 4 下删 token **不报错**，`bg-card2` 只是静默失效 → 输入框变透明。这两个 token 现存于 8 个源文件。**@theme 中保留为别名**（`--color-card2: #1A1A1D; --color-iron2: #FFB340;`），直到 `grep -rn "card2\|iron2" src` 为 0 才可移除。 |
| B3 | 重写 Onboarding 且要求"117 测试全绿" | 二者互斥：`App.test.tsx` 3 个测试都 `findByText('开始第一次打卡')`，4 步流程下该按钮在第 4 屏。**先改测试（TDD）**，加 helper `completeOnboarding(user)`。四屏**全部挂载** + `translateX` 位移（非条件渲染），非当前屏加 `inert` + `aria-hidden` 防假绿。 |
| B4 | TodayScreen 模块清单漏了 `<WeightQuickEntry>` 和 `<PhotoCard>` | 二者必须保留（前者是**唯一**体重录入口）。文案逐字保留：`体重 kg` / `记录` / `体重需在 20–300kg 之间` / `+ 开始今日训练` / `+ 继续加练`。 |
| B5 | Anton 走 @fontsource | woff2 **不进 workbox 预缓存**（默认 globPatterns 只含 js/wasm/css/html）→ 装 PWA 后离线发网络请求，**违反铁律 7**。改为：**pyftsubset 出数字+基本拉丁子集 woff2（3–8KB）→ base64 内联进 `theme.css` 的 `@font-face`**，字体资产 commit 进仓库。零网络。 |
| B6 | iOS 海报分享：`onClick → await toBlob → navigator.share()` | WebKit transient activation 已失效 → `NotAllowedError`（概率性，真机才暴露）；且 `<a download>` 在 iOS 存不了相册。改为：**进预览页就异步生成 blob 存 state**；「保存图片」onClick 中**同步**调 `navigator.share({files:[new File([blob],…)]})`，调用栈内**不得出现任何 await**；先 `navigator.canShare({files})` 判定；降级为全屏 `<img>` + 「长按图片 → 存储到照片」。 |

### HIGH 修正

- **Canvas 里没有 feTurbulence。** 海报噪点：生成 **128×128 离屏 tile → `createPattern('repeat')` → `globalAlpha = 0.06`**。禁止逐像素 ImageData（1170×2340 ≈ 11MB + 2.7M 次循环 → 旧 iPhone 白屏）。页面噪点同理改成 **base64 PNG tile 做 `background-image`**（SVG filter 全屏栅格化在 iOS 滚动时整层重绘）。海报导出 **2x 保底**，3x 可选并 try/catch 回退 2x。
- **海报在 jsdom 里一行都测不了**（无 `getContext('2d')` / `toBlob` / `document.fonts` / `navigator.share` / `navigator.vibrate`）。因此**强制两层拆分**：`buildPosterModel(raw) → PosterModel`（纯数据，单测覆盖）+ `paint(ctx, model)`（mock ctx spy 断言调用序列）。所有平台 API 走 `src/lib/platform.ts` 能力探测；`navigator.vibrate` 不判空会让 7 个 LogFlow 测试变红。
- **`--color-line` 从 `#3a3a3c` 改为 `rgba(255,255,255,.07)` 后**，`DayDetailScreen` / `ExerciseManager` / `SetRows` / `PhotoCard` / `PhotoTimeline` / `InstallHint` / `UpdateToast` 的边框会几乎消失 → 视觉"碎掉"。这 7 个文件**必须进改造清单**（v1 漏了）。

### MEDIUM 修正

- `.display`（Anton）**只允许包纯数字/单位的 `<span>`**，中文另起 span 用默认字体（Anton 无中文字形，中英混排基线错位）。回退链：`Anton, 'Arial Narrow', 'Helvetica Neue Condensed', system-ui, sans-serif`；`font-display: block` + 3s 超时（**不是 swap**）。
- 逐字保留的测试文案：`CalendarScreen` 的 `${y}年${m}月`、`ProfileScreen` 的 `导出 CSV` / `导出失败，请重试`、`DayDetailScreen` 5 个测试的文案。
- 日历大字用 `<h1 className="sr-only">2026年7月</h1>` + `aria-hidden` 的视觉大字，防 a11y 退化。保留 `aria-label`：`上个月` / `下个月` / `减少目标` / `增加目标`。

---

## 1. 数据页：按根因重做信息架构

### 根因（第一性原理）

整页是**能力驱动**而非**问题驱动**——`stats.ts` 能算什么就画什么，没有一张图是从"用户想知道什么"倒推的。四个病灶：

1. **假控件**：30/90/365 分段只作用于雷达图（`StatsScreen.tsx:38-43`）。三个大数字是全时段、柱状图写死 12 周、体重写死 365 天、力量曲线全时段。点「90天」页面几乎没反应 → 直觉上就是"坏了"。
2. **稀疏数据下每张图都像 bug**：雷达图 7 轴里 5 轴为 0 的畸形三角且 `ticks.display:false`；12 周柱状图 11 根空柱；力量曲线默认动作 = `exMap` 迭代顺序第一个（`StatsScreen.tsx:51`，**本质随机**）。
3. **总容量可能恒为 0**：`SetEntry.weight/reps` 选填（`types.ts:4-7`），`totals()` 的 `volumeKg` 只在两者都填时才累加（`stats.ts:64`）。只记"练了什么+几组"的用户 hero 恒为 0，力量曲线整块被 `&&` 掉。
4. **两个最重要的问题零回答**：「我在变强吗」（PR / 进步性超负荷）、「我这个月比上个月强吗」（环比）。已写好的 `currentStreak` 甚至没在数据页用上。

### 新版式（自上而下）

| # | 区块 | 说明 |
|---|---|---|
| — | 页头 | 标题「数据」+ **全局时间分段：本周 / 本月 / 今年 / 全部**。**真正驱动每一个区块**（不再有假控件）。 |
| 1 | Hero 三数 | 连续 N 天（heat 渐变）/ 本区间打卡 X 天 · 目标达成率 / 本区间有效组数（有重量时并列容量 t） |
| 2 | **训练热力图** | 日历格，深浅 = 当天组数。**取代 12 周柱状图**（稀疏时不像 bug） |
| 3 | **环比卡** | 本区间 vs 上一同长区间：天数 / 组数 / 容量，各带 Δ% |
| 4 | **PR 榜** | 历史最佳 e1RM × 动作，本区间新 PR 高亮。抗稀疏，**永不空图** |
| 5 | **主力动作 e1RM 曲线** | chip 横滑切换（**杀掉 `<select>`**），默认取**数据点最多**的动作；< 3 个有效训练日 → 整块降级为引导态 |
| 6 | **部位分布水平条** | 组数计权 + 距上次训练天数 + 未训练部位提示。**取代雷达图** |
| 7 | 体重趋势 | **time scale x 轴**（修不等距 bug）+ **按自然日开窗**均线；< 2 条不渲染 |
| 8 | 照片时间线 | 保留 `<PhotoTimeline />` |
| 9 | 海报入口 banner | → `/poster` |

**KILL**：雷达图、下拉式力量曲线、局部 30/90/365 假控件。

### 新增 `src/lib/stats.ts` 纯函数（每个都要单测）

```ts
rangeOf(seg: Segment, today: string): { from: string; to: string }
daysInRange(dates: string[], from: string, to: string): number
hasWeightData(items: WorkoutItem[]): boolean
dailyLoad(items: WorkoutItem[], from: string, to: string): Map<string, number>   // date → 组数
compare(items, dates, cur: Range, prev: Range): { days: Delta; sets: Delta; volumeKg: Delta }
estimate1RM(weight: number, reps: number): number    // Epley: weight * (1 + reps / 30)
prsByExercise(items, exMap): { exerciseId; name; e1rm; date }[]
e1rmSeries(items, exerciseId): { date: string; e1rm: number }[]
setsByBodyPart(items, exMap): Record<BodyPart, number>
lastTrainedByBodyPart(items, exMap, today): Record<BodyPart, number | null>      // 距今天数
longestStreak(dates: string[]): number
```

保留并复用现有：`countByBodyPart` `weeklyCounts` `movingAverage` `maxWeightSeries` `totals` `currentStreak` `weekProgress`（`weeklyCounts` / `maxWeightSeries` / `countByBodyPart` 在数据页不再被调用，但**不删**——其它页/测试仍依赖）。

### 分级空状态阶梯（渲染契约，必须实现）

| 数据量 | 渲染 |
|---|---|
| 0 次打卡 | 整页换**单张引导卡**，不渲染任何 chart |
| 1–2 次 | 只渲 Hero + 热力图 + PR 榜；趋势类显示「再练 N 次解锁」 |
| 有打卡但**无任何 weight/reps** | 容量 / PR / e1RM **整体降级为组数口径** + 提示「填上重量和次数，解锁力量曲线」 |

---

## 2. 年度海报（v1 未覆盖，本次纳入 Phase 1）

**Hero 数字 = 打卡天数**（用户拍板）。

### 画布

- 年度 **390 × 780**；月度 **390 × 693**（不变）
- 左右 padding 36，内容宽 318
- 导出 2x 保底（780×1560）；3x 可选（1170×2340）并 try/catch 回退

### 共用引擎 `src/lib/poster/`

```
tokens.ts        Canvas 读不到 CSS 变量 → 硬编码一份颜色/字号常量（与 theme.css 手工对齐）
fonts.ts         ensurePosterFonts(timeoutMs = 3000)
canvas.ts        唯一碰 DOM 的文件：PosterSpec { width, height, scale, paint(ctx) }
                 monthlySpec() / yearlySpec() / renderPoster() / exportPoster()
layers.ts        纯 ctx 绘制原语：drawBackdrop drawGrain drawHeader drawTitle drawEtch
                 drawHero drawMetrics drawSplit drawMonthGrid drawYearGrid drawFooter drawStamp
data.ts          buildMonthlyPosterData / buildYearlyPosterData —— 纯函数，不碰 Dexie
monthlyPoster.ts 一串 layers 调用 + 一张 y 常量表
yearlyPoster.ts  同上
```

> 月度与年度**共用同一套 layers**——视觉一致性由代码保证，强于"再画一张 HTML 卡片"。因此不新增 `poster/yearly.html`；`poster/monthly.html` 仍是 layers 的像素母版。

### 年度版式 y 常量表

| 元素 | 位置 |
|---|---|
| HEADER | 基线 48，右「ANNUAL PROOF」 |
| YEAR 标题 | Anton 88px + heat 渐变，基线 160；右侧「铁龄 IRON AGE / N 天」 |
| ETCH | y = 182 |
| **HERO** | Anton **120px 打卡天数**，基线 300 + 「天 · 全年钢印」；右对齐「占全年 N%」 |
| METRICS | 三数 y 326–372（总组数 / 总容量 t / 最长连续 → amber） |
| ETCH | y = 390 |
| HEATMAP | 标题基线 412；月份刻度基线 430；**GitHub 式 53/54 列 × 7 行**网格 y 438–479（cell ≈ 4.79px，gap 1.2，列数动态算）；图例基线 494「格子颜色 = 当日主练部位 · 深浅 = 组数」 |
| ETCH | y = 510 |
| SPLIT | **100% 堆叠条** x36 y544 w318 h12 r6 + 两行色点图例 |
| ETCH | y = 612 |
| PEAK DAY | 「最猛的一天」y 624–670 |
| FOOTER | 钢印 x280 y674 size74；「你练过的，都有铁证。」基线 730；「TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传」基线 748 |

### 热力图上色规则

- 未练格：`rgba(255,255,255,.045)`
- 已练格：当日**主练部位**色（组数最多者；并列取 `BODY_PARTS` 顺序靠前者）
- alpha = `0.35 + 0.65 * min(1, sets / maxSets)`，`maxSets = Math.max(1, p90(该年单日组数))`（防 0 除）
- 已练格叠 0.5px 同色描边

### 新增纯函数

`longestStreak(dates)`（见 §1）、`daysBetween(a, b)`、`daysInYear(year)`、`yearsWithData(allDates)`

### 入口

- 路由 `/poster?kind=month&period=2026-07` 与 `/poster?kind=year&period=2026`
- PosterScreen 顶部 segmented control「月度 / 年度」
- 数据页 banner + 我的页列表行
- 12/25–1/31 期间年终强入口

**明确否决**：吨数具象化（"相当于 3 辆 SUV"）—— 廉价营销腔，违背锻造工业风的克制。

**铁律 7 复述**：海报全本地、零网络请求、照片绝不上传；`workout.note` 是用户私人文字，**绝不出现在海报任何位置**。

---

## 3. 完整改造清单（v1 漏了 7 个文件）

**Screens（6）**：`TodayScreen` `CalendarScreen` `DayDetailScreen` `StatsScreen` `ProfileScreen` `LogFlow` `Onboarding`
**Components（7，v1 遗漏）**：`ExerciseManager` `SetRows` `PhotoCard` `PhotoTimeline` `InstallHint` `UpdateToast` `TabBar`
**新增**：`Stamp` `PartIcon` `ForgeRing` `HeatGrid` `PosterScreen` + `src/lib/poster/*`
**保留不动**：`ProgressRing`（`ForgeRing` 内部复用其 dashoffset 计算；删了会让 `ProgressRing.test` 的 4 个测试变孤儿）

---

## 4. 实施：强制两阶段（防文件争抢）

真正的冲突点：`theme.css`（每个 agent 都想加 utility）、`App.tsx`（噪点层 + 路由）、`bodyParts.ts`、`App.test.tsx`。

### 阶段 0 —— **串行，单 agent**

1. `src/styles/theme.css`：全部 token（含 `card2` / `iron2` 别名）+ `.etch` + `.display` + `@font-face`（base64 Anton 子集）+ 噪点 tile + keyframes
2. `src/data/bodyParts.ts`：胸 `#FF5C1F` → **`#E8483F`**（让 iron 成为唯一热源）
3. `src/components/`：`Stamp` / `PartIcon` / `ForgeRing`
4. `src/lib/stats.ts`：§1 全部新纯函数 + 单测
5. `src/lib/platform.ts`：`canShareFiles()` / `vibrate()` 能力探测
6. `src/App.tsx`：噪点层 + `/poster` 路由
7. `src/test/helpers.ts`：`completeOnboarding(user)`

**Gate：`npx tsc --noEmit` + `npm test` 全绿后才进阶段 1。**

### 阶段 1 —— 并行，6 agent

| Agent | 允许改的文件 |
|---|---|
| A | `screens/today/**` + `components/PhotoCard.tsx` `components/SetRows.tsx` + 对应 test |
| B | `screens/calendar/**`（含 DayDetailScreen）+ 对应 test |
| C | `screens/stats/**` + `components/charts.tsx` `components/PhotoTimeline.tsx` + 对应 test |
| D | `screens/profile/**` + `components/ExerciseManager.tsx` + 对应 test |
| E | `screens/log/**` + `components/TabBar.tsx` `components/InstallHint.tsx` `components/UpdateToast.tsx` + 对应 test |
| F | `screens/Onboarding.tsx` + `screens/poster/**` + `lib/poster/**` + `App.test.tsx` + 对应 test |

**硬约束：阶段 1 的 agent 一律禁止碰 `theme.css` / `App.tsx` / `bodyParts.ts` / `lib/stats.ts` / `lib/platform.ts`。** 每个 agent 必须先读自己那张 `docs/design-cards/**` 卡片。

---

## 5. 验收

- `npm test` 全绿（测试数会 > 117：新增 stats 纯函数测试 + poster model 测试）
- `npx tsc --noEmit` 无错
- `npm run build` 通过
- `grep -rn "card2\|iron2" src` → 只剩 `theme.css` 的别名定义（或为 0）
- **零新增网络请求**（字体 base64 内联；海报全本地）
- 六个界面与 `docs/design-cards/**` 对应卡片视觉一致
- 数据页在 0 次 / 1 次 / 只记组数不记重量 三种数据下均**无空图、无畸形图**
