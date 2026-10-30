import type { MetricDataView } from '@yucampus/types';
import { Card, Table, Td, Th, cn } from '@yucampus/ui';
import Link from 'next/link';

const REGISTER_NAMES: Record<string, string> = {
  FACULTY: 'Faculty',
  STUDENT_BATCHES: 'Student batches',
  RESEARCH: 'Research',
  ACTIVITIES: 'Activities',
  INFRA_FINANCE: 'Infrastructure and finance',
};

function show(value: number | null, unit?: string, format?: 'percent' | 'per') {
  if (value === null) return null;
  if (format === 'percent') return `${value}%`;
  return `${value.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
}

/** The metric's inputs from the data registers, per year. "Not entered" links to the register to fill it in. */
export function MetricData({ data }: { data: MetricDataView }) {
  const registers = [...new Set(data.measures.map((m) => m.register))];
  const rows = [
    ...data.measures.map((m, i) => ({ label: m.label, register: m.register, cells: data.years.map((y) => show(y.values[i] ?? null, m.unit)), ratio: false })),
    ...data.ratios.map((r, i) => ({ label: r.label, register: null, cells: data.years.map((y) => show(y.ratios[i] ?? null, undefined, r.format)), ratio: true })),
  ];
  return (
    <Card aria-labelledby="data-h" className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 id="data-h" className="text-[17px] font-bold">
          Numbers from the data registers
        </h2>
        <p className="text-[13px] text-muted">
          From {registers.map((code, i) => (
            <span key={code}>
              {i > 0 ? (i === registers.length - 1 ? ' and ' : ', ') : ''}
              <Link href={`/registers?register=${code}`}>{REGISTER_NAMES[code] ?? code}</Link>
            </span>
          ))}
          . These are the inputs NAAC asks for; NAAC applies its own formula.
        </p>
      </div>
      <Table aria-labelledby="data-h" className="min-w-[420px]">
        <thead>
          <tr>
            <Th>Measure</Th>
            {data.years.map((y) => (
              <Th key={y.label} className="text-right">
                {y.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <Td className={cn(row.ratio ? 'text-secondary' : 'font-semibold')}>{row.label}</Td>
              {row.cells.map((value, i) => (
                <Td key={data.years[i]!.label} className={cn('text-right tabular-nums', value === null && !row.ratio && 'bg-red-soft font-semibold text-red-strong')}>
                  {value ?? (row.ratio ? '–' : 'Not entered')}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {data.note ? <p className="text-[13px] text-amber-strong">{data.note}</p> : null}
    </Card>
  );
}
