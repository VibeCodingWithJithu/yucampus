'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RegisterImportResult, RegisterPage } from '@yucampus/types';
import type { RegisterImportInput } from '@yucampus/validation';
import { Button, Dialog, Notice } from '@yucampus/ui';
import { useState } from 'react';
import { api, apiDownload, errorMessage } from '@/lib/api';
import { formatYearLabel, plural } from '@/lib/format';
import { registerRowsFromTable } from '@/lib/registers';
import { readTable } from '@/lib/spreadsheet';

/** Excel import for one register: check every row first, then save all rows or none (like the people import). */
export function RegisterImportDialog({ register, open, onClose }: { register: RegisterPage; open: boolean; onClose: (message?: string) => void }) {
  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title={`Import ${register.definition.name.toLowerCase()}`}
      description={`Rows are added to ${formatYearLabel(register.year.label)}. Every row is checked first; if any has a problem, nothing is saved.`}
    >
      {open ? <ImportForm register={register} onDone={onClose} /> : null}
    </Dialog>
  );
}

function ImportForm({ register, onDone }: { register: RegisterPage; onDone: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RegisterImportInput['rows'] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [check, setCheck] = useState<RegisterImportResult | null>(null);
  const run = useMutation({
    mutationFn: (input: { rows: RegisterImportInput['rows']; dryRun: boolean }) =>
      api<RegisterImportResult>(`/registers/${register.definition.code}/import`, {
        method: 'POST',
        body: { academicYearId: register.year.id, rows: input.rows, dryRun: input.dryRun },
      }),
    onSuccess: (result, input) => {
      if (input.dryRun || !result.saved) return setCheck(result);
      void queryClient.invalidateQueries({ queryKey: ['registers'] });
      onDone(`Added ${plural(result.created, 'record')} to ${register.definition.name}.`);
    },
  });

  async function choose(file: File | undefined) {
    setReadError(null);
    setCheck(null);
    setRows(null);
    if (!file) return;
    try {
      const parsed = registerRowsFromTable(register.definition, await readTable(file));
      if (parsed.rows.length === 0) throw new Error('The sheet has headings but no rows.');
      setRows(parsed.rows);
      setIgnored(parsed.ignored);
      // Pass the rows directly: state set above is not visible inside this call yet.
      run.mutate({ rows: parsed.rows, dryRun: true });
    } catch (caught) {
      setReadError(caught instanceof Error ? caught.message : 'We could not read that file.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        <li>
          <Button variant="ghost" className="-ml-4 px-4" onClick={() => void apiDownload(`/registers/${register.definition.code}/sheet`, 'register.xlsx')}>
            Download the blank sheet
          </Button>
          <span className="text-muted"> with the right columns and the allowed choices.</span>
        </li>
        <li>Fill in one row per record. Keep the heading row.</li>
        <li>Choose the file (.xlsx or .csv). It is read on this device; only the rows are sent.</li>
      </ol>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
        File
        <input
          type="file"
          accept=".xlsx,.csv"
          className="min-h-11 text-sm text-ink file:mr-3 file:h-11 file:cursor-pointer file:rounded-control file:border file:border-border file:bg-surface file:px-4 file:font-semibold"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </label>
      {readError ? <Notice tone="error">{readError}</Notice> : null}
      {ignored.length ? <Notice tone="info">These columns are not part of this register and were left out: {ignored.join(', ')}.</Notice> : null}
      {run.isPending ? <p className="text-sm text-muted">Checking…</p> : null}
      {run.isError ? <Notice tone="error">{errorMessage(run.error)}</Notice> : null}
      {check && check.problems.length ? (
        <div className="flex flex-col gap-2">
          <Notice tone="error">
            {plural(check.problems.length, 'row needs', 'rows need')} fixing. Nothing has been saved. Fix the sheet and choose it again.
          </Notice>
          <ul className="max-h-60 overflow-y-auto rounded-control border border-border text-sm">
            {check.problems.map((problem) => (
              <li key={`${problem.row}-${problem.message}`} className="border-b border-row px-3 py-2 last:border-b-0">
                <span className="font-semibold">Row {problem.row}:</span> {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {check && check.problems.length === 0 && rows ? (
        <div className="flex flex-col gap-3">
          <Notice tone="success">All {plural(rows.length, 'row')} look right.</Notice>
          <div className="flex flex-wrap gap-3">
            <Button disabled={run.isPending} onClick={() => run.mutate({ rows, dryRun: false })}>
              Add {plural(rows.length, 'record')}
            </Button>
            <Button variant="secondary" onClick={() => onDone()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
