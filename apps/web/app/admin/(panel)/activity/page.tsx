'use client';

import { useQuery } from '@tanstack/react-query';
import type { PlatformAuditEntry } from '@yucampus/types';
import { Card, Notice, Table, Td, Th } from '@yucampus/ui';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { when } from '../format';

/** A short, readable summary of what changed. */
function detailOf(entry: PlatformAuditEntry): string {
  const d = entry.detail as Record<string, unknown> & { before?: Record<string, unknown>; after?: Record<string, unknown> };
  if (d.after?.reason) return String(d.after.reason);
  if (d.before?.plan && d.after?.plan) return `${String(d.before.plan)} → ${String(d.after.plan)}`;
  if (typeof d.email === 'string') return d.email;
  if (typeof d.subdomain === 'string') return `${d.subdomain} · ${String(d.plan ?? '')}`;
  return '';
}

export default function ActivityPage() {
  const log = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => platformApi<PlatformAuditEntry[]>('/audit') });
  return (
    <>
      <PageHeader title="Activity" description="What the YuCampus team did, newest first (the latest 100). Entries cannot be edited or deleted." />
      {log.isError ? <Notice tone="error">{errorMessage(log.error)}</Notice> : null}
      {log.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {log.data ? (
        <Card aria-labelledby="activity-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="activity-h" className="sr-only">
            Team activity
          </h2>
          {log.data.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <Table aria-labelledby="activity-h" className="min-w-[720px]">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>What</Th>
                  <Th>College</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-secondary">{when(entry.at)}</Td>
                    <Td>{entry.admin?.name ?? 'Command line'}</Td>
                    <Td>{entry.actionLabel}</Td>
                    <Td>{entry.college ? <Link href={`/admin/colleges/${entry.college.id}`}>{entry.college.name}</Link> : <span className="text-muted">–</span>}</Td>
                    <Td className="text-secondary">{detailOf(entry)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
