import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ExerciseManager } from '../../components/ExerciseManager';
import { PartIcon } from '../../components/PartIcon';
import { Stamp } from '../../components/Stamp';
import { todayStr } from '../../lib/dates';
import { buildJsonExport, buildWorkoutCsv, downloadText } from '../../lib/exportData';
import { log } from '../../lib/logger';
import { daysBetween, longestStreak, prsByExercise, totals } from '../../lib/stats';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { adjustWeeklyGoal, getProfile } from '../../repos/profileRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';

export function ProfileScreen() {
  const navigate = useNavigate();
  const today = todayStr();
  const data = useLiveQuery(async () => {
    const [profile, items, dates] = await Promise.all([
      getProfile(),
      listAllItems(),
      listAllWorkoutDates(),
    ]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    return { profile, items, dates, exMap };
  }, [today]);

  // 门闩：导出期间重入直接返回（ref 保证同 tick 连点也拦得住，LogFlow 判例）
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  async function exportFile(kind: 'csv' | 'json') {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(false);
    try {
      if (kind === 'csv') {
        downloadText(`tiezheng-${todayStr()}.csv`, await buildWorkoutCsv(), 'text/csv');
      } else {
        downloadText(`tiezheng-${todayStr()}.json`, await buildJsonExport(), 'application/json');
      }
    } catch (err) {
      log(`export ${kind}: ${String(err)}`);
      setExportError(true);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  if (!data) return null;
  const { profile, items, dates, exMap } = data;

  const t = totals(items, dates);
  const prs = prsByExercise(items, exMap);
  const empty = items.length === 0 && dates.length === 0;
  // 铁龄：从第一条铁证那天算起（含当天）
  const ironAge = dates.length > 0 ? daysBetween(dates[0], today) + 1 : 0;

  return (
    <div className="px-5 pt-6 pb-4">
      {/* 身份：这一页先是「我是谁、我练成了什么」，设置只是附带 */}
      <div className="flex items-center gap-4">
        <Stamp size={60} decorative />
        <div className="min-w-0">
          <h1 className="flex items-baseline gap-2 text-xl font-extrabold">
            铁证
            <span className="text-[10px] font-semibold tracking-[3px] text-mute">IRONPROOF</span>
          </h1>
          <p className="mt-1 text-xs text-mute">你练过的，都有铁证。</p>
          {ironAge > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-amber">
              <HammerGlyph />
              <span>铁龄</span>
              {/* Anton 无中文字形：数字单独成 span，中文留在默认字体里 */}
              <span className="display text-sm leading-none">{ironAge}</span>
              <span>天</span>
            </p>
          )}
        </div>
      </div>

      {/* 战绩：四个大数字。它们是这一页的主角，字号必须压过下面所有设置项。
          零数据时不摆四个 0——那是在告诉新用户「你什么都没有」，跟数据页/PR 榜的空态口径也不一致 */}
      {empty ? (
        <p className="mt-7 rounded-xl border border-dashed border-line px-4 py-7 text-center text-xs leading-relaxed text-mute">
          一条铁证都还没有。
          <br />
          练完第一次，这里立起四个数字：打卡 · 连续 · 组数 · 容量。
        </p>
      ) : (
        <div className="mt-7 grid grid-cols-2">
          <Stat value={t.days} unit="天" label="总打卡" hot className="border-r border-b border-line pr-4" />
          <Stat value={longestStreak(dates)} unit="天" label="最长连续" className="border-b border-line pl-5" />
          <Stat value={t.sets} unit="组" label="总组数" className="border-r border-line pr-4" />
          <Volume kg={t.volumeKg} className="pl-5" />
        </div>
      )}

      <div className="etch" />

      <SectionTitle>个人纪录 · PR</SectionTitle>
      {/* 榜首是 e1RM 外推值——用户从没真正举起来过那个数。
          说明必须在他看到数字之前出现，放列表底部等于没放 */}
      {prs.length > 0 && (
        <p className="mb-1 text-[11px] text-mute">按预估 1RM（Epley）排名 · 越往上越硬</p>
      )}
      {prs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-mute">
          还没有纪录。
          <br />
          记下一组带重量的动作，这里就会立起你的第一块碑。
        </p>
      ) : (
        <ul aria-label="PR 榜" className="flex flex-col">
          {prs.map((pr, i) => (
            <li
              key={pr.exerciseId}
              className={`flex items-center gap-3 py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised">
                <PartIcon part={pr.bodyPart} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[15px] font-semibold">{pr.name}</b>
                <span className="mt-0.5 block text-[11px] text-mute tabular-nums">
                  {pr.weight}kg × {pr.reps} · {pr.date.slice(5)}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-0.5">
                <span
                  className={`display text-[26px] leading-none ${i === 0 ? 'heat-text' : 'text-ink'}`}
                >
                  {Math.round(pr.e1rm)}
                </span>
                <span className="text-[11px] text-mute">kg</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="etch" />

      {/* 全页唯一「浮起来」的表面：它是这页的行动号召 */}
      <button
        type="button"
        aria-label="导出训练海报"
        onClick={() => navigate('/poster')}
        className="flex w-full items-center gap-3.5 rounded-[18px] border border-iron/35 bg-gradient-to-br from-iron/12 to-amber/5 px-4 py-4 text-left active:scale-[0.99]"
      >
        <Stamp size={44} decorative />
        <span className="min-w-0">
          <b className="block text-[15px] font-semibold">导出训练海报</b>
          <span className="mt-0.5 block text-xs text-mute">把汗水盖上钢印 · 保存到相册</span>
        </span>
        <span className="ml-auto text-xl text-iron">›</span>
      </button>

      <div className="etch" />

      <SectionTitle>设置</SectionTitle>

      {/* 设置项一律朴素列表行：细线分隔，没有一人一个卡片 */}
      <div className="flex items-center gap-3.5 py-4">
        <RowIcon>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </RowIcon>
        <b className="flex-1 text-[15px] font-semibold">每周目标</b>
        <span className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="减少目标"
            disabled={profile.weeklyGoal <= 1}
            onClick={() => adjustWeeklyGoal(-1)}
            className="size-8 rounded-lg border border-line bg-raised text-base leading-none text-mute disabled:opacity-30 active:scale-95"
          >
            −
          </button>
          <span className="min-w-16 text-center text-sm font-bold">{profile.weeklyGoal} 练/周</span>
          <button
            type="button"
            aria-label="增加目标"
            disabled={profile.weeklyGoal >= 7}
            onClick={() => adjustWeeklyGoal(1)}
            className="size-8 rounded-lg border border-line bg-raised text-base leading-none text-mute disabled:opacity-30 active:scale-95"
          >
            ＋
          </button>
        </span>
      </div>

      <ExerciseManager />

      <div className="border-t border-line py-4">
        <div className="flex items-center gap-3.5">
          <RowIcon>
            <path d="M12 3.5v11m0 0-3.5-3.5m3.5 3.5 3.5-3.5" />
            <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
          </RowIcon>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-semibold">数据导出</b>
            <span className="mt-0.5 block text-xs text-mute">
              数据主权归你 · 照片仅存本机，不含在导出文件中
            </span>
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => exportFile('csv')}
            className="flex-1 rounded-xl border border-line bg-raised py-2.5 text-sm font-semibold text-ink disabled:opacity-30 active:scale-95"
          >
            导出 CSV
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => exportFile('json')}
            className="flex-1 rounded-xl border border-line bg-raised py-2.5 text-sm font-semibold text-ink disabled:opacity-30 active:scale-95"
          >
            导出 JSON
          </button>
        </div>
        {exportError && <p className="mt-2 text-xs text-iron">导出失败，请重试</p>}
      </div>

      <div className="flex items-center gap-3.5 border-t border-line py-4">
        <RowIcon>
          <path d="M6.5 19.5c-2.2-1.2-3.5-3.3-3.5-6C3 8.9 7 5.5 12 5.5s9 3.4 9 8c0 2.7-1.3 4.8-3.5 6" />
          <path d="M12 12v7.5" />
        </RowIcon>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] font-semibold">云同步</b>
          <span className="mt-0.5 block text-xs text-mute">换手机不丢数据 · 照片云备份</span>
        </span>
        <span className="rounded-full border border-line px-2.5 py-1 text-[10px] text-mute">
          Phase 2
        </span>
      </div>

      <p className="pt-8 pb-2 text-center text-[11px] tracking-[1px] text-mute">
        IRONPROOF v2 · 你练过的，都有铁证
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[11px] tracking-[2px] text-mute uppercase">{children}</p>;
}

/** 铁龄前的锤形字标。这里原是锤子 emoji：设备字体不齐时掉成豆腐块，也不是全站的线描图标语言 */
function HammerGlyph() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4.5" y="4" width="13" height="5.5" rx="1.6" />
      <path d="M11 9.5V20" />
    </svg>
  );
}

/** 设置行的线描图标框，图形取自 docs/design-cards/screens/profile.html */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised">
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-mute"
        aria-hidden
      >
        {children}
      </svg>
    </span>
  );
}

/** 战绩格：数字用 Anton（.display，纯数字），单位/标签另起 span 走默认字体 */
function Stat({
  value,
  unit,
  label,
  hot,
  className,
}: {
  value: number | string;
  unit: string;
  label: string;
  hot?: boolean;
  className?: string;
}) {
  return (
    <div className={`py-4 ${className ?? ''}`}>
      <p className="flex items-baseline gap-1">
        <span className={`display text-[42px] leading-none ${hot ? 'heat-text' : 'text-ink'}`}>
          {value}
        </span>
        <span className="text-xs text-mute">{unit}</span>
      </p>
      <p className="mt-2 text-[11px] tracking-[1px] text-mute">{label}</p>
    </div>
  );
}

/** 容量：上千用吨，否则 kg。整数不带小数点，别让 900kg 显示成 900.0 */
function Volume({ kg, className }: { kg: number; className?: string }) {
  const asTon = kg >= 1000;
  return (
    <Stat
      value={asTon ? (kg / 1000).toFixed(1) : String(Math.round(kg))}
      unit={asTon ? 't' : 'kg'}
      label="累计容量"
      className={className}
    />
  );
}
