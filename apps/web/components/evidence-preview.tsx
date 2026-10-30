'use client';

import { useQuery } from '@tanstack/react-query';
import type { EvidenceSummary } from '@yucampus/types';
import { Button, Notice } from '@yucampus/ui';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/upload';

interface Link {
  url: string;
}

/** Shows PDFs and images in the page; other files (Word, Excel, PowerPoint) are offered as a download. */
export function EvidencePreview({
  item,
}: {
  item: Pick<EvidenceSummary, 'id' | 'fileType' | 'fileName' | 'fileSize' | 'version'>;
}) {
  const viewable = item.fileType === 'application/pdf' || item.fileType.startsWith('image/');
  const link = useQuery({
    queryKey: ['evidence', item.id, 'file', item.version],
    queryFn: () => api<Link>(`/evidence/${item.id}/file?view=inline`),
    enabled: viewable,
    // Links expire after a few minutes; fetch a fresh one rather than reuse an old one.
    staleTime: 60_000,
  });

  async function download() {
    const { url } = await api<Link>(`/evidence/${item.id}/file`);
    window.location.assign(url);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] text-muted">
          <span className="font-semibold text-ink">{item.fileName}</span> · {formatBytes(item.fileSize)}
          {item.version > 1 ? ` · version ${item.version}` : ''}
        </span>
        <Button variant="secondary" onClick={() => void download()}>
          Download
        </Button>
      </div>
      {!viewable ? (
        <div className="flex min-h-48 items-center justify-center rounded-card border border-dashed border-border bg-bg p-6 text-center text-sm text-secondary">
          This file type cannot be shown here. Download it to open it.
        </div>
      ) : link.isError ? (
        <Notice tone="error">{errorMessage(link.error)}</Notice>
      ) : !link.data ? (
        <div className="flex min-h-48 items-center justify-center rounded-card bg-bg text-sm text-muted">
          Loading preview…
        </div>
      ) : item.fileType === 'application/pdf' ? (
        <iframe
          title={`Preview of ${item.fileName}`}
          src={link.data.url}
          className="h-[70vh] min-h-96 w-full rounded-card border border-border bg-bg"
        />
      ) : (
        <img
          src={link.data.url}
          alt={`Uploaded image: ${item.fileName}`}
          className="max-h-[70vh] w-full rounded-card border border-border bg-bg object-contain"
        />
      )}
    </div>
  );
}
