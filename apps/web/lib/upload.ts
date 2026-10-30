import type { UploadTicket } from '@yucampus/types';
import {
  EVIDENCE_FILE_TYPES,
  EVIDENCE_FILE_TYPE_NAMES,
  type EvidenceFileType,
  MAX_EVIDENCE_BYTES,
} from '@yucampus/validation';
import { ApiError, api } from './api';

/** For the file picker. */
export const EVIDENCE_ACCEPT = [
  ...Object.keys(EVIDENCE_FILE_TYPES),
  ...Object.values(EVIDENCE_FILE_TYPES).flatMap((extensions) => extensions.map((extension) => `.${extension}`)),
].join(',');

const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2000;

/** The file's type, from what the browser says or else its extension. null when we do not accept it. */
export function evidenceType(file: File): EvidenceFileType | null {
  if (file.type in EVIDENCE_FILE_TYPES) return file.type as EvidenceFileType;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const match = Object.entries(EVIDENCE_FILE_TYPES).find(([, extensions]) =>
    (extensions as readonly string[]).includes(extension),
  );
  return (match?.[0] as EvidenceFileType | undefined) ?? null;
}

/**
 * Phone photos are often 4-8 MB. Large photos are shrunk to at most 2000 px on the long side as JPEG before
 * upload (documents stay readable), which saves faculty mobile data and storage. Other files are sent as they are.
 */
export async function prepareFile(file: File): Promise<{ file: File; type: EvidenceFileType }> {
  const type = evidenceType(file);
  if (!type) throw new ApiError(400, 'invalid_input', `Upload a ${EVIDENCE_FILE_TYPE_NAMES} file.`);
  if (!type.startsWith('image/') || file.size <= COMPRESS_ABOVE_BYTES) return checkSize(file, type);

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (blob && blob.size < file.size) {
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return checkSize(new File([blob], name, { type: 'image/jpeg' }), 'image/jpeg');
    }
  } catch {
    // The browser could not read the image; send the original.
  }
  return checkSize(file, type);
}

function checkSize(file: File, type: EvidenceFileType) {
  if (file.size === 0) throw new ApiError(400, 'invalid_input', 'That file is empty.');
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new ApiError(
      400,
      'invalid_input',
      `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. Files can be up to ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`,
    );
  }
  return { file, type };
}

async function sha256(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // Only used to warn about duplicates.
  }
}

/**
 * Sends a file straight to storage with a pre-signed link (it never passes through the API) and returns the
 * token that proves the upload. `onProgress` gets 0..1.
 */
export async function uploadFile(
  file: File,
  type: EvidenceFileType,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const ticket = await api<UploadTicket>('/evidence/uploads', {
    method: 'POST',
    body: { fileName: file.name, contentType: type, size: file.size, sha256: await sha256(file) },
  });
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(ticket.method, ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new ApiError(request.status, 'upload_failed', 'The upload did not go through. Please try again.'));
    request.onerror = () =>
      reject(new ApiError(0, 'network', 'The upload stopped. Check your internet connection and try again.'));
    request.send(file);
  });
  onProgress(1);
  return ticket.uploadToken;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
