# 铁证月度轨道日历 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 28–31 天月度轨道替换传统 7×6 月历，并让选中日信息卡直接回答“什么时候练了什么、练了多少”。

**Architecture:** 日期格式、默认选择、p90 柱高和信息卡汇总先落到纯函数；`CalendarScreen` 负责月份状态和数据查询，`MonthRail` 与 `SelectedDayCard` 分别负责轨道交互和明细呈现。空刻度不创建按钮，训练柱才可聚焦。

**Tech Stack:** React 19、TypeScript、Dexie live query、Vitest、Testing Library、CSS/Tailwind

**Depends on:** `2026-07-26-tiezheng-assisted-log-flow.md` Task 1–3；视觉计划的 `PartIcon` 可在本计划之后替换，不阻塞功能实现。

---

## Task 1: 相对训练日期纯函数

**Files:**
- Modify: `src/lib/dates.ts`
- Modify: `src/lib/dates.test.ts`

- [ ] **Step 1: 写失败测试**

为 `formatRelativeWorkoutDate(target, today)` 覆盖：同一自然周返回“本周六”；上一自然周返回“上周三”；再早且同年返回“7月3日”；跨年返回“2025年12月28日”；周一边界明确把周日归入前一周。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/dates.test.ts`

- [ ] **Step 3: 最小实现**

比较 `weekStartOf(target)` 与 `weekStartOf(today)`，星期文字来自固定数组：

```ts
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
```

不得用“相差不超过 7 天”代替自然周判断。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/dates.test.ts`

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat: format relative workout dates"
```

## Task 2: 月度轨道与默认选择纯函数

**Files:**
- Add: `src/lib/calendar.ts`
- Add: `src/lib/calendar.test.ts`
- Modify: `src/lib/dates.ts`
- Modify: `src/lib/dates.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：闰年 2 月返回 29 天；31 天月份返回 31 天；当前月选择不晚于今天的最近训练日；历史月选择最后训练日；未来月/无记录返回 `null`；柱高使用当月训练日组数 p90 封顶，空刻度保持最小高度；多部位只取 `cellParts()` 的前两项。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/calendar.test.ts src/lib/dates.test.ts`

- [ ] **Step 3: 实现稳定数据结构**

在 `dates.ts` 增加 `datesOfMonth(ym)`；在新文件返回：

```ts
export interface MonthRailDay {
  date: string;
  day: number;
  trained: boolean;
  sets: number;
  parts: BodyPart[];
  heightPct: number;
  anchorLabel?: string;
}
```

定位标签只给 1、8、15、22、月末。训练柱高度以 `Math.min(sets, p90) / Math.max(p90, 1)` 归一，保留一个可见最小高度；未训练日由渲染层画中性短刻度。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/calendar.test.ts src/lib/dates.test.ts src/lib/heat.test.ts`

```bash
git add src/lib/calendar.ts src/lib/calendar.test.ts src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat: derive month rail calendar data"
```

## Task 3: 构建选中日信息卡数据

**Files:**
- Modify: `src/lib/calendar.ts`
- Modify: `src/lib/calendar.test.ts`

- [ ] **Step 1: 写失败测试**

为 `summarizeRailDay(date, items, exMap)` 断言：全部部位保留且按 `BODY_PARTS` 稳定排序；动作数为当天不同动作数；总组数正确；动作列表带名称和组数；容量只累加普通负重且字段不足时返回 `null`，不显示伪造的 `0kg`；辅助重量不进入容量。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/calendar.test.ts`

- [ ] **Step 3: 最小实现**

返回：

```ts
export interface RailDaySummary {
  date: string;
  parts: BodyPart[];
  moves: number;
  sets: number;
  volumeKg: number | null;
  exercises: { exerciseId: string; name: string; sets: number }[];
}
```

同一动作一天多条 item 时合并组数，动作顺序按 workout item 输入顺序首次出现的位置稳定保留。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/calendar.test.ts`

```bash
git add src/lib/calendar.ts src/lib/calendar.test.ts
git commit -m "feat: summarize selected workout day"
```

## Task 4: 实现可访问的 MonthRail

**Files:**
- Add: `src/screens/calendar/MonthRail.tsx`
- Add: `src/screens/calendar/MonthRail.test.tsx`

- [ ] **Step 1: 写失败组件测试**

断言：一个月有对应数量的刻度；只有训练日是按钮；按钮名称包含完整日期、全部部位和总组数；混合日有最多两段颜色；点击更新 `onSelect`；选中项有 `aria-pressed=true`、日号和非颜色轮廓；1/8/15/22/月末显示定位标签。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/calendar/MonthRail.test.tsx`

- [ ] **Step 3: 最小实现**

轨道使用横向可滚动、底部对齐的 flex 布局；训练柱用 `<button>`，空刻度用 `aria-hidden` 的 `<span>`。颜色段复用 `bodyPartInfo()` 和 `cellParts()`；高对比轮廓、`aria-pressed` 和日号三重表达选中状态。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/screens/calendar/MonthRail.test.tsx`

```bash
git add src/screens/calendar/MonthRail.tsx src/screens/calendar/MonthRail.test.tsx
git commit -m "feat: render accessible month rail"
```

## Task 5: 实现选中日信息卡

**Files:**
- Add: `src/screens/calendar/SelectedDayCard.tsx`
- Add: `src/screens/calendar/SelectedDayCard.test.tsx`

- [ ] **Step 1: 写失败组件测试**

断言主标题使用相对日期，副标题始终保留具体日期；全部部位显示徽记与文字；动作数、组数显示；容量只有 `volumeKg !== null` 时出现；动作列表逐项显示动作名和组数；“查看完整记录”链接到 `/day/YYYY-MM-DD`。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/calendar/SelectedDayCard.test.tsx`

- [ ] **Step 3: 最小实现并运行 GREEN**

Run: `npm test -- src/screens/calendar/SelectedDayCard.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add src/screens/calendar/SelectedDayCard.tsx src/screens/calendar/SelectedDayCard.test.tsx
git commit -m "feat: add selected workout day card"
```

## Task 6: 用月度轨道重构 CalendarScreen

**Files:**
- Modify: `src/screens/calendar/CalendarScreen.tsx`
- Modify: `src/screens/calendar/CalendarScreen.test.tsx`
- Modify: `src/screens/naming.test.tsx`

- [ ] **Step 1: 先替换屏幕测试的行为契约**

删除传统 42 格网格、星期行、溢出格背景的专属断言，改为：月份头与切换按钮仍在；默认选择正确；点击另一个训练柱后信息卡更新；切月后重新按规则选择；未来月或空月显示“这个月还没有一条铁证”且无虚假卡片；月统计仍按当前浏览月计算。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/calendar/CalendarScreen.test.tsx src/screens/naming.test.tsx`

- [ ] **Step 3: 重构查询和状态**

查询范围改为当月首日至末日；一次获取 items、照片日期和 `exMap`。从纯函数得到 `railDays`、默认日期和 `RailDaySummary`。月份变更或数据刷新时：若当前选中日期仍有效则保留，否则使用默认选择；空月设为 `null`。

- [ ] **Step 4: 重组页面**

保留现有大号月份头和月度统计，随后渲染 `MonthRail`，再渲染 `SelectedDayCard`。照片状态可放入信息卡副信息；删除 7×6 grid、星期行、溢出格和底部七色图例。月份切换必须在空态下可用。

- [ ] **Step 5: 运行 GREEN**

Run: `npm test -- src/screens/calendar/CalendarScreen.test.tsx src/screens/calendar/MonthRail.test.tsx src/screens/calendar/SelectedDayCard.test.tsx src/screens/naming.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/screens/calendar/CalendarScreen.tsx src/screens/calendar/CalendarScreen.test.tsx src/screens/calendar/MonthRail.tsx src/screens/calendar/SelectedDayCard.tsx src/screens/naming.test.tsx
git commit -m "feat: replace calendar grid with month rail"
```

## Task 7: 完整验证

**Files:**
- Verify only

- [ ] **Step 1: 相关测试与完整门禁**

Run: `npm test -- src/lib/calendar.test.ts src/lib/dates.test.ts src/screens/calendar src/screens/naming.test.tsx`

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 2: 浏览器验收**

在 320px、390px、430px 验证 28/30/31 天月份、混合部位、p90 极端日、当前月/历史月/未来月、切月、信息卡、完整日记录入口。确认横向轨道可操作但不出现页面级横向溢出。

- [ ] **Step 3: 范围检查与推送**

Run: `git diff --check`

Run: `git status --short --branch`

Run: `git push -u origin HEAD`
