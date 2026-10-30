import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { apiError } from '../common/api-error.js';

/**
 * Where uploaded files live. The app only ever talks to this interface; S3Storage implements it for every
 * S3-compatible provider (AWS S3, Oracle, Supabase, Google Cloud Storage, local SeaweedFS). Switching provider
 * is configuration only. Files never pass through the API: browsers upload and download with short-lived
 * pre-signed links (CLAUDE.md rule 5).
 */
export abstract class FileStorage {
  /** A link the browser can PUT the file to. The signature fixes the content type and exact size. */
  abstract presignUpload(input: { key: string; contentType: string; size: number }): Promise<PresignedRequest>;

  /** A link to a file, offered under `fileName`. `inline` shows it in the browser (previews) instead of saving it. */
  abstract presignDownload(input: { key: string; fileName: string; inline?: boolean }): Promise<PresignedRequest>;

  /** The first `bytes` bytes of a stored file, to check what it really is. */
  abstract readStart(key: string, bytes: number): Promise<Uint8Array>;

  /** Size and type of a stored file, or null if there is none (e.g. the upload never finished). */
  abstract inspect(key: string): Promise<{ size: number; contentType: string | null } | null>;

  /** A stored file as a stream. Server-side only, for background jobs (e.g. building an evidence pack). */
  abstract read(key: string): Promise<Readable>;

  /** Stores a file the server made (e.g. a generated report). `size` must be the exact length of `body`. */
  abstract write(input: { key: string; body: Readable | Uint8Array; contentType: string; size: number }): Promise<void>;

  abstract remove(key: string): Promise<void>;

  /** Whether the storage can be reached, for /health. */
  abstract isReachable(): Promise<boolean>;
}

export interface PresignedRequest {
  url: string;
  method: 'PUT' | 'GET';
  /** Headers the browser must send exactly as given (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: string;
}

/** Used when no storage is configured: says so plainly instead of failing obscurely. */
export class UnconfiguredStorage extends FileStorage {
  private fail(): never {
    // Server setup: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are not set (see .env.example).
    throw apiError(503, 'storage_unavailable', 'File uploads are not switched on for this YuCampus server yet.');
  }
  presignUpload(): Promise<PresignedRequest> {
    this.fail();
  }
  presignDownload(): Promise<PresignedRequest> {
    this.fail();
  }
  readStart(): Promise<Uint8Array> {
    this.fail();
  }
  inspect(): Promise<null> {
    this.fail();
  }
  read(): Promise<Readable> {
    this.fail();
  }
  write(): Promise<void> {
    this.fail();
  }
  remove(): Promise<void> {
    this.fail();
  }
  async isReachable() {
    return false;
  }
}

/**
 * Object key for a new file. Every key starts with the college id, so one college's files can never be
 * addressed through another college's prefix, and a college's files can be exported or deleted together
 * (DPDP Act). The name the person chose is kept only as the extension; the rest is random.
 */
export function newFileKey(collegeId: string, kind: 'evidence' | 'import' | 'export', fileName: string, now = new Date()): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase();
  const month = now.toISOString().slice(0, 7);
  return `colleges/${collegeId}/${kind}/${month}/${randomUUID()}${extension ? `.${extension}` : ''}`;
}
