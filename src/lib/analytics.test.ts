import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { analyticsEnabled, initAnalytics, screenOf, track, trackScreen } from './analytics';

const ID = '11111111-2222-3333-4444-555555555555';
const injected = () => document.querySelector<HTMLScriptElement>('script[data-website-id]');

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
  test('上报的是白名单字面量，不是真实 URL', () => {
    const spy = vi.fn();
    (window as unknown as { umami: unknown }).umami = { track: spy };
    trackScreen('day');
    expect(spy).toHaveBeenCalledWith({ url: '/day', title: '训练详情' });
  });

  test('脚本没加载时静默', () => {
    expect(() => trackScreen('stats')).not.toThrow();
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
