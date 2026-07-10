import { db } from './db';

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

/** 全量 JSON 备份；照片是二进制不进 JSON（UI 里注明） */
export async function buildJsonExport(): Promise<string> {
  const [workouts, workoutItems, exercises, weightLogs, profile] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
    db.weightLogs.toArray(),
    db.profile.toArray(),
  ]);
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), workouts, workoutItems, exercises, weightLogs, profile },
    null,
    2,
  );
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
