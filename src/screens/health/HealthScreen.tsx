import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';

export function HealthScreen() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      <header>
        <Button
          variant="tertiary"
          aria-label="返回今日页"
          onClick={() => navigate('/', { replace: true })}
          className="-ml-4 px-4"
        >
          ←
        </Button>
      </header>

      <section className="mt-8">
        <p className="text-[11px] tracking-[2px] text-mute">DAILY NUTRITION</p>
        <h1 className="mt-2 text-[28px] leading-[1.15] font-extrabold text-ink">健康</h1>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center text-center">
        <h2 className="text-xl font-bold text-ink">记录今天吃了什么</h2>
        <p className="mt-2 text-sm text-mute">早餐 · 午餐 · 晚餐 · 加餐</p>
      </section>
    </main>
  );
}
