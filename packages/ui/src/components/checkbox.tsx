import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

/** A checkbox with its whole row clickable (44px tall at least). */
export function Checkbox({ label, description, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-border bg-surface px-3.5 py-3 has-checked:border-primary has-checked:bg-primary-soft',
        className,
      )}
    >
      <input type="checkbox" className="mt-0.5 size-5 flex-none accent-primary" {...props} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {description ? <span className="text-[13px] text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
