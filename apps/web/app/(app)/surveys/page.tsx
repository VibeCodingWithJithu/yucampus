import type { Metadata } from 'next';
import { SurveysScreen } from './surveys-screen';

export const metadata: Metadata = { title: 'Surveys' };

export default function SurveysPage() {
  return <SurveysScreen />;
}
