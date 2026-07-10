import { useState } from 'react';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  );
}

const DISMISS_KEY = 'installHintDismissed';

/** iOS Safari 无安装 API：提示「分享→添加到主屏幕」。微信内提示先用 Safari 打开。 */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  );
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  if (dismissed || !isIOS || isStandalone()) return null;
  return (
    <div className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-card p-4 text-sm shadow-lg">
      <span className="flex-1">
        {isWeChat
          ? '用 Safari 打开后：分享 → 添加到主屏幕，即可像 App 一样使用'
          : '点底部「分享」→「添加到主屏幕」，即可像 App 一样使用'}
      </span>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="shrink-0 text-mute"
      >
        知道了
      </button>
    </div>
  );
}
