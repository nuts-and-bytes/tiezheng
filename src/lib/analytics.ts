/* 这个文件是训练数据能不能出境的唯一闸门。
 *
 * 铁律：出境的只有白名单里的字面量 —— 事件名和屏幕名。训练明细、workout.note、照片，
 * 一个字节都不许走这条线。
 *
 * 这条铁律靠四层拦，缺一层都会漏。前三层挡"我们主动发出去的东西"，第四层挡
 * "umami 自己顺手捎带的东西"—— 后者才是真正阴的那条路：
 *
 * 一、类型。track 的签名里没有第二个参数。调用点物理上递不进去任何数据 ——
 *    不是"约定不传"，是传了编译不过。
 *
 * 二、关掉 umami 的 auto-track。umami 默认自己劫持 pushState 上报 pageview，payload 里带
 *    真实 URL。而 HashRouter 的每一次导航都走 history.pushState(state, "", "#/day/2026-07-14")
 *    （react-router 7 源码确认），umami 又默认不剥 hash —— 用户每翻一天详情，那个日期就绕过
 *    track()、绕过类型系统，自己飞出去了。关掉它，使用记录改由 trackScreen 上报白名单字面量：
 *    /day/2026-07-14 在 screenOf 那一步就折叠成 'day'，日期在源头就没了。
 *
 * 三、源码守门（见 analytics.test.ts 最后一条）。window.umami 是全局对象，谁都能在自己的
 *    组件里绕过这个封装写 window.umami.track('x', { note })，类型系统拦不住。所以钉死：
 *    src 下除了本文件，不许有第二个模块认识 umami 这个词。
 *
 * 四、exclude-hash。前三层全都只管"我们递给 umami 的那个参数"—— 可 payload 根本不是我们
 *    组装的。umami 模块顶层跑了一句 Y = B(location.href)，然后 C() 把 `url: Y` 塞进**每一个**
 *    事件 payload，包括我们发的 track('workout_logged')。关掉 auto-track 只是让 Y 不再随导航
 *    更新 —— 它于是被**冻结在脚本加载那一刻的 URL** 上。用户在 #/day/2026-07-14 刷新一次
 *    （或从分享链接进来），此后整个会话的每个事件都驮着那个日期出境。白名单对此无能为力：
 *    它管得住我们传什么，管不住 umami 自己往里塞什么。只能让 umami 在源头剥掉 hash。
 *    （源码：N=w("exclude-hash")==="true"，B() 里 `N && (e.hash="")`）
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

/** umami 自己组装的 payload：website / hostname / screen / language / url / referrer… */
type UmamiPayload = Record<string, unknown>;

/**
 * 全局对象上只声明我们允许自己用的那部分：track 只收一个事件名，或一个"改写 payload 的函数"。
 * umami 真实的 API 还支持 track(name, data) —— 这里故意不声明第二个参数，让"想给事件挂数据"
 * 这件事在类型层面就无路可走。
 *
 * 屏幕上报必须走函数形式，不能直接递对象：umami 对对象走的是 `{...t}` —— 不合并它自己组装的
 * payload，website / hostname 全丢，服务端认不出这是哪个站点，这条上报就白发了。
 * 函数形式拿到它组装好的 props，我们只把 url / title 换掉。
 */
declare global {
  interface Window {
    umami?: { track: (payload: string | ((props: UmamiPayload) => UmamiPayload)) => void };
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
 * 脚本是 async 从 CDN 拉的，而首屏那次上报只等一个 IndexedDB 读 —— 本地读几乎必赢跨域请求。
 * 于是"入口是哪一屏"这条最该有的记录，冷启动时大概率撞在 window.umami 还没出生的空档里，被
 * `?.` 一声不响吞掉：不报错，只是这个数字长期偏低、且偏得毫无规律。攒着，等 onload 补发。
 *
 * 上限 20：脚本可能永远不来（广告拦截器、断网），队列不能无限涨。溢出时丢新的不丢旧的 ——
 * 最该保住的入口那条在最前面。
 */
type Pending = string | ((props: UmamiPayload) => UmamiPayload);
const MAX_PENDING = 20;
let pending: Pending[] = [];

function send(payload: Pending): void {
  if (window.umami) window.umami.track(payload);
  // 没配 id 就不攒 —— 脚本永远不会来，dev 里不该悬着一个只进不出的队列
  else if (websiteId() && pending.length < MAX_PENDING) pending.push(payload);
}

/**
 * 幂等性直接从 DOM 里读，不用模块级 flag —— 这样测试之间清一下 head 就自然复位，
 * 不必为了测试在生产代码上开一个 reset() 后门。
 */
export function initAnalytics(): void {
  const id = websiteId();
  if (!id) return;
  if (document.querySelector('script[data-website-id]')) return;

  pending = []; // 这里是入口：它之前不存在合法的上报（main.tsx 在 render 之前就调了它）

  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  // 云版免费只给 3 个站点，搬去自托管是迟早的事。地址写死 = 部署决策泄漏进源码
  s.src = import.meta.env.VITE_UMAMI_SRC?.trim() || CLOUD_SRC;
  s.dataset.websiteId = id;
  s.dataset.autoTrack = 'false'; // ← 文件头第二层。删掉这行 = 每次翻日历，日期自己出境
  s.dataset.excludeHash = 'true'; // ← 文件头第四层。删掉这行 = 每个事件都驮着当前 URL 出境
  s.onload = () => {
    const queued = pending;
    pending = [];
    for (const p of queued) window.umami?.track(p);
  };
  document.head.appendChild(s);
}

/** 脚本可能没加载（断网 / 被拦截）—— 埋点失败绝不能把 app 带崩 */
export function track(event: AnalyticsEvent): void {
  send(event);
}

export function trackScreen(screen: AnalyticsScreen): void {
  // 只覆盖 url / title，其余保留 umami 自己组装的字段（见 declare global 处的说明）
  send((props) => ({ ...props, ...SCREENS[screen] }));
}
