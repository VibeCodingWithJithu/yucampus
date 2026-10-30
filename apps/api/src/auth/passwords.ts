import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt cost. Stored inside each hash, so it can be raised later without breaking old passwords.
const COST = { N: 2 ** 16, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Returns "scrypt$N$r$p$salt$hash" (salt and hash in base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}
