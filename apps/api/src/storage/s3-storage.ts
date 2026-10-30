import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileStorage, type PresignedRequest } from './file-storage.js';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Upload and download links stop working after this many seconds. */
  linkSeconds: number;
}

/** Any S3-compatible provider. Only standard S3 calls are used, so providers are interchangeable. */
export class S3Storage extends FileStorage {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings) {
    super();
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // Path-style URLs (endpoint/bucket/key) work with every provider, including local ones.
      forcePathStyle: true,
      // Otherwise the SDK signs a checksum of an empty body into pre-signed upload links, so every real
      // upload is refused, and several S3-compatible providers do not support these checksums anyway.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async presignUpload({ key, contentType, size }: { key: string; contentType: string; size: number }): Promise<PresignedRequest> {
    const command = new PutObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.settings.linkSeconds,
      // Signed, so the browser cannot upload a different type or size than the API approved.
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, method: 'PUT', headers: { 'content-type': contentType }, expiresAt: this.expiry() };
  }

  async presignDownload({ key, fileName, inline }: { key: string; fileName: string; inline?: boolean }): Promise<PresignedRequest> {
    const safeName = fileName.replace(/["\\\r\n]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.settings.linkSeconds });
    return { url, method: 'GET', headers: {}, expiresAt: this.expiry() };
  }

  async readStart(key: string, bytes: number): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async inspect(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async read(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    if (!(result.Body instanceof Readable)) throw new Error(`No readable body for ${key}`);
    return result.Body;
  }

  async write({ key, body, contentType, size }: { key: string; body: Readable | Uint8Array; contentType: string; size: number }) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: size }),
    );
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  async isReachable() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Local development only: creates the bucket and lets the web app upload to it from the browser.
   * In pilot and production the bucket, its region (India) and its CORS rule (UPLOAD_ORIGINS, e.g.
   * https://*.yucampus.yubhiantechnologies.in, methods PUT and GET) are set up once by hand.
   * Origins already allowed are kept, so two local servers (e.g. dev and an end-to-end run) can share the bucket.
   */
  async prepareForDevelopment(origins: readonly string[]) {
    if (!(await this.isReachable())) {
      await this.client.send(new CreateBucketCommand({ Bucket: this.settings.bucket }));
    }
    try {
      const existing = await this.client
        .send(new GetBucketCorsCommand({ Bucket: this.settings.bucket }))
        .then((cors) => cors.CORSRules?.flatMap((rule) => rule.AllowedOrigins ?? []) ?? [])
        .catch(() => [] as string[]);
      const allowed = [...new Set([...existing, ...origins])];
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.settings.bucket,
          CORSConfiguration: {
            CORSRules: [{ AllowedOrigins: allowed, AllowedMethods: ['PUT', 'GET'], AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }],
          },
        }),
      );
    } catch {
      // Some local stores allow every origin and do not implement this call.
    }
  }

  private expiry() {
    return new Date(Date.now() + this.settings.linkSeconds * 1000).toISOString();
  }
}
