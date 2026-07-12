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
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // iOS「阻止所有 Cookie」时访问 localStorage 抛 SecurityError：按已关闭处理，宁可不显示提示
      return true;
    }
  });
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  if (dismissed || !isIOS || isStandalone()) return null;
  return (
    // 真正「浮起来」的东西才配有 raised 表面：这条提示浮在全屏之上
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-raised p-4 text-sm shadow-[0_12px_40px_rgba(0,0,0,.55)]">
      <span className="flex-1">
        {isWeChat
          ? '用 Safari 打开后：分享 → 添加到主屏幕，即可像 App 一样使用'
          : '点底部「分享」→「添加到主屏幕」，即可像 App 一样使用'}
      </span>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, '1');
          } catch {
            // 存储不可用时忽略：本次会话仍关闭提示
          }
          setDismissed(true);
        }}
        className="shrink-0 text-mute"
      >
        知道了
      </button>
    </div>
  );
}
