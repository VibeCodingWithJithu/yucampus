import type { Metadata } from 'next';
import { CourseScreen } from './course-screen';

export const metadata: Metadata = { title: 'Course outcomes' };

export default function CoursePage() {
  return <CourseScreen />;
}
