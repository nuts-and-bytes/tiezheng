# 铁证精密锻造视觉系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 GPT 生图作为视觉探索参考，落地可缩放的 A1 实心部位徽记、品牌/导航图标、统一三层按钮与精密锻造表面，并迁移全 App 的真实交互控件。

**Architecture:** 生成图只进入 `docs/design-references/generated/`，运行时 UI 不依赖位图。最终图标集中在 `PartIcon.tsx`/`Stamp.tsx` 的内联 SVG，按钮集中在 `Button.tsx`，材质与状态集中在 theme token/CSS；页面只组合这些原语，不复制热源渐变和按压状态。

**Tech Stack:** GPT Image Generation、React 19、SVG、Tailwind CSS 4、Vitest、Testing Library、浏览器截图验收

**Depends on:** 可与辅助功能计划 Task 1–5 并行设计，但按钮迁移应在各功能屏幕结构稳定后完成。

---

## Task 1: 生成三组项目视觉参考资产

**Files:**
- Add: `docs/design-references/generated/tiezheng-body-part-emblems.png`
- Add: `docs/design-references/generated/tiezheng-brand-navigation.png`
- Add: `docs/design-references/generated/tiezheng-forged-surfaces.png`
- Add: `docs/design-references/generated/prompts.md`

- [ ] **Step 1: 锁定本轮设计 bible**

写入 `prompts.md`：主题 `deep dark`；字体性格 `sharper product sans with disciplined hierarchy`；结构 `wellness-led calm block rhythm`；表面 `tactile monochrome surface`；配色 `restrained monochrome + one iron-orange accent`；装饰只用 `fine-grid motif` 与 `mini geometric markers`；避免紫蓝渐变、玻璃卡片、Lucide 默认感、嵌套卡片和不可读小字。

- [ ] **Step 2: 单独生成七枚部位徽记概念组**

用内置 GPT 生图工具单独调用一次，不和其他资产批量混生。提示词：

```text
Create a premium mobile fitness icon concept sheet for IRONPROOF / 铁证. Seven distinct solid body-part emblems: chest, shoulder, back, legs, arms, core, cardio. Precision-forged industrial language, bold filled silhouettes, maximum 2 internal cutouts, readable at 12 px and still elegant at 40 px, consistent optical weight and 24x24 geometry. Dark cold-metal background, warm off-white forms, one restrained iron-orange highlight. No text inside icons, no anatomy illustration, no generic line icons, no dumbbell for every category, no gradients inside glyphs. Present as a clean evenly spaced reference sheet, not a phone UI.
```

保存为 `tiezheng-body-part-emblems.png`。

- [ ] **Step 3: 单独生成品牌钢印与四枚导航图标**

第二次独立调用，提示词：

```text
Design a coherent icon reference sheet for the premium dark fitness app IRONPROOF / 铁证: one compact forged proof-stamp brand mark plus four mobile bottom-navigation glyphs for Today, Calendar, Data, Profile. Custom solid-or-cutout geometry, consistent weight, app-native at 20-26 px, subtly industrial and unmistakable without labels. Cold black metal, warm ivory, restrained iron-orange active accent. Avoid Lucide-style outline defaults, emojis, fake 3D chrome, tiny details, text baked into icons, and generic home/user/bar-chart symbols.
```

保存为 `tiezheng-brand-navigation.png`。

- [ ] **Step 4: 单独生成按钮与信息卡材质参考**

第三次独立调用，提示词：

```text
Create a material and component reference board for a premium iOS-native fitness app named IRONPROOF / 铁证. Show one primary action button, one secondary action button, one tertiary text action, and one selected-workout information surface. Precision-forged dark industrial aesthetic: cold matte black, subtle grain, hairline etched separators, restrained warm iron-orange heat source, readable warm-white typography placeholders, strong focus/pressed/disabled distinctions, generous touch targets. Clean hierarchy, very few containers, no glassmorphism, no neon, no purple-blue gradient, no excessive rounded cards, no baked-in final button text.
```

保存为 `tiezheng-forged-surfaces.png`。

- [ ] **Step 5: 视觉筛选与记录**

逐张检查：七枚徽记两两可区分；导航不会与部位徽记混淆；按钮状态层级明确；文字区域对比度足够。若任一条件不满足，针对该资产重新生成，不接受首张弱结果。把最终提示词、生成日期和选中原因写入 `prompts.md`。

- [ ] **Step 6: Commit**

```bash
git add docs/design-references/generated
git commit -m "docs: add generated ironproof visual references"
```

## Task 2: 建立统一 Button 原语

**Files:**
- Add: `src/components/Button.tsx`
- Add: `src/components/Button.test.tsx`
- Modify: `src/styles/theme.css`

- [ ] **Step 1: 写失败测试**

覆盖 `primary`、`secondary`、`tertiary`；默认 `type="button"`；显式 `type="submit"` 可覆盖；`loading` 时禁用且有 `aria-busy`；禁用不触发 onClick；所有 variant 有可识别的 focus-visible 样式；支持 `fullWidth`、`className` 和原生 button 属性。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/components/Button.test.tsx`

- [ ] **Step 3: 最小实现**

API：

```ts
type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
}
```

主按钮使用热源渐变且每屏仅一个；次按钮用发丝描边；三级按钮无容器。三者共享 `min-h-11`、按压、focus-visible、禁用和 reduced-motion 行为。加载状态保留按钮宽度并显示可访问文本，不用只有旋转图标的无名状态。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/components/Button.test.tsx`

```bash
git add src/components/Button.tsx src/components/Button.test.tsx src/styles/theme.css
git commit -m "feat: add unified forged button system"
```

## Task 3: 重绘 A1 实心部位徽记

**Files:**
- Modify: `src/components/PartIcon.tsx`
- Modify: `src/components/PartIcon.test.tsx`
- Add: `docs/design-references/generated/icon-rationale.md`

- [ ] **Step 1: 写失败测试**

断言七个 `part` 都输出同一 `viewBox="0 0 24 24"`、以 `fill=currentColor/部位色` 为主而不是全线描；每个路径有稳定 `data-shape`；12、18、40 三种尺寸保持宽高；传 `color="currentColor"` 可用于导航和单色环境；SVG 为装饰不进入无障碍树。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/components/PartIcon.test.tsx`

- [ ] **Step 3: 从参考图重绘 SVG**

每枚保持 24×24、实心外轮廓、最多两个负空间；不用描摹生成图像素，不引入运行时 PNG。把每枚识别锚点、12px 简化取舍和避免混淆对象写入 `icon-rationale.md`。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/components/PartIcon.test.tsx src/screens/log/LogFlow.test.tsx src/screens/calendar/CalendarScreen.test.tsx`

```bash
git add src/components/PartIcon.tsx src/components/PartIcon.test.tsx docs/design-references/generated/icon-rationale.md
git commit -m "feat: redraw solid body part emblems"
```

## Task 4: 统一品牌钢印与底部导航图标

**Files:**
- Modify: `src/components/PartIcon.tsx`
- Modify: `src/components/PartIcon.test.tsx`
- Modify: `src/components/Stamp.tsx`
- Modify: `src/components/Stamp.test.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/TabBar.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖四枚 `NavGlyph` 共享视觉重量和 fill/cutout 逻辑；选中 tab 同时有文字、颜色和 `aria-current`；品牌钢印保持装饰/语义两种模式；所有图形不含 emoji 和外链图片。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/components/PartIcon.test.tsx src/components/Stamp.test.tsx src/components/TabBar.test.tsx`

- [ ] **Step 3: 最小实现并运行 GREEN**

根据参考图在现有组件内重绘，不把 `NavGlyph` 拆成第三方图标库。TabBar 保持四项、safe area 与文字标签，选中态只用一个 iron 热源。

Run: `npm test -- src/components/PartIcon.test.tsx src/components/Stamp.test.tsx src/components/TabBar.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add src/components/PartIcon.tsx src/components/PartIcon.test.tsx src/components/Stamp.tsx src/components/Stamp.test.tsx src/components/TabBar.tsx src/components/TabBar.test.tsx
git commit -m "feat: refine ironproof brand and navigation glyphs"
```

## Task 5: 迁移核心流程按钮

**Files:**
- Modify: `src/screens/log/LogFlow.tsx`
- Modify: `src/screens/log/LogFlow.test.tsx`
- Modify: `src/screens/Onboarding.tsx`
- Modify: `src/screens/Onboarding.test.tsx`
- Modify: `src/screens/today/TodayScreen.tsx`
- Modify: `src/screens/today/TodayScreen.test.tsx`
- Modify: `src/screens/calendar/DayDetailScreen.tsx`
- Modify: `src/screens/calendar/DayDetailScreen.test.tsx`

- [ ] **Step 1: 先写/更新行为测试**

核心 CTA 使用 `primary`，返回/继续添加使用 `secondary`，关闭/移除使用 `tertiary`；每屏不出现两个 primary；提交/保存 loading 状态仍可访问。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/log/LogFlow.test.tsx src/screens/Onboarding.test.tsx src/screens/today/TodayScreen.test.tsx src/screens/calendar/DayDetailScreen.test.tsx`

- [ ] **Step 3: 机械迁移，保持行为不变**

删除 `LogFlow.tsx` 的 `CTA`/`GHOST` 字符串，改用 `Button`。链接型 CTA 仍用 `Link`，但抽取同源的 `buttonClassName(variant)` 或允许 `Button` 的 `asChild` 方案；不要用嵌套 `<button><a>`。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/screens/log/LogFlow.test.tsx src/screens/Onboarding.test.tsx src/screens/today/TodayScreen.test.tsx src/screens/calendar/DayDetailScreen.test.tsx`

```bash
git add src/screens/log/LogFlow.tsx src/screens/log/LogFlow.test.tsx src/screens/Onboarding.tsx src/screens/Onboarding.test.tsx src/screens/today src/screens/calendar/DayDetailScreen.tsx src/screens/calendar/DayDetailScreen.test.tsx
git commit -m "refactor: unify core workflow buttons"
```

## Task 6: 迁移其余 App 按钮与表面

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/InstallHint.tsx`
- Modify: `src/components/PhotoCard.tsx`
- Modify: `src/components/PhotoTimeline.tsx`
- Modify: `src/components/SetRows.tsx`
- Modify: `src/components/UpdateToast.tsx`
- Modify: `src/components/ExerciseManager.tsx`
- Modify: `src/screens/calendar/CalendarScreen.tsx`
- Modify: `src/screens/poster/PosterScreen.tsx`
- Modify: `src/screens/profile/ProfileScreen.tsx`
- Modify: `src/screens/stats/StatsScreen.tsx`
- Modify: 对应现有 `*.test.tsx`

- [ ] **Step 1: 建立按钮清单测试/静态护栏**

在 `Button.test.tsx` 或 `theme.test.ts` 增加源码扫描：允许 `Button.tsx`、Tab 导航链接和必须保留的原生文件输入；其余业务 `<button>` 必须附带明确豁免说明或迁移为统一组件。护栏只检查 `src/`，排除测试文件。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/components/Button.test.tsx src/lib/theme.test.ts`

- [ ] **Step 3: 按文件迁移**

保持现有事件、disabled、aria-label、重入门闩和导航行为。移除散落的热源渐变、圆角和按压 class；分段选择器、日期柱、Tab 等“选择控件”不伪装成 CTA，但必须采用统一 focus-visible 与触控尺寸 token。

- [ ] **Step 4: 精简信息卡表面**

在 `theme.css` 增加精密锻造表面 token/utility：亚光底、单层发丝线、轻微 grain；禁止新增玻璃拟态和大面积阴影。数据页、日历信息卡、PR 分组最多一层容器，层级优先用字号、留白和 `.etch`。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `npm test -- src/components src/screens src/lib/theme.test.ts`

```bash
git add src/components src/screens src/styles/theme.css src/lib/theme.test.ts
git commit -m "refactor: apply forged controls across app"
```

## Task 7: 视觉回归与完成门禁

**Files:**
- Verify only

- [ ] **Step 1: 自动化门禁**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 2: 三尺寸截图验收**

启动：`npm run dev -- --host 127.0.0.1`

在 320×693、390×844、430×932 检查今日、打卡三步、日历、数据、我的、海报页。重点确认：12px/18px/40px 徽记可辨；文本不小于可读尺度；safe area；每屏唯一主 CTA；焦点环；禁用/加载；没有横向溢出；没有 box-in-box 堆叠。

- [ ] **Step 3: 资产边界检查**

Run: `rg -n "docs/design-references/generated|\.png|https?://" src`

Expected: `src` 不引用生成参考 PNG 或运行时网络图片。

- [ ] **Step 4: 范围检查**

Run: `git diff --check`

Run: `git status --short --branch`

确认 `.superpowers/` 未跟踪，生成图仅在文档参考目录，所有按钮文字仍由 HTML 渲染。

- [ ] **Step 5: Push 当前实现分支**

Run: `git push -u origin HEAD`
