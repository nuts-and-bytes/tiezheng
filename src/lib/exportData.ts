import { db } from './db';
import { downloadBlob } from './download';

export function csvEscape(value: string): string {
  // OWASP CSV Injection：前导 = + - @ 会被 Excel/WPS 当公式执行，加单引号中和（先前缀再走引号转义）
  if (/^[=+\-@]/.test(value)) value = `'${value}`;
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}

/** 每组一行的扁平 CSV（数据主权，规格 §3） */
export async function buildWorkoutCsv(): Promise<string> {
  const [workouts, items, exercises] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
  ]);
  const dateOf = new Map(
    workouts.filter((w) => w.deletedAt === null).map((w) => [w.id, w.date]),
  );
  const exOf = new Map(exercises.map((e) => [e.id, e]));
  const rows: string[][] = [];
  const active = items
    .filter((i) => i.deletedAt === null && dateOf.has(i.workoutId))
    .sort((a, b) => {
      const d = dateOf.get(a.workoutId)!.localeCompare(dateOf.get(b.workoutId)!);
      return d !== 0 ? d : a.order - b.order;
    });
  for (const item of active) {
    const ex = exOf.get(item.exerciseId);
    item.sets.forEach((s, i) => {
      rows.push([
        dateOf.get(item.workoutId)!,
        ex?.name ?? item.exerciseId,
        ex?.bodyPart ?? '',
        String(i + 1),
        s.weight !== undefined ? String(s.weight) : '',
        s.reps !== undefined ? String(s.reps) : '',
      ]);
    });
  }
  return toCsv(['date', 'exercise', 'body_part', 'set', 'weight_kg', 'reps'], rows);
}

/**
 * 全量 JSON 备份；照片是二进制不进 JSON（UI 里注明）。
 *
 * 两条规矩，都是刻意的：
 * 1. **删了就是删了。** 软删是我们的实现细节，不是给用户的承诺——他删掉的训练日
 *    不该在他发给教练、传网盘的备份里原样复活。逐表按 `deletedAt === null` 过滤。
 *    唯一的例外是 exercises：历史条目靠 exerciseId 取动作名，一刀切会让备份里的
 *    历史变成认不出名字的孤儿 ID，所以**仍被活跃记录引用的软删动作要保留**
 *    （CSV 的 exOf 早就为此不过滤，见上）。
 * 2. **字段是白名单，不是整行 dump。** 尤其 note 是用户的私人文字——它留在自己的
 *    备份里是对的（数据主权），但这必须是一个写下来、被测试钉住的决定，
 *    而不是 spread 的副作用；否则下一个往 Workout 上加字段的人会静默地把它送出去。
 */
export async function buildJsonExport(): Promise<string> {
  const [allWorkouts, allItems, allExercises, allWeightLogs, profileRows] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
    db.weightLogs.toArray(),
    db.profile.toArray(),
  ]);

  const items = allItems.filter((i) => i.deletedAt === null);
  const referenced = new Set(items.map((i) => i.exerciseId));

  return JSON.stringify(
    {
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
        .map((e) => ({ id: e.id, name: e.name, bodyPart: e.bodyPart, preset: e.preset })),
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
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
