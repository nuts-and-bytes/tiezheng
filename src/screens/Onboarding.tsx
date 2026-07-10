import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveProfile } from '../repos/profileRepo';

const GOALS = [3, 4, 5];

export function Onboarding() {
  const nav = useNavigate();
  const [goal, setGoal] = useState(4);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-8 text-center">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-3xl text-5xl font-black text-white"
        style={{ background: 'linear-gradient(135deg, #FF5C1F, #FF8C42)' }}
      >
        铁
      </div>
      <div>
        <h1 className="text-3xl font-bold">你练过的，都有铁证。</h1>
        <p className="mt-2 text-sm text-mute">数据存在你手机本地，无广告，无推销。</p>
      </div>
      <div className="w-full">
        <p className="mb-3 text-sm text-mute">每周想练几次？</p>
        <div className="flex justify-center gap-3">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGoal(g)}
              className={`h-14 w-14 rounded-2xl text-xl font-bold active:scale-95 ${
                goal === g ? 'bg-iron text-white' : 'bg-card text-ink'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={async () => {
          await saveProfile({ weeklyGoal: goal, onboarded: true });
          nav('/log');
        }}
        className="w-full rounded-2xl bg-iron py-4 text-lg font-bold text-white active:scale-[.98]"
      >
        开始第一次打卡
      </button>
    </div>
  );
}
