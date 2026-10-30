# YuCampus

Keeps Indian colleges accreditation-ready all year (NAAC, NBA, NIRF, AISHE). By Yubhian Technologies LLP.

Product, architecture, data model, design system, screens and build order are in [docs/](docs/).
Rules for working in this repository are in [CLAUDE.md](CLAUDE.md).

## What is here

| Path | What |
|---|---|
| `apps/web` | Next.js web app (sign-in screen, app shell with sidebar) |
| `apps/api` | NestJS API, Prisma schema, migrations, seed |
| `packages/ui` | Design tokens and base components (Tailwind) |
| `packages/types` | Shared domain types (roles, statuses) |
| `packages/validation` | Shared Zod schemas |
| `packages/config` | Shared TypeScript configs |
| `infra` | docker-compose for Postgres, Redis, SeaweedFS (local S3-compatible file storage) and Mailpit (test inbox) |

## You need

- Node.js 24 (LTS) and pnpm 12
- Docker Desktop only if you want a real PostgreSQL, Redis and file storage locally (optional for now)

## Run it (no Docker)

```sh
pnpm install
pnpm dev             # web on http://localhost:3000, API on http://localhost:4000
```

With no `.env` file the API uses a built-in local database (PGlite, stored in `apps/api/.data`). It runs the
same migrations and the same row-level security as PostgreSQL, and seeds a sample college.
Delete `apps/api/.data` to start again from scratch.

Sample sign-ins (all dummy data), password `Sample@1234`:

| Email | Mobile | Role |
|---|---|---|
| admin@sample-college.example | 90000 00001 | College admin |
| principal@sample-college.example | 90000 00002 | Principal |
| iqac@sample-college.example | 90000 00003 | IQAC coordinator |
| hod.cse@sample-college.example | 90000 00004 | HOD + faculty |
| nba@sample-college.example | 90000 00005 | NBA coordinator + faculty |
| nirf@sample-college.example | 90000 00006 | NIRF coordinator |
| faculty@sample-college.example | 90000 00007 | Faculty |
| office@sample-college.example | 90000 00008 | Office staff |

For mobile sign-in the 6-digit code is printed in the API console; no SMS is sent locally.

The YuCampus team panel is at `/admin` (sample team account `team@yucampus.example`, same password). College
accounts cannot sign in there. The first sign-in sets up an authenticator app (scan the QR code with any TOTP app).

## Run it with PostgreSQL (Docker)

```sh
cp .env.example .env
pnpm infra:up        # Postgres, Redis, SeaweedFS (local S3), Mailpit (test inbox)
pnpm db:migrate      # create tables and row-level security
pnpm db:seed         # the same sample college
pnpm dev
```

API docs: http://localhost:4000/docs (OpenAPI JSON at `/docs-json`).
Emails the app sends (task notices, invites, password links) land in Mailpit: http://localhost:8025. Nothing
leaves your machine. Without Docker, emails are printed in the API console instead.

## Checks

```sh
pnpm typecheck
pnpm test            # includes the tenant-isolation test; no Docker needed
pnpm build
```

## Tenancy in one paragraph

Every tenant-owned table has `college_id` and a row-level security policy. The API connects as the
`yucampus_app` database role and reaches tenant data only through `PrismaService.forTenant(collegeId, ...)`,
which names the college for one transaction. Migrations and seeds run as the owner role. When a migration
adds a tenant-owned table it must add the policy too; `apps/api/test/tenant-isolation.test.ts` fails if not.

## Sign-in in one paragraph

Mobile OTP or email and password. The API returns a 15-minute access token (kept in memory by the web app)
and sets a 30-day refresh token as an httpOnly cookie, replaced on every use. The web app calls `/api/v1`
on its own origin and Next forwards it to the API (`API_PROXY_TARGET`, read when the web app is built).
Every API route needs a signed-in user unless marked `@Public()`; `@Roles()` / `@RequireSection()` limit
it by role, using the same table (`SECTION_ROLES` in `packages/types`) that decides what the sidebar shows.

## Institution setup in one paragraph

College admins, principals and IQAC coordinators manage the profile, departments and programs, frameworks,
people and the academic calendar. Only a college admin can give, remove or edit the college admin role. The
head of department is whoever holds the HOD role for it (one per department). People are added as
"invited" and become "active" the first time they sign in. Excel import reads the file in the browser,
checks every row first, and saves all rows or none (up to 500 at a time). Starting the next academic year
locks the current one. Every change is written to the audit log.

## Permissions in one paragraph

Access is decided by permissions, not role names (docs/PRODUCT.md, "Permissions"). Each role has a default
template (`ROLE_TEMPLATES` in packages/types); a college admin can switch entries on or off for their college on
the Users and roles page, and the principal can give IQAC "Manage users and setup". The API works out each
person's permissions on every request (`PermissionsGuard`) and the web app hides what the API would refuse.

## File storage in one paragraph

Files go to S3-compatible storage through one interface (`apps/api/src/storage`), with pre-signed upload and
download links, so files never pass through the API. Locally that is SeaweedFS in Docker; in pilot and production
it is a provider in India, chosen by the five `S3_*` values in `.env`. Without those values uploads are off.

## Criteria templates in one paragraph

NAAC, NBA, NIRF and AISHE criteria and metrics are data files in `apps/api/rules`, loaded with
`pnpm rules:import <file>` (see apps/api/rules/README.md). Each metric lists the documents it needs; a metric's
readiness is the share of those documents with finally approved evidence in the years it covers. Templates not
checked against the official manual show a clear warning. **The sample college uses the NAAC RAF template for
affiliated colleges, extracted from the official manual but not yet checked line by line by a person.**

## Dashboard in one paragraph

The principal, IQAC and other college-wide viewers see NAAC readiness (with the change over 30 days, worked out from
when each item got its final approval), uploads in the chosen academic year, what waits for review, missing NAAC
documents, criteria progress, coming key dates, each program's NBA format, a table by department and recent activity
from the audit log (`GET /dashboard`). HODs see the same for their own departments; faculty keep their personal home.
Readiness always covers every year each metric needs; the year selector changes the counts and the department table.

## NBA outcomes in one paragraph

On the NBA page, the HOD or NBA coordinator adds a program's courses for the year and assigns teachers. Engineering
programs get NBA's twelve POs from `apps/api/rules/nba/program-outcomes.json` (marked "not yet checked"), and each
program adds its PSOs. The course teacher enters the course outcomes, the CO–PO mapping (1–3) and, for each assessment,
how many students attempted and how many reached the target mark (totals only, never a student's marks). Attainment is
worked out step by step with the program's rules (defaults: target 60%, levels at 70/60/50% of students, direct 40%
internal + 60% end exam, final 80% direct + 20% indirect, CO target 2.0). Locking a course makes it read only and
counts it for the program's PO attainment. The program's vision, mission and PEOs are entered on the same page.
On the Reports page each NBA program has a SAR (Word, PDF, an outcome data workbook and a missing-items list): criteria 1–6
are compiled from the NBA page and the registers, criteria 7–10 are marked to be written by hand. The SAR's structure is
the rules file `apps/api/rules/nba/sar.json` (not yet checked against the current NBA format).

## Surveys in one paragraph

IQAC runs student satisfaction, alumni, employer, parent and teacher-curriculum surveys on the Surveys page; a course's
teacher, HOD or NBA coordinator starts its course exit survey from the course page. Each survey has an open link
(`/s/<token>`) and a QR code: no sign-in, anonymous answers, one per device (only a hash of a random device token is
kept), and no list of students, alumni or parents is stored. Templates and questions are rules data
(`apps/api/rules/surveys/templates.json`). Course exit questions are one per CO on a 1–3 scale; closing the survey sets each
CO's NBA indirect attainment to its average (unless the course is locked). Written comments are listed as written.

## NIRF in one paragraph

The NIRF page shows how much of the data each ranking parameter needs is entered, for each of the last academic years.
It covers the five parameters (TLR, RP, GO, OI, PR), their sub-parameters, and the individual data items. The parameters
and items are rules data (`apps/api/rules/nirf/parameters.json`, marked as a first mapping that has not been checked
against the current year's methodology). Every value comes from the Data registers, and an empty value shows as "Not
entered", never as 0. YuCampus does not compute a NIRF score, and Perception is left to NIRF's own surveys. "Ask someone"
turns a sub-parameter into a task with reminders. "Export data sheets" downloads one Excel sheet per parameter. The page is
for the NIRF coordinator, IQAC and the principal, and the college picks its NIRF category in Institution setup.

## AISHE in one paragraph

The AISHE page compiles one survey year's data forms from the Data registers and the institution profile, with the year
before shown alongside. The survey year defaults to the latest locked year. It covers the profile, programmes and
admissions (also per programme), results, teaching and non-teaching staff, Ph.D., scholarships, infrastructure and
finance. The blocks are rules data (`apps/api/rules/aishe/survey.json`), and an empty value shows as "Not entered". The
consistency checker (`apps/api/rules/aishe/checks.json`) runs four kinds of check: on each register record (for example
women admitted ≤ admitted), on college totals, on year-on-year changes, and on the profile. Each finding is an "Error"
or a "Check" and says where to fix it. IQAC and the college admin can record what the college actually submitted to
AISHE, NIRF and NAAC (table `submitted_figures`). A submitted figure is flagged when it differs from the registers or
from what was submitted to another portal. Nothing is sent to any portal, and "Export data forms" downloads an Excel
workbook. The page is for college-wide dashboard viewers.

## Data registers in one paragraph

Faculty, student batches, research, activities, infrastructure and finance, and college figures (one record a year
with totals such as students on roll) are entered once per academic year on
the Data registers page and reused for NAAC, NBA, NIRF and AISHE. Each register's fields are configuration
(`apps/api/rules/registers/*.json`, loaded by the seed or `pnpm rules:import`), so forms, tables, checks and the Excel
import sheet are built from them. Records can be saved with gaps; missing required values and missing proof (approved
evidence) are counted and shown. IQAC, office staff and the college admin edit everything; HODs their department;
faculty their own profile and research; the principal and coordinators read. Students are batch totals, never
individual records. Locked years are read only, and last year's records can be copied into an empty year.

## Reports in one paragraph

IQAC, the principal and HODs (their departments only) create NAAC SSR and AQAR files on the Reports page: a full report
(Word and PDF), an evidence index (Excel), an evidence pack (ZIP, folders by criterion and metric) and a missing-items list
with task owners. Only finally approved evidence is used; missing documents are listed as missing, never filled in.
"Fix before export" lists the gaps first. Files are made by a background job, stored like evidence and downloaded with
short-lived links; every export stays in the history. Report layouts are rules data (`reports` in each framework
template). NAAC data tables, NBA SAR, NIRF and AISHE come with their data in Phase 2.

## Tasks and notifications in one paragraph

IQAC (any college) and HODs (their own department) give tasks to a person or a whole department, linked to a
metric document if they like, or create one task per missing NAAC document in one go. The board column comes
from the evidence uploaded for the task, and final approval completes it. Reminders (before the due date,
when overdue, repeating tasks, college key dates) come from a background sweep every 15 minutes that never
sends the same reminder twice. Every notification is in the app; email follows each person's choices, right
away or as a 9:00 / 17:00 India-time summary. Jobs run on Redis (BullMQ) when `REDIS_URL` is set, otherwise
inside the API. New people get an invite email to choose a password; "Forgot password?" sends a 60-minute,
one-time link and answers the same whether or not the email has an account.

## Audit log in one paragraph

Every change goes into an append-only audit log: the app's database role can add entries but never edit or delete
them. The college admin and the principal read it on the "Audit log" page. Anyone with "Manage permissions" or
college-wide "Manage users and setup" can open it too. The page shows who changed what and when, filtered by person,
kind of record and India dates. Each entry opens to show its before and after values; passwords, tokens and hashes
always show as "hidden". The page also offers a CSV download of up to 5,000 rows. A larger download is refused with a
request to narrow the filters, rather than cut short. Actions by the YuCampus team appear as "YuCampus support".

## Team panel in one paragraph

The YuCampus team works in `/admin` (admin.yucampus.yubhiantechnologies.in later) with its own accounts (`platform_admins`), its own
sign-in, a separate 12-hour refresh cookie, and access tokens with audience "platform". A college token is refused by
platform routes, and a platform token by college routes. The panel lists colleges with their profile, plan, status
and counts: people, people active in 30 days, evidence and storage, register records and last activity. It never
shows evidence, records or answers (DPDP Act). It reads each college through `forTenant()`, so row-level security
still applies. A team member can:
- set up a college through the `create_college()` database function, which invites its first college admin;
- change a college's plan label;
- suspend a college (no sign-in or refresh; sessions end within 15 minutes) and reactivate it;
- view the loaded rules read only;
- invite and disable team members.

Every action is kept in `platform_audit_logs`; actions that concern a college are also written to that college's own
audit log. Create the first team account on a server with `pnpm platform:create-admin "Name" email`, which prints a
one-time link (it needs `DATABASE_MIGRATE_URL`). Team sign-in has two steps. The password gives a 5-minute ticket, and the
ticket plus a code from an authenticator app (TOTP, built on `node:crypto`) gives the session. The secret is stored
encrypted with `TOTP_KEY`, or with `JWT_SECRET` if that is not set. Setting up the app gives 10 one-time recovery
codes, shown once. A code cannot be used twice, and wrong codes count towards the password lock. Another team member
can reset a lost authenticator.

## Sign-in with Google or Microsoft in one paragraph

A college admin turns Google and/or Microsoft sign-in on in Institution setup and lists the email domains allowed. SSO
is off by default. Only people already added to the college can sign in this way, matched by email; roles always come
from YuCampus. The flow is OpenID Connect with PKCE, state and nonce, built on `jose`. It runs on one fixed address
(`SSO_BASE_URL`: `auth.<ROOT_DOMAIN>` in production, `WEB_ORIGIN` locally), because providers accept only exact redirect
addresses. That address hands the person back to their college with a one-time code that lasts 60 seconds, which the
college's `/sso/finish` page swaps for a normal session. The buttons appear only on a server with `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` (or the Microsoft pair) set. Register the redirect address
`<SSO_BASE_URL>/api/v1/auth/sso/<google|microsoft>/callback` with each provider. Microsoft uses the "organizations"
endpoint: work and school accounts, not personal ones.
#   y u c a m p u s  
 