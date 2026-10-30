import type { Metadata } from 'next';
import { NirfScreen } from './nirf-screen';

export const metadata: Metadata = { title: 'NIRF' };

export default function NirfPage() {
  return <NirfScreen />;
}
