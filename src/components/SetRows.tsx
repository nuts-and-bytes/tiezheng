import { useState } from 'react';
import { LIMITS, validLoad, validReps } from '../lib/validation';
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
  /** placeholder 一输入就消失，当不了标签。名字得独立挂着，而且要带组号——
      一屏 5 组、10 个框，光叫「重量」等于没有名字。 */
  label: string;
  inputMode: 'decimal' | 'numeric';
  className: string;
  invalid: boolean;
  onCommit: (value: number | undefined) => void;
}

/**
 * 数字输入格：显示层持有本地字符串态，允许「62.」这类中间态存在；
 * 可解析时把 number 同步给上层（store 类型不变），失焦用外部值归一化显示。
 */
function NumField({ value, placeholder, label, inputMode, className, invalid, onCommit }: NumFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const committed = value === undefined ? '' : String(value);
  // 本地字符串与外部值语义一致时显示本地态（保留「62.」）；外部值被别处改动时跟随外部
  const display = text !== null && numOrUndefined(text) === value ? text : committed;
  return (
    <input
      inputMode={inputMode}
      aria-label={label}
      placeholder={placeholder}
      value={display}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(numOrUndefined(e.target.value));
      }}
      onBlur={() => setText(null)}
      aria-invalid={invalid}
      className={`${className} ${invalid ? 'ring-1 ring-inset ring-[#E8483F] text-[#E8483F]' : ''}`}
    />
  );
}

export function SetRows({ sets, onChange }: Props) {
  const patch = (index: number, entry: SetEntry) =>
    onChange(sets.map((s, i) => (i === index ? entry : s)));

  const badWeight = sets.some((s) => s.weight !== undefined && !validLoad(s.weight));
  const badReps = sets.some((s) => s.reps !== undefined && !validReps(s.reps));

  const field = 'rounded-xl bg-raised px-3 py-2.5 text-ink tabular-nums placeholder:text-mute';
  const step =
    'flex h-9 w-9 items-center justify-center rounded-xl bg-raised text-lg text-ink disabled:opacity-25 active:scale-95';

  return (
    // 清单，不是卡片堆：每组一行，靠 line 分隔
    <div>
      <div className="flex items-center gap-3 pb-1">
        <button
          type="button"
          aria-label="减一组"
          disabled={sets.length <= LIMITS.sets.min}
          onClick={() => onChange(sets.slice(0, -1))}
          className={step}
        >
          −
        </button>
        <span className="min-w-12 text-center text-sm text-mute">{sets.length} 组</span>
        <button
          type="button"
          aria-label="加一组"
          disabled={sets.length >= LIMITS.sets.max}
          onClick={() => onChange([...sets, {}])}
          className={step}
        >
          ＋
        </button>
      </div>
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2.5 border-t border-line py-2.5 text-sm">
          <span className="display w-6 text-xs text-mute">{i + 1}</span>
          <NumField
            inputMode="decimal"
            placeholder="重量kg"
            label={`第 ${i + 1} 组 重量（公斤）`}
            value={s.weight}
            invalid={s.weight !== undefined && !validLoad(s.weight)}
            onCommit={(weight) => patch(i, { ...s, weight })}
            className={`w-24 ${field}`}
          />
          <span className="text-mute">×</span>
          <NumField
            inputMode="numeric"
            placeholder="次数"
            label={`第 ${i + 1} 组 次数`}
            value={s.reps}
            invalid={s.reps !== undefined && !validReps(s.reps)}
            onCommit={(reps) => patch(i, { ...s, reps })}
            className={`w-20 ${field}`}
          />
        </div>
      ))}
      {/* 超范围的值会被 sanitizeSets 静默丢弃 —— 所以必须在这里就说出来，而不是让用户
          按下保存、以为记上了，回头才发现那一栏是空的。 */}
      {badWeight && (
        <p className="pt-2 text-xs text-[#E8483F]">
          重量需在 {LIMITS.load.min}–{LIMITS.load.max} kg 之间
        </p>
      )}
      {badReps && (
        <p className="pt-2 text-xs text-[#E8483F]">
          次数需在 {LIMITS.reps.min}–{LIMITS.reps.max} 之间的整数
        </p>
      )}
    </div>
  );
}
