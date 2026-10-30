import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';

/** Scrolls sideways inside its card on narrow screens, so the page itself never does. */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    // relative: screen-reader-only text inside cells is absolutely positioned and must stay inside the scroll box.
    <div className="relative -mx-5 overflow-x-auto sm:-mx-6">
      <table className={cn('w-full min-w-[560px] border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-muted first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-row px-3 py-3 align-middle first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6', className)}
      {...props}
    />
  );
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}
