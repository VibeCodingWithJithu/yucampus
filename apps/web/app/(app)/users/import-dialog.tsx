'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserImportResult } from '@yucampus/types';
import { Button, Dialog, Notice } from '@yucampus/ui';
import { MAX_IMPORT_ROWS, USER_IMPORT_COLUMNS, type UserImportRow } from '@yucampus/validation';
import { useId, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { downloadPeopleTemplate, readPeopleSheet } from '@/lib/spreadsheet';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import people from Excel"
      description={`One person per row, up to ${MAX_IMPORT_ROWS} at a time. Columns: ${USER_IMPORT_COLUMNS.join(', ')}.`}
    >
      {open ? <ImportSteps onDone={onClose} /> : null}
    </Dialog>
  );
}

function ImportSteps({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const fileId = useId();
  const [rows, setRows] = useState<UserImportRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // Rows are passed in, not read from state: right after choosing a file the state has not updated yet.
  const send = (sheet: UserImportRow[], dryRun: boolean) =>
    api<UserImportResult>('/users/import', { method: 'POST', body: { rows: sheet, dryRun } });
  const check = useMutation({ mutationFn: (sheet: UserImportRow[]) => send(sheet, true) });
  const save = useMutation({
    mutationFn: (sheet: UserImportRow[]) => send(sheet, false),
    onSuccess: (result) => {
      if (result.saved) {
        void queryClient.invalidateQueries({ queryKey: ['users'] });
        void queryClient.invalidateQueries({ queryKey: ['departments'] });
        void queryClient.invalidateQueries({ queryKey: ['institution', 'setup-progress'] });
      }
    },
  });

  async function choose(file: File | undefined) {
    setRows(null);
    setReadError(null);
    check.reset();
    save.reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const read = await readPeopleSheet(file);
      if (read.length === 0) throw new Error('That file has headings but no people.');
      if (read.length > MAX_IMPORT_ROWS) throw new Error(`That file has ${read.length} rows. Split it into files of ${MAX_IMPORT_ROWS} or fewer.`);
      setRows(read);
      check.mutate(read);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'We could not read that file.');
    }
  }

  const result = save.data ?? check.data;

  if (save.data?.saved) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">
          Added {plural(save.data.created, 'person', 'people')}.
          {save.data.skipped ? ` ${plural(save.data.skipped, 'row')} skipped because they are already here.` : ''}
        </Notice>
        <p className="text-sm text-secondary">Their status shows Invited until they sign in for the first time.</p>
        <div>
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-secondary">
        <li>
          <Button variant="ghost" className="-ml-4 h-auto min-h-11" onClick={downloadPeopleTemplate}>
            Download the template
          </Button>{' '}
          and fill it in. Role can be Principal, IQAC, HOD, NBA coordinator, NIRF coordinator, Faculty or Office. HOD and
          Faculty need a department code, e.g. CSE.
        </li>
        <li>
          <label htmlFor={fileId} className="font-semibold text-ink">
            Choose the filled file (.xlsx or .csv)
          </label>
          <input
            id={fileId}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => void choose(event.target.files?.[0])}
            className="mt-2 block w-full text-sm file:mr-3 file:h-11 file:cursor-pointer file:rounded-control file:border file:border-border file:bg-surface file:px-4 file:font-semibold"
          />
        </li>
      </ol>

      {readError ? <Notice tone="error">{readError}</Notice> : null}
      {check.isPending ? <p className="text-sm text-muted">Checking {fileName}…</p> : null}
      {check.isError ? <Notice tone="error">{errorMessage(check.error)}</Notice> : null}
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}

      {result ? (
        result.problems.length ? (
          <div className="flex flex-col gap-2">
            <Notice tone="error">
              {plural(result.problems.length, 'row needs', 'rows need')} fixing before anyone is added. Fix the file and
              choose it again.
            </Notice>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-control bg-bg p-3 text-sm">
              {result.problems.map((problem) => (
                <li key={`${problem.row}-${problem.message}`}>
                  <span className="font-semibold">Row {problem.row}:</span> {problem.message}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Notice tone="success">
              Ready to add {plural(result.created, 'person', 'people')}.
              {result.skipped ? ` ${plural(result.skipped, 'row')} will be skipped because they are already here.` : ''}
            </Notice>
            <div>
              <Button onClick={() => rows && save.mutate(rows)} disabled={save.isPending || !rows || result.created === 0}>
                {save.isPending ? 'Adding…' : `Add ${plural(result.created, 'person', 'people')}`}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
