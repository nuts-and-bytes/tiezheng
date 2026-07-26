import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stamp } from './Stamp';

describe('Stamp', () => {
  it('语义模式输出可缩放品牌钢印而非文字或外链图片', () => {
    const { container } = render(<Stamp size={96} />);
    expect(screen.getByRole('img', { name: '铁证' })).toBeInTheDocument();
    expect(container.querySelector('svg[data-stamp-mark]')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('装饰性使用时对读屏隐藏', () => {
    const { container } = render(<Stamp size={96} decorative />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('非装饰时有可读标签', () => {
    render(<Stamp size={96} />);
    expect(screen.getByLabelText('铁证')).toBeInTheDocument();
  });

  it('按传入尺寸保持正方形', () => {
    const { container } = render(<Stamp size={48} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '48');
    expect(container.querySelector('svg')).toHaveAttribute('height', '48');
  });
});
