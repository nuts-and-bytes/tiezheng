import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stamp } from './Stamp';

describe('Stamp', () => {
  it('渲染「铁」字', () => {
    render(<Stamp size={96} />);
    expect(screen.getByText('铁')).toBeInTheDocument();
  });

  it('装饰性使用时对读屏隐藏', () => {
    const { container } = render(<Stamp size={96} decorative />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('非装饰时有可读标签', () => {
    render(<Stamp size={96} />);
    expect(screen.getByLabelText('铁证')).toBeInTheDocument();
  });
});
