import { fireEvent, render, screen } from '@testing-library/react';
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
