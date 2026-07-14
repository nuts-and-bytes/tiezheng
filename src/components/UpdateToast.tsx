import { useRegisterSW } from 'virtual:pwa-register/react';

/** 规格 §11：新版本提示「点击更新」 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      // 浮层用 raised + 发丝线，iron 只留给那一个字：热源必须稀缺。
      //
      // 落点在底部而不是顶部。顶部试过两版都不行：贴顶压标题，往下躲 52px 就压进了
      // 「顶部控件带」——数据页的周/月/年/全部、海报页的月度/年度都在那条带上，被这颗
      // 胶囊盖住后根本点不到。顶部没有安全落点，因为每页顶端不是标题就是控件。
      // 底部有：TabBar 之上是空的。144px 让开 InstallHint（它在 +80px），
      // 两条提示同时出现（iOS Safari 里遇上新版本）时不会叠在一起。
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+144px)] z-50 mx-auto flex max-w-md items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 shadow-[0_12px_40px_rgba(0,0,0,.55)]"
    >
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="flex-1 text-left text-sm font-semibold text-ink active:scale-95"
      >
        新版本已就绪 · 点击更新
      </button>
      <button
        type="button"
        aria-label="关闭"
        // 更新会重载页面，当前填了一半的组就没了。必须能拒绝。
        onClick={() => setNeedRefresh(false)}
        className="-mr-1 shrink-0 rounded-full p-1 text-mute active:scale-90"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
