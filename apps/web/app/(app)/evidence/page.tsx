import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LibraryScreen } from './library-screen';

export const metadata: Metadata = { title: 'Evidence library' };

export default function EvidenceLibraryPage() {
  return (
    <Suspense>
      <LibraryScreen />
    </Suspense>
  );
}
