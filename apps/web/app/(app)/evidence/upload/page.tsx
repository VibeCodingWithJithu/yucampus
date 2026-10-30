import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UploadScreen } from './upload-screen';

export const metadata: Metadata = { title: 'Upload evidence' };

export default function UploadPage() {
  return (
    <Suspense>
      <UploadScreen />
    </Suspense>
  );
}
