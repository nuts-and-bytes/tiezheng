import { useState } from 'react';
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

interface NumFieldProps {
  value: number | undefined;
  placeholder: string;
  inputMode: 'decimal' | 'numeric';
  className: string;
  onCommit: (value: number | undefined) => void;
}

/**
 * 数字输入格：显示层持有本地字符串态，允许「62.」这类中间态存在；
 * 可解析时把 number 同步给上层（store 类型不变），失焦用外部值归一化显示。
 */
function NumField({ value, placeholder, inputMode, className, onCommit }: NumFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const committed = value === undefined ? '' : String(value);
  // 本地字符串与外部值语义一致时显示本地态（保留「62.」）；外部值被别处改动时跟随外部
  const display = text !== null && numOrUndefined(text) === value ? text : committed;
  return (
    <input
      inputMode={inputMode}
      placeholder={placeholder}
      value={display}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(numOrUndefined(e.target.value));
      }}
      onBlur={() => setText(null)}
      className={className}
    />
  );
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
          <NumField
            inputMode="decimal"
            placeholder="重量kg"
            value={s.weight}
            onCommit={(weight) => patch(i, { ...s, weight })}
            className="w-24 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
          <span className="text-mute">×</span>
          <NumField
            inputMode="numeric"
            placeholder="次数"
            value={s.reps}
            onCommit={(reps) => patch(i, { ...s, reps })}
            className="w-20 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
        </div>
      ))}
    </div>
  );
}
