import type { DownloadLink } from '@yucampus/types';
import { ApiError } from './api';

/** Browsers hold the whole ZIP in memory; above this, ask for smaller selections. */
export const MAX_ZIP_BYTES = 500 * 1024 * 1024;

/** "Report.pdf", "Report.pdf" -> "Report.pdf", "Report (2).pdf". */
function uniqueName(name: string, used: Set<string>): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'file';
  let candidate = safe;
  const dot = safe.lastIndexOf('.');
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = dot > 0 ? `${safe.slice(0, dot)} (${n})${safe.slice(dot)}` : `${safe} (${n})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Downloads files straight from storage and saves them as one ZIP, built in the browser: the files never pass
 * through the YuCampus server. `onProgress` gets (files done, files in all).
 */
export async function downloadAsZip(
  links: DownloadLink[],
  zipName: string,
  onProgress: (done: number, total: number) => void,
) {
  const { zip } = await import('fflate');
  const used = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  let done = 0;
  onProgress(0, links.length);
  for (const link of links) {
    let response: Response;
    try {
      response = await fetch(link.url);
    } catch {
      throw new ApiError(0, 'network', 'A file could not be downloaded. Check your internet connection and try again.');
    }
    if (!response.ok)
      throw new ApiError(response.status, 'download_failed', `“${link.fileName}” could not be downloaded. Try again.`);
    entries[uniqueName(link.fileName, used)] = new Uint8Array(await response.arrayBuffer());
    onProgress(++done, links.length);
  }
  // Level 0 (store): evidence is mostly PDFs and photos, which are compressed already.
  const archive = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
  const url = URL.createObjectURL(new Blob([archive as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: zipName });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
