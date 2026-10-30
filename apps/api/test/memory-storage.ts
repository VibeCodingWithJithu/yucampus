import { Readable } from 'node:stream';
import { FileStorage, type PresignedRequest } from '../src/storage/file-storage.js';

/** In-memory FileStorage for tests. `put` plays the browser uploading to the pre-signed link. */
export class MemoryStorage extends FileStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  put(key: string, bytes: Uint8Array, contentType: string) {
    this.files.set(key, { bytes, contentType });
  }

  async presignUpload({ key }: { key: string }): Promise<PresignedRequest> {
    return { url: `memory://${key}`, method: 'PUT', headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  async presignDownload({ key, inline }: { key: string; inline?: boolean }): Promise<PresignedRequest> {
    return { url: `memory://${key}?${inline ? 'inline' : 'download'}`, method: 'GET', headers: {}, expiresAt: new Date().toISOString() };
  }

  async readStart(key: string, bytes: number) {
    return this.files.get(key)?.bytes.slice(0, bytes) ?? new Uint8Array();
  }

  async inspect(key: string) {
    const file = this.files.get(key);
    return file ? { size: file.bytes.length, contentType: file.contentType } : null;
  }

  async read(key: string) {
    const file = this.files.get(key);
    if (!file) throw new Error(`No file ${key}`);
    return Readable.from([Buffer.from(file.bytes)]);
  }

  async write({ key, body, contentType }: { key: string; body: Readable | Uint8Array; contentType: string; size: number }) {
    if (body instanceof Uint8Array) return this.put(key, body, contentType);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    this.put(key, new Uint8Array(Buffer.concat(chunks)), contentType);
  }

  async remove(key: string) {
    this.files.delete(key);
  }

  async isReachable() {
    return true;
  }
}
