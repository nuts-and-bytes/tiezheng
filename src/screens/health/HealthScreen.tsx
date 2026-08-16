import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { addDays, todayStr } from '../../lib/dates';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import {
  evaluateNutritionDay,
  formatNutritionIntake,
} from '../../lib/nutritionStats';
import type { MealSlot } from '../../lib/nutritionTypes';
import { listFoods, saveCustomFood } from '../../repos/foodRepo';
import {
  listNutritionDay,
  removeMealItem,
  saveConfirmedFoodItem,
  updateMealItemAmount,
} from '../../repos/mealRepo';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';
import { FoodPickerSheet } from './FoodPickerSheet';
import { MealSection } from './MealSection';
import { NutritionPlanDetails, NutritionPlanSetup } from './NutritionPlanSetup';

const DATA_LOADING = Symbol('health-data-loading');

export function HealthScreen() {
  const navigate = useNavigate();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [pickerSlot, setPickerSlot] = useState<MealSlot>();
  const [editingPlan, setEditingPlan] = useState(false);
  const targetsEnabled = autoNutritionTargetsEnabled();
  const data = useLiveQuery(
    async () => {
      const [day, foods, plan] = await Promise.all([
        listNutritionDay(date),
        listFoods(),
        getEffectiveNutritionPlan(date),
      ]);
      return { day, foods, plan };
    },
    [date],
    DATA_LOADING,
  );

  const evaluation =
    data !== DATA_LOADING && targetsEnabled
      ? evaluateNutritionDay(data.day.summary, data.plan)
      : undefined;
  const evaluationMessages = evaluation
    ? [evaluation.protein, evaluation.energy]
        .filter((dimension) => dimension.mode !== 'disabled')
        .map((dimension) => dimension.message)
    : [];

  function changeDate(nextDate: string) {
    setPickerSlot(undefined);
    setEditingPlan(false);
    setDate(nextDate);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      <header>
        <Button
          variant="tertiary"
          aria-label="返回今日页"
          onClick={() => navigate('/', { replace: true })}
          className="-ml-4 size-11 p-0"
        >
          ←
        </Button>
      </header>

      <section className="mt-6">
        <p className="text-[11px] font-semibold tracking-[2px] text-amber">
          DAILY NUTRITION
        </p>
        <h1 className="mt-2 text-[28px] leading-[1.15] font-extrabold text-ink">健康</h1>
      </section>

      <div className="etch" />
      <div
        role="group"
        aria-label="饮食日期"
        className="flex items-center justify-between border-y border-line py-2"
      >
        <Button
          variant="tertiary"
          aria-label="前一天"
          onClick={() => changeDate(addDays(date, -1))}
        >
          ‹
        </Button>
        <time dateTime={date} className="display text-lg text-ink">
          {date}
        </time>
        <Button
          variant="tertiary"
          aria-label="后一天"
          disabled={date >= today}
          onClick={() => changeDate(addDays(date, 1))}
        >
          ›
        </Button>
      </div>

      {data === DATA_LOADING ? (
        <section
          role="status"
          aria-label="正在读取健康记录"
          className="forged-surface mt-5 min-h-40 animate-pulse rounded-2xl p-5 motion-reduce:animate-none"
        >
          <span className="sr-only">正在读取健康记录</span>
        </section>
      ) : (
        <>
          <div className="mt-5">
            {!data.plan || editingPlan ? (
              <NutritionPlanSetup
                key={`plan:${date}:${data.plan?.id ?? 'new'}:${data.plan?.updatedAt ?? 'none'}`}
                date={date}
                existing={data.plan}
                onSaved={() => setEditingPlan(false)}
              />
            ) : (
              <NutritionPlanDetails
                plan={data.plan}
                targetsEnabled={targetsEnabled}
                onEdit={() => setEditingPlan(true)}
              />
            )}
          </div>

          <section
            aria-label="今日摄入"
            className="forged-surface mt-4 rounded-2xl p-4"
          >
            <p className="text-[10px] font-semibold tracking-[1.5px] text-amber">
              DAILY INTAKE
            </p>
            <h2 className="mt-1 text-sm font-bold text-ink">今日摄入</h2>
            <p className="mt-2 text-sm text-mute">
              {formatNutritionIntake(data.day.summary)}
            </p>
            <div aria-label="今日目标状态" className="mt-3 space-y-1 text-xs text-mute">
              {evaluationMessages.length > 0 ? (
                evaluationMessages.map((message) => <p key={message}>{message}</p>)
              ) : (
                <p>目标评价未开启</p>
              )}
            </div>
          </section>

          <div className="mt-4 space-y-4">
            {data.day.meals.map(({ slot, items }) => (
              <MealSection
                key={slot}
                slot={slot}
                items={items}
                onAdd={setPickerSlot}
                onUpdate={async (id, amount) => {
                  await updateMealItemAmount(id, amount);
                }}
                onRemove={removeMealItem}
              />
            ))}
          </div>

          {pickerSlot && (
            <FoodPickerSheet
              slot={pickerSlot}
              foods={data.foods}
              onClose={() => setPickerSlot(undefined)}
              onCreateCustomFood={saveCustomFood}
              onSave={async ({ operationId, food, amount }) => {
                const saveSnapshot = {
                  operationId,
                  date,
                  slot: pickerSlot,
                  food: structuredClone(food),
                  amount,
                };
                await saveConfirmedFoodItem(saveSnapshot);
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
