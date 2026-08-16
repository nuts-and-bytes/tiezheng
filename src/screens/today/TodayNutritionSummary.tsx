import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { evaluateNutritionDay, formatNutritionIntake } from '../../lib/nutritionStats';
import { listNutritionDay } from '../../repos/mealRepo';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';

export function TodayNutritionSummary({ date }: { date: string }) {
  const targetsEnabled = autoNutritionTargetsEnabled();
  const queriedData = useLiveQuery(async () => {
    const [day, plan] = await Promise.all([
      listNutritionDay(date),
      getEffectiveNutritionPlan(date),
    ]);
    return { day, plan };
  }, [date]);
  const data = queriedData?.day.date === date ? queriedData : undefined;
  const label = !data
    ? '正在读取饮食记录'
    : data.day.summary.recordedMeals === 0 && data.plan === undefined
      ? '记录今天吃了什么'
      : formatNutritionIntake(data.day.summary);
  const evaluation = data && targetsEnabled
    ? evaluateNutritionDay(data.day.summary, data.plan)
    : undefined;
  const statusMessages = evaluation
    ? [evaluation.protein, evaluation.energy]
        .filter((dimension) => dimension.mode !== 'disabled')
        .map((dimension) => dimension.message)
    : [];

  return (
    <section
      aria-labelledby="today-nutrition-title"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-4"
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="today-nutrition-title" className="text-[11px] tracking-[2px] text-mute uppercase">
            今日饮食
          </h2>
          <p className="mt-1 text-sm font-semibold text-ink">{label}</p>
          {data && data.day.summary.recordedMeals > 0 && (
            <p className="mt-1 text-xs text-mute">
              已记录 {data.day.summary.recordedMeals} / 4 餐
            </p>
          )}
          {data && (
            <div
              role="status"
              aria-label="今日目标状态"
              aria-live="polite"
              className="mt-2 space-y-1 text-xs text-mute"
            >
              {statusMessages.length > 0 ? (
                statusMessages.map((message) => <p key={message}>{message}</p>)
              ) : (
                <p>目标评价未开启</p>
              )}
            </div>
          )}
        </div>
        <Link
          to="/health"
          aria-label="进入健康"
          onClick={() => track('health_opened')}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-iron outline-none transition active:scale-[.98] focus-visible:ring-2 focus-visible:ring-iron motion-reduce:transition-none"
        >
          进入健康 <span aria-hidden="true">›</span>
        </Link>
      </div>
    </section>
  );
}
