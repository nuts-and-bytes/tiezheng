import { useLiveQuery } from 'dexie-react-hooks';
import { ExerciseManager } from '../../components/ExerciseManager';
import { todayStr } from '../../lib/dates';
import { buildJsonExport, buildWorkoutCsv, downloadText } from '../../lib/exportData';
import { getProfile, saveProfile } from '../../repos/profileRepo';

export function ProfileScreen() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-2xl font-bold">我的</h1>

      <div className="flex items-center justify-between rounded-2xl bg-card p-5">
        <div>
          <h2 className="font-semibold">云同步</h2>
          <p className="mt-1 text-sm text-mute">换手机不丢数据 · 照片云备份</p>
        </div>
        <span className="rounded-full bg-card2 px-3 py-1 text-xs text-mute">Phase 2 · 敬请期待</span>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-card p-5">
        <h2 className="font-semibold">每周目标</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="减少目标"
            disabled={profile.weeklyGoal <= 1}
            onClick={() => saveProfile({ weeklyGoal: profile.weeklyGoal - 1 })}
            className="h-9 w-9 rounded-lg bg-card2 text-lg disabled:opacity-30 active:scale-95"
          >
            −
          </button>
          <span className="min-w-14 text-center text-lg font-bold">{profile.weeklyGoal} 练/周</span>
          <button
            type="button"
            aria-label="增加目标"
            disabled={profile.weeklyGoal >= 7}
            onClick={() => saveProfile({ weeklyGoal: profile.weeklyGoal + 1 })}
            className="h-9 w-9 rounded-lg bg-card2 text-lg disabled:opacity-30 active:scale-95"
          >
            ＋
          </button>
        </div>
      </div>

      <ExerciseManager />

      <div className="rounded-2xl bg-card p-5">
        <h2 className="mb-1 font-semibold">数据导出</h2>
        <p className="mb-3 text-sm text-mute">数据主权归你。照片仅存本机，不含在导出文件中。</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              downloadText(`tiezheng-${todayStr()}.csv`, await buildWorkoutCsv(), 'text/csv');
            }}
            className="flex-1 rounded-lg bg-card2 py-3 text-sm font-semibold text-ink active:scale-95"
          >
            导出 CSV
          </button>
          <button
            type="button"
            onClick={async () => {
              downloadText(`tiezheng-${todayStr()}.json`, await buildJsonExport(), 'application/json');
            }}
            className="flex-1 rounded-lg bg-card2 py-3 text-sm font-semibold text-ink active:scale-95"
          >
            导出 JSON
          </button>
        </div>
      </div>

      <p className="py-4 text-center text-xs text-mute">铁证 IRONPROOF · 你练过的，都有铁证</p>
    </div>
  );
}
