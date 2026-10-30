'use client';

import { useQuery } from '@tanstack/react-query';
import type { PlatformRulesView } from '@yucampus/types';
import { Card, Notice, StatusPill, Table, Td, Th } from '@yucampus/ui';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';

function Checked({ verified }: { verified: boolean }) {
  return <StatusPill tone={verified ? 'good' : 'attention'}>{verified ? 'Checked' : 'Not yet checked'}</StatusPill>;
}

export default function RulesPage() {
  const rules = useQuery({ queryKey: ['platform', 'rules'], queryFn: () => platformApi<PlatformRulesView>('/rules') });
  const data = rules.data;
  const unchecked = data ? [...data.frameworks, ...data.registers, ...data.files].filter((r) => !r.verified).length : 0;
  return (
    <>
      <PageHeader
        title="Rules"
        description="Criteria templates, registers and rule files loaded in YuCampus. They live as versioned files in the code and are loaded on deploy (pnpm rules:import); they cannot be changed here."
      />
      {rules.isError ? <Notice tone="error">{errorMessage(rules.error)}</Notice> : null}
      {rules.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {data ? (
        <>
          {unchecked ? (
            <Notice tone="info">
              {unchecked} {unchecked === 1 ? 'item is' : 'items are'} not yet checked against the official format. Colleges see a warning wherever they are used.
            </Notice>
          ) : null}
          <Card aria-labelledby="fw-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="fw-h" className="text-[17px] font-bold">
              Frameworks
            </h2>
            <Table aria-labelledby="fw-h" className="min-w-[720px]">
              <thead>
                <tr>
                  <Th>Framework</Th>
                  <Th>Body</Th>
                  <Th>Version</Th>
                  <Th>Status</Th>
                  <Th>Official format</Th>
                  <Th className="text-right">Colleges using it</Th>
                </tr>
              </thead>
              <tbody>
                {data.frameworks.map((f) => (
                  <tr key={`${f.code}-${f.version}`}>
                    <Td>
                      <span className="font-semibold">{f.name}</span>
                      <span className="block text-xs text-muted">{f.code}</span>
                    </Td>
                    <Td>{f.body}</Td>
                    <Td>{f.version}</Td>
                    <Td className="capitalize">{f.status}</Td>
                    <Td>
                      <Checked verified={f.verified} />
                    </Td>
                    <Td className="text-right tabular-nums">{f.colleges}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card aria-labelledby="reg-h" className="flex min-w-0 flex-col gap-3">
              <h2 id="reg-h" className="text-[17px] font-bold">
                Data registers
              </h2>
              <Table aria-labelledby="reg-h" className="min-w-[420px]">
                <thead>
                  <tr>
                    <Th>Register</Th>
                    <Th>Version</Th>
                    <Th>Official format</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.registers.map((r) => (
                    <tr key={`${r.code}-${r.version}`}>
                      <Td>
                        <span className="font-semibold">{r.name}</span>
                        <span className="block text-xs text-muted">{r.code}</span>
                      </Td>
                      <Td>{r.version}</Td>
                      <Td>
                        <Checked verified={r.verified} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card aria-labelledby="files-h" className="flex min-w-0 flex-col gap-3">
              <h2 id="files-h" className="text-[17px] font-bold">
                Rule files
              </h2>
              <ul className="flex flex-col">
                {data.files.map((f) => (
                  <li key={f.file} className="flex flex-col gap-1 border-b border-row py-2.5 last:border-b-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{f.area}</span>
                      <code className="text-xs text-muted">rules/{f.file}</code>
                      <span className="text-xs text-muted">v{f.version}</span>
                      <Checked verified={f.verified} />
                    </span>
                    {f.title ? <span className="text-[13px] text-secondary">{f.title}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
