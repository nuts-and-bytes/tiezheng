import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import type { MealItem, MealSlot } from '../../lib/nutritionTypes';

const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 100_000;

export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export interface MealSectionProps {
  slot: MealSlot;
  items: MealItem[];
  onAdd(slot: MealSlot): void;
  photoAiEnabled?: boolean;
  onPhoto?(slot: MealSlot): void;
  onUpdate(id: string, amount: number): Promise<void>;
  onRemove(id: string): Promise<void>;
}

function amountText(low: number, high: number, unit: string): string {
  return low === high
    ? `${Math.round(low)} ${unit}`
    : `约 ${Math.round(low)}–${Math.round(high)} ${unit}`;
}

export function MealSection({
  slot,
  items,
  onAdd,
  photoAiEnabled = false,
  onPhoto,
  onUpdate,
  onRemove,
}: MealSectionProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string>();
  const [pendingById, setPendingById] = useState<Map<string, 'update' | 'remove'>>(
    () => new Map(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pendingLatch = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(
    id: string,
    action: 'update' | 'remove',
    work: () => Promise<void>,
  ) {
    if (pendingLatch.current.has(id)) return;
    pendingLatch.current.add(id);
    setErrors((all) => ({ ...all, [id]: '' }));
    setPendingById((all) => new Map(all).set(id, action));
    try {
      await work();
      if (!mounted.current) return;
      if (action === 'remove') setConfirming(undefined);
      else {
        setDrafts((all) => {
          const next = { ...all };
          delete next[id];
          return next;
        });
      }
    } catch (cause) {
      if (!mounted.current) return;
      setErrors((all) => ({
        ...all,
        [id]: cause instanceof Error ? cause.message : '保存失败，请重试',
      }));
    } finally {
      pendingLatch.current.delete(id);
      if (mounted.current) {
        setPendingById((all) => {
          const next = new Map(all);
          next.delete(id);
          return next;
        });
      }
    }
  }

  return (
    <section
      aria-labelledby={`meal-${slot}`}
      className="forged-surface rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[1.5px] text-amber">MEAL LOG</p>
          <h2 id={`meal-${slot}`} className="mt-1 text-lg font-extrabold text-ink">
            {MEAL_LABELS[slot]}
          </h2>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {photoAiEnabled && onPhoto ? (
            <Button variant="tertiary" onClick={() => onPhoto(slot)}>
              拍照识别
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onAdd(slot)}>
            选择食物
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-mute">尚未记录</p>
      ) : (
        <ul className="mt-4 space-y-4 border-t border-line pt-4">
          {items.map((item) => {
            const pending = pendingById.get(item.id);
            const draft = drafts[item.id] ?? String(item.amount);
            return (
              <li key={item.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{item.name}</p>
                    <p className="mt-1 text-xs leading-5 text-mute">
                      做法：{item.preparation} · 实际吃下：{item.amount} {item.unit}
                    </p>
                    <p className="text-xs leading-5 text-mute">
                      {amountText(item.energyKcalLow, item.energyKcalHigh, 'kcal')} ·{' '}
                      {amountText(item.proteinGLow, item.proteinGHigh, 'g 蛋白质')}
                    </p>
                  </div>
                  <Button
                    variant="tertiary"
                    aria-label={`删除${item.name}`}
                    disabled={pending !== undefined}
                    onClick={() => setConfirming(item.id)}
                  >
                    删除
                  </Button>
                </div>

                <fieldset disabled={pending !== undefined} className="mt-3 flex gap-2">
                  <legend className="sr-only">修改{item.name}实际吃下数量</legend>
                  <input
                    aria-label={`修改${item.name}实际吃下数量`}
                    type="number"
                    min="0.01"
                    max="100000"
                    step="any"
                    value={draft}
                    onChange={(event) => {
                      setDrafts((all) => ({ ...all, [item.id]: event.target.value }));
                      setErrors((all) => ({ ...all, [item.id]: '' }));
                    }}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                  />
                  <Button
                    variant="secondary"
                    aria-label={`保存${item.name}数量`}
                    loading={pending === 'update'}
                    disabled={pending !== undefined}
                    onClick={() => {
                      const amount = Number(draft);
                      if (
                        !Number.isFinite(amount) ||
                        amount < MIN_AMOUNT ||
                        amount > MAX_AMOUNT
                      ) {
                        setErrors((all) => ({
                          ...all,
                          [item.id]: '实际吃下数量必须是有限且介于 0.01 到 100000 的数',
                        }));
                        return;
                      }
                      void run(item.id, 'update', () => onUpdate(item.id, amount));
                    }}
                  >
                    保存
                  </Button>
                </fieldset>

                {errors[item.id] && (
                  <p role="alert" className="mt-2 text-xs text-iron">
                    {errors[item.id]}
                  </p>
                )}
                {confirming === item.id && (
                  <div
                    role="alertdialog"
                    aria-label={`确认删除${item.name}`}
                    className="mt-3 border-l border-iron pl-3 text-xs text-mute"
                  >
                    <p>删除这条已确认记录？</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="secondary"
                        aria-label={`确认删除${item.name}`}
                        loading={pending === 'remove'}
                        disabled={pending !== undefined}
                        onClick={() => void run(item.id, 'remove', () => onRemove(item.id))}
                      >
                        确认删除
                      </Button>
                      <Button
                        variant="tertiary"
                        disabled={pending !== undefined}
                        onClick={() => setConfirming(undefined)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
