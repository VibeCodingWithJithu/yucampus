'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A modal built on the native <dialog>: focus moves inside, Escape closes it, and the page behind
 * cannot be reached by keyboard or screen reader while it is open. Full screen on phones.
 */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'm-0 h-full max-h-none w-full max-w-none bg-surface p-0 text-ink backdrop:bg-ink/40',
        'sm:m-auto sm:h-auto sm:max-h-[90vh] sm:w-[560px] sm:rounded-card sm:border sm:border-border',
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-[17px] font-bold">
                {title}
              </h2>
              {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-control text-muted hover:bg-bg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
