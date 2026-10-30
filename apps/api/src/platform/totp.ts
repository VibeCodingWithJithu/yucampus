// Authenticator-app codes for team sign-in (RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30-second steps), and the
// encryption of the stored secrets. Decided 2026-10-21; docs/ARCHITECTURE.md "Platform panel".
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
/** One step either way, for phones whose clock is a little off. */
const DRIFT = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, as the base32 text authenticator apps take. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The 6-digit code for one time step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return number.toString().padStart(6, '0');
}

/**
 * The time step the code belongs to, or null. A step at or before `lastStep` is refused, so a code that was
 * already used (or an older one) cannot be used again.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (let step = current - DRIFT; step <= current + DRIFT; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`YuCampus team:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('YuCampus team')}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Encrypts secrets at rest (AES-256-GCM), with a key derived from the configured key material. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(material: Uint8Array) {
    this.key = Buffer.from(hkdfSync('sha256', material, 'yucampus', 'platform-totp-secret', 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Ten one-time recovery codes like "k7qm-3xdp", and how they are stored (sha256 of the normalised code). */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const text = base32Encode(randomBytes(5)).toLowerCase();
    return `${text.slice(0, 4)}-${text.slice(4, 8)}`;
  });
}

export const normaliseRecoveryCode = (code: string) => code.replace(/[\s-]/g, '').toLowerCase();
