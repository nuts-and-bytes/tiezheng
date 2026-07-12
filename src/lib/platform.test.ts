import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareFiles, vibrate } from './platform';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vibrate', () => {
  it('jsdom 里没有 navigator.vibrate 时静默跳过，不抛', () => {
    expect(() => vibrate(10)).not.toThrow();
  });

  it('有 vibrate 时透传时长', () => {
    const spy = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate: spy });
    vibrate(30);
    expect(spy).toHaveBeenCalledWith(30);
  });

  it('vibrate 抛异常时吞掉（某些浏览器在无用户手势时抛）', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      vibrate: () => {
        throw new Error('no gesture');
      },
    });
    expect(() => vibrate(10)).not.toThrow();
  });
});

describe('canShareFiles', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });

  it('没有 navigator.share 时为 false', () => {
    expect(canShareFiles([file])).toBe(false);
  });

  it('有 share 但没有 canShare 时为 false（Android 老版本会假阳性）', () => {
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn() });
    expect(canShareFiles([file])).toBe(false);
  });

  it('share + canShare 且 canShare 返回 true 时为 true', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi.fn(),
      canShare: () => true,
    });
    expect(canShareFiles([file])).toBe(true);
  });

  it('canShare 抛异常时为 false，不冒泡', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi.fn(),
      canShare: () => {
        throw new TypeError('bad');
      },
    });
    expect(canShareFiles([file])).toBe(false);
  });
});

describe('shareFiles', () => {
  it('同步调用 navigator.share —— 调用栈里不能有 await，否则 iOS 丢失用户手势授权', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, canShare: () => true });
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const returned = shareFiles([file], '铁证');

    // 关键断言：shareFiles 返回时 share 必须已经被调用过（同步），而不是在某个 await 之后
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files[0]).toBe(file);
    expect(returned).toBe(true);
  });

  it('不支持时返回 false，不抛', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(shareFiles([file], '铁证')).toBe(false);
  });
});
