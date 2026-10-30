import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NbaScreen } from './nba-screen';

export const metadata: Metadata = { title: 'NBA' };

export default function NbaPage() {
  return (
    <Suspense>
      <NbaScreen />
    </Suspense>
  );
}
