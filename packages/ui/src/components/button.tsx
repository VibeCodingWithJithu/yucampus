import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-ink hover:bg-bg',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-red-strong text-white hover:bg-red',
};

// Both sizes meet the 44px touch target.
const SIZES: Record<Size, string> = {
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};

/** Classes for anything that should look like a button, e.g. a link. */
export function buttonClasses({ variant = 'primary', size = 'md' }: { variant?: Variant; size?: Size } = {}) {
  return cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-semibold no-underline transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonClasses({ variant, size }), className)} {...props} />;
}
