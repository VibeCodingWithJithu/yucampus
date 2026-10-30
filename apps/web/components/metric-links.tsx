'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { EvidenceDetail, LinkableMetric } from '@yucampus/types';
import { Button, Notice, SelectField } from '@yucampus/ui';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export const LINKABLE_KEY = ['metrics', 'linkable'];

export function useLinkableMetrics() {
  return useQuery({
    queryKey: LINKABLE_KEY,
    queryFn: () => api<LinkableMetric[]>('/metrics/linkable'),
    staleTime: 5 * 60_000,
  });
}

/** Picks a metric (grouped by framework and criterion) and, when it needs several documents, which one. */
export function MetricPicker({
  value,
  onChange,
  label = 'Counts for metric',
}: {
  value: { metricId: string; documentKey: string | null };
  onChange: (value: { metricId: string; documentKey: string | null }) => void;
  label?: string;
}) {
  const metrics = useLinkableMetrics();
  const chosen = metrics.data?.find((m) => m.id === value.metricId);
  const groups = new Map<string, LinkableMetric[]>();
  for (const metric of metrics.data ?? []) {
    const group = `${metric.framework.name} · Criterion ${metric.criterion.number}`;
    groups.set(group, [...(groups.get(group) ?? []), metric]);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={label}
        value={value.metricId}
        disabled={!metrics.data}
        onChange={(event) => {
          const metric = metrics.data?.find((m) => m.id === event.target.value);
          onChange({
            metricId: event.target.value,
            documentKey: metric?.documents.length === 1 ? metric.documents[0]!.key : null,
          });
        }}
      >
        <option value="">{metrics.data?.length === 0 ? 'No metrics loaded yet' : 'Not linked yet'}</option>
        {[...groups].map(([group, list]) => (
          <optgroup key={group} label={group}>
            {list.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.code} · {metric.name}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>
      {chosen && chosen.documents.length > 1 ? (
        <SelectField
          label="Which document is this?"
          value={value.documentKey ?? ''}
          onChange={(event) => onChange({ metricId: value.metricId, documentKey: event.target.value || null })}
        >
          <option value="">Choose…</option>
          {chosen.documents.map((doc) => (
            <option key={doc.key} value={doc.key}>
              {doc.name}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}

/** The metrics an evidence item counts for, editable by whoever the API allows. */
export function MetricLinks({ item, onChange }: { item: EvidenceDetail; onChange: (updated: EvidenceDetail) => void }) {
  const [adding, setAdding] = useState({ metricId: '', documentKey: null as string | null });
  const save = useMutation({
    mutationFn: (links: { metricId: string; documentKey: string | null }[]) =>
      api<EvidenceDetail>(`/evidence/${item.id}/metrics`, { method: 'PUT', body: { links } }),
    onSuccess: (updated) => {
      setAdding({ metricId: '', documentKey: null });
      onChange(updated);
    },
  });
  const current = item.metrics.map((m) => ({ metricId: m.metricId, documentKey: m.documentKey }));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[15px] font-bold">Counts for</h3>
      {item.metrics.length === 0 ? (
        <p className="text-sm text-amber-strong">
          Not linked to any metric yet, so it does not count towards readiness.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {item.metrics.map((link) => (
            <li
              key={link.metricId}
              className="flex items-center justify-between gap-3 rounded-control bg-bg px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold">
                  {link.body} {link.code}
                </span>{' '}
                {link.name}
                {link.documentName ? <span className="text-muted"> · {link.documentName}</span> : null}
              </span>
              {item.can.linkMetrics ? (
                <Button
                  variant="ghost"
                  className="text-red"
                  disabled={save.isPending}
                  onClick={() => save.mutate(current.filter((l) => l.metricId !== link.metricId))}
                >
                  Remove<span className="sr-only"> link to {link.code}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {item.can.linkMetrics ? (
        <div className="flex flex-col gap-3">
          <MetricPicker value={adding} onChange={setAdding} label="Link to a metric" />
          <div>
            <Button
              variant="secondary"
              disabled={save.isPending || !adding.metricId}
              onClick={() => save.mutate([...current.filter((l) => l.metricId !== adding.metricId), adding])}
            >
              {save.isPending ? 'Saving…' : 'Add link'}
            </Button>
          </div>
        </div>
      ) : null}
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
    </div>
  );
}
