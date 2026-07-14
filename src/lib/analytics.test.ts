import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { analyticsEnabled, initAnalytics, screenOf, track, trackScreen } from './analytics';

const ID = '11111111-2222-3333-4444-555555555555';
const injected = () => document.querySelector<HTMLScriptElement>('script[data-website-id]');

/**
 * umami 的函数形式：它把自己组装好的 payload 递进来，我们只覆盖其中的 url / title。
 * 这里模拟一份"它真实会传进来的 props"——注意 url 里带着训练日期，那正是要被覆盖掉的东西。
 * （对照 cloud.umami.is/script.js：C()=({website,screen,language,title,hostname,url,referrer,…})）
 */
const UMAMI_PROPS = {
  website: ID,
  hostname: 'tiezheng.pages.dev',
  screen: '390x844',
  language: 'zh-CN',
  title: '铁证 IRONPROOF',
  url: 'https://tiezheng.pages.dev/#/day/2026-07-14',
  referrer: '',
};
/** 取出第 i 次调用传给 umami 的函数，喂给它 umami 的 props，看它吐出什么 payload */
const applied = (spy: Mock, i = 0): Record<string, unknown> => spy.mock.calls[i][0](UMAMI_PROPS);

function fakeUmami(): Mock {
  const spy = vi.fn();
  (window as unknown as { umami: unknown }).umami = { track: spy };
  return spy;
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete (window as unknown as { umami?: unknown }).umami;
});
afterEach(() => vi.unstubAllEnvs());

describe('装载', () => {
  test('没配 website id 时不注入任何脚本 —— dev/test 里零网络请求', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    initAnalytics();
    expect(injected()).toBeNull();
    expect(analyticsEnabled()).toBe(false);
  });

  test('配了 website id 时注入 umami 脚本并带上 id', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    const s = injected();
    expect(s?.src).toBe('https://cloud.umami.is/script.js');
    expect(s?.dataset.websiteId).toBe(ID);
    expect(analyticsEnabled()).toBe(true);
  });

  /* 云版免费额度只有 3 个站点，随时可能要搬去自托管。脚本地址写死 = 搬家要改代码，
   * 那就成了"部署决策泄漏进源码"。留一个环境变量出口，默认仍走云版。 */
  test('脚本地址可被环境变量覆盖 —— 自托管不需要改一行代码', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    vi.stubEnv('VITE_UMAMI_SRC', 'https://stats.example.com/script.js');
    initAnalytics();
    expect(injected()?.src).toBe('https://stats.example.com/script.js');
  });

  /* 这条是整个隐私边界的地基。
   * umami 默认开着 auto-track：每次路由变化它自己上报一次 pageview，payload 里带真实
   * URL —— 而我们的路由是 #/day/2026-07-14，日期就这么绕过 track() 自己飞出去了。
   * 关掉它，白名单通道才是唯一通道，而不是"审计出来的"唯一通道。 */
  test('关掉 auto-track —— 否则 #/day/2026-07-14 里的日期会绕过白名单自己上报', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    expect(injected()?.dataset.autoTrack).toBe('false');
  });

  /* 关掉 auto-track 只挡住了"自动上报"这半边。umami 模块顶层那句 `Y = B(location.href)`
   * 照跑不误，而 C() 会把 `url: Y` 塞进**每一个**事件 payload——包括我们自己发的
   * track('workout_logged')。用户在 #/day/2026-07-14 上刷新一次（或从分享链接进来），
   * Y 就冻结成那个带日期的 URL，此后整个会话的每个事件都驮着它出境。
   *
   * 白名单管不到这条通道——payload 不是我们组装的。只能让 umami 自己在源头剥掉 hash：
   * 源码里 N=w("exclude-hash")==="true"，B() 里 `N && (e.hash = "")`。 */
  test('剥掉 hash —— 否则每个事件 payload 都驮着 #/day/2026-07-14 出境', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    expect(injected()?.dataset.excludeHash).toBe('true');
  });

  test('重复调用只注入一次', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    initAnalytics();
    initAnalytics();
    expect(document.querySelectorAll('script[data-website-id]')).toHaveLength(1);
  });
});

describe('track', () => {
  test('脚本没加载时静默 —— 断网/被拦截不能把 app 带崩', () => {
    expect(() => track('workout_logged')).not.toThrow();
  });

  /* 隐私边界的类型级守门：track 的签名里没有第二个参数，所以调用点物理上
   * 递不进去任何训练明细。这条测试钉住"运行时也确实只发了事件名"。 */
  test('只发事件名，一个字节的附加数据都不带', () => {
    const spy = vi.fn();
    (window as unknown as { umami: unknown }).umami = { track: spy };
    track('workout_logged');
    expect(spy).toHaveBeenCalledWith('workout_logged');
    expect(spy.mock.calls[0]).toHaveLength(1);
  });
});

describe('trackScreen', () => {
  /* 必须走 umami 的**函数**形式，不能直接递一个对象：它的 track 对对象走的是 `{...t}`——
   * 不合并自己组装的 payload，website / hostname / screen 全丢，服务端认不出这是哪个站点，
   * 这条上报就白发了。函数形式拿到它组装好的 props，我们只把 url / title 换成白名单字面量。
   * （读 cloud.umami.is/script.js 源码确认：F=(t,e)=>q("object"==typeof t?{...t}:…)） */
  test('保留 umami 自己的 payload —— 丢了 website 服务端根本不收', () => {
    const spy = fakeUmami();
    trackScreen('day');
    expect(applied(spy).website).toBe(ID);
  });

  test('把真实 URL 换成白名单字面量 —— 日期被覆盖掉，不出境', () => {
    const spy = fakeUmami();
    trackScreen('day');
    const payload = applied(spy);
    expect(payload.url).toBe('/day');
    expect(payload.title).toBe('训练详情');
    expect(JSON.stringify(payload)).not.toContain('2026-07-14');
  });

  test('脚本没加载时静默', () => {
    expect(() => trackScreen('stats')).not.toThrow();
  });
});

/* 脚本是 async 从 CDN 拉的，而首屏那次上报只等一个 IndexedDB 读——本地读几乎必赢跨域请求。
 * 于是"入口是哪一屏"这条最该有的记录，冷启动时大概率撞在 window.umami 还没出生的空档里，
 * 被 `?.` 一声不响地吞掉：不报错、不掉数据以外的任何东西，只是这个数字长期偏低，且偏得
 * 毫无规律。攒着，等脚本 onload 再补发。 */
describe('载入竞态', () => {
  test('脚本还没到就上报 —— 先攒着，加载完补发', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    trackScreen('today'); // 此刻 window.umami 还不存在
    track('workout_logged');

    const spy = fakeUmami();
    injected()!.dispatchEvent(new Event('load'));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(applied(spy, 0).url).toBe('/today');
    expect(spy.mock.calls[1][0]).toBe('workout_logged');
  });

  test('脚本到位后直接发，不再进队列', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    const spy = fakeUmami();
    injected()!.dispatchEvent(new Event('load'));
    spy.mockClear();

    track('poster_exported');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('脚本永远不来（被广告拦截器挡掉 / 断网）—— 队列有上限，不会无限涨', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    for (let i = 0; i < 200; i++) track('workout_logged');

    const spy = fakeUmami();
    injected()!.dispatchEvent(new Event('load'));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(20);
  });

  test('没配 id 时不攒也不发 —— dev 里不该悬着一个只进不出的队列', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    initAnalytics();
    track('workout_logged');

    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', ID);
    initAnalytics();
    const spy = fakeUmami();
    injected()!.dispatchEvent(new Event('load'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('screenOf', () => {
  /* 日期在映射这一步就被丢掉 —— 出境的永远是 'day' 这个字面量，不是 2026-07-14 */
  test('/day/:date 折叠成 day，日期不出境', () => {
    expect(screenOf('/day/2026-07-14')).toBe('day');
  });

  test.each([
    ['/', 'today'],
    ['/calendar', 'calendar'],
    ['/stats', 'stats'],
    ['/profile', 'profile'],
    ['/log', 'log'],
    ['/poster', 'poster'],
  ])('%s → %s', (path, screen) => {
    expect(screenOf(path)).toBe(screen);
  });

  test('认不出的路径返回 null —— 宁可不上报，也不上报未知字符串', () => {
    expect(screenOf('/whatever/2026-07-14')).toBeNull();
  });
});

/* 封装能被绕开就等于没有封装：谁都可以在自己的组件里写 window.umami.track('x', {note})，
 * 类型守门是拦不住的（它是全局对象）。所以在源码层面钉死：除了 analytics.ts，
 * src 下不许有第二个模块认识 umami 这个词。 */
test('src 下除 analytics.ts 外，没有任何模块直接碰 umami', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  // 注释里写满了 umami 的来龙去脉，扫描前先剥掉，否则守门测试会被自己的文档打成红的
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const offenders = walk('src')
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .filter((f) => !f.includes('lib/analytics'))
    .filter((f) => /umami/i.test(stripComments(readFileSync(f, 'utf8'))));

  expect(offenders).toEqual([]);
});
