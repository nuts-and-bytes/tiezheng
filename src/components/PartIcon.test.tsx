import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BODY_PARTS } from '../data/bodyParts';
import { PartIcon } from './PartIcon';

describe('PartIcon', () => {
  it('7 个部位每个都有图标，且用自己的部位色描边', () => {
    for (const p of BODY_PARTS) {
      const { container } = render(<PartIcon part={p.id} size={24} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      // 部位色必须出现在 svg 内部（stroke 硬编码为部位色）
      expect(container.innerHTML.toUpperCase()).toContain(p.color.toUpperCase());
    }
  });

  it('可覆盖描边色（TabBar 里用 currentColor）', () => {
    const { container } = render(<PartIcon part="chest" size={24} color="currentColor" />);
    expect(container.querySelector('svg')!.innerHTML).toContain('currentColor');
  });
});
