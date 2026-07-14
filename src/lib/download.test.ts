import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadBlob } from './download';

describe('downloadBlob：把「存进相册 / 存到本地」这句承诺真的兑现', () => {
  let clicked: HTMLAnchorElement[];
  /** click 触发的那一刻，<a> 在不在 DOM 里 —— 这是 iOS PWA 能不能下载的分水岭 */
  let attachedAtClick: boolean[];

  beforeEach(() => {
    clicked = [];
    attachedAtClick = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
      attachedAtClick.push(document.body.contains(this));
    });
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('点击时 <a> 已挂载到 DOM —— 游离节点在 iOS Safari / PWA 里静默不下载', () => {
    downloadBlob(new Blob(['x']), 'proof.png');

    expect(clicked).toHaveLength(1);
    expect(attachedAtClick).toEqual([true]);
  });

  test('点完把 <a> 摘掉，不在页面上留残骸', () => {
    downloadBlob(new Blob(['x']), 'proof.png');

    expect(document.body.contains(clicked[0]!)).toBe(false);
  });

  test('href 来自 blob URL，download 是给定的文件名', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    downloadBlob(blob, 'ironproof-2026.png');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked[0]!.getAttribute('href')).toBe('blob:mock');
    expect(clicked[0]!.download).toBe('ironproof-2026.png');
  });

  test('blob URL 延后吊销 —— 与 click() 同步吊销会让部分机型下到空文件', () => {
    downloadBlob(new Blob(['x']), 'proof.png');

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
