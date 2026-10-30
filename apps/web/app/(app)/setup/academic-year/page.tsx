import type { Metadata } from 'next';
import { AcademicYearScreen } from './academic-year-screen';

export const metadata: Metadata = { title: 'Academic year and calendar' };

export default function AcademicYearPage() {
  return <AcademicYearScreen />;
}
