import { LIMITS } from '../lib/validation';
import type { SetEntry } from '../lib/types';

interface Props {
  sets: SetEntry[];
  onChange: (sets: SetEntry[]) => void;
}

function numOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function SetRows({ sets, onChange }: Props) {
  const patch = (index: number, entry: SetEntry) =>
    onChange(sets.map((s, i) => (i === index ? entry : s)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="减一组"
          disabled={sets.length <= LIMITS.sets.min}
          onClick={() => onChange(sets.slice(0, -1))}
          className="h-9 w-9 rounded-lg bg-card2 text-lg text-ink disabled:opacity-30 active:scale-95"
        >
          −
        </button>
        <span className="min-w-12 text-center text-sm text-mute">{sets.length} 组</span>
        <button
          type="button"
          aria-label="加一组"
          disabled={sets.length >= LIMITS.sets.max}
          onClick={() => onChange([...sets, {}])}
          className="h-9 w-9 rounded-lg bg-card2 text-lg text-ink disabled:opacity-30 active:scale-95"
        >
          ＋
        </button>
      </div>
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-8 text-mute">{i + 1}</span>
          <input
            inputMode="decimal"
            placeholder="重量kg"
            value={s.weight ?? ''}
            onChange={(e) => patch(i, { ...s, weight: numOrUndefined(e.target.value) })}
            className="w-24 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
          <span className="text-mute">×</span>
          <input
            inputMode="numeric"
            placeholder="次数"
            value={s.reps ?? ''}
            onChange={(e) => patch(i, { ...s, reps: numOrUndefined(e.target.value) })}
            className="w-20 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
        </div>
      ))}
    </div>
  );
}
