import { fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Button, buttonClassName } from './Button';

test.each(['primary', 'secondary', 'tertiary'] as const)('%s 按钮有统一状态和可识别变体', (variant) => {
  render(<Button variant={variant}>继续</Button>);
  const button = screen.getByRole('button', { name: '继续' });

  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveAttribute('data-variant', variant);
  expect(button.className).toContain('focus-visible:');
  expect(button.className).toContain('min-h-11');
});

test('原生属性、提交类型、全宽与 className 可以透传', () => {
  render(<Button type="submit" fullWidth className="extra" aria-label="保存">保存</Button>);
  const button = screen.getByRole('button', { name: '保存' });

  expect(button).toHaveAttribute('type', 'submit');
  expect(button.className).toContain('w-full');
  expect(button.className).toContain('extra');
});

test('loading 时禁用、标记忙碌并提供可访问文案', () => {
  render(<Button loading>保存</Button>);
  const button = screen.getByRole('button', { name: '处理中…' });

  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toHaveTextContent('保存');
});

test('禁用按钮不触发点击', () => {
  const onClick = vi.fn();
  render(<Button disabled onClick={onClick}>删除</Button>);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(onClick).not.toHaveBeenCalled();
});

test('链接可复用按钮视觉类而不嵌套 button', () => {
  expect(buttonClassName('primary', true)).toContain('w-full');
  expect(buttonClassName('secondary')).toContain('border-line');
  expect(buttonClassName('tertiary')).toContain('bg-transparent');
});

test('业务源码不再出现未声明身份的原生按钮', () => {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.tsx')) files.push(path);
    }
  };
  visit(join(process.cwd(), 'src'));

  const violations = files.flatMap((file) => {
    if (file.endsWith('/components/Button.tsx')) return [];
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/<button\b[\s\S]*?>/g)]
      .filter(([tag]) => !tag.includes('data-ui-control='))
      .map((_match, index) => `${file.replace(process.cwd(), '')}#${index + 1}`);
  });

  expect(violations).toEqual([]);
});
