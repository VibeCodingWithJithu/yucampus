import type { RegisterDefinitionView, RegisterFieldView, RegisterValue } from '@yucampus/types';
import type { RegisterImportInput } from '@yucampus/validation';
import { formatDate } from './format';
import type { Cell } from './spreadsheet';

/** How a stored value reads in a table or summary. Empty values return null (the caller shows "Missing" or "–"). */
export function formatRegisterValue(field: RegisterFieldView, value: RegisterValue | undefined, programs: { id: string; name: string }[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date':
      return typeof value === 'string' ? formatDate(value) : String(value);
    case 'program':
      return programs.find((p) => p.id === value)?.name ?? 'Unknown program';
    case 'number': {
      const text = typeof value === 'number' ? value.toLocaleString('en-IN') : String(value);
      return field.unit ? `${text} ${field.unit}` : text;
    }
    default:
      return String(value);
  }
}

const normal = (text: string) => text.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/**
 * Turns sheet rows into import rows. Headings are matched to field labels (a unit in brackets is ignored), plus
 * "Department code" and the person's email column. Unknown columns are ignored and reported.
 */
export function registerRowsFromTable(
  definition: RegisterDefinitionView,
  table: Cell[][],
): { rows: RegisterImportInput['rows']; ignored: string[] } {
  const [headings = [], ...body] = table;
  const fieldByHeading = new Map(definition.fields.map((f) => [normal(f.label), f.key]));
  const personHeading = definition.person ? normal(`${definition.person.label}`) : null;
  const columns = headings.map((heading) => {
    const text = String(heading ?? '').trim();
    const key = normal(text);
    if (key === 'department code' || key === 'department') return { kind: 'department' as const };
    if (definition.person && (text.toLowerCase().includes('(email)') || key === personHeading || key === 'email')) return { kind: 'person' as const };
    const field = fieldByHeading.get(key);
    return field ? { kind: 'field' as const, key: field } : { kind: 'ignored' as const, heading: text };
  });
  if (!columns.some((c) => c.kind === 'field' && c.key === definition.titleField)) {
    const title = definition.fields.find((f) => f.key === definition.titleField)?.label ?? 'the name';
    throw new Error(`The first row must be the headings, including "${title}". Download the blank sheet to start.`);
  }
  const rows = body.map((cells) => {
    const row: RegisterImportInput['rows'][number] = { data: {} };
    columns.forEach((column, index) => {
      const cell = cells[index];
      const value = cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === undefined ? null : cell;
      if (column.kind === 'department') row.departmentCode = value === null ? null : String(value);
      else if (column.kind === 'person') row.personEmail = value === null ? null : String(value);
      else if (column.kind === 'field') row.data[column.key] = value;
    });
    return row;
  });
  return { rows, ignored: columns.flatMap((c) => (c.kind === 'ignored' && c.heading ? [c.heading] : [])) };
}
