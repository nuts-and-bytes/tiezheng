import { render, screen } from '@testing-library/react';
import { resetDb } from '../test/dbTestUtils';
import { PhotoCard } from './PhotoCard';

beforeEach(async () => {
  await resetDb();
});

/**
 * `capture="environment"` 不是"建议用相机"，是**强制**：在 iOS/Android 上它直接
 * 拉起后置摄像头，连"从相册选"这个选项都不给。两个后果：
 *
 * 1. 用户手机相册里躺着的三个月前的旧照片，永远补录不进来 —— 而体型对比恰恰
 *    是要拿旧照片当基线的。这个 app 的照片功能整个建立在"对比"上。
 * 2. 体型照的实际拍法就是对镜自拍，`environment` 强制的是**后置**摄像头。
 *
 * 去掉 capture，系统自己会给"拍照 / 从相册选"两个选项 —— 该由用户选的事，
 * 不该由我们替他钉死。
 */
test('照片入口不写死相机：相册里的旧照片补得进来', () => {
  const { container } = render(<PhotoCard date="2026-07-10" />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;

  expect(input).not.toHaveAttribute('capture');
  expect(input).toHaveAttribute('accept', 'image/*');
});

test('未拍照时显示上传入口', async () => {
  render(<PhotoCard date="2026-07-10" />);
  expect(await screen.findByText(/体型铁证/)).toBeInTheDocument();
});
