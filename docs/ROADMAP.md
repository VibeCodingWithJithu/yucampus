# Build order

Phase 0 (week 1): monorepo, CI, docker-compose (Postgres, Redis, SeaweedFS for local S3), Prisma schema v1,
OpenAPI contract, design tokens + base UI components in packages/ui, seed with dummy college.

Phase 1 core loop (weeks 2-8), each slice = API + UI + tests:
1. Auth (OTP + email/password), tenancy + RLS, roles
2. Institution setup, departments/programs, users (Excel import, invites), academic year
3. Evidence upload (web + PWA, pre-signed upload, compression) and IQAC review queue
4. Framework templates (seed NAAC RAF; Binary/MBGL partial), NAAC criteria + metric detail, readiness
5. Evidence library
6. Tasks + task templates + reminders; notifications (in-app, email; WhatsApp later)
7. Principal dashboard
8. Reports & export (Excel data sheets, Word/PDF, ZIP packs, fix-before-export)

Phase 2: data registers, NBA CO-PO + attainment + SAR, NIRF, AISHE + consistency checker, surveys.
Phase 3: AI service (OCR + extraction + suggestions), WhatsApp channel, SSO, super-admin panel, billing, audit UI.

Definition of done per slice: matches design, permission tests pass, tenant isolation test passes,
works at 390px width, empty/loading/error states handled.
