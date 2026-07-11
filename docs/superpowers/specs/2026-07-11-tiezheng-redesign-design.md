# 铁证 IRONPROOF · UI 重设计规格（锻造工业风）

日期：2026-07-11
状态：设计已通过（claude design 项目「铁证 IRONPROOF」8 张卡片，用户确认「通过，写设计文档」）
范围：视觉重设计 + 品牌系统 + 五页改造 + 首次引导重做 + 月度海报（新功能）
不改动：数据层（Dexie schema/repos）、路由结构、记录流三步逻辑、PWA 配置

## 0. 背景与目标

用户真机测试后反馈四点，其中第 1 点（数据崩溃）已单独修复上线。本规格解决其余三点：

1. **UI 版块化**：现有页面全是 `rounded-2xl bg-card p-5` 均匀卡片堆叠，「一块一块」没有层次
2. **品牌特点不足**：启动无 logo、部位无图标、日历页看不出练了什么部位、「我的」页弱
3. **缺首次引导**：现引导只有单屏定目标，没有介绍核心玩法与海报导出卖点

设计方向已定：**锻造工业风** — 打卡 = 盖钢印的仪式感；暗色金属质感 + 噪点纹理；铁橙唯一热源；粗壮压缩体大数字；蚀刻线取代卡片。

视觉母版：claude design 项目「铁证 IRONPROOF」（projectId c67bcd2e-01b3-45c6-9d93-b9657e920bfd），8 张卡片为实现验收基准。

## 1. 设计 Tokens（brand/tokens 卡片）

### 1.1 色彩

| Token | 值 | 用途 |
|---|---|---|
| `bg` | `#0A0A0B` | 页面基底 |
| `raised` | `#141416` | 抬升面（图标底、输入框、tab bar） |
| `card` | `#1A1A1D` | 容器（**少用**，仅日历已练格等必要处） |
| `ink` | `#F2F0EB` | 主文字（暖白） |
| `mute` | `#8B8B85` | 辅助文字 |
| `iron` | `#FF5C1F` | 品牌铁橙，全局唯一热源 |
| `amber` | `#FFB340` | 热渐变终点、streak 强调 |
| `line` | `rgba(255,255,255,.07)` | 描边 |

- **heat 渐变**：`linear-gradient(135deg,#FF5C1F,#FFB340)` — 用于英雄数字（background-clip:text）、CTA 按钮、趋势线
- **glow**：`radial-gradient(circle,rgba(255,92,31,.55),transparent 70%)` — 成就/钢印辉光
- Tailwind 4 `@theme` 中更新现有 `--color-*` 变量，新增 amber；现有类名（bg-card 等）保留可用，但页面布局改用蚀刻线结构

### 1.2 部位七色（修改 `src/data/bodyParts.ts`）

胸 `#E8483F`（原 #FF5C1F，避免与品牌橙撞色）、肩 `#FFB340`、背 `#4F8EF7`、腿 `#A06BFF`、手臂 `#2FD6C3`、核心 `#FF5C8A`、有氧 `#8FAE9B`。

已有存量数据只存 part id，不存颜色，改色无迁移成本。

### 1.3 纹理与蚀刻线

- **噪点**：SVG feTurbulence data-URI，`position:fixed;inset:0;opacity:.05;pointer-events:none`，App 壳层挂一次，全局生效
- **蚀刻线**（Etch）：`height:1px;background:rgba(255,255,255,.06);box-shadow:0 1px 0 rgba(0,0,0,.65)` — 页面内区块分隔一律用它，取代卡片描边；做成 `<Etch />` 组件或 `.etch` 工具类

### 1.4 展示数字字体

- 打包 **Anton** 数字子集（@fontsource/anton + unicode-range 子集化，只留 0-9 . , : / t kg 等字符），`font-family` 回退 `Impact,'Arial Narrow',sans-serif`
- 类：`.display` = Anton + `letter-spacing:.5px` + `font-variant-numeric:tabular-nums`
- 用于：周进度、日历月份、统计三数、海报大字、铁龄

### 1.5 钢印 Motif

- 方形圆角容器，`border:3.5px solid iron`，`transform:rotate(-6deg)`，内圈 `1px dashed rgba(255,92,31,.45)`，外辉光 `0 0 34px rgba(255,92,31,.35)` + 内辉光 inset，中心「铁」字黑体特粗
- 做成 `<Stamp size={n} />` 组件，尺寸按场景缩放：引导页 84px、我的页 64px、海报 74px、CTA 内 22px 线稿版
- **打卡成功动效**：钢印从 1.4x 缩放砸落至 1x + 辉光脉冲 + `navigator.vibrate(200)`（iOS PWA 不支持 vibrate 则静默降级），总时长约 400ms

## 2. 图标系统（brand/icons 卡片）

### 2.1 部位图标 · 7 枚

统一 `viewBox="0 0 24 24"`、`stroke-width:1.8`、圆头圆角、`fill:none`，颜色跟部位色。符号：胸=盾形胸廓+中缝+胸肌弧、肩=头点+斜方弧、背=V 型倒三角+脊柱、腿=双腿轮廓、手臂=屈臂二头、核心=圆角矩形+六块分割线、有氧=心形+脉搏折线。

实现：新建 `src/components/PartIcon.tsx`，`<PartIcon part={id} size={n} strokeWidth?/>` 输出内联 SVG；`bodyParts.ts` 不存 SVG 字符串，图标 path 集中在 PartIcon 内。

用于：记录流部位选择 chips、今日已练列表、日历格、数据页分布条、日详情、海报。

### 2.2 Tab 图标 · 4 枚

重绘 `TabBar.tsx` 内联 SVG：今日=倾斜钢印勾（-6° rotate 的圆角方框+对勾+底座线）、日历=双提耳日历、数据=四柱条形、我的=哑铃人形。激活态 `text-iron` 不变。

### 2.3 相机标记

日历格右上角的照片标记从 📷 emoji 换为 9px 线稿相机 SVG（mute 色）。

## 3. 五页改造（screens/* 卡片为验收基准）

通用变化：所有页面去掉均匀卡片堆叠，改「蚀刻线分区 + 抬升面点缀」；重要数字一律 `.display` 大字。

### 3.1 今日页（today 卡片）

- 品牌抬头：左 = 26px 迷你钢印 + 「铁证 / IRONPROOF」双行 wordmark；右 = 日期
- 英雄区：128px **锻造环**（SVG 圆环，heat 渐变描边，圆头端帽）内嵌 `.display` 周进度 `3/4` + 「本周打卡」；右侧「还差 N 练」+ streak 行（火苗 icon + 连续天数 + 个人纪录，amber 色）
- 「今日已练」列表：蚀刻线分隔行，每行 = 部位图标（色底圆角块）+ 动作摘要 + 组数/容量 + 右侧 `.display` 组数
- CTA：heat 渐变大按钮「开始打卡 / 继续打卡」，内嵌钢印线稿 icon，投影 `0 8px 32px rgba(255,92,31,.35)`
- 数据来源不变（现有 useLiveQuery 逻辑）

### 3.2 日历页（calendar 卡片）

- 抬头：84px `.display` heat 渐变月份数字（如 `07`）+ 右下「2026 七月」；保留左右滑/箭头切月交互
- 月度统计条：本月打卡 / 当前连续 / 总组数 三数并排，竖蚀刻线分隔
- 月格：已练格 = `raised` 底 + 细描边 + 日期数字 + **部位小图标**（11px 描边版，最多 2 枚，超出显示 `+n`）；今天 = 1.5px iron 描边；未练格近乎透明
- 照片标记：9px 相机 SVG 右上角
- 底部图例：七色小方块 + 相机说明
- 点格进日详情交互不变

### 3.3 数据页（stats 卡片）

- 周/月/年切换 segmented 保留，激活态改 iron 色 tint
- 英雄三数：打卡天数（heat 渐变）/ 总组数 / 总容量（t 单位小字），`.display` 40px，竖蚀刻线分隔
- 容量趋势：Chart.js 面积图重新皮肤 — heat 渐变描边线 + iron 渐隐填充 + 极淡网格线 + 端点 amber 圆点
- 部位分布：每行 = 部位图标色块 + 名称 + 水平条（部位色）+ 组数，替换现有图表样式
- 底部新增**海报入口 banner**：迷你钢印 + 「生成 N 月训练海报」+ 副文案「把这个月的汗水盖上钢印，保存到相册」，iron 描边 + 淡热渐变底

### 3.4 我的页（profile 卡片）

- 品牌门面：64px 钢印 + 「铁证 IRONPROOF」+ slogan + **铁龄 N 天**（amber，自首次打卡日起算）
- 累计三数：总打卡（heat 渐变）/ 当前连续 / 累计容量，`.display` 30px
- 蚀刻列表行（icon + 标题 + 副文案 + 右侧值/chevron/tag）：
  1. 每周目标 → 值 `N 练/周`（点击行内展开 ± stepper，复用现有 `adjustWeeklyGoal` 逻辑）
  2. 动作库 → 值 `N 个`（点击展开现有 ExerciseManager，交互逻辑不变）
  3. **月度训练海报**（NEW tag）→ 海报生成页
  4. 数据导出 → CSV/JSON（现有逻辑）
  5. 云同步 → 降级为行尾 `Phase 2` tag，不再占大卡片
  6. 关于铁证 → 版本、隐私承诺（照片只存本机）
- 页脚 slogan

### 3.5 记录流

不改三步逻辑；仅换皮：部位选择 chips 用 PartIcon + 部位色描边选中态（icons 卡片底部示例），按钮/输入框用新 token。

## 4. 首次引导重做（onboarding 卡片）

替换现单屏 `Onboarding.tsx` 为 4 步横滑（步骤指示点，2-4 步右上「跳过」，跳过=直接用默认周目标 4 进入）：

1. **钢印开场**：84px 钢印砸落动效（同打卡动效）+ 「你练过的，都有铁证。」+ 本地存储/无广告承诺
2. **30 秒打卡**：三步说明（选部位→记几组→盖钢印），编号 + 小字副文案
3. **海报卖点**：迷你海报缩略图（真实功能预览，非虚构）+ 「月底，领你的海报」+ 本地生成说明
4. **定周目标**：3/4/5 选择（默认 4 选中）+ 「开始第一次打卡」heat CTA → `saveProfile({weeklyGoal, onboarded:true})` → `/log`（现有逻辑与 submittingRef 门闩保留）

## 5. 月度海报（poster/monthly 卡片）— 新功能

### 5.1 范围

本次只做**月度**海报；年度海报列 Phase 3。入口：数据页 banner + 我的页列表行。

### 5.2 版面（390×693 逻辑尺寸，导出 3x = 1170×2079 png）

顶部「铁证 IRONPROOF / MONTHLY PROOF」小字 → 88px heat 渐变月份 + 年份 → 蚀刻线 → 120px 打卡天数英雄数字 → 组数/容量/最长连续三数 → 蚀刻线 → 部位分布条（top5）→ 迷你月格热力图 → 底部 slogan + 「TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传」+ 74px 钢印。顶部 iron 径向氛围光 + 6% 噪点。

### 5.3 技术方案

- **Canvas 2D 手绘**（不引 html2canvas 等库）：新建 `src/lib/poster/monthlyPoster.ts`，纯函数 `drawMonthlyPoster(canvas, data)`，data 来自现有统计纯函数（打卡天数/组数/容量/连续/部位分布/已练日期集合）
- 字体：`document.fonts.load` 等待 Anton 子集就绪再绘制
- 噪点：离屏 canvas 生成一次随机灰度贴上（低透明度）
- 导出：`canvas.toBlob('image/png')` → iOS Safari 用 `navigator.share({files})` 优先（存相册体验最好），降级 `<a download>` 
- **铁律 7**：全程本地生成，零网络请求，不含照片
- 生成页：全屏预览 + 「保存图片」+ 「关闭」，月份默认当月、可切上月

## 6. 组件与文件计划

新增：`src/components/Stamp.tsx`、`src/components/PartIcon.tsx`、`src/components/ForgeRing.tsx`（锻造环）、`src/screens/poster/PosterScreen.tsx`、`src/lib/poster/monthlyPoster.ts`、Anton 子集字体资产。蚀刻线不做组件，做成 `index.css` 里的 `.etch` 工具类。

修改：`src/index.css`（tokens/@theme/noise/etch/display）、`src/data/bodyParts.ts`（胸色）、`TabBar.tsx`（图标）、`Onboarding.tsx`（重写 4 步）、五个 screen 组件、记录流部位选择、`App` 壳（噪点层 + 海报路由）。

不动：db/repos/统计函数/校验/PWA/测试基建。现有 117 测试必须保持全绿；bodyParts 颜色断言、Onboarding 与各 screen 的测试随 UI 更新。

## 7. 错误处理与边界

- 海报：当月 0 打卡时入口置灰 + 文案「本月还没有钢印」；canvas.toBlob 失败 toast「生成失败，请重试」；share 被用户取消不算错误
- vibrate/share API 不存在时静默降级
- 字体加载超时（3s）用回退字体直接绘制，不阻塞
- 日历格部位 >2 时 `+n`，不溢出

## 8. 验收标准

1. 8 张 claude design 卡片与实现视觉一致（允许字体渲染级差异）
2. 用户 4 点反馈逐条对应：版块化消失（蚀刻线结构）、品牌贯穿（钢印/图标/大数字）、日历一眼看出部位、引导 4 步含海报介绍
3. 月度海报在 iOS Safari PWA 真机可生成并保存
4. `npm test` 全绿、`npm run build` 通过、Lighthouse PWA 不退化
5. 零新增网络请求（铁律 7）
