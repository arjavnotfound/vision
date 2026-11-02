import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PreviewGallery } from '@/components/vision/preview/preview-gallery';

/** Dev-only design QA route: every surface in every state, mocked, no backend. */
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production' && process.env.VISION_ENABLE_PREVIEW !== '1') {
    notFound();
  }
  return (
    <Suspense>
      <PreviewGallery />
    </Suspense>
  );
}
