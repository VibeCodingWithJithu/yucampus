// Lays out a block report (the SAR) as Word, PDF and Excel. Blocks are headings, text and tables; "Missing" cells
// are shaded so gaps stand out in every format.

import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { type Block, MISSING, type SarModel } from './sar-data.js';

const FONT = 'Calibri';
const COLORS = { muted: '545B73', warning: '7A4505', missing: '8F1D17', header: 'E8EAF6', gap: 'FBE4E2', border: 'E3E6EF' };
const forDocument = (blocks: Block[]) => blocks.filter((b) => b.kind !== 'table' || b.only !== 'workbook');

export async function blocksDocx(model: SarModel): Promise<Buffer> {
  const border = { style: BorderStyle.SINGLE, size: 4, color: COLORS.border };
  const borders = { top: border, bottom: border, left: border, right: border };
  const children: (Paragraph | Table)[] = [];
  for (const block of forDocument(model.blocks)) {
    if (block.kind === 'title') children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: block.text, bold: true, font: FONT, size: 40 })] }));
    else if (block.kind === 'heading') {
      const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading, pageBreakBefore: block.pageBreak, keepNext: true, children: [new TextRun({ text: block.text, font: FONT })] }));
    } else if (block.kind === 'text') {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          shading: block.tone === 'warning' ? { type: ShadingType.CLEAR, color: 'auto', fill: 'FDF0DC' } : undefined,
          children: [
            new TextRun({
              text: block.tone === 'missing' ? `Missing: ${block.text}` : block.text,
              font: FONT,
              bold: block.tone === 'warning' || block.tone === 'missing',
              color: block.tone ? COLORS[block.tone] : undefined,
              size: block.tone === 'muted' ? 20 : 22,
            }),
          ],
        }),
      );
    } else {
      const small = block.columns.length > 8 ? 16 : 20;
      const cellOf = (text: string, header = false) =>
        new TableCell({
          borders,
          shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.header } : text === MISSING ? { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.gap } : undefined,
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: small, bold: header || text === MISSING, color: text === MISSING ? COLORS.missing : undefined })] })],
        });
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ tableHeader: true, children: block.columns.map((c) => cellOf(c, true)) }), ...block.rows.map((r) => new TableRow({ children: r.map((c) => cellOf(c)) }))],
        }),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
      );
    }
  }
  const document = new Document({
    creator: 'YuCampus',
    title: `${model.label} · ${model.collegeName}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${model.collegeName} · ${model.label} · page `, size: 18, color: COLORS.muted, font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: COLORS.muted, font: FONT }),
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

// The built-in PDF fonts cover Western European text; other characters are replaced (the Word file keeps them).
const plain = (value: string) => value.replace(/[^ -~ -ÿ€‘’“”•–—…\n]/g, (ch) => (ch === '₹' ? 'Rs.' : '?'));

export function blocksPdf(model: SarModel): Promise<Buffer> {
  const MARGIN = 45;
  const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN + 10, left: MARGIN, right: MARGIN }, bufferPages: true, info: { Title: plain(model.label), Creator: 'YuCampus' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 10;
  let first = true;

  for (const block of forDocument(model.blocks)) {
    if (block.kind === 'title') {
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#121733').text(plain(block.text), { width });
      doc.moveDown(0.3);
    } else if (block.kind === 'heading') {
      if (block.pageBreak && !first) doc.addPage();
      if (doc.y > bottom() - 60) doc.addPage();
      const size = block.level === 1 ? 15 : block.level === 2 ? 12 : 10.5;
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#121733').text(plain(block.text), MARGIN, doc.y, { width });
      doc.moveDown(0.3);
    } else if (block.kind === 'text') {
      const color = block.tone === 'missing' ? '#8F1D17' : block.tone === 'warning' ? '#7A4505' : block.tone === 'muted' ? '#545B73' : '#121733';
      doc
        .font(block.tone === 'missing' || block.tone === 'warning' ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(block.tone === 'muted' ? 8.5 : 9.5)
        .fillColor(color)
        .text(plain(block.tone === 'missing' ? `Missing: ${block.text}` : block.text), MARGIN, doc.y, { width });
      doc.moveDown(0.4);
    } else {
      // Equal columns, the first ones wider when they hold names or statements.
      const size = block.columns.length > 10 ? 6.5 : block.columns.length > 6 ? 7.5 : 8.5;
      const wide = block.columns.map((c, i) => (/statement|objective|course$|item|teacher/i.test(c) || (i === 1 && block.columns.length <= 3) ? 3 : 1));
      const total = wide.reduce((a, b) => a + b, 0);
      const widths = wide.map((w) => (w / total) * width);
      const drawRow = (cells: string[], header: boolean) => {
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        const height = Math.max(...cells.map((c, i) => doc.heightOfString(plain(c), { width: widths[i]! - 6 }))) + 6;
        if (doc.y + height > bottom()) doc.addPage();
        const top = doc.y;
        let x = MARGIN;
        cells.forEach((text, i) => {
          if (header) doc.rect(x, top, widths[i]!, height).fill('#E8EAF6');
          else if (text === MISSING) doc.rect(x, top, widths[i]!, height).fill('#FBE4E2');
          doc.rect(x, top, widths[i]!, height).lineWidth(0.4).strokeColor('#E3E6EF').stroke();
          doc
            .font(header || text === MISSING ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(size)
            .fillColor(text === MISSING ? '#8F1D17' : '#121733')
            .text(plain(text), x + 3, top + 3, { width: widths[i]! - 6 });
          x += widths[i]!;
        });
        doc.x = MARGIN;
        doc.y = top + height;
      };
      drawRow(block.columns, true);
      for (const row of block.rows) drawRow(row, false);
      doc.moveDown(0.6);
    }
    first = false;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#545B73')
      .text(plain(`${model.collegeName} · ${model.label} · page ${i + 1} of ${range.count}`), MARGIN, doc.page.height - MARGIN + 12, { width, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
const GAP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E2' } };

function summary(workbook: ExcelJS.Workbook, model: SarModel) {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 22 }, { width: 100 }];
  for (const [label, value] of [
    ['College', model.collegeName],
    ['Report', `${model.title} · ${model.label}`],
    ['Created', `${model.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${model.generatedBy}`],
    ['Counts', 'Locked courses and register data only. Nothing filled in or estimated.'],
    ...(model.verified ? [] : [['Check first', 'The SAR structure is not yet checked against the official NBA format.']]),
  ] as [string, string][]) {
    sheet.addRow([label, value]).getCell(1).font = { bold: true };
  }
}

/** Every table marked for the workbook, one sheet each, after a summary sheet. */
export async function blocksXlsx(model: SarModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'YuCampus';
  summary(workbook, model);
  for (const block of model.blocks) {
    if (block.kind !== 'table' || !block.sheet || block.only === 'document') continue;
    const sheet = workbook.addWorksheet(block.sheet.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = block.columns.map((c) => ({ header: c, width: Math.min(60, Math.max(10, c.length + 4, ...block.rows.map((r) => Math.min(60, (r[block.columns.indexOf(c)] ?? '').length + 2)))) }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = HEADER_FILL;
    for (const row of block.rows) {
      const added = sheet.addRow(row.map((v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)));
      row.forEach((v, i) => {
        if (v === MISSING) {
          added.getCell(i + 1).fill = GAP_FILL;
          added.getCell(i + 1).font = { bold: true, color: { argb: 'FF8F1D17' } };
        }
      });
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** What is still missing, by criterion, to share with the department. */
export async function gapsXlsx(model: SarModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'YuCampus';
  summary(workbook, model);
  const sheet = workbook.addWorksheet('Missing items', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [{ header: 'Criterion', width: 11 }, { header: 'What is missing', width: 110 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = HEADER_FILL;
  for (const gap of model.gaps) sheet.addRow([gap.criterion, gap.text]);
  if (model.gaps.length === 0) sheet.addRow(['', 'Nothing is missing from what YuCampus compiles.']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
