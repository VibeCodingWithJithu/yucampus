import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksScreen } from './tasks-screen';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}
