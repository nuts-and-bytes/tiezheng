import { useId, useState } from 'react';
import { LIMITS, validLoad, validReps } from '../lib/validation';
import type { LoadMode, SetEntry } from '../lib/types';

interface Props {
  sets: SetEntry[];
  onChange: (sets: SetEntry[]) => void;
  loadMode?: LoadMode;
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
  describedBy?: string;
  errorMessage?: string;
  onCommit: (value: number | undefined) => void;
}

/**
 * 数字输入格：显示层持有本地字符串态，允许「62.」这类中间态存在；
 * 可解析时把 number 同步给上层（store 类型不变），失焦用外部值归一化显示。
 */
function NumField({
  value,
  placeholder,
  label,
  inputMode,
  className,
  invalid,
  describedBy,
  errorMessage,
  onCommit,
}: NumFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const committed = value === undefined ? '' : String(value);
  // 本地字符串与外部值语义一致时显示本地态（保留「62.」）；外部值被别处改动时跟随外部
  const display = text !== null && numOrUndefined(text) === value ? text : committed;
  return (
    <input
      inputMode={inputMode}
      aria-label={label}
      aria-describedby={describedBy}
      aria-errormessage={errorMessage}
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

export function SetRows({ sets, onChange, loadMode = 'external' }: Props) {
  const id = useId();
  const patch = (index: number, entry: SetEntry) =>
    onChange(sets.map((s, i) => (i === index ? entry : s)));

  const assisted = loadMode === 'assistance';
  const assistanceGuidanceId = `${id}-assistance-guidance`;
  const weightErrorId = `${id}-weight-error`;
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
          data-ui-control="stepper"
          type="button"
          aria-label="减一组"
          disabled={sets.length <= LIMITS.sets.min}
          onClick={() => onChange(sets.slice(0, -1))}
          className={`${step} outline-none focus-visible:ring-2 focus-visible:ring-iron`}
        >
          −
        </button>
        <span className="min-w-12 text-center text-sm text-mute">{sets.length} 组</span>
        <button
          data-ui-control="stepper"
          type="button"
          aria-label="加一组"
          disabled={sets.length >= LIMITS.sets.max}
          onClick={() => onChange([...sets, {}])}
          className={`${step} outline-none focus-visible:ring-2 focus-visible:ring-iron`}
        >
          ＋
        </button>
      </div>
      {assisted && (
        <p id={assistanceGuidanceId} className="pb-1 text-xs text-mute">
          辅助越少，表现越强
        </p>
      )}
      {sets.map((s, i) => {
        const invalidWeight = s.weight !== undefined && !validLoad(s.weight);
        const weightDescription = [
          assisted ? assistanceGuidanceId : undefined,
          invalidWeight ? weightErrorId : undefined,
        ]
          .filter(Boolean)
          .join(' ') || undefined;

        return (
          <div key={i} className="flex items-center gap-2.5 border-t border-line py-2.5 text-sm">
            <span className="display w-6 text-xs text-mute">{i + 1}</span>
            <NumField
              inputMode="decimal"
              placeholder={assisted ? '辅助 kg' : '重量kg'}
              label={`第 ${i + 1} 组 ${assisted ? '辅助重量' : '重量'}（公斤）`}
              value={s.weight}
              invalid={invalidWeight}
              describedBy={weightDescription}
              errorMessage={invalidWeight ? weightErrorId : undefined}
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
        );
      })}
      {/* 超范围的值会被 sanitizeSets 静默丢弃 —— 所以必须在这里就说出来，而不是让用户
          按下保存、以为记上了，回头才发现那一栏是空的。 */}
      {badWeight && (
        <p id={weightErrorId} className="pt-2 text-xs text-[#E8483F]">
          {assisted ? '辅助重量' : '重量'}需在 {LIMITS.load.min}–{LIMITS.load.max} kg 之间
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
