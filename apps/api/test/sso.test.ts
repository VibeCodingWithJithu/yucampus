// Sign-in with Google or Microsoft, against a fake OpenID Connect provider that signs real tokens and checks PKCE:
// per-college switch and domains, existing people only, state / nonce / audience / issuer checks, the one-time
// handoff to the college's own address, suspension, and the audit log.

import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { ssoSettingsSchema } from '@yucampus/validation';
import { type JWK, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { OtpSender } from '../src/auth/otp-sender.js';
import { SsoService } from '../src/auth/sso.service.js';
import { type AuthUser, TokensService } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { InstitutionService } from '../src/setup/institution.service.js';
import { linksFor } from './notifications-for.js';

class SilentOtpSender extends OtpSender {
  async send() {}
}

const FAKE = 'https://idp.test';
const config = Object.assign(new AppConfig(), { webOrigin: 'http://localhost:3000' });
config.sso = {
  google: { clientId: 'google-client', clientSecret: 's1', authUrl: `${FAKE}/google/auth`, tokenUrl: `${FAKE}/google/token`, jwksUrl: `${FAKE}/jwks`, issuer: 'https://accounts.google.com', params: {} },
  microsoft: {
    clientId: 'ms-client',
    clientSecret: 's2',
    authUrl: `${FAKE}/ms/auth`,
    tokenUrl: `${FAKE}/ms/token`,
    jwksUrl: `${FAKE}/jwks`,
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    params: { response_mode: 'query' },
  },
};

let database: Database;
let prisma: PrismaService;
let sso: SsoService;
let auth: AuthService;
let institution: InstitutionService;
let admin: AuthUser;
let privateKey: CryptoKey;

/** What the fake provider puts in the next ID token (on top of the defaults). */
let claims: Record<string, unknown> = {};
/** The authorize request the browser was sent to, as the fake provider saw it. */
let lastAuthorize: URL;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

/** The fake token endpoint: checks the code and PKCE verifier, then signs an ID token. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = new URLSearchParams(String(init?.body));
  const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url');
  if (body.get('code') !== 'good-code' || challenge !== lastAuthorize.searchParams.get('code_challenge')) {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  }
  const microsoft = url.includes('/ms/');
  const idToken = await new SignJWT({
    nonce: lastAuthorize.searchParams.get('nonce'),
    ...(microsoft ? { tid: 'tenant-1', preferred_username: 'Admin@Sample-College.example' } : { email: 'admin@sample-college.example', email_verified: true }),
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer((claims.iss as string) ?? (microsoft ? 'https://login.microsoftonline.com/tenant-1/v2.0' : 'https://accounts.google.com'))
    .setAudience((claims.aud as string) ?? (microsoft ? 'ms-client' : 'google-client'))
    .setSubject('someone')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
};

/** Runs the browser's part: start, the provider redirecting back with a code, and the callback. */
async function signIn(provider: 'google' | 'microsoft', extra: { code?: string; error?: string; state?: string; cookie?: string | null } = {}) {
  const started = await sso.start(provider, 'sample');
  if (!started.cookie) return started.redirect;
  lastAuthorize = new URL(started.redirect);
  return sso.callback(
    provider,
    { code: extra.error ? undefined : (extra.code ?? 'good-code'), state: extra.state ?? lastAuthorize.searchParams.get('state')!, error: extra.error },
    extra.cookie === null ? undefined : (extra.cookie ?? started.cookie),
  );
}
const reason = (url: string) => new URL(url).searchParams.get('sso_error');

beforeAll(async () => {
  database = await openLocalDatabase({ setup: (owner) => seed(owner) });
  prisma = new PrismaService(database);
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' };
  sso = new SsoService(prisma, config);
  sso.fetch = fakeFetch;
  sso.useKeys('google', createLocalJWKSet({ keys: [jwk] }));
  sso.useKeys('microsoft', createLocalJWKSet({ keys: [jwk] }));
  auth = new AuthService(prisma, new TokensService(config), new SilentOtpSender(), config, new PermissionsService(prisma), linksFor(prisma, config).links);
  institution = new InstitutionService(prisma, config);
  const collegeId = (await prisma.resolveCollegeId('sample'))!;
  const row = await prisma.forTenant(collegeId, (db) => db.user.findFirstOrThrow({ where: { collegeId, email: 'admin@sample-college.example' }, include: { roles: true } }));
  admin = { id: row.id, collegeId, roles: row.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('College setting', () => {
  it('is off by default, so no buttons and no sign-in', async () => {
    expect(await sso.options('sample')).toEqual({ google: false, microsoft: false });
    expect(reason(await signIn('google'))).toBe('sso_not_enabled');
  });

  it('needs at least one domain, and only providers this server has', async () => {
    expect(ssoSettingsSchema.safeParse({ google: true, microsoft: false, domains: [] }).success).toBe(false);
    expect(ssoSettingsSchema.parse({ google: true, microsoft: false, domains: ['@SREC.ac.in', 'srec.ac.in'] }).domains).toEqual(['srec.ac.in']);
    const bare = new InstitutionService(prisma, new AppConfig());
    expect(await codeOf(bare.updateSso(admin, { google: true, microsoft: false, domains: ['sample-college.example'] }))).toBe('sso_unavailable');
  });

  it('turns Google on for the college domain', async () => {
    const saved = await institution.updateSso(admin, { google: true, microsoft: false, domains: ['sample-college.example'] });
    expect(saved).toEqual({ google: true, microsoft: false, domains: ['sample-college.example'], available: { google: true, microsoft: true } });
    expect(await sso.options('sample')).toEqual({ google: true, microsoft: false });
  });
});

describe('Signing in', () => {
  it('sends the browser to the provider with state, nonce and PKCE', async () => {
    const started = await sso.start('google', 'sample');
    const url = new URL(started.redirect);
    expect(url.origin + url.pathname).toBe(`${FAKE}/google/auth`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'google-client',
      redirect_uri: 'http://localhost:3000/api/v1/auth/sso/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(20);
    expect(url.searchParams.get('nonce')!.length).toBeGreaterThan(20);
    expect(started.cookie).toBeTruthy();
  });

  it('signs in someone the college added, once, through the handoff code', async () => {
    claims = {};
    const back = new URL(await signIn('google'));
    expect(back.pathname).toBe('/sso/finish');
    const code = back.searchParams.get('code')!;
    const started = await auth.finishSso('sample', code);
    expect(started.session.user.email).toBe('admin@sample-college.example');
    expect(await codeOf(auth.finishSso('sample', code))).toBe('sso_expired');
    const log = await prisma.forTenant(admin.collegeId, (db) => db.auditLog.findFirstOrThrow({ where: { collegeId: admin.collegeId, action: 'sign_in' }, orderBy: { at: 'desc' } }));
    expect(log.after).toEqual({ method: 'google' });
  });

  it('refuses someone the college has not added, or an email on another domain', async () => {
    claims = { email: 'stranger@sample-college.example' };
    expect(reason(await signIn('google'))).toBe('sso_unknown_user');
    claims = { email: 'admin@gmail.com' };
    expect(reason(await signIn('google'))).toBe('sso_domain');
  });

  it('refuses tokens that are not for this sign-in', async () => {
    claims = { email_verified: false };
    expect(reason(await signIn('google'))).toBe('sso_failed');
    claims = { nonce: 'someone-elses-nonce' };
    expect(reason(await signIn('google'))).toBe('sso_failed');
    claims = { aud: 'another-app' };
    expect(reason(await signIn('google'))).toBe('sso_failed');
    claims = { iss: 'https://evil.test' };
    expect(reason(await signIn('google'))).toBe('sso_failed');
    claims = {};
    expect(reason(await signIn('google', { code: 'stolen-code' }))).toBe('sso_failed');
  });

  it('refuses a callback without its own state or cookie', async () => {
    claims = {};
    expect(reason(await signIn('google', { state: 'made-up-state' }))).toBe('sso_failed');
    const noCookie = new URL(await signIn('google', { cookie: null }));
    expect(noCookie.origin).toBe('http://localhost:3000');
    expect(noCookie.searchParams.get('sso_error')).toBe('sso_failed');
    expect(reason(await signIn('google', { cookie: 'not-a-signed-cookie' }))).toBe('sso_failed');
  });

  it('says so when the person cancels at the provider', async () => {
    expect(reason(await signIn('google', { error: 'access_denied' }))).toBe('sso_cancelled');
  });

  it('works with Microsoft work accounts, checking the organisation issuer', async () => {
    await institution.updateSso(admin, { google: true, microsoft: true, domains: ['sample-college.example'] });
    claims = {};
    const back = new URL(await signIn('microsoft'));
    expect((await auth.finishSso('sample', back.searchParams.get('code')!)).session.user.email).toBe('admin@sample-college.example');
    claims = { iss: 'https://login.microsoftonline.com/another-tenant/v2.0' };
    expect(reason(await signIn('microsoft'))).toBe('sso_failed');
  });

  it('lets the handoff code expire after a minute', async () => {
    claims = {};
    const code = new URL(await signIn('google')).searchParams.get('code')!;
    await prisma.forTenant(admin.collegeId, (db) => db.ssoHandoff.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect(await codeOf(auth.finishSso('sample', code))).toBe('sso_expired');
  });

  it('refuses a suspended college', async () => {
    await prisma.forTenant(admin.collegeId, (db) => db.college.update({ where: { id: admin.collegeId }, data: { status: 'suspended' } }));
    expect(await sso.options('sample')).toEqual({ google: false, microsoft: false });
    expect(reason(await signIn('google'))).toBe('college_suspended');
    await prisma.forTenant(admin.collegeId, (db) => db.college.update({ where: { id: admin.collegeId }, data: { status: 'active' } }));
  });
});
