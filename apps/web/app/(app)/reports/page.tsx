import type { Metadata } from 'next';
import { ReportsScreen } from './reports-screen';

export const metadata: Metadata = { title: 'Reports and export' };

export default function ReportsPage() {
  return <ReportsScreen />;
}
