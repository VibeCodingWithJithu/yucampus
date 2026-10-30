import type { EvidenceFileType } from '@yucampus/validation';

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** How many leading bytes `matchesType` needs. */
export const SIGNATURE_BYTES = 16;

/**
 * True when the file's first bytes match its claimed type. Stops a renamed file (e.g. a web page or a
 * program saved as ".pdf") from being stored as evidence and later opened by reviewers.
 * Word, Excel and PowerPoint files are ZIP archives, so they share one signature.
 */
export function matchesType(bytes: Uint8Array, type: EvidenceFileType): boolean {
  switch (type) {
    case 'application/pdf':
      return ascii(bytes, 0, '%PDF-');
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP');
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return startsWith(bytes, ZIP);
  }
}

export const TYPE_NAMES: Record<EvidenceFileType, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG image',
  'image/png': 'PNG image',
  'image/webp': 'WebP image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel workbook',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint deck',
};
