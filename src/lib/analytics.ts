/* 这个文件是训练数据能不能出境的唯一闸门。
 *
 * 铁律：出境的只有白名单里的字面量 —— 事件名和屏幕名。训练明细、workout.note、照片，
 * 一个字节都不许走这条线。
 *
 * 这条铁律靠三层拦，缺一层都会漏：
 *
 * 一、类型。track 的签名里没有第二个参数。调用点物理上递不进去任何数据 ——
 *    不是"约定不传"，是传了编译不过。
 *
 * 二、关掉 umami 的 auto-track。这是最容易忘、也最致命的一层：umami 默认自己监听路由变化
 *    并上报 pageview，payload 里带真实 URL。我们的路由是 #/day/2026-07-14 —— 用户每翻一天
 *    详情，那个日期就绕过 track()、绕过类型系统，自己飞出去了。关掉它，白名单才真的是
 *    唯一通道，而不是"审计出来的"唯一通道。使用记录改由 trackScreen 上报白名单字面量：
 *    /day/2026-07-14 在 screenOf 那一步就折叠成 'day'，日期在源头就没了。
 *
 * 三、源码守门（见 analytics.test.ts 最后一条）。window.umami 是全局对象，谁都能在自己的
 *    组件里绕过这个封装写 window.umami.track('x', { note })，类型系统拦不住。所以钉死：
 *    src 下除了本文件，不许有第二个模块认识 umami 这个词。
 *
 * 没配 VITE_UMAMI_WEBSITE_ID 时整个模块是哑的 —— 不注入脚本、零网络请求。
 * dev 和测试里天然安静，不需要谁记得去关。
 */

/** 白名单：能出境的事件，就这几个 */
export type AnalyticsEvent = 'onboarding_done' | 'workout_logged' | 'poster_exported';

/** 白名单：能出境的屏幕名 */
export type AnalyticsScreen =
  | 'today'
  | 'calendar'
  | 'stats'
  | 'profile'
  | 'log'
  | 'poster'
  | 'day';

/** 屏幕 → 上报用的固定字面量。这里没有任何一个字符来自用户数据 */
const SCREENS: Record<AnalyticsScreen, { url: string; title: string }> = {
  today: { url: '/today', title: '今日' },
  calendar: { url: '/calendar', title: '日历' },
  stats: { url: '/stats', title: '数据' },
  profile: { url: '/profile', title: '我的' },
  log: { url: '/log', title: '记录训练' },
  poster: { url: '/poster', title: '海报' },
  day: { url: '/day', title: '训练详情' },
};

/** 路径首段 → 屏幕名。'/day/2026-07-14' 的日期在这一步就被丢掉 */
const BY_SEGMENT: Record<string, AnalyticsScreen> = {
  '': 'today',
  calendar: 'calendar',
  stats: 'stats',
  profile: 'profile',
  log: 'log',
  poster: 'poster',
  day: 'day',
};

/**
 * 全局对象上只声明我们允许自己用的那部分：track 只收一个事件名，或一个屏幕字面量。
 * umami 真实的 API 还支持 track(name, data) —— 这里故意不声明它，让"想传数据"这件事
 * 在类型层面就无路可走。
 */
declare global {
  interface Window {
    umami?: { track: (payload: string | { url: string; title: string }) => void };
  }
}

const CLOUD_SRC = 'https://cloud.umami.is/script.js';

const websiteId = () => import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim() ?? '';

/** 埋点是否真的在跑。文案要据此说实话 —— 没配 id 的构建不许承诺"有匿名统计" */
export function analyticsEnabled(): boolean {
  return websiteId() !== '';
}

export function screenOf(pathname: string): AnalyticsScreen | null {
  return BY_SEGMENT[pathname.split('/')[1] ?? ''] ?? null;
}

/**
 * 幂等性直接从 DOM 里读，不用模块级 flag —— 这样测试之间清一下 head 就自然复位，
 * 不必为了测试在生产代码上开一个 reset() 后门。
 */
export function initAnalytics(): void {
  const id = websiteId();
  if (!id) return;
  if (document.querySelector('script[data-website-id]')) return;

  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  // 云版免费只给 3 个站点，搬去自托管是迟早的事。地址写死 = 部署决策泄漏进源码
  s.src = import.meta.env.VITE_UMAMI_SRC?.trim() || CLOUD_SRC;
  s.dataset.websiteId = id;
  s.dataset.autoTrack = 'false'; // ← 见文件头第二层。删掉这行 = 日期出境
  document.head.appendChild(s);
}

/** 脚本可能没加载（没配 id / 断网 / 被拦截）—— 埋点失败绝不能把 app 带崩 */
export function track(event: AnalyticsEvent): void {
  window.umami?.track(event);
}

export function trackScreen(screen: AnalyticsScreen): void {
  window.umami?.track(SCREENS[screen]);
}
