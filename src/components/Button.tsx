import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
}

const BASE = 'relative inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold outline-none transition duration-200 active:translate-y-px active:scale-[.985] focus-visible:ring-2 focus-visible:ring-iron focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'heat text-bg shadow-[0_10px_30px_rgba(255,92,31,.2)]',
  secondary: 'border border-line bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.035)]',
  tertiary: 'bg-transparent text-mute hover:text-ink',
};

export function buttonClassName(
  variant: ButtonVariant = 'primary',
  fullWidth = false,
  className = '',
): string {
  return `${BASE} ${VARIANT[variant]} ${fullWidth ? 'w-full' : ''} ${className}`.trim();
}

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  className = '',
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={loading ? '处理中…' : props['aria-label']}
      data-variant={variant}
      className={buttonClassName(variant, fullWidth, className)}
    >
      <span className={loading ? 'opacity-0' : undefined}>{children}</span>
      {loading && <span className="absolute inset-0 flex items-center justify-center">处理中…</span>}
    </button>
  );
}
