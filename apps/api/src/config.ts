/**
 * One OpenID Connect provider (decided 2026-10-21). issuer may contain {tenantid}, filled from the token's tid claim
 * (Microsoft issues tokens per organisation). The endpoints can be overridden for local testing with a fake provider.
 */
export interface SsoProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuer: string;
  /** Extra authorize parameters. */
  params: Record<string, string>;
}

const SSO_DEFAULTS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    params: { prompt: 'select_account' },
  },
  microsoft: {
    // "organizations": any work or school account, not personal Microsoft accounts.
    authUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys',
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    params: { prompt: 'select_account', response_mode: 'query' },
  },
} as const;

const DEV_JWT_SECRET = 'yucampus-local-development-secret-not-for-production';

/** Typed settings, read once from the environment at start-up. */
export class AppConfig {
  isProduction = false;
  port = 4000;
  webOrigin = 'http://localhost:3000';
  /** postgresql://... or, for local work without Docker, pglite:<folder> (pglite: alone = in memory). */
  databaseUrl = 'pglite:.data/pglite';
  jwtSecret: Uint8Array = new TextEncoder().encode(DEV_JWT_SECRET);
  /** Used when a request names no college. Never set in production. */
  defaultCollegeSubdomain: string | null = 'sample';

  accessTokenSeconds = 15 * 60;
  refreshTokenDays = 30;
  /** Two tabs can refresh at the same moment; a just-replaced token is still accepted for this long. */
  refreshReuseGraceSeconds = 20;

  otpSeconds = 5 * 60;
  otpMaxAttempts = 5;
  otpMaxRequests = 3;
  otpRequestWindowSeconds = 10 * 60;

  loginMaxFailures = 5;
  loginLockMinutes = 15;

  /**
   * Web addresses browsers may upload from directly to storage (the bucket's CORS rule). Every college has its
   * own subdomain, so production uses a wildcard such as https://*.yucampus.yubhiantechnologies.in.
   */
  uploadOrigins: string[] = ['http://localhost:3000', 'http://*.localhost:3000'];

  /** SMTP server for email, e.g. smtp://localhost:1025. null: emails are only printed in the console. */
  smtpUrl: string | null = null;
  mailFrom = 'YuCampus <no-reply@yubhiantechnologies.in>';
  /** Redis for background jobs. null: jobs run inside the API process. */
  redisUrl: string | null = null;
  /** Production: colleges live at <subdomain>.<rootDomain>. */
  rootDomain: string | null = null;

  /** The web address of a college, for links in emails. */
  appUrl(subdomain: string): string {
    return this.isProduction && this.rootDomain ? `https://${subdomain}.${this.rootDomain}` : this.webOrigin;
  }

  /** Key material for encrypting team authenticator secrets (TOTP_KEY). Falls back to the JWT secret. */
  totpKey: Uint8Array | null = null;

  /** Google and Microsoft sign-in, when this server has been registered with them. null: not available. */
  sso: { google: SsoProviderConfig | null; microsoft: SsoProviderConfig | null } = { google: null, microsoft: null };
  /** The one fixed address the SSO flow runs on (providers accept only exact redirect addresses). */
  ssoBaseUrl: string | null = null;

  ssoUrl(): string {
    return this.ssoBaseUrl ?? (this.isProduction && this.rootDomain ? `https://auth.${this.rootDomain}` : this.webOrigin);
  }

  /** YuCampus team sessions last a working day, not a month. */
  platformRefreshHours = 12;

  /** The platform panel's web address, for links in emails (admin.<rootDomain> in production). */
  platformUrl(): string {
    return this.isProduction && this.rootDomain ? `https://admin.${this.rootDomain}/admin` : `${this.webOrigin}/admin`;
  }

  /** S3-compatible file storage. null when not configured (then uploads are unavailable). */
  storage: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; linkSeconds: number } | null =
    null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = new AppConfig();
  config.isProduction = env.NODE_ENV === 'production';
  if (env.API_PORT) config.port = Number(env.API_PORT);
  if (env.WEB_ORIGIN) config.webOrigin = env.WEB_ORIGIN;
  if (env.DATABASE_URL) config.databaseUrl = env.DATABASE_URL;
  if (env.JWT_SECRET) config.jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
  if (env.TOTP_KEY) config.totpKey = new TextEncoder().encode(env.TOTP_KEY);
  if (env.SSO_BASE_URL) config.ssoBaseUrl = env.SSO_BASE_URL.replace(/\/+$/, '');
  for (const provider of ['google', 'microsoft'] as const) {
    const prefix = provider.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) continue;
    const defaults = SSO_DEFAULTS[provider];
    config.sso[provider] = {
      clientId,
      clientSecret,
      authUrl: env[`${prefix}_AUTH_URL`] ?? defaults.authUrl,
      tokenUrl: env[`${prefix}_TOKEN_URL`] ?? defaults.tokenUrl,
      jwksUrl: env[`${prefix}_JWKS_URL`] ?? defaults.jwksUrl,
      issuer: env[`${prefix}_ISSUER`] ?? defaults.issuer,
      params: { ...defaults.params },
    };
  }
  if (env.DEFAULT_COLLEGE_SUBDOMAIN) config.defaultCollegeSubdomain = env.DEFAULT_COLLEGE_SUBDOMAIN;
  if (env.SMTP_URL) config.smtpUrl = env.SMTP_URL;
  if (env.MAIL_FROM) config.mailFrom = env.MAIL_FROM;
  if (env.REDIS_URL) config.redisUrl = env.REDIS_URL;
  if (env.ROOT_DOMAIN) config.rootDomain = env.ROOT_DOMAIN;
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
    config.storage = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'ap-south-1',
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      linkSeconds: Number(env.S3_LINK_SECONDS ?? 600),
    };
  }

  config.uploadOrigins = env.UPLOAD_ORIGINS
    ? env.UPLOAD_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : config.isProduction
      ? [`https://*.${env.ROOT_DOMAIN ?? 'yucampus.yubhiantechnologies.in'}`]
      : [...new Set([config.webOrigin, ...config.uploadOrigins])];

  if (config.isProduction) {
    config.defaultCollegeSubdomain = null;
    if (!env.DATABASE_URL || config.databaseUrl.startsWith('pglite:')) {
      throw new Error('DATABASE_URL must point to PostgreSQL in production.');
    }
    if (!config.smtpUrl) throw new Error('SMTP_URL must be set in production (password resets and invitations are sent by email).');
    if (!config.rootDomain) throw new Error('ROOT_DOMAIN must be set in production (e.g. yucampus.yubhiantechnologies.in).');
    if (!config.storage) throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY must be set in production.');
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
    }
    // Endpoint overrides are for testing with a fake provider only.
    for (const name of ['GOOGLE', 'MICROSOFT']) {
      if (['AUTH_URL', 'TOKEN_URL', 'JWKS_URL', 'ISSUER'].some((part) => env[`${name}_${part}`])) {
        throw new Error(`${name}_AUTH_URL, _TOKEN_URL, _JWKS_URL and _ISSUER are for local testing only.`);
      }
    }
  }
  return config;
}
