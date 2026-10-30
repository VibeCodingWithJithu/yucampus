import { Logo } from '@yucampus/ui';
import type { ReactNode } from 'react';

/** Sign-in, forgot-password and choose-password pages: the brand panel and one narrow column. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg">
      <section
        aria-label="About YuCampus"
        className="flex flex-[1_1_480px] flex-col justify-between gap-10 bg-primary p-6 text-white sm:p-14"
      >
        <Logo onDark size="lg" />
        <div className="flex max-w-[520px] flex-col gap-4">
          <p className="text-3xl leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[44px]">
            Your campus, always accreditation-ready.
          </p>
          <p className="text-[17px] leading-[1.55] text-on-primary-muted">
            NAAC, NBA and NIRF data in one place, collected once and reused everywhere.
          </p>
        </div>
        <span className="text-[13px] text-on-primary-muted">Data stored securely in India</span>
      </section>

      <main className="flex flex-[1_1_480px] items-center justify-center px-4 py-12 sm:px-6">
        <div className="flex w-full max-w-[440px] flex-col gap-5">
          <div>
            <h1 className="text-[28px] font-bold">{title}</h1>
            {description ? <p className="mt-1.5 text-[15px] text-muted">{description}</p> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
