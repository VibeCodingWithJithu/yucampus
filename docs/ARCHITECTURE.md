# Architecture

## Stack (final)
- Monorepo: Turborepo + pnpm
- Web: Next.js (App Router) + React + TypeScript, Tailwind CSS + shadcn/ui, React Hook Form + Zod,
  TanStack Query, TanStack Table, Recharts. PWA for faculty phone uploads.
- API: NestJS (TypeScript), REST + OpenAPI/Swagger, modular monolith (modules: core, accredit-naac,
  accredit-nba, rank-nirf, report-aishe, surveys, reports, ai-bridge).
- DB: standard PostgreSQL + Prisma. Row-level security keyed on college_id (set per transaction with
  set_config(..., true), the function form of SET LOCAL). Only features every managed PostgreSQL offers
  (RDS, Supabase, Cloud SQL, Azure, a plain Docker container) - no provider-specific extensions - so the
  database can move between providers. For local work without Docker and for tests, the same migrations run in
  PGlite (PostgreSQL compiled to WebAssembly).
- Jobs/cache: Redis + BullMQ.
- Files: S3-compatible object storage in an Indian region, behind one storage interface that speaks the S3 API.
  Uploads and downloads use pre-signed URLs from the start (files never pass through the API). Switching
  provider is configuration only (S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY).
  Client-side image compression before upload.
- AI service: Python FastAPI (PaddleOCR/Tesseract + open-source LLM for structured extraction). Never send real
  personal data to free third-party AI APIs.
- Reports: docx (Word), pdfkit (PDF), ExcelJS (Excel), archiver (ZIP). PDF was planned with Playwright; pdfkit was
  chosen (2026-10-16) so the API needs no browser installed. Its built-in fonts cover Western European text only;
  other characters are replaced in the PDF (the Word file keeps them). Embed a Unicode font if Indian scripts are needed.
- Rankings and surveys (2026-10-18): NIRF and AISHE pages compute from the Data registers on request, using the
  same register measures as NAAC metrics; their structure and the consistency checks are rules files in
  apps/api/rules (nirf, aishe). Nothing is sent to the NIRF, AISHE or NAAC portals: they have no public API for
  colleges, so YuCampus prepares Excel workbooks and records what the college submitted.
- Platform panel (2026-10-18): a "platform" API module and an /admin area in the web app (admin.yucampus.yubhiantechnologies.in in
  production). Platform access tokens carry audience "platform" and no college; the college AuthGuard refuses them
  and the PlatformGuard refuses college tokens. The refresh cookie is separate (path /api/v1/platform/auth). The
  panel reads across colleges by visiting each college through forTenant() in turn, so row-level security still
  applies; it never opens a connection that bypasses it. New colleges go through the create_college() function.
  Rules stay files imported at deploy time; the app role stays read-only on rules. Platform sign-in has two steps
  (2026-10-21): the password gives a 5-minute sign-in ticket (a token with audience "platform-mfa" that opens nothing
  else), and the ticket plus a TOTP code (RFC 6238: SHA-1, 6 digits, 30 seconds, one step of clock drift either way)
  or a recovery code gives the session. TOTP is implemented with node:crypto; no extra library.
- SSO (2026-10-21): OpenID Connect authorization code flow with PKCE, nonce and state, for Google and Microsoft
  (multi-tenant "organizations" endpoint), built on jose (already used for tokens); no extra library. Google accepts
  only exact redirect addresses, so the flow runs on one fixed host (SSO_BASE_URL; auth.<rootDomain> in production,
  WEB_ORIGIN locally): /api/v1/auth/sso/<provider>/start?college=<subdomain> sets a short signed httpOnly cookie
  (state, PKCE verifier, nonce, college) and sends the browser to the provider; the callback checks state and the ID
  token (signature from the provider's keys, issuer, audience, nonce, expiry), then hands the person back to their
  college's own address with a one-time code (60 seconds, stored hashed). That page exchanges the code for a normal
  session, so the refresh cookie stays on the college's own host. Client ids and secrets come from environment
  variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET).
- Auth: JWT access + refresh tokens, mobile OTP, Google/Microsoft SSO. Authorisation is permission-based:
  roles are default permission templates that each college can adjust (docs/PRODUCT.md, "Permissions").
- Later: Tauri desktop (reuses web UI), React Native (Expo) mobile.
- CI/CD: GitHub Actions. Monitoring: Sentry. Tests: Vitest + Playwright.

## Environments and hosting (decided 2026-10-14)
All YuCampus app data (database, files, backups) stays in India.

| Stage | Where | Data |
|---|---|---|
| Development (now) | This PC: Docker Compose with PostgreSQL, Redis and SeaweedFS (S3-compatible; MinIO no longer publishes free images) - infra/docker-compose.yml. Without Docker, the API falls back to PGlite. | Dummy data only |
| Pilot (first colleges) | Oracle Cloud Always Free VM in Mumbai or Hyderabad running the same stack in Docker, OR Supabase in Mumbai for PostgreSQL + storage | Real data |
| Production (paid launch) | AWS Mumbai (ap-south-1) or Hyderabad (ap-south-2): RDS PostgreSQL, S3, ElastiCache Redis, CloudFront | Real data |

- Funding for production hosting: startup credits (AWS Activate, Google for Startups, Microsoft for Startups) and
  subscriptions.
- Other acceptable S3-compatible storage with Indian regions: Google Cloud Storage (Mumbai/Delhi), Azure Blob
  (Pune/Chennai, through an S3-compatible gateway or a second storage adapter), Oracle Object Storage, E2E Networks.
- Not allowed for app data: Cloudflare R2 or any provider that cannot guarantee data residency in India;
  Zoho WorkDrive / Zoho Catalyst. Zoho is only for Yubhian's own business operations (CRM, campaigns,
  bookings, billing).
- Configuration lives in environment variables, documented in .env.example. Real secrets are never committed.
- Pilot deployment (decided 2026-10-30): one Ubuntu server in an Indian region (any provider) runs Docker Compose
  from infra/production: Caddy (HTTPS and routing), web, api, PostgreSQL, Redis and SeaweedFS. One Docker image holds
  the whole built workspace and serves as web, api and the tools container (migrations, rules import, team
  accounts). Step-by-step guide: docs/DEPLOY.md.
  - HTTPS: the domain's DNS is at Hostinger, which Caddy cannot drive for a wildcard certificate (DNS challenge). So
    the fixed names (yucampus., admin., auth., files.) get ordinary certificates, and each college subdomain gets its
    own certificate the first time it is opened (Caddy on-demand TLS). Before issuing one, Caddy asks the API
    (GET /health/tls?domain=..., reachable only inside the server) and the API agrees only for an existing college,
    so strangers cannot make Caddy request certificates for made-up names. DNS needs only two A records.
  - The bare yucampus. address redirects to yubhiantechnologies.in for now; admin./ redirects to /admin.
  - Files: SeaweedFS on the same server, reached by browsers at files.<rootDomain> through Caddy (uploads stay
    pre-signed and direct). S3_SETUP=true lets the API create the bucket and its CORS rule on start. Moving to S3
    Mumbai later is a change of the S3_* settings and copying the files.
  - A production database gets the rules files only (pnpm db:rules), never the sample college or sample team account.
  - Backups: a nightly database dump and file archive on the server, kept 14 days, plus a copy to a second Indian
    location (see docs/DEPLOY.md).
  - "files" is a reserved subdomain.
- Open question: whether app traffic may pass through a global CDN/proxy (CloudFront, Cloudflare). Static files
  are fine; API responses contain personal data, so check this against the DPDP Act and college contracts first.

## Folder layout
apps/web, apps/api, apps/ai-service, (later) apps/desktop, apps/mobile
packages/ui, packages/types, packages/validation, packages/config
infra/ (docker-compose, deployment)

## Multi-tenancy
One app, many colleges. Each college has a subdomain (e.g. abc.yucampus.yubhiantechnologies.in).
Domain (decided 2026-10-30): YuCampus runs under Yubhian's own domain as yucampus.yubhiantechnologies.in (ROOT_DOMAIN). Colleges are
<subdomain>.yucampus.yubhiantechnologies.in; the team panel is admin.yucampus.yubhiantechnologies.in and SSO runs on auth.yucampus.yubhiantechnologies.in (both reserved). DNS needs a
record for yucampus.yubhiantechnologies.in and a wildcard *.yucampus.yubhiantechnologies.in; TLS needs a wildcard certificate for *.yucampus.yubhiantechnologies.in (a certificate
for *.yubhiantechnologies.in does not cover these, as a wildcard covers one level only). Email is sent from
no-reply@yubhiantechnologies.in. Nothing in the code depends on the name: moving to another domain later is a
change of ROOT_DOMAIN, NEXT_PUBLIC_ROOT_DOMAIN, the SSO addresses and the provider registrations. college_id on every tenant row.
Hosting change (decided 2026-10-30, later the same day): the pilot runs on Yubhian's own computer in India, reached
through a Cloudflare Tunnel (free), instead of a rented server. Cloudflare's free certificate covers names one
level below a domain only, so ROOT_DOMAIN becomes yubhiantechnologies.in itself: colleges are
<subdomain>.yubhiantechnologies.in, with admin., auth. and files. as before. Requires moving the DNS of
yubhiantechnologies.in from Hostinger to Cloudflare (free; the website and email records move with it). Colleges
share the name space with the company's own addresses, so the company's names (www, mail, blog and the like) are
reserved. Cloudflare ends HTTPS, so Caddy is not used in this setup (infra/production/docker-compose.tunnel.yml);
the admin./ to /admin redirect moved into the web app so both setups have it. Guide: docs/DEPLOY_HOME.md. Traffic
passes through Cloudflare (the open CDN question above); stored data stays on the computer in India. Moving to a
rented server later means running the same tunnel setup there; the addresses stay. (docs/DEPLOY.md, with Caddy
and yucampus.yubhiantechnologies.in, stays for a server without Cloudflare.) Needs: the computer always on, BitLocker on its disk.
Premium option later: separate database per college.

## Performance rules
Paginate (20-50 rows), cache dashboards in Redis, index (college_id, academic_year_id, ...), background jobs
with progress indicators, CDN for static assets.

## Security & compliance
Encryption in transit and at rest, daily backups to a second location (also in India), audit log of who changed
what, permission-based access, data residency in India, DPDP Act consent/export/deletion, Terms of Service,
Privacy Policy, Data Processing Agreement with colleges.
