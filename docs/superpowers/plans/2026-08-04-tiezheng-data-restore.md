# 铁证 JSON 数据恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为铁证增加可预览、可校验、可合并或完整覆盖的 JSON 备份恢复功能，并保持旧版备份兼容。

**Architecture:** `exportData.ts` 维护带版本号的输出契约；新的 `importData.ts` 作为唯一恢复边界，完成文件读取、白名单解析、预览统计和 Dexie 原子事务。新的 `DataRestorePanel.tsx` 只管理文件选择与确认状态，`ProfileScreen.tsx` 负责把它放入现有数据区域。

**Tech Stack:** React 19、TypeScript、Dexie/IndexedDB、Vitest、Testing Library、Tailwind CSS

---

## 文件结构

- 修改 `src/lib/exportData.ts`：在 JSON 顶层写入当前备份版本。
- 修改 `src/lib/exportData.test.ts`：锁定新版本字段和既有字段白名单。
- 新建 `src/lib/importData.ts`：恢复领域边界；解析、校验、预览、合并和覆盖均从这里进入。
- 新建 `src/lib/importData.test.ts`：覆盖旧格式、坏文件、冲突、幂等、回滚和照片保护。
- 新建 `src/screens/profile/DataRestorePanel.tsx`：恢复面板与交互状态机。
- 新建 `src/screens/profile/DataRestorePanel.test.tsx`：覆盖模式说明、预览、覆盖前备份和错误反馈。
- 修改 `src/screens/profile/ProfileScreen.tsx`：在“数据导出”区挂载恢复入口。
- 修改 `src/screens/profile/ProfileScreen.test.tsx`：证明恢复入口出现在正确页面区域。

### Task 1: 版本化 JSON 导出契约

**Files:**
- Modify: `src/lib/exportData.ts:50-110`
- Test: `src/lib/exportData.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/exportData.test.ts` 增加：

```ts
test('buildJsonExport：顶层声明当前备份格式版本', async () => {
  const json = JSON.parse(await buildJsonExport());
  expect(json.schemaVersion).toBe(1);
  expect(json.exportedAt).toEqual(expect.any(String));
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npm test -- --run src/lib/exportData.test.ts
```

Expected: 新测试因 `schemaVersion` 为 `undefined` 失败；既有导出测试保持通过。

- [ ] **Step 3: 写最小实现**

在 `src/lib/exportData.ts` 顶部导出版本常量，并放入 JSON 顶层：

```ts
export const BACKUP_SCHEMA_VERSION = 1;

return JSON.stringify(
  {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workouts: allWorkouts
      .filter((w) => w.deletedAt === null)
      .map((w) => ({ id: w.id, date: w.date, note: w.note ?? '' })),
    workoutItems: items.map((i) => ({
      id: i.id,
      workoutId: i.workoutId,
      exerciseId: i.exerciseId,
      order: i.order,
      sets: i.sets,
    })),
    exercises: allExercises
      .filter((e) => e.deletedAt === null || referenced.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        bodyPart: e.bodyPart,
        loadMode: loadModeOf(e),
        preset: e.preset,
      })),
    weightLogs: allWeightLogs
      .filter((l) => l.deletedAt === null)
      .map((l) => ({ id: l.id, date: l.date, weightKg: l.weightKg })),
    profile: profileRows.map((p) => ({
      id: p.id,
      weeklyGoal: p.weeklyGoal,
      nickname: p.nickname ?? '',
      onboarded: p.onboarded,
    })),
  },
  null,
  2,
);
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
npm test -- --run src/lib/exportData.test.ts
```

Expected: `src/lib/exportData.test.ts` 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/exportData.ts src/lib/exportData.test.ts
git commit -m "feat: version JSON backups"
```

### Task 2: 安全解析、兼容与预览

**Files:**
- Create: `src/lib/importData.ts`
- Create: `src/lib/importData.test.ts`

- [ ] **Step 1: 写版本兼容与预览失败测试**

测试构造一个不含 `schemaVersion`、动作不含 `loadMode` 的旧备份，调用目标 API：

```ts
const candidate = await parseBackupFile(
  new File([JSON.stringify(legacyBackup)], 'tiezheng-old.json', { type: 'application/json' }),
);

expect(candidate.schemaVersion).toBe(0);
expect(candidate.data.exercises[0].loadMode).toBe('external');
expect(candidate.preview).toEqual({
  exportedAt: legacyBackup.exportedAt,
  workoutDays: 1,
  exercises: 1,
  sets: 2,
  weightLogs: 1,
});
```

再增加以下独立测试：

```ts
await expect(parseBackupFile(fileOf('{bad json')))
  .rejects.toMatchObject({ code: 'invalid-json' });

await expect(parseBackupFile(fileOf(JSON.stringify({ ...backup, schemaVersion: 99 }))))
  .rejects.toMatchObject({ code: 'future-version' });

await expect(parseBackupFile(fileOf(JSON.stringify(brokenReferenceBackup))))
  .rejects.toMatchObject({ code: 'invalid-content' });

await expect(parseBackupFile(new File([new Uint8Array(MAX_BACKUP_BYTES + 1)], 'huge.json')))
  .rejects.toMatchObject({ code: 'file-too-large' });
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: 模块或 `parseBackupFile` 不存在而失败。

- [ ] **Step 3: 定义恢复边界类型和错误类型**

在 `src/lib/importData.ts` 定义并导出：

```ts
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export type RestoreMode = 'merge' | 'replace';
export type BackupErrorCode =
  | 'file-too-large'
  | 'invalid-json'
  | 'future-version'
  | 'invalid-content'
  | 'restore-failed';

export class BackupImportError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupImportError';
  }
}

export interface BackupPreview {
  exportedAt: string;
  workoutDays: number;
  exercises: number;
  sets: number;
  weightLogs: number;
}

export interface RestoreCandidate {
  schemaVersion: 0 | 1;
  preview: BackupPreview;
  data: {
    workouts: Array<Pick<Workout, 'id' | 'date' | 'note'>>;
    workoutItems: Array<Pick<WorkoutItem, 'id' | 'workoutId' | 'exerciseId' | 'order' | 'sets'>>;
    exercises: Array<Pick<Exercise, 'id' | 'name' | 'bodyPart' | 'loadMode' | 'preset'>>;
    weightLogs: Array<Pick<WeightLog, 'id' | 'date' | 'weightKg'>>;
    profile: Array<Pick<Profile, 'id' | 'weeklyGoal' | 'nickname' | 'onboarded'>>;
  };
}
```

- [ ] **Step 4: 实现白名单解析与完整校验**

实现 `parseBackupFile(file: File): Promise<RestoreCandidate>`，顺序固定为：

```ts
export async function parseBackupFile(file: File): Promise<RestoreCandidate> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupImportError('file-too-large', '备份文件不能超过 10 MB');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new BackupImportError('invalid-json', '文件不是有效的 JSON 备份');
  }

  return parseBackupValue(raw);
}
```

`parseBackupValue` 必须逐字段复制到新对象，不能对不可信对象使用展开运算符。用 `validLoad`、`validReps`、`validBodyWeight` 和 `LIMITS.sets` 校验数值；用 `parseDate` 后重新格式化或等价的严格判定校验日期。构建 ID 集合后验证：ID 和日期唯一、训练明细引用有效训练与动作、每个训练至少含一个明细、个人设置最多一行且 ID 为 `me`。系统预设动作引用允许由 `PRESET_EXERCISES` 满足。

- [ ] **Step 5: 运行解析测试并确认 GREEN**

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: 兼容、统计和所有拒绝路径测试通过。

- [ ] **Step 6: 提交**

```bash
git add src/lib/importData.ts src/lib/importData.test.ts
git commit -m "feat: validate JSON restore backups"
```

### Task 3: 原子合并与完整覆盖

**Files:**
- Modify: `src/lib/importData.ts`
- Modify: `src/lib/importData.test.ts`

- [ ] **Step 1: 写安全合并失败测试**

用 `resetDb()` 和仓储函数建立当前数据：当前独有日期、与备份冲突日期、当前照片。解析备份后执行：

```ts
const result = await restoreBackup(candidate, 'merge');

expect(result.workoutDays).toBe(candidate.preview.workoutDays);
expect(await listAllWorkoutDates()).toEqual([
  currentOnlyDate,
  backupConflictDate,
  backupOnlyDate,
]);
expect(await getDayItems(backupConflictDate)).toMatchObject(backupDayItems);
expect(await db.photos.count()).toBe(1);
```

重复调用 `restoreBackup(candidate, 'merge')`，断言各表数量不再增加。另写系统预设保护测试：旧备份里的 `p-assisted-pullup` 即使标成 `external`，恢复后仍为当前定义的 `assistance`。

- [ ] **Step 2: 运行合并测试并确认 RED**

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: `restoreBackup` 不存在而失败。

- [ ] **Step 3: 实现安全合并事务**

新增：

```ts
export async function restoreBackup(
  candidate: RestoreCandidate,
  mode: RestoreMode,
): Promise<{ workoutDays: number }> {
  try {
    await db.transaction(
      'rw',
      db.workouts,
      db.workoutItems,
      db.exercises,
      db.weightLogs,
      db.profile,
      async () => {
        if (mode === 'replace') await clearRestorableTables();
        await applyCandidate(candidate, mode);
      },
    );
    return { workoutDays: candidate.preview.workoutDays };
  } catch (error) {
    if (error instanceof BackupImportError) throw error;
    throw new BackupImportError('restore-failed', '恢复失败，原数据未发生变化');
  }
}
```

`applyCandidate` 的合并顺序：

1. 根据 `PRESET_EXERCISES` 构造当前系统预设行并 `bulkPut`。
2. `bulkPut` 清洗后的自定义动作。
3. 查出备份日期对应的当前训练，删除这些训练的全部明细和训练行。
4. 为可能与备份明细 ID 冲突的旧行执行 `bulkDelete`，再写入备份训练与明细。
5. 删除备份日期对应的当前体重行，再写入备份体重。
6. 合并模式对 `profile/me` 使用“当前值 → 备份存在字段”的顺序；覆盖模式使用默认值后叠加备份值。

所有入库行补齐 `updatedAt: Date.now()` 与 `deletedAt: null`。当前系统预设不得使用备份字段覆盖。

- [ ] **Step 4: 写完整覆盖与回滚失败测试**

增加测试：

```ts
await restoreBackup(candidate, 'replace');
expect(await listAllWorkoutDates()).toEqual(backupDates);
expect(await db.weightLogs.count()).toBe(candidate.data.weightLogs.length);
expect(await db.photos.count()).toBe(1);
expect((await db.exercises.get('p-assisted-pullup'))?.loadMode).toBe('assistance');
```

使用 `vi.spyOn(db.workoutItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'))` 制造事务中途失败，恢复前后分别读取五张可恢复表并断言完全相等，同时照片仍在。

- [ ] **Step 5: 实现覆盖清理并确认 GREEN**

`clearRestorableTables` 仅清理五张可恢复表：

```ts
async function clearRestorableTables(): Promise<void> {
  await Promise.all([
    db.workoutItems.clear(),
    db.workouts.clear(),
    db.exercises.clear(),
    db.weightLogs.clear(),
    db.profile.clear(),
  ]);
}
```

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: 合并、覆盖、幂等、系统预设保护、照片保护和事务回滚全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/lib/importData.ts src/lib/importData.test.ts
git commit -m "feat: restore backups atomically"
```

### Task 4: 恢复面板与模式说明

**Files:**
- Create: `src/screens/profile/DataRestorePanel.tsx`
- Create: `src/screens/profile/DataRestorePanel.test.tsx`
- Modify: `src/screens/profile/ProfileScreen.tsx:266-298`
- Modify: `src/screens/profile/ProfileScreen.test.tsx`

- [ ] **Step 1: 写界面失败测试**

在组件测试中 mock `parseBackupFile`、`restoreBackup`、`buildJsonExport` 和 `downloadText`，覆盖：

```ts
expect(screen.getByRole('button', { name: '从 JSON 恢复' })).toBeInTheDocument();

await user.upload(hiddenInput, validFile);
expect(await screen.findByText('安全合并（推荐）')).toBeInTheDocument();
expect(screen.getByText(/保留当前记录/)).toBeInTheDocument();
expect(screen.getByText(/用备份替换当前训练/)).toBeInTheDocument();
expect(screen.getByText(/不会改动本机照片/)).toBeInTheDocument();
expect(screen.getByText('12 天')).toBeInTheDocument();
```

模式测试：默认提交调用 `restoreBackup(candidate, 'merge')`；选择完整覆盖后第一次点击必须先调用 `buildJsonExport` 和 `downloadText`，显示“确认覆盖”，第二次点击才调用 `restoreBackup(candidate, 'replace')`。下载抛错时恢复函数不得调用。

错误测试分别断言 `BackupImportError.code` 映射为：文件过大、文件损坏、版本过新、内容不合法、恢复失败。

- [ ] **Step 2: 运行组件测试并确认 RED**

Run:

```bash
npm test -- --run src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: 新组件和恢复入口不存在而失败。

- [ ] **Step 3: 实现恢复状态机**

`DataRestorePanel.tsx` 使用以下状态：

```ts
type RestoreStep = 'idle' | 'preview' | 'confirm-replace' | 'restoring' | 'success';

const inputRef = useRef<HTMLInputElement>(null);
const [step, setStep] = useState<RestoreStep>('idle');
const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
const [mode, setMode] = useState<RestoreMode>('merge');
const [message, setMessage] = useState<string | null>(null);
```

文件入口：

```tsx
<input
  ref={inputRef}
  type="file"
  accept="application/json,.json"
  className="hidden"
  onChange={handleFile}
/>
<Button variant="secondary" onClick={() => inputRef.current?.click()}>
  从 JSON 恢复
</Button>
```

预览面板使用 `role="dialog"` 与 `aria-labelledby`，渲染五项统计、两张原生 radio 选择卡、固定照片说明以及取消/提交按钮。完整覆盖卡使用现有 `text-iron`/`border-iron` 警示色，不引入新视觉 token。所有可交互控件保持至少 44px 高。

覆盖提交顺序必须为：

```ts
const current = await buildJsonExport();
downloadText(`tiezheng-before-restore-${todayStr()}.json`, current, 'application/json');
setStep('confirm-replace');
```

只有 `confirm-replace` 阶段的第二次确认才调用 `restoreBackup(candidate, 'replace')`。成功后显示 `已恢复 ${result.workoutDays} 天训练记录`，随后用 `window.location.reload()` 让所有 Dexie live query 重新取数。

- [ ] **Step 4: 在个人页挂载并确认 GREEN**

在 `ProfileScreen.tsx` 的 CSV/JSON 导出按钮下方加入：

```tsx
<DataRestorePanel />
```

Run:

```bash
npm test -- --run src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: 恢复入口、区别说明、预览、覆盖二次确认、自动备份和错误反馈测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/screens/profile/DataRestorePanel.tsx src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.tsx src/screens/profile/ProfileScreen.test.tsx
git commit -m "feat: add JSON restore experience"
```

### Task 5: 完整验证与交付

**Files:**
- Review: all changed files

- [ ] **Step 1: 运行恢复功能测试**

```bash
npm test -- --run src/lib/exportData.test.ts src/lib/importData.test.ts src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: 相关测试 0 failures。

- [ ] **Step 2: 运行完整测试、类型检查和生产构建**

```bash
npm test
npm run typecheck
npm run build
```

Expected: 三条命令全部退出码 0，无测试失败或 TypeScript 错误。

- [ ] **Step 3: 核对需求与 diff**

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

逐条对照设计规格：旧备份兼容、两种恢复方式、区别说明、自动回滚备份、原子事务、系统预设保护、照片不变、分类错误和重复导入幂等。

- [ ] **Step 4: 请求代码审查并修复发现项**

使用 `requesting-code-review` skill 审查 `origin/main...HEAD`，只处理可复现且属于本功能范围的问题；修复继续遵循 RED→GREEN。

- [ ] **Step 5: 最终提交与推送**

如果审查修复产生未提交改动：

```bash
git add src docs
git commit -m "fix: address data restore review"
```

重新运行 Step 1–3 后，将功能分支推送到 GitHub；经用户既有授权合并到 `main`，再确认远端 SHA 与 GitHub Actions 部署成功。
