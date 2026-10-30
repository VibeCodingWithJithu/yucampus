import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '../cn';

export const inputClasses =
  'h-12 w-full min-w-0 rounded-control border border-border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 aria-invalid:border-red';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  error?: string;
  hint?: string;
  /** Shown before the input, e.g. the "+91" country code. */
  prefix?: ReactNode;
}

/** A text input that always has a visible label, with its error announced to screen readers. */
export function Field({ label, error, hint, prefix, className, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-semibold text-muted">
        {label}
      </label>
      <div className="flex gap-2">
        {prefix ? (
          <span className="flex h-12 items-center rounded-control border border-border bg-surface px-3.5 text-[15px]">
            {prefix}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(inputClasses, className)}
          {...props}
        />
      </div>
      {message ? (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn('text-[13px]', error ? 'text-red' : 'text-muted')}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
