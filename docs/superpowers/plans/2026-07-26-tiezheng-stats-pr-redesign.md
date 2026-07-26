# 铁证数据页与分部位 PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让数据页展示全部练过的动作、最近 12 周节奏和自适应动作趋势，并把“我的”页 PR 改成按部位独立比较，辅助纪录单独展示。

**Architecture:** 先在 `src/lib/stats.ts` 建立稳定、可单测的动作分组、趋势判型、周节奏和 PR 分组纯函数；屏幕层只负责选择状态、空态和绘图。年度热力图从数据页移除，但保留底层热力工具供日历与海报使用。

**Tech Stack:** React 19、TypeScript、Chart.js、Dexie live query、Vitest、Testing Library

**Depends on:** `2026-07-26-tiezheng-assisted-log-flow.md` Task 1–3

---

## Task 1: 全历史动作按部位分组与稳定排序

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/stats.test.ts`

- [ ] **Step 1: 写失败测试**

为 `groupExerciseActivity(items, exMap, today)` 增加测试：超过 5 个动作仍全部返回；只输出有动作的部位；按 `BODY_PARTS` 排序；今天练过优先；其余按最近日期倒序；同日按中文动作名稳定排序；缺少元数据的孤儿 id 被忽略。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/stats.test.ts`

- [ ] **Step 3: 最小实现**

返回明确结构：

```ts
export interface ExerciseActivity {
  exercise: Exercise;
  lastDate: string;
  trainedToday: boolean;
}
export interface ExerciseActivityGroup {
  bodyPart: BodyPart;
  exercises: ExerciseActivity[];
}
```

使用 `BODY_PARTS` 作为唯一部位顺序，不复用 `topExerciseIds()` 的数量上限。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/stats.test.ts`

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: group workout exercises by body part"
```

## Task 2: 四级自适应动作趋势

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/stats.test.ts`

- [ ] **Step 1: 写失败测试**

为 `exerciseTrend(items, exercise, 12)` 覆盖四个判型：辅助重量 → `assistance`；普通重量+次数 → `e1rm`；仅次数 → `reps`；仅组数 → `sets`。断言按训练日聚合、日期升序、只取最近 12 次；辅助取当天最小辅助重量，次数取当天最高次数，组数取当天该动作总组数。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/stats.test.ts`

- [ ] **Step 3: 最小实现判别联合**

```ts
export type ExerciseTrend =
  | { kind: 'assistance'; unit: 'kg'; inverse: true; points: TrendPoint[] }
  | { kind: 'e1rm'; unit: 'kg'; inverse: false; points: TrendPoint[] }
  | { kind: 'reps'; unit: '次'; inverse: false; points: TrendPoint[] }
  | { kind: 'sets'; unit: '组'; inverse: false; points: TrendPoint[] };
```

所有分支都返回真实口径，不把辅助、次数或组数伪装成 e1RM。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/stats.test.ts`

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: add adaptive exercise trends"
```

## Task 3: 最近 12 周训练节奏

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/stats.test.ts`

- [ ] **Step 1: 写失败测试**

为 `weeklyRhythm(items, workoutDates, 12, today)` 覆盖：周一开头、当前周 + 前 11 周、跨年、空周保留、同一天去重计 1 个训练日、组数按周求和。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/stats.test.ts`

- [ ] **Step 3: 最小实现**

返回 `{ weekStart, days, sets, current }[]`；当前周 `current: true`，不对 0 周做过滤。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/stats.test.ts`

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: calculate twelve-week training rhythm"
```

## Task 4: 普通 PR 与辅助纪录按部位分组

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/stats.test.ts`

- [ ] **Step 1: 写失败测试**

增加 `prGroups(items, exMap)` 测试：部位顺序固定；空部位省略；普通 PR 段内按 e1RM 降序、同值日期新到旧、再按名称；辅助动作不进入普通 PR；辅助纪录按辅助重量升序、次数降序、日期新到旧；辅助值存在但次数缺失时不产生纪录。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/lib/stats.test.ts`

- [ ] **Step 3: 最小实现**

保持 `prsByExercise()` 供海报使用，但让它排除 `assistance` 并补齐稳定 tie-break。新增：

```ts
export interface AssistanceRecord {
  exerciseId: string; name: string; bodyPart: BodyPart;
  assistanceKg: number; reps: number; date: string;
}
export interface PrGroup {
  bodyPart: BodyPart;
  strength: PrRow[];
  assistance: AssistanceRecord[];
}
```

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/lib/stats.test.ts src/lib/poster.test.ts`

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: group strength and assistance records"
```

## Task 5: 重组数据页叙事并删除年度热力图

**Files:**
- Add: `src/screens/stats/ExercisePicker.tsx`
- Add: `src/screens/stats/ExercisePicker.test.tsx`
- Add: `src/screens/stats/TrainingRhythm.tsx`
- Add: `src/screens/stats/TrainingRhythm.test.tsx`
- Add: `src/screens/stats/ExerciseTrend.tsx`
- Add: `src/screens/stats/ExerciseTrend.test.tsx`
- Modify: `src/screens/stats/StatsScreen.tsx`
- Modify: `src/screens/stats/StatsScreen.test.tsx`

- [ ] **Step 1: 写失败组件测试**

覆盖：所有历史动作均显示且按部位标题分组；今日动作带可见“今日”；初次选择优先今天最近动作，否则全历史最近动作；当前动作被删除后回退；12 周区块含 12 个柱与“本周”；辅助趋势纵轴 `reverse: true` 并显示解释；单点显示数字而不画 canvas；数据页不再出现“年度热力”。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/stats/ExercisePicker.test.tsx src/screens/stats/TrainingRhythm.test.tsx src/screens/stats/ExerciseTrend.test.tsx src/screens/stats/StatsScreen.test.tsx`

- [ ] **Step 3: 实现三个聚焦组件**

`ExercisePicker` 只接收纯分组与当前 id；今天状态同时使用部位实心徽记、部位色和文字。`TrainingRhythm` 用语义化按钮/图形描述每周天数与组数，柱高按 12 周 p90 封顶。`ExerciseTrend` 根据判别联合决定标题、单位、tooltip 和 Chart.js `y.reverse`。

- [ ] **Step 4: 按固定顺序组装 StatsScreen**

顺序必须是：周期概览 → 动作分组 → 最近 12 周节奏 → 当前动作趋势 → 部位均衡 → 体重 → 海报 → 照片。删除 `Heat` 组件、`year`/`pick` 状态和年度热力相关 import；不要删除 `heat.ts` 或海报年度图。

- [ ] **Step 5: 运行 GREEN**

Run: `npm test -- src/screens/stats/ExercisePicker.test.tsx src/screens/stats/TrainingRhythm.test.tsx src/screens/stats/ExerciseTrend.test.tsx src/screens/stats/StatsScreen.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/screens/stats src/screens/stats/StatsScreen.tsx src/screens/stats/StatsScreen.test.tsx
git commit -m "feat: redesign workout data narrative"
```

## Task 6: “我的”页按部位展示 PR

**Files:**
- Modify: `src/screens/profile/ProfileScreen.tsx`
- Modify: `src/screens/profile/ProfileScreen.test.tsx`

- [ ] **Step 1: 写失败组件测试**

断言胸、背等部位形成独立 section；同部位第一名高亮；不存在全局序号；文案为“按预估 1RM（Epley）· 每个部位独立比较”；辅助纪录位于所属部位的“辅助训练纪录”小节；两类都空时保留现有空态。

- [ ] **Step 2: 运行 RED**

Run: `npm test -- src/screens/profile/ProfileScreen.test.tsx`

- [ ] **Step 3: 最小实现**

用 `prGroups()` 替换全局 `prsByExercise()` 映射。每个部位只渲染自身列表，排名高亮下标在组内重置；辅助纪录显示“辅助 N kg × reps”并强调越低越强。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm test -- src/screens/profile/ProfileScreen.test.tsx src/lib/stats.test.ts`

```bash
git add src/screens/profile/ProfileScreen.tsx src/screens/profile/ProfileScreen.test.tsx
git commit -m "feat: group personal records by body part"
```

## Task 7: 完整验证

**Files:**
- Verify only

- [ ] **Step 1: 相关测试**

Run: `npm test -- src/lib/stats.test.ts src/screens/stats src/screens/profile/ProfileScreen.test.tsx src/lib/poster.test.ts`

- [ ] **Step 2: 完整门禁**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 3: 浏览器验收**

在 320px、390px、430px 检查：动作超过 5 个不丢；今日标签可见；区块顺序正确；辅助曲线方向正确；PR 不跨部位比较；空数据与单点降级不显示空图。

- [ ] **Step 4: 范围检查与推送**

Run: `git diff --check`

Run: `git status --short --branch`

Run: `git push -u origin HEAD`
