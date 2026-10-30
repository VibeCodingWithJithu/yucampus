import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

/** Top of every desktop screen: breadcrumb or a line of context, the title, a short description, and actions. */
export function PageHeader({
  eyebrow,
  breadcrumb,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  breadcrumb?: Crumb[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.label}>
                {index > 0 ? ' / ' : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="font-semibold text-primary no-underline hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  crumb.label
                )}
              </span>
            ))}
          </nav>
        ) : eyebrow ? (
          <p className="text-[13px] text-muted">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.01em]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-prose text-[15px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
