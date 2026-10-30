// File storage through the S3 interface. The upload/download checks run against the local Docker storage
// (pnpm infra:up) and are skipped when it is not running. Dummy file contents only.
import { describe, expect, it } from 'vitest';
import { newFileKey } from '../src/storage/file-storage.js';
import { S3Storage } from '../src/storage/s3-storage.js';

const COLLEGE = '11111111-1111-4111-8111-111111111111';

describe('file keys', () => {
  it('start with the college, keep only the extension of the original name, and never repeat', () => {
    const key = newFileKey(COLLEGE, 'evidence', 'Board of Studies minutes (final).PDF', new Date('2026-10-15T10:00:00Z'));
    expect(key).toMatch(new RegExp(`^colleges/${COLLEGE}/evidence/2026-10/[0-9a-f-]{36}\\.pdf$`));
    expect(key).not.toContain('Board');
    expect(newFileKey(COLLEGE, 'evidence', 'a.pdf')).not.toBe(newFileKey(COLLEGE, 'evidence', 'a.pdf'));
    expect(newFileKey(COLLEGE, 'import', '../../etc/passwd')).toMatch(/\/[0-9a-f-]{36}$/);
  });
});

const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000';
const storage = new S3Storage({
  endpoint,
  region: 'ap-south-1',
  bucket: 'yucampus-test',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? 'yucampus',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? 'yucampus-local-secret',
  linkSeconds: 60,
});
const running = await fetch(endpoint, { signal: AbortSignal.timeout(2000) }).then(
  () => true,
  () => false,
);

describe.skipIf(!running)(`S3 storage at ${endpoint}`, () => {
  const body = new TextEncoder().encode('%PDF-1.4 sample evidence file');

  it('uploads with a pre-signed link, reports the stored size, downloads, and deletes', async () => {
    await storage.prepareBucket(['http://localhost:3000']);
    expect(await storage.isReachable()).toBe(true);
    const key = newFileKey(COLLEGE, 'evidence', 'sample.pdf');

    const upload = await storage.presignUpload({ key, contentType: 'application/pdf', size: body.length });
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body });
    expect(put.status).toBe(200);
    expect(await storage.inspect(key)).toEqual({ size: body.length, contentType: 'application/pdf' });

    const download = await storage.presignDownload({ key, fileName: 'Board minutes.pdf' });
    const got = await fetch(download.url);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body);
    expect(got.headers.get('content-disposition')).toContain('attachment');

    await storage.remove(key);
    expect(await storage.inspect(key)).toBeNull();
  });

  it('refuses an upload of a different type or size than was signed', async () => {
    const key = newFileKey(COLLEGE, 'evidence', 'sample.pdf');
    const upload = await storage.presignUpload({ key, contentType: 'application/pdf', size: body.length });
    const wrongType = await fetch(upload.url, { method: 'PUT', headers: { 'content-type': 'text/html' }, body });
    expect(wrongType.ok).toBe(false);
    const bigger = new Uint8Array(body.length + 100);
    const wrongSize = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bigger });
    expect(wrongSize.ok).toBe(false);
    expect(await storage.inspect(key)).toBeNull();
  });

  it('refuses a link whose signature was tampered with', async () => {
    const key = newFileKey(COLLEGE, 'evidence', 'sample.pdf');
    const upload = await storage.presignUpload({ key, contentType: 'application/pdf', size: body.length });
    const tampered = upload.url.replace(/X-Amz-Signature=([0-9a-f])/, (_m, c) => `X-Amz-Signature=${c === '0' ? '1' : '0'}`);
    const put = await fetch(tampered, { method: 'PUT', headers: upload.headers, body });
    expect(put.ok).toBe(false);
  });
});
