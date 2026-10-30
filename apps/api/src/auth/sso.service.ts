import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SSO_PROVIDERS, type SsoOptions, type SsoProvider } from '@yucampus/types';
import { type JWTPayload, type JWTVerifyGetKey, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppConfig, type SsoProviderConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ISSUER = 'yucampus';
const STATE_AUDIENCE = 'sso-state';
const STATE_MINUTES = 10;
const HANDOFF_SECONDS = 60;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const base64url = (bytes: Buffer) => bytes.toString('base64url');
const sha256 = (text: string) => createHash('sha256').update(text).digest();
export const hashHandoff = (code: string) => sha256(code).toString('hex');

/** Why an SSO sign-in did not finish; the sign-in page turns these into plain messages. */
export type SsoError = 'sso_cancelled' | 'sso_failed' | 'sso_not_enabled' | 'sso_domain' | 'sso_unknown_user' | 'college_suspended';

export interface SsoSettings {
  google: boolean;
  microsoft: boolean;
  domains: string[];
}

export function ssoSettingsOf(settings: unknown): SsoSettings {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).sso : null;
  const sso = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    google: sso.google === true,
    microsoft: sso.microsoft === true,
    domains: Array.isArray(sso.domains) ? sso.domains.filter((d): d is string => typeof d === 'string') : [],
  };
}

class SsoFailure extends Error {
  constructor(readonly reason: SsoError) {
    super(reason);
  }
}

/**
 * Sign-in with Google or Microsoft (docs/ARCHITECTURE.md "SSO"): OpenID Connect authorization code flow with PKCE,
 * state and nonce. Only people the college already added can sign in, by email on an allowed domain. A finished
 * sign-in becomes a one-time handoff code for the college's own address, never a session on the SSO host.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger('SSO');
  private readonly keys = new Map<SsoProvider, JWTVerifyGetKey>();
  /** Replaceable in tests (a fake provider). */
  fetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Uses these signing keys instead of fetching the provider's (tests and local fake providers). */
  useKeys(provider: SsoProvider, keys: JWTVerifyGetKey) {
    this.keys.set(provider, keys);
  }

  private keysFor(provider: SsoProvider, cfg: SsoProviderConfig): JWTVerifyGetKey {
    let keys = this.keys.get(provider);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(cfg.jwksUrl));
      this.keys.set(provider, keys);
    }
    return keys;
  }

  redirectUri(provider: SsoProvider) {
    return `${this.config.ssoUrl()}/api/v1/auth/sso/${provider}/callback`;
  }

  private async college(subdomain: string) {
    const name = subdomain.trim().toLowerCase();
    const collegeId = SUBDOMAIN.test(name) ? await this.prisma.resolveCollegeId(name) : null;
    if (!collegeId) return null;
    const college = await this.prisma.forTenant(collegeId, (db) => db.college.findUnique({ where: { id: collegeId }, select: { status: true, settings: true, subdomain: true } }));
    return college ? { id: collegeId, subdomain: college.subdomain, suspended: college.status === 'suspended', sso: ssoSettingsOf(college.settings) } : null;
  }

  /** The buttons the sign-in page shows: turned on by the college and set up on this server. */
  async options(subdomain: string): Promise<SsoOptions> {
    const college = await this.college(subdomain);
    const on = (provider: SsoProvider) => Boolean(college && !college.suspended && college.sso[provider] && this.config.sso[provider]);
    return { google: on('google'), microsoft: on('microsoft') };
  }

  /**
   * Starts a sign-in: the provider's address to send the browser to, and the signed state cookie to set.
   * Anything not allowed sends the browser straight back to the college's sign-in page with a reason.
   */
  async start(provider: SsoProvider, subdomain: string): Promise<{ redirect: string; cookie: string | null }> {
    const college = await this.college(subdomain);
    if (!college) return { redirect: `${this.config.webOrigin}/login?sso_error=sso_failed`, cookie: null };
    const back = (reason: SsoError) => ({ redirect: `${this.config.appUrl(college.subdomain)}/login?sso_error=${reason}`, cookie: null });
    const cfg = this.config.sso[provider];
    if (college.suspended) return back('college_suspended');
    if (!cfg || !college.sso[provider]) return back('sso_not_enabled');

    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    const cookie = await new SignJWT({ st: state, nonce, ver: verifier, col: college.subdomain, prv: provider })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(STATE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${STATE_MINUTES}m`)
      .sign(this.config.jwtSecret);
    const url = new URL(cfg.authUrl);
    for (const [key, value] of Object.entries({
      client_id: cfg.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: base64url(sha256(verifier)),
      code_challenge_method: 'S256',
      ...cfg.params,
    })) {
      url.searchParams.set(key, value);
    }
    return { redirect: url.toString(), cookie };
  }

  /** The provider sent the browser back. Returns where to send it next: the college's finish page, or its sign-in page. */
  async callback(provider: SsoProvider, query: { code?: string; state?: string; error?: string }, cookie: string | undefined): Promise<string> {
    let saved: { st: string; nonce: string; ver: string; col: string; prv: string };
    try {
      if (!cookie) throw new Error('no state cookie');
      const { payload } = await jwtVerify(cookie, this.config.jwtSecret, { issuer: ISSUER, audience: STATE_AUDIENCE, algorithms: ['HS256'] });
      saved = payload as unknown as typeof saved;
    } catch {
      // Without our cookie we do not know the college: back to the main sign-in page.
      return `${this.config.webOrigin}/login?sso_error=sso_failed`;
    }
    const back = (reason: SsoError) => `${this.config.appUrl(saved.col)}/login?sso_error=${reason}`;
    try {
      if (saved.prv !== provider || !query.state || query.state !== saved.st) throw new SsoFailure('sso_failed');
      if (query.error) throw new SsoFailure(query.error === 'access_denied' ? 'sso_cancelled' : 'sso_failed');
      if (!query.code) throw new SsoFailure('sso_failed');
      const cfg = this.config.sso[provider];
      const college = await this.college(saved.col);
      if (!cfg || !college) throw new SsoFailure('sso_failed');
      if (college.suspended) throw new SsoFailure('college_suspended');
      if (!college.sso[provider]) throw new SsoFailure('sso_not_enabled');

      const email = await this.emailFrom(provider, cfg, query.code, saved);
      const domain = email.split('@')[1] ?? '';
      if (!college.sso.domains.includes(domain)) throw new SsoFailure('sso_domain');

      const code = base64url(randomBytes(32));
      const found = await this.prisma.forTenant(college.id, async (db) => {
        const user = await db.user.findFirst({ where: { collegeId: college.id, email }, select: { id: true } });
        if (!user) return false;
        await db.ssoHandoff.create({
          data: { collegeId: college.id, userId: user.id, provider, codeHash: hashHandoff(code), expiresAt: new Date(Date.now() + HANDOFF_SECONDS * 1000) },
        });
        return true;
      });
      if (!found) throw new SsoFailure('sso_unknown_user');
      return `${this.config.appUrl(college.subdomain)}/sso/finish?code=${code}`;
    } catch (error) {
      if (error instanceof SsoFailure) return back(error.reason);
      this.logger.warn(`${provider} sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
      return back('sso_failed');
    }
  }

  /** Exchanges the code for tokens and returns the verified email address from the ID token. */
  private async emailFrom(provider: SsoProvider, cfg: SsoProviderConfig, code: string, saved: { nonce: string; ver: string }): Promise<string> {
    const response = await this.fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri(provider),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: saved.ver,
      }),
    });
    if (!response.ok) throw new Error(`token endpoint answered ${response.status}`);
    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    if (!idToken) throw new Error('no id_token');
    const { payload } = await jwtVerify(idToken, this.keysFor(provider, cfg), { audience: cfg.clientId, algorithms: ['RS256'] });
    const claims = payload as JWTPayload & { nonce?: string; email?: string; email_verified?: boolean; preferred_username?: string; tid?: string };
    const issuer = cfg.issuer.replace('{tenantid}', typeof claims.tid === 'string' ? claims.tid : '');
    if (claims.iss !== issuer || (cfg.issuer.includes('{tenantid}') && !claims.tid)) throw new Error('unexpected issuer');
    if (claims.nonce !== saved.nonce) throw new Error('nonce does not match');
    let email: string | undefined;
    if (provider === 'google') {
      // Google says whether it checked the address.
      if (claims.email_verified !== true) throw new SsoFailure('sso_failed');
      email = claims.email;
    } else {
      // Work or school accounts: the organisation manages the address; the college's domain list limits who passes.
      email = claims.email ?? claims.preferred_username;
    }
    if (!email || !email.includes('@')) throw new SsoFailure('sso_failed');
    return email.trim().toLowerCase();
  }
}

export const isSsoProvider = (value: string): value is SsoProvider => (SSO_PROVIDERS as readonly string[]).includes(value);
