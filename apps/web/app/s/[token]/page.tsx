import { Logo } from '@yucampus/ui';
import type { Metadata } from 'next';
import { SurveyForm } from './survey-form';

export const metadata: Metadata = { title: 'Survey' };

/** The open link of a survey: no sign-in, anonymous answers, built for phones. */
export default function PublicSurveyPage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <Logo />
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
        <SurveyForm />
      </main>
    </div>
  );
}
