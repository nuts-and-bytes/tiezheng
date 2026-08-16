import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { PRESET_FOOD_IMAGE_MANIFEST } from '../../data/presetFoodImageManifest.generated';
import type { Food, MealSlot } from '../../lib/nutritionTypes';
import type { SaveCustomFoodInput } from '../../repos/foodRepo';
import { MEAL_LABELS } from './MealSection';
import { useDialogFocusTrap } from './useDialogFocusTrap';

const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 100_000;
const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50';

export interface FoodPickerSheetProps {
  slot: MealSlot;
  foods: Food[];
  onClose(): void;
  onCreateCustomFood(operationId: string, input: SaveCustomFoodInput): Promise<Food>;
  onSave(input: { operationId: string; food: Food; amount: number }): Promise<void>;
}

function fieldText(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

function initialOperationId(ref: { current: string | null }): string {
  if (ref.current === null) ref.current = crypto.randomUUID();
  return ref.current;
}

export function FoodPickerSheet({
  slot,
  foods,
  onClose,
  onCreateCustomFood,
  onSave,
}: FoodPickerSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const operationIdRef = useRef<string | null>(null);
  const operationId = initialOperationId(operationIdRef);
  const submitLatch = useRef(false);
  const mounted = useRef(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [manual, setManual] = useState(false);
  const [manualUnit, setManualUnit] = useState<'g' | 'mL'>('g');
  const [amount, setAmount] = useState('100');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const visibleFoods = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return foods.filter(
      (food) =>
        food.deletedAt === null &&
        (needle === '' ||
          `${food.name} ${food.aliases.join(' ')}`
            .toLocaleLowerCase('zh-CN')
            .includes(needle)),
    );
  }, [foods, query]);
  const selected = useMemo(
    () => foods.find((food) => food.id === selectedId && food.deletedAt === null),
    [foods, selectedId],
  );
  const unit = manual ? manualUnit : (selected?.basisUnit ?? 'g');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLatch.current) return;

    const form = new FormData(event.currentTarget);
    const originalBasisAmountText = fieldText(form, 'originalBasisAmount');
    const originalEnergyValueText = fieldText(form, 'originalEnergyValue');
    const originalProteinGText = fieldText(form, 'originalProteinG');
    const ediblePortionRatioText = fieldText(form, 'ediblePortionRatio');
    const snapshot = {
      operationId,
      manual,
      manualUnit,
      amount: Number(amount),
      selected: selected ? structuredClone(selected) : undefined,
      name: fieldText(form, 'name'),
      rawOrCooked: fieldText(form, 'rawOrCooked'),
      preparation: fieldText(form, 'preparation'),
      originalBasisAmountText,
      originalBasisAmount: Number(originalBasisAmountText),
      originalEnergyUnit: fieldText(form, 'originalEnergyUnit'),
      originalEnergyValueText,
      originalEnergyValue: Number(originalEnergyValueText),
      originalProteinGText,
      originalProteinG: Number(originalProteinGText),
      ediblePortionRatioText,
      ediblePortionRatio: Number(ediblePortionRatioText),
      densityGPerMl: fieldText(form, 'densityGPerMl'),
      conversionAssumptions: fieldText(form, 'conversionAssumptions'),
    };

    if (
      !Number.isFinite(snapshot.amount) ||
      snapshot.amount < MIN_AMOUNT ||
      snapshot.amount > MAX_AMOUNT
    ) {
      setError('实际数量必须是有限且介于 0.01 到 100000 的数');
      return;
    }
    if (!snapshot.manual && !snapshot.selected) {
      setError('请先选择食物');
      return;
    }
    if (
      snapshot.manual &&
      (!snapshot.name ||
        !snapshot.preparation ||
        !snapshot.originalBasisAmountText ||
        !snapshot.originalEnergyValueText ||
        !snapshot.originalProteinGText ||
        !snapshot.ediblePortionRatioText ||
        !snapshot.conversionAssumptions)
    ) {
      setError('请完整填写标签必填项');
      return;
    }

    submitLatch.current = true;
    setSubmitting(true);
    setError('');
    try {
      let food = snapshot.selected;
      if (snapshot.manual) {
        const customInput: SaveCustomFoodInput = {
          name: snapshot.name,
          aliases: [],
          rawOrCooked: snapshot.rawOrCooked as SaveCustomFoodInput['rawOrCooked'],
          preparation: snapshot.preparation,
          originalEnergyValue: snapshot.originalEnergyValue,
          originalEnergyUnit:
            snapshot.originalEnergyUnit as SaveCustomFoodInput['originalEnergyUnit'],
          originalProteinG: snapshot.originalProteinG,
          originalBasisAmount: snapshot.originalBasisAmount,
          originalBasisUnit: snapshot.manualUnit,
          normalizedBasisAmount: 100,
          normalizedBasisUnit: snapshot.manualUnit,
          ediblePortionRatio: snapshot.ediblePortionRatio,
          densityGPerMl:
            snapshot.densityGPerMl === '' ? null : Number(snapshot.densityGPerMl),
          conversionAssumptions: [snapshot.conversionAssumptions],
          fdcId: null,
          fdcDataType: null,
          sourceRetrievedAt: null,
          source: 'user-label',
          sourceVersion: 'user-label-v1',
          license: 'user-provided',
        };
        food = await onCreateCustomFood(snapshot.operationId, customInput);
      }
      if (!food) throw new Error('请先选择食物');
      const saveSnapshot = {
        operationId: snapshot.operationId,
        food: structuredClone(food),
        amount: snapshot.amount,
      };
      await onSave(saveSnapshot);
      operationIdRef.current = crypto.randomUUID();
      submitLatch.current = false;
      if (!mounted.current) return;
      setSubmitting(false);
      onClose();
    } catch (cause) {
      submitLatch.current = false;
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/70" aria-hidden={false}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="food-picker-title"
        className="forged-surface max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-x-0 border-b-0 p-5 text-ink transition motion-reduce:transition-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[2px] text-amber">LOCAL FOOD</p>
            <h2 id="food-picker-title" className="mt-1 text-lg font-extrabold">
              选择食物
            </h2>
          </div>
          <Button
            variant="tertiary"
            aria-label="关闭选择食物"
            onClick={onClose}
            className="size-11 p-0"
          >
            ×
          </Button>
        </div>
        <div className="etch" />

        <form className="space-y-5" noValidate onSubmit={submit}>
          <fieldset disabled={submitting}>
            <legend className="mb-3 text-xs font-semibold tracking-[1.5px] text-amber">
              本地食物目录
            </legend>
            <label className="grid gap-1 text-xs text-mute">
              搜索食物
              <input
                aria-label="搜索食物"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={CONTROL_CLASS}
              />
            </label>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {visibleFoods.map((food) => {
                const image = PRESET_FOOD_IMAGE_MANIFEST.find(
                  (row) => row.foodId === food.id,
                );
                return (
                  <Button
                    type="button"
                    variant="tertiary"
                    aria-label={food.name}
                    aria-pressed={!manual && selectedId === food.id}
                    key={food.id}
                    onClick={() => {
                      setSelectedId(food.id);
                      setManual(false);
                      setAmount(String(food.basisAmount));
                      setError('');
                    }}
                    className="min-h-11 rounded-xl border border-line bg-bg p-2 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {image ? (
                      <img
                        alt=""
                        src={image.path}
                        width={image.width}
                        height={image.height}
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    ) : (
                      <span
                        role="img"
                        aria-label={`${food.name}暂无图片`}
                        className="flex aspect-square w-full items-center justify-center rounded-lg border border-line bg-raised text-[10px] text-mute"
                      >
                        暂无图片
                      </span>
                    )}
                    <span className="mt-2 block leading-4">{food.name}</span>
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              setManual(true);
              setSelectedId(undefined);
              setAmount('100');
              setError('');
            }}
          >
            手动添加食物
          </Button>

          {manual && (
            <fieldset
              disabled={submitting}
              className="grid gap-3 border-l border-line pl-4 text-sm text-mute"
            >
              <legend className="mb-1 text-xs font-semibold tracking-[1.5px] text-amber">
                标签数据
              </legend>
              <label className="grid gap-1">
                食物名称
                <input name="name" aria-label="食物名称" required className={CONTROL_CLASS} />
              </label>
              <label className="grid gap-1">
                生熟状态
                <select name="rawOrCooked" aria-label="生熟状态" className={CONTROL_CLASS}>
                  <option value="not-applicable">不适用</option>
                  <option value="cooked">熟</option>
                  <option value="raw">生</option>
                </select>
              </label>
              <label className="grid gap-1">
                处理方式
                <input
                  name="preparation"
                  aria-label="处理方式"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                原始单位
                <select
                  aria-label="原始单位"
                  value={manualUnit}
                  onChange={(event) => {
                    setManualUnit(event.target.value as 'g' | 'mL');
                    setAmount('100');
                  }}
                  className={CONTROL_CLASS}
                >
                  <option value="g">g</option>
                  <option value="mL">mL</option>
                </select>
              </label>
              <label className="grid gap-1">
                原始基准数量
                <input
                  name="originalBasisAmount"
                  aria-label="原始 basis"
                  type="number"
                  defaultValue="100"
                  min="0.01"
                  max="100000"
                  step="any"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                能量单位
                <select
                  name="originalEnergyUnit"
                  aria-label="能量单位"
                  className={CONTROL_CLASS}
                >
                  <option value="kcal">kcal</option>
                  <option value="kJ">kJ</option>
                </select>
              </label>
              <label className="grid gap-1">
                原始能量
                <input
                  name="originalEnergyValue"
                  aria-label="原始能量"
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                原始蛋白质（克）
                <input
                  name="originalProteinG"
                  aria-label="原始蛋白质（克）"
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                可食部比例
                <input
                  name="ediblePortionRatio"
                  aria-label="可食部比例"
                  type="number"
                  defaultValue="1"
                  min="0.000001"
                  max="1"
                  step="any"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                密度 g/mL（可空）
                <input
                  name="densityGPerMl"
                  aria-label="密度 g/mL（可空）"
                  type="number"
                  min="0.000001"
                  max="100"
                  step="any"
                  className={CONTROL_CLASS}
                />
              </label>
              <label className="grid gap-1">
                换算说明
                <input
                  name="conversionAssumptions"
                  aria-label="换算说明"
                  required
                  className={CONTROL_CLASS}
                />
              </label>
            </fieldset>
          )}

          <fieldset disabled={submitting}>
            <legend className="mb-2 text-xs font-semibold tracking-[1.5px] text-amber">
              实际吃下数量
            </legend>
            <label className="grid gap-1 text-xs text-mute">
              {unit === 'g' ? '实际克数' : '实际毫升'}
              <input
                aria-label={unit === 'g' ? '实际克数' : '实际毫升'}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                type="number"
                min="0.01"
                max="100000"
                step="any"
                required
                className={CONTROL_CLASS}
              />
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-iron">
              {error}
            </p>
          )}
          <Button type="submit" fullWidth loading={submitting}>
            加入{MEAL_LABELS[slot]}
          </Button>
        </form>
      </div>
    </div>
  );
}
