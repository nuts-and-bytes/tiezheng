import { fireEvent, render, screen } from '@testing-library/react';
import { InstallHint } from './InstallHint';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WECHAT_UA = `${IPHONE_UA} MicroMessenger/8.0.49(0x18003129)`;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('InstallHint', () => {
  it('localStorage 抛 SecurityError 时不崩溃、按已关闭处理不渲染提示', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => render(<InstallHint />)).not.toThrow();
    expect(screen.queryByText(/添加到主屏幕/)).not.toBeInTheDocument();
  });

  it('iPhone Safari 显示添加主屏文案；微信内显示用 Safari 打开文案', () => {
    const uaSpy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    const { unmount } = render(<InstallHint />);
    expect(screen.getByText(/点底部「分享」→「添加到主屏幕」/)).toBeInTheDocument();
    unmount();

    uaSpy.mockReturnValue(WECHAT_UA);
    render(<InstallHint />);
    expect(screen.getByText(/用 Safari 打开后/)).toBeInTheDocument();
  });

  it('点「知道了」后提示消失且 localStorage 写入 1', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    render(<InstallHint />);
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText(/添加到主屏幕/)).not.toBeInTheDocument();
    expect(localStorage.getItem('installHintDismissed')).toBe('1');
  });
});
