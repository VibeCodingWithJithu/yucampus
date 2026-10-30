import type { Metadata } from 'next';
import { AisheScreen } from './aishe-screen';

export const metadata: Metadata = { title: 'AISHE' };

export default function AishePage() {
  return <AisheScreen />;
}
