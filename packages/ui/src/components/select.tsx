import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from '../cn';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/** A native select with a visible label (works with screen readers and phone pickers out of the box). */
export function SelectField({ label, error, hint, className, id, children, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[13px] font-semibold text-muted">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'h-12 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-[15px] text-ink aria-invalid:border-red',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {message ? (
        <p id={messageId} role={error ? 'alert' : undefined} className={cn('text-[13px]', error ? 'text-red' : 'text-muted')}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
