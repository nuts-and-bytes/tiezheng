# 铁证辅助重量与连续添加动作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通负重与辅助重量共存，老用户自动获得两个辅助器械预设；新动作默认 4 组，并能从记组数页继续添加动作且完整保留草稿。

**Architecture:** `Exercise.loadMode` 使用可选字段保持 IndexedDB 向后兼容，统一通过 `loadModeOf()` 把缺省值解释为 `external`。动作类型固定在动作层，不进入 `SetEntry`；统计层通过动作映射排除辅助重量的容量与 e1RM。记录流继续使用现有 Zustand 持久化草稿，只改变新条目的初始化与底部操作栏。

**Tech Stack:** React 19、TypeScript、Zustand、Dexie、Vitest、Testing Library、Tailwind CSS 4

**Depends on:** 已批准规格 `docs/superpowers/specs/2026-07-26-tiezheng-data-calendar-ui-redesign-design.md`

---

## Task 1: 建立动作重量类型与老用户预设补齐机制

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/data/presetExercises.ts`
- Modify: `src/data/presetExercises.test.ts`
- Modify: `src/repos/exerciseRepo.ts`
- Modify: `src/repos/exerciseRepo.test.ts`

- [ ] **Step 1: 写失败测试，锁定类型、预设与旧库补齐行为**

在 `src/data/presetExercises.test.ts` 把总数断言从 40 改为 42，并增加：

```ts
expect(PRESET_EXERCISES).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'p-assisted-pullup', bodyPart: 'back', loadMode: 'assistance' }),
  expect.objectContaining({ id: 'p-assisted-dip', bodyPart: 'chest', loadMode: 'assistance' }),
]));
```

在 `src/repos/exerciseRepo.test.ts` 增加两个用例：

```ts
test('已有 40 个预设的旧库会补齐两个辅助动作，不覆盖现有动作', async () => { /* 先写入旧预设，再 seed */ });
test('自定义动作缺省为普通负重，也可显式创建为辅助重量', async () => { /* external + assistance */ });
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/data/presetExercises.test.ts src/repos/exerciseRepo.test.ts`

Expected: 总数、`loadMode` 字段和旧库补齐断言失败。

- [ ] **Step 3: 最小实现动作类型和预设**

在 `src/lib/types.ts` 增加：

```ts
export type LoadMode = 'external' | 'assistance';
export const loadModeOf = (exercise: Pick<Exercise, 'loadMode'>): LoadMode =>
  exercise.loadMode ?? 'external';
```

并给 `Exercise` 增加 `loadMode?: LoadMode`。在 `PresetExercise` 同样增加可选字段，新增：

```ts
{ id: 'p-assisted-dip', name: '辅助双杠臂屈伸', bodyPart: 'chest', loadMode: 'assistance' },
{ id: 'p-assisted-pullup', name: '辅助引体向上', bodyPart: 'back', loadMode: 'assistance' },
```

重写 `seedPresets()`：读取现有主键，只 `bulkPut` 缺失的预设，不能再以 `count() > 0` 直接退出；映射时保留 `p.loadMode`。把 `addCustomExercise` 改成：

```ts
export async function addCustomExercise(
  name: string,
  part: BodyPart,
  loadMode: LoadMode = 'external',
): Promise<Exercise>
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/data/presetExercises.test.ts src/repos/exerciseRepo.test.ts`

Expected: PASS，旧库最终 42 条，重复调用仍幂等。

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/data/presetExercises.ts src/data/presetExercises.test.ts src/repos/exerciseRepo.ts src/repos/exerciseRepo.test.ts
git commit -m "feat: add assisted exercise load modes"
```

## Task 2: 保存、修改并导出动作重量类型

**Files:**
- Modify: `src/repos/exerciseRepo.ts`
- Modify: `src/repos/exerciseRepo.test.ts`
- Modify: `src/lib/exportData.ts`
- Modify: `src/lib/exportData.test.ts`

- [ ] **Step 1: 写失败测试**

增加 `setExerciseLoadMode(id, mode)` 的仓库测试，覆盖：自定义动作和预置动作均可修改；只更新动作元数据，关联 `WorkoutItem.sets` 原样不变。更新 JSON 导出白名单测试，要求每个动作包含归一化后的 `loadMode`，旧动作缺字段时导出 `external`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/repos/exerciseRepo.test.ts src/lib/exportData.test.ts`

Expected: 缺少更新 API 和导出字段。

- [ ] **Step 3: 最小实现**

在 `exerciseRepo.ts` 新增：

```ts
export async function setExerciseLoadMode(id: string, loadMode: LoadMode): Promise<void> {
  await db.exercises.update(id, { loadMode, updatedAt: Date.now() });
}
```

在 `buildJsonExport()` 的动作白名单加入：

```ts
loadMode: loadModeOf(e),
```

不新增 Dexie 版本、store 或索引。项目当前没有 JSON 导入功能，因此本任务只保证旧数据库字段缺失可读、导出格式显式归一；不虚构导入入口。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/repos/exerciseRepo.test.ts src/lib/exportData.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/repos/exerciseRepo.ts src/repos/exerciseRepo.test.ts src/lib/exportData.ts src/lib/exportData.test.ts
git commit -m "feat: persist assisted load mode metadata"
```

## Task 3: 辅助重量不进入容量、负荷类型与 e1RM

**Files:**
- Modify: `src/lib/stats.ts`
- Modify: `src/lib/stats.test.ts`
- Modify: `src/screens/stats/StatsScreen.tsx`
- Modify: `src/screens/profile/ProfileScreen.tsx`
- Modify: `src/lib/poster.ts`

- [ ] **Step 1: 写失败测试锁定统计口径**

在 `stats.test.ts` 构造一个 `loadMode: 'assistance'` 的动作，断言：

```ts
expect(totals(items, dates, exMap).volumeKg).toBe(普通动作容量);
expect(loadKind(只有辅助动作的items, exMap)).toBe('reps');
expect(prsByExercise(items, exMap)).not.toContainEqual(
  expect.objectContaining({ exerciseId: 'p-assisted-pullup' }),
);
```

同时保留普通负重的原有断言，防止把所有重量都排除。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/lib/stats.test.ts`

Expected: 辅助重量仍被计入容量或普通 PR。

- [ ] **Step 3: 给统计入口传入动作映射**

让 `totals(items, workoutDates, exMap?)`、`loadKind(items, exMap?)`、`compare(items, dates, cur, prev, exMap?)` 使用 `loadModeOf(exMap?.get(exerciseId) ?? {})`。只有 `external` 允许累计 `weight * reps`、参与 `hasWeightData` 与普通 e1RM。缺少映射时保持现有默认行为，避免一次性破坏纯函数调用者。

更新三处真实调用：

```ts
const cmp = compare(items, dates, range, prevRangeOf(seg, today), exMap);
const kind = loadKind(items, exMap);
const t = totals(items, dates, exMap);
```

`poster.ts` 使用现有 `input.exMap` 传入。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/lib/stats.test.ts src/screens/stats/StatsScreen.test.tsx src/screens/profile/ProfileScreen.test.tsx src/lib/poster.test.ts`

Expected: PASS，普通负重统计无回归。

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts src/screens/stats/StatsScreen.tsx src/screens/profile/ProfileScreen.tsx src/lib/poster.ts
git commit -m "fix: exclude assistance from strength volume"
```

## Task 4: 按动作类型渲染组输入

**Files:**
- Modify: `src/components/SetRows.tsx`
- Modify: `src/components/SetRows.test.tsx`

- [ ] **Step 1: 写失败组件测试**

让测试 Harness 接收 `loadMode`，新增：辅助模式显示 4 个“辅助 kg”输入和“辅助越少，表现越强”；普通模式继续显示“重量kg”；辅助值 `0` 有效且不标红。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/components/SetRows.test.tsx`

Expected: `SetRows` 不接受 `loadMode`，辅助标签不存在。

- [ ] **Step 3: 最小实现**

把 Props 扩展为 `loadMode?: LoadMode`，由 `loadMode === 'assistance'` 决定 placeholder、aria-label 和帮助文案。继续复用 `validLoad()`，因为它已允许 `0`；不要把辅助数值写到新字段，仍存入 `SetEntry.weight`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/components/SetRows.test.tsx src/lib/validation.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/SetRows.tsx src/components/SetRows.test.tsx
git commit -m "feat: label assisted set inputs"
```

## Task 5: 动作管理支持创建和修改重量类型

**Files:**
- Modify: `src/components/ExerciseManager.tsx`
- Modify: `src/components/ExerciseManager.test.tsx`
- Modify: `src/repos/exerciseRepo.ts`

- [ ] **Step 1: 写失败测试**

覆盖三个行为：创建自定义动作时可选择“辅助重量”；动作行显示“普通负重/辅助重量”；修改类型前出现包含“历史趋势与纪录会重新解释、原始组数据不变”的确认提示，确认后更新元数据。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/components/ExerciseManager.test.tsx`

- [ ] **Step 3: 最小实现**

在新建区增加原生 `<select aria-label="重量类型">`，默认 `external`。动作行增加类型标签和“改类型”三级操作；调用 `window.confirm()` 后执行 `setExerciseLoadMode()`。取消时不得写库。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/components/ExerciseManager.test.tsx src/repos/exerciseRepo.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/ExerciseManager.tsx src/components/ExerciseManager.test.tsx src/repos/exerciseRepo.ts
git commit -m "feat: manage exercise load modes"
```

## Task 6: 默认四组与固定“继续添加动作”操作栏

**Files:**
- Modify: `src/stores/logDraftStore.ts`
- Modify: `src/stores/logDraftStore.test.ts`
- Modify: `src/screens/log/LogFlow.tsx`
- Modify: `src/screens/log/LogFlow.test.tsx`

- [ ] **Step 1: 写失败测试**

更新 store 测试为新动作 `[{},{},{},{}]`。在 `LogFlow.test.tsx` 增加完整流程：选择动作 → 填写第 1 组 → 点击“继续添加动作” → 再选一个同部位动作 → 回到记组数页；断言原输入仍在、新动作是 4 组、旧的 3 组草稿不会自动补成 4 组。再覆盖辅助预设出现且 `SetRows` 收到正确模式。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/stores/logDraftStore.test.ts src/screens/log/LogFlow.test.tsx`

- [ ] **Step 3: 最小实现**

把 `addItem()` 的初始 sets 改为四个空对象。`EditSets` 从已加载的 `names` 读取动作，向 `SetRows` 传 `loadModeOf(exercise)`。底部改为 safe-area 固定栏：

```tsx
<div className="sticky bottom-0 mt-auto bg-bg/95 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur">
  <Button variant="secondary" onClick={onBack}>继续添加动作</Button>
  <Button variant="primary" loading={submitting} onClick={onFinish}>完成打卡</Button>
</div>
```

若统一 `Button` 尚未由视觉计划落地，先保持现有 class 常量与原生按钮，使用同样布局和文案；视觉计划随后机械替换。滚动列表加 `min-h-0 pb-28`，不能遮住最后一组。`PartSection` 的自定义动作创建区也提供重量类型选择并传给 `addCustomExercise()`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- src/stores/logDraftStore.test.ts src/screens/log/LogFlow.test.tsx src/components/SetRows.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/stores/logDraftStore.ts src/stores/logDraftStore.test.ts src/screens/log/LogFlow.tsx src/screens/log/LogFlow.test.tsx
git commit -m "feat: continue workout with four-set defaults"
```

## Task 7: 集成验证与兼容性检查

**Files:**
- Verify only

- [ ] **Step 1: 运行功能测试集**

Run: `npm test -- src/data/presetExercises.test.ts src/repos/exerciseRepo.test.ts src/lib/exportData.test.ts src/lib/stats.test.ts src/components/SetRows.test.tsx src/components/ExerciseManager.test.tsx src/stores/logDraftStore.test.ts src/screens/log/LogFlow.test.tsx`

Expected: PASS。

- [ ] **Step 2: 运行完整门禁**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 3: 浏览器验证关键流程**

在 320px、390px、430px 宽度验证普通动作和辅助动作各一次：辅助值 0 可保存；继续添加动作后输入不丢；固定栏不遮最后一组；重复点击完成只提交一次。

- [ ] **Step 4: 检查范围与分支**

Run: `git diff --check`

Run: `git status --short --branch`

确认没有 Dexie `version(4)`、没有 `SetEntry.assistance`、没有提交 `.superpowers/`。

- [ ] **Step 5: Push 当前实现分支**

Run: `git push -u origin HEAD`
