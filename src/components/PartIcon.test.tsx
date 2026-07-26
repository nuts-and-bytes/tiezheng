import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BODY_PARTS } from '../data/bodyParts';
import { PartIcon } from './PartIcon';

describe('PartIcon', () => {
  it('7 个部位共享 24 格几何，以实心 currentColor 为主并保留稳定形状标记', () => {
    for (const p of BODY_PARTS) {
      const { container } = render(<PartIcon part={p.id} size={24} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(svg.getAttribute('stroke')).toBe('none');
      expect(svg.querySelector(`[data-shape="${p.id}"]`)).not.toBeNull();
      expect(container.innerHTML.toUpperCase()).toContain(p.color.toUpperCase());
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
    }
  });

  it.each([12, 18, 40])('%dpx 保持正方尺寸', (size) => {
    const { container } = render(<PartIcon part="back" size={size} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', String(size));
    expect(svg).toHaveAttribute('height', String(size));
  });

  it('可覆盖颜色（导航和单色环境用 currentColor）', () => {
    const { container } = render(<PartIcon part="chest" size={24} color="currentColor" />);
    expect(container.querySelector('svg')).toHaveAttribute('color', 'currentColor');
  });
});
