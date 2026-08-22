import type { ConfirmedModelRangeCandidate } from '../../lib/estimateConfirmation';

const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50';

export interface EstimateConfirmationDraft
  extends ConfirmedModelRangeCandidate {
  assumptionsText: string;
}

export interface EstimateConfirmationEditorProps {
  draft: EstimateConfirmationDraft;
  nutrientMode: 'read-only-range' | 'editable-point';
  disabled: boolean;
  onChange(draft: EstimateConfirmationDraft): void;
}

export function toEditorDraft(
  draft: ConfirmedModelRangeCandidate,
): EstimateConfirmationDraft {
  return {
    ...draft,
    confirmedAssumptions: [...draft.confirmedAssumptions],
    assumptionsText: draft.confirmedAssumptions.join('，'),
  };
}

export function fromEditorDraft(
  draft: EstimateConfirmationDraft,
): ConfirmedModelRangeCandidate {
  const { assumptionsText, ...confirmed } = draft;
  return {
    ...confirmed,
    confirmedAssumptions: assumptionsText
      .split(/[，,]/)
      .map((assumption) => assumption.trim())
      .filter((assumption) => assumption.length > 0),
  };
}

function parseNumber(value: string): number {
  return value.trim().length === 0 ? Number.NaN : Number(value);
}

function numberInputValue(value: number | undefined): number | '' {
  return value === undefined || Number.isNaN(value) ? '' : value;
}

function nutrientRange(
  low: number | null,
  high: number | null,
  unit: 'kcal' | 'g',
): string {
  return typeof low === 'number' && typeof high === 'number'
    ? `${low}–${high} ${unit}`
    : '—';
}

export function EstimateConfirmationEditor({
  draft,
  nutrientMode,
  disabled,
  onChange,
}: EstimateConfirmationEditorProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-mute">
          食物名称
          <input
            aria-label="食物名称"
            maxLength={120}
            className={CONTROL_CLASS}
            value={draft.confirmedName}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...draft, confirmedName: event.currentTarget.value })
            }
          />
        </label>
        <label className="grid gap-1 text-xs text-mute">
          处理方式
          <input
            aria-label="处理方式"
            maxLength={120}
            className={CONTROL_CLASS}
            value={draft.confirmedPreparation}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...draft,
                confirmedPreparation: event.currentTarget.value,
              })
            }
          />
        </label>
        <label className="grid gap-1 text-xs text-mute">
          实际数量
          <input
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            aria-label="实际数量"
            className={CONTROL_CLASS}
            value={numberInputValue(draft.confirmedAmount)}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...draft,
                confirmedAmount: parseNumber(event.currentTarget.value),
              })
            }
          />
        </label>
        <label className="grid gap-1 text-xs text-mute">
          单位
          <select
            aria-label="单位"
            className={CONTROL_CLASS}
            value={draft.confirmedUnit}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...draft,
                confirmedUnit: event.currentTarget.value as 'g' | 'mL',
              })
            }
          >
            <option value="g">g</option>
            <option value="mL">mL</option>
          </select>
        </label>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-mute">AI 热量区间</dt>
          <dd className="font-bold text-ink">
            {nutrientRange(
              draft.candidate.energyKcalLow,
              draft.candidate.energyKcalHigh,
              'kcal',
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-mute">AI 蛋白质区间</dt>
          <dd className="font-bold text-ink">
            {nutrientRange(
              draft.candidate.proteinGLow,
              draft.candidate.proteinGHigh,
              'g',
            )}
          </dd>
        </div>
      </dl>

      {nutrientMode === 'editable-point' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-mute">
            最终热量（kcal）
            <input
              type="number"
              min="0"
              max="100000"
              step="1"
              aria-label="最终热量（kcal）"
              className={CONTROL_CLASS}
              value={numberInputValue(draft.confirmedEnergyKcal)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  confirmedEnergyKcal: parseNumber(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-mute">
            最终蛋白质（g）
            <input
              type="number"
              min="0"
              max="10000"
              step="0.1"
              aria-label="最终蛋白质（g）"
              className={CONTROL_CLASS}
              value={numberInputValue(draft.confirmedProteinG)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  confirmedProteinG: parseNumber(event.currentTarget.value),
                })
              }
            />
          </label>
        </div>
      ) : null}

      <label className="grid gap-1 text-xs text-mute">
        确认说明
        <textarea
          aria-label="确认说明"
          maxLength={500}
          className={`${CONTROL_CLASS} min-h-20 py-3`}
          value={draft.assumptionsText}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, assumptionsText: event.currentTarget.value })
          }
        />
      </label>
    </div>
  );
}
