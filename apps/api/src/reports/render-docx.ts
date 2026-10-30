import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { type ReportEvidence, type ReportModel, dataRows } from './report-data.js';

const FONT = 'Calibri';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'E3E6EF' };
const borders = { top: border, bottom: border, left: border, right: border };

const text = (value: string, options: { bold?: boolean; color?: string; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text: value, font: FONT, ...options });
const para = (runs: TextRun[] | string, spacingAfter = 120) =>
  new Paragraph({ children: typeof runs === 'string' ? [text(runs)] : runs, spacing: { after: spacingAfter } });

function cell(content: string | Paragraph[], options: { header?: boolean; missing?: boolean; width?: number } = {}) {
  return new TableCell({
    borders,
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.header
      ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EAF6' }
      : options.missing
        ? { type: ShadingType.CLEAR, color: 'auto', fill: 'FBE4E2' }
        : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: typeof content === 'string' ? [new Paragraph({ children: [text(content, { bold: options.header, size: 20 })] })] : content,
  });
}

function grid(headers: { label: string; width: number }[], rows: TableCell[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => cell(h.label, { header: true, width: h.width })) }),
      ...rows.map((children) => new TableRow({ children })),
    ],
  });
}

const evidenceLine = (e: ReportEvidence) =>
  new Paragraph({
    children: [
      text(e.title, { bold: true, size: 20 }),
      text(` · ${e.year}${e.department ? ` · ${e.department}` : ''} · ${e.uploadedBy}`, { size: 20, color: '545B73' }),
    ],
  });

/** The full report in Word: cover facts, a summary table, then every criterion and metric in order. */
export async function reportDocx(model: ReportModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [text(model.college.name, { bold: true, size: 40 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text(`${model.title} · evidence compilation`)] }),
    para([text(`${model.framework.name} · ${model.period.text}${model.scope ? ` · ${model.scope}` : ''}`)]),
    para([
      text(`Created ${model.generatedAt.toISOString().slice(0, 10)} by ${model.generatedBy}. `),
      text('Only evidence with final approval is included; nothing has been filled in or estimated.', { italics: true }),
    ]),
  ];
  if (!model.framework.verified) {
    children.push(
      new Paragraph({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FDF0DC' },
        spacing: { after: 200 },
        children: [
          text('Not yet checked against the official manual. ', { bold: true, color: '7A4505' }),
          text(`${model.framework.sourceTitle} Check the metric list with your IQAC before submitting.`, { color: '7A4505' }),
        ],
      }),
    );
  }
  children.push(
    para([text('Data tables (student, staff and financial figures) are not part of this file yet; they come with data registers.', { color: '545B73' })]),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text(`Summary · readiness ${model.percent}%`)] }),
    grid(
      [
        { label: 'Criterion', width: 52 },
        { label: 'Readiness', width: 16 },
        { label: 'Metrics complete', width: 16 },
        { label: 'Documents missing', width: 16 },
      ],
      model.criteria.map((c) => [
        cell(`C${c.number} ${c.name}`),
        cell(c.pending ? '–' : `${c.percent}%`),
        cell(c.pending ? 'Not loaded' : `${c.metrics.filter((m) => m.percent === 100).length} of ${c.metrics.length}`),
        cell(String(c.metrics.reduce((sum, m) => sum + m.documents.filter((d) => d.evidence.length === 0).length, 0))),
      ]),
    ),
  );

  for (const criterion of model.criteria) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        children: [text(`Criterion ${criterion.number}: ${criterion.name}`)],
      }),
    );
    if (criterion.pending) {
      children.push(para('The metrics of this criterion are not loaded yet.'));
      continue;
    }
    children.push(para([text(`Readiness ${criterion.percent}%`, { bold: true })]));
    for (const metric of criterion.metrics) {
      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [text(`${metric.code} ${metric.name}`)] }),
        para([
          text(`${metric.type === 'quantitative' ? 'Quantitative' : 'Qualitative'} · `, { color: '545B73' }),
          text(`${metric.years.length ? `Years counted: ${metric.years.join(', ')}` : 'No academic year counted yet'} · `, { color: '545B73' }),
          text(`Readiness ${metric.percent}%`, { bold: true }),
        ]),
        grid(
          [
            { label: 'Document required', width: 34 },
            { label: 'Approved evidence', width: 66 },
          ],
          [
            ...metric.documents.map((doc) => [
              cell(doc.name),
              doc.evidence.length
                ? cell(doc.evidence.map(evidenceLine))
                : cell(
                    [
                      new Paragraph({
                        children: [
                          text('Missing', { bold: true, color: '8F1D17', size: 20 }),
                          ...(doc.owner ? [text(` · asked of ${doc.owner.assignee}${doc.owner.dueDate ? ` by ${doc.owner.dueDate}` : ''}`, { size: 20 })] : []),
                        ],
                      }),
                    ],
                    { missing: true },
                  ),
            ]),
            ...(metric.other.length ? [[cell('Other evidence for this metric'), cell(metric.other.map(evidenceLine))]] : []),
          ],
        ),
      );
      if (metric.data && metric.data.years.length) {
        const width = Math.floor(60 / metric.data.years.length);
        children.push(
          para([text('Numbers from the data registers', { bold: true, size: 20 })], 60),
          grid(
            [{ label: 'Measure', width: 40 }, ...metric.data.years.map((y) => ({ label: y.label, width }))],
            dataRows(metric.data).map((row) => [cell(row.label), ...row.cells.map((c) => cell(c, { missing: c === 'Not entered' }))]),
          ),
        );
        if (metric.data.note) children.push(para([text(metric.data.note, { italics: true, size: 18, color: '545B73' })], 60));
      }
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }
  }

  const document = new Document({
    creator: 'YuCampus',
    title: `${model.label} · ${model.college.name}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  text(`${model.college.name} · ${model.label} · page `, { size: 18, color: '545B73' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '545B73', font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
