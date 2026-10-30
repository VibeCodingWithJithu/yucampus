import { USER_IMPORT_COLUMNS, type UserImportRow } from '@yucampus/validation';

export type Cell = string | number | boolean | Date | null | undefined;

const FIELD_BY_HEADING: Record<string, keyof UserImportRow> = {
  name: 'name',
  'full name': 'name',
  email: 'email',
  'email address': 'email',
  mobile: 'mobile',
  'mobile number': 'mobile',
  phone: 'mobile',
  role: 'role',
  'department code': 'departmentCode',
  department: 'departmentCode',
};

/**
 * Reads the people sheet in the browser (only the rows travel to the API, never the file).
 * Accepts .xlsx and .csv. The first row must be the headings; their order does not matter.
 */
export async function readPeopleSheet(file: File): Promise<UserImportRow[]> {
  const table = /\.csv$/i.test(file.name) ? parseCsv(await file.text()) : await readXlsx(file);
  const [headings = [], ...rows] = table.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''));

  const fields = headings.map((heading) => FIELD_BY_HEADING[String(heading ?? '').trim().toLowerCase()]);
  if (!fields.includes('name') || !fields.includes('role')) {
    throw new Error(`The first row must be the headings: ${USER_IMPORT_COLUMNS.join(', ')}. Download the template to start.`);
  }

  return rows.map((row) => {
    const person: Record<string, string | number | null> = {};
    fields.forEach((field, index) => {
      if (!field) return;
      const cell = row[index];
      person[field] = cell instanceof Date ? cell.toISOString().slice(0, 10) : typeof cell === 'boolean' ? String(cell) : (cell ?? null);
    });
    return person as UserImportRow;
  });
}

/** Any .xlsx or .csv as rows of cells, with empty rows left out. Read in the browser; only rows go to the API. */
export async function readTable(file: File): Promise<Cell[][]> {
  const table = /\.csv$/i.test(file.name) ? parseCsv(await file.text()) : await readXlsx(file);
  return table.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''));
}

async function readXlsx(file: File): Promise<Cell[][]> {
  // Loaded only when someone imports, so it is not part of every page.
  const { readSheet } = await import('read-excel-file/browser');
  try {
    return (await readSheet(file)) as Cell[][];
  } catch {
    throw new Error('We could not read that file. Save it as .xlsx or .csv and try again.');
  }
}

/** Minimal RFC 4180 CSV: commas, quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A CSV template with the headings and two made-up example rows. Opens directly in Excel. */
export function downloadPeopleTemplate() {
  const lines = [
    USER_IMPORT_COLUMNS.join(','),
    'Sample Teacher,teacher@your-college.example,9876543210,Faculty,CSE',
    'Sample Head,,9876543211,HOD,ECE',
  ];
  // The byte-order mark makes Excel read the file as UTF-8 (names in Telugu or Hindi stay intact).
  const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: 'yucampus-people-template.csv' });
  link.click();
  URL.revokeObjectURL(url);
}
