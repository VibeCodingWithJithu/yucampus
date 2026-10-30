import ExcelJS from 'exceljs';
import { type ReportModel, dataRows } from './report-data.js';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
const MISSING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E2' } };
const WARNING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF0DC' } };

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function newWorkbook(model: ReportModel) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'YuCampus';
  workbook.created = model.generatedAt;
  workbook.title = model.label;
  return workbook;
}

/** A sheet with a bold, coloured, frozen and filterable heading row. */
function table(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width: number }[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ header: c.header, width: c.width, style: { alignment: { wrapText: true, vertical: 'top' } } }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = HEADER_FILL;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

/** Facts about the export at the top of every workbook, including the warning for unchecked templates. */
function summarySheet(workbook: ExcelJS.Workbook, model: ReportModel) {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 28 }, { width: 90 }];
  const rows: [string, string | number][] = [
    ['College', model.college.name],
    ['Report', `${model.title} · ${model.label}`],
    ['Framework', `${model.framework.name} (version ${model.framework.version}, layout ${model.layoutVersion})`],
    ['Period', model.period.text],
    ...(model.scope ? ([['Covers', model.scope]] as [string, string][]) : []),
    ['Readiness', `${model.percent}%`],
    ['Created', `${model.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${model.generatedBy}`],
    ['Counts', 'Only evidence with final approval is included.'],
  ];
  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  if (!model.framework.verified) {
    const row = sheet.addRow(['Check first', `Not yet checked against the official manual. ${model.framework.sourceTitle}`]);
    row.font = { bold: true };
    row.fill = WARNING_FILL;
  }
  sheet.addRow([]);
  const head = sheet.addRow(['Criterion', 'Readiness']);
  head.font = { bold: true };
  head.fill = HEADER_FILL;
  for (const c of model.criteria) {
    sheet.addRow([`C${c.number} ${c.name}`, c.pending ? 'Metrics not loaded yet' : `${c.percent}%`]);
  }
  return sheet;
}

/** Evidence index: every required document, with the approved evidence for it or "Missing". */
export async function evidenceIndexXlsx(model: ReportModel): Promise<Buffer> {
  const workbook = newWorkbook(model);
  summarySheet(workbook, model);
  for (const criterion of model.criteria) {
    if (criterion.pending) continue;
    const sheet = table(workbook, `C${criterion.number}`, [
      { header: 'Metric', width: 9 },
      { header: 'Metric name', width: 48 },
      { header: 'Document required', width: 36 },
      { header: 'Status', width: 11 },
      { header: 'Evidence', width: 36 },
      { header: 'Academic year', width: 13 },
      { header: 'Document date', width: 13 },
      { header: 'Department', width: 12 },
      { header: 'Uploaded by', width: 22 },
      { header: 'Final approval', width: 14 },
      { header: 'File in the pack', width: 60 },
    ]);
    for (const metric of criterion.metrics) {
      for (const doc of metric.documents) {
        if (doc.evidence.length === 0) {
          const row = sheet.addRow([metric.code, metric.name, doc.name, 'Missing', '', metric.years.join(', ')]);
          row.getCell(4).font = { bold: true, color: { argb: 'FF8F1D17' } };
          row.getCell(4).fill = MISSING_FILL;
          continue;
        }
        for (const e of doc.evidence) {
          sheet.addRow([metric.code, metric.name, doc.name, 'Approved', e.title, e.year, dateOnly(e.documentDate), e.department ?? '', e.uploadedBy, dateOnly(e.approvedAt), e.packPath]);
        }
      }
      for (const e of metric.other) {
        sheet.addRow([metric.code, metric.name, 'Other evidence', 'Approved', e.title, e.year, dateOnly(e.documentDate), e.department ?? '', e.uploadedBy, dateOnly(e.approvedAt), e.packPath]);
      }
    }
  }
  registerDataSheet(workbook, model);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One row per metric, measure and year: the numbers the data registers give. */
function registerDataSheet(workbook: ExcelJS.Workbook, model: ReportModel) {
  const mapped = model.criteria.flatMap((c) => c.metrics.filter((m) => m.data && m.data.years.length));
  if (mapped.length === 0) return;
  const sheet = table(workbook, 'Register data', [
    { header: 'Metric', width: 9 },
    { header: 'Metric name', width: 48 },
    { header: 'Measure', width: 40 },
    { header: 'Academic year', width: 13 },
    { header: 'Value', width: 16 },
    { header: 'Note', width: 60 },
  ]);
  for (const metric of mapped) {
    for (const line of dataRows(metric.data!)) {
      line.cells.forEach((value, i) => {
        const row = sheet.addRow([metric.code, metric.name, line.label, metric.data!.years[i]!.label, value, i === 0 ? (metric.data!.note ?? '') : '']);
        if (value === 'Not entered') {
          row.getCell(5).font = { bold: true, color: { argb: 'FF8F1D17' } };
          row.getCell(5).fill = MISSING_FILL;
        }
      });
    }
  }
}

/** Missing items: documents without approved evidence, with the open task and its owner, to share with departments. */
export async function missingItemsXlsx(model: ReportModel): Promise<Buffer> {
  const workbook = newWorkbook(model);
  summarySheet(workbook, model);
  const sheet = table(workbook, 'Missing items', [
    { header: 'Criterion', width: 10 },
    { header: 'Metric', width: 9 },
    { header: 'Metric name', width: 48 },
    { header: 'Document missing', width: 40 },
    { header: 'Years needed', width: 26 },
    { header: 'Open task', width: 36 },
    { header: 'With', width: 24 },
    { header: 'Due', width: 12 },
  ]);
  let count = 0;
  for (const criterion of model.criteria) {
    for (const metric of criterion.metrics) {
      for (const doc of metric.documents.filter((d) => d.evidence.length === 0)) {
        const row = sheet.addRow([
          `C${criterion.number}`,
          metric.code,
          metric.name,
          doc.name,
          metric.years.join(', '),
          doc.owner?.task ?? 'No task yet',
          doc.owner?.assignee ?? '',
          doc.owner?.dueDate ?? '',
        ]);
        if (!doc.owner) row.getCell(6).font = { italic: true, color: { argb: 'FF8F1D17' } };
        count++;
      }
    }
  }
  if (count === 0) sheet.addRow(['', '', 'Nothing is missing: every required document has approved evidence.']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
