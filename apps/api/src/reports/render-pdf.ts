import PDFDocument from 'pdfkit';
import { type ReportEvidence, type ReportModel, dataRows } from './report-data.js';

const INK = '#121733';
const MUTED = '#545B73';
const RED = '#8F1D17';
const AMBER = '#7A4505';
const MARGIN = 50;

// The built-in PDF fonts cover Western European text (WinAnsi). Other characters are replaced so they never
// print as garbage; the Word file keeps the original text.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const plain = (value: string) =>
  [...value]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
      if (ch === '\n') return ch;
      return ch === '≥' ? '>=' : ch === '≤' ? '<=' : ch === '₹' ? 'Rs.' : '?';
    })
    .join('');

const evidenceText = (e: ReportEvidence) => `${e.title} · ${e.year}${e.department ? ` · ${e.department}` : ''} · ${e.uploadedBy}`;

/** The full report as PDF: the same content as the Word file, laid out for printing and sharing. */
export function reportPdf(model: ReportModel): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + 10, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: plain(`${model.label} · ${model.college.name}`), Creator: 'YuCampus' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const write = (value: string, options: { font?: string; size?: number; color?: string; gap?: number } = {}) => {
    doc
      .font(options.font ?? 'Helvetica')
      .fontSize(options.size ?? 10)
      .fillColor(options.color ?? INK)
      .text(plain(value), { width });
    if (options.gap) doc.moveDown(options.gap);
  };
  const ensure = (height: number) => {
    if (doc.y + height > doc.page.height - MARGIN - 10) doc.addPage();
  };

  /** A two-column row with a light border, starting a new page when it does not fit. */
  const row = (left: string, right: { text: string; color?: string; bold?: boolean }[], fill?: string) => {
    const leftWidth = width * 0.34 - 12;
    const rightWidth = width * 0.66 - 12;
    doc.font('Helvetica').fontSize(9);
    const leftHeight = doc.heightOfString(plain(left), { width: leftWidth });
    const rightHeight = right.reduce((sum, line) => sum + doc.heightOfString(plain(line.text), { width: rightWidth }) + 2, 0);
    const height = Math.max(leftHeight, rightHeight) + 10;
    ensure(height);
    const top = doc.y;
    if (fill) doc.rect(MARGIN, top, width, height).fill(fill);
    doc.rect(MARGIN, top, width, height).lineWidth(0.5).strokeColor('#E3E6EF').stroke();
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(plain(left), MARGIN + 6, top + 5, { width: leftWidth });
    let y = top + 5;
    for (const line of right) {
      doc
        .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(line.color ?? INK)
        .text(plain(line.text), MARGIN + width * 0.34 + 6, y, { width: rightWidth });
      y = doc.y + 2;
    }
    doc.x = MARGIN;
    doc.y = top + height;
  };

  // Cover
  write(model.college.name, { font: 'Helvetica-Bold', size: 22, gap: 0.3 });
  write(`${model.title} · evidence compilation`, { font: 'Helvetica-Bold', size: 15, gap: 0.3 });
  write(`${model.framework.name} · ${model.period.text}${model.scope ? ` · ${model.scope}` : ''}`, { size: 11, color: MUTED, gap: 0.3 });
  write(`Created ${model.generatedAt.toISOString().slice(0, 10)} by ${model.generatedBy}.`, { size: 10, color: MUTED });
  write('Only evidence with final approval is included; nothing has been filled in or estimated.', { size: 10, color: MUTED, gap: 0.8 });
  if (!model.framework.verified) {
    write(`Not yet checked against the official manual. ${model.framework.sourceTitle}`, { font: 'Helvetica-Bold', size: 10, color: AMBER, gap: 0.8 });
  }
  write('Data tables (student, staff and financial figures) are not part of this file yet; they come with data registers.', {
    size: 9,
    color: MUTED,
    gap: 1,
  });

  write(`Summary · readiness ${model.percent}%`, { font: 'Helvetica-Bold', size: 14, gap: 0.4 });
  for (const c of model.criteria) {
    const missing = c.metrics.reduce((sum, m) => sum + m.documents.filter((d) => d.evidence.length === 0).length, 0);
    row(`C${c.number} ${c.name}`, [
      c.pending
        ? { text: 'Metrics not loaded yet', color: MUTED }
        : { text: `${c.percent}% · ${c.metrics.filter((m) => m.percent === 100).length} of ${c.metrics.length} metrics complete · ${missing} documents missing` },
    ]);
  }

  for (const criterion of model.criteria) {
    doc.addPage();
    write(`Criterion ${criterion.number}: ${criterion.name}`, { font: 'Helvetica-Bold', size: 16, gap: 0.2 });
    if (criterion.pending) {
      write('The metrics of this criterion are not loaded yet.', { color: MUTED });
      continue;
    }
    write(`Readiness ${criterion.percent}%`, { font: 'Helvetica-Bold', size: 11, gap: 0.6 });
    for (const metric of criterion.metrics) {
      ensure(70);
      write(`${metric.code} ${metric.name}`, { font: 'Helvetica-Bold', size: 11, gap: 0.1 });
      write(
        `${metric.type === 'quantitative' ? 'Quantitative' : 'Qualitative'} · ${metric.years.length ? `Years counted: ${metric.years.join(', ')}` : 'No academic year counted yet'} · Readiness ${metric.percent}%`,
        { size: 9, color: MUTED, gap: 0.3 },
      );
      for (const d of metric.documents) {
        if (d.evidence.length) row(d.name, d.evidence.map((e) => ({ text: evidenceText(e) })));
        else
          row(
            d.name,
            [
              { text: 'Missing', color: RED, bold: true },
              ...(d.owner ? [{ text: `Asked of ${d.owner.assignee}${d.owner.dueDate ? ` by ${d.owner.dueDate}` : ''}`, color: RED }] : []),
            ],
            '#FBE4E2',
          );
      }
      if (metric.other.length) row('Other evidence for this metric', metric.other.map((e) => ({ text: evidenceText(e) })));
      if (metric.data && metric.data.years.length) {
        doc.moveDown(0.3);
        write('Numbers from the data registers', { font: 'Helvetica-Bold', size: 9 });
        for (const line of dataRows(metric.data)) {
          row(
            line.label,
            line.cells.map((value, i) => ({ text: `${metric.data!.years[i]!.label}: ${value}`, color: value === 'Not entered' ? RED : INK })),
          );
        }
        if (metric.data.note) write(metric.data.note, { size: 8, color: MUTED });
      }
      doc.moveDown(0.8);
    }
  }

  // Footer on every page: college, report and page number.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Text inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(plain(`${model.college.name} · ${model.label} · page ${i + 1} of ${range.count}`), MARGIN, doc.page.height - MARGIN + 10, {
        width,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
