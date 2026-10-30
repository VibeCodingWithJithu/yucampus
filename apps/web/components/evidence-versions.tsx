'use client';

import { useQuery } from '@tanstack/react-query';
import type { EvidenceVersionView } from '@yucampus/types';
import { Button, Notice } from '@yucampus/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { formatBytes } from '@/lib/upload';

/** Every file the item has had. Older files are kept, so an earlier version can always be opened again. */
export function EvidenceVersions({ id, version }: { id: string; version: number }) {
  const versions = useQuery({
    queryKey: ['evidence', id, 'versions', version],
    queryFn: () => api<EvidenceVersionView[]>(`/evidence/${id}/versions`),
  });

  async function open(number: number) {
    const { url } = await api<{ url: string }>(`/evidence/${id}/versions/${number}/file`);
    window.location.assign(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 id="versions" className="scroll-mt-8 text-[17px] font-bold">
        Versions
      </h2>
      {versions.isError ? <Notice tone="error">{errorMessage(versions.error)}</Notice> : null}
      <ul className="flex flex-col">
        {versions.data?.map((v) => (
          <li
            key={v.version}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-row py-2 last:border-b-0"
          >
            <span className="min-w-0 text-sm">
              <span className="font-semibold">
                Version {v.version}
                {v.current ? ' (current)' : ''}
              </span>
              <span className="block truncate text-xs text-muted">
                {v.fileName} · {formatBytes(v.fileSize)} · {v.uploadedBy} · {formatDateTime(v.uploadedAt)}
              </span>
            </span>
            <Button variant="ghost" onClick={() => void open(v.version)}>
              Download<span className="sr-only"> version {v.version}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
