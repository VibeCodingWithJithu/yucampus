import { createWriteStream } from 'node:fs';
import { ZipArchive } from 'archiver';
import type { FileStorage } from '../storage/file-storage.js';
import { type ReportModel, packEntries } from './report-data.js';

/**
 * The evidence pack: approved files in folders by criterion and metric, the evidence index, and a short
 * read-me. Written to a file on disk and streamed file by file, so a large pack never sits in memory.
 * Returns the number of evidence files in it.
 */
export async function evidencePackZip(
  model: ReportModel,
  storage: FileStorage,
  index: Buffer,
  path: string,
): Promise<number> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(path);
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
  });
  // Awaited at the end; this only keeps an early failure from counting as unhandled meanwhile.
  finished.catch(() => {});
  archive.pipe(output);

  // One file at a time: the next download starts only when the archive has written the previous one.
  let written = 0;
  let wake: (() => void) | null = null;
  archive.on('entry', () => {
    written++;
    wake?.();
  });
  const writtenAtLeast = (count: number, stream: NodeJS.ReadableStream) =>
    new Promise<void>((resolve, reject) => {
      stream.once('error', reject);
      archive.once('error', reject);
      const check = () => (written >= count ? resolve() : (wake = check));
      check();
    });

  const entries = packEntries(model);
  archive.append(
    [
      `${model.college.name}`,
      `${model.title} · ${model.label}`,
      `${model.framework.name} · ${model.period.text}${model.scope ? ` · ${model.scope}` : ''}`,
      `Created ${model.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${model.generatedBy} with YuCampus.`,
      '',
      'Only evidence with final approval is included. Folders follow the criteria and metrics; each file name',
      'starts with the number of the document it is for. Index.xlsx lists every file and what is still missing.',
      entries.length === 0 ? '\nNo approved evidence yet: this pack only has the index.' : '',
      model.framework.verified ? '' : `\nNot yet checked against the official manual. ${model.framework.sourceTitle}`,
    ]
      .filter((line) => line !== '')
      .join('\r\n'),
    { name: 'Read me.txt' },
  );
  archive.append(index, { name: 'Index.xlsx' });
  for (const [i, entry] of entries.entries()) {
    const stream = await storage.read(entry.fileKey);
    archive.append(stream, { name: entry.packPath });
    await writtenAtLeast(2 + i + 1, stream); // Read me and Index come first.
  }
  await archive.finalize();
  await finished;
  return entries.length;
}
