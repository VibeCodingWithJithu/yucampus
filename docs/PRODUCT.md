# Product

## Problem
Colleges spend months collecting evidence and formatting NAAC SSR/AQAR, NBA SAR and NIRF data at the last minute.
Evidence is scattered (email, drives, WhatsApp), the same numbers are retyped for every portal, and rules change often
(NAAC moved from the 7-criteria RAF to Binary accreditation + Maturity-Based Graded Levels; One Nation One Data cross-checks figures).

## Target customers
Affiliated and autonomous colleges and private/state universities in India, starting with Andhra Pradesh
(engineering, pharmacy, MBA/MCA first). IITs/NITs later, mainly for NIRF and government reporting.

## Roles
- Super admin (Yubhian team): manages colleges (tenants), templates/rules, subscriptions.
- College admin: institution setup, departments, programs, users, academic years, permissions.
- Principal / Dean: views everything, downloads reports, manages users. Uploading evidence is optional (off by default).
- IQAC coordinator: tasks, final approval in the review queue, readiness tracking, reports, surveys.
  Manages users and setup only if the principal grants it.
- HOD: department dashboards and reports, department-level approval, reminders; invites and manages faculty
  of their own department only.
- NBA coordinator: CO-PO mapping, attainment, SAR; reviews NBA evidence.
- NIRF coordinator: NIRF data sheets and NIRF reports.
- Faculty: upload evidence (mostly from phone), see own tasks and own uploads.
- Office/cell staff: maintain data registers.

A person can hold several roles (e.g. faculty + HOD of CSE + NBA coordinator); they get everything any of
their roles allows.

## Permissions (decided 2026-10-14)
Access is decided by permissions, not by role names. A role is only a default set of permissions.

- YuCampus ships default permission templates for every role (table below). Each college admin can adjust what
  each role may do in their college. The principal can grant or remove "Manage users and setup" for IQAC.
- Some permissions have a scope: whole college, own department, own items, or one body (NBA / NIRF only).
- Safety rules that no college setting can change:
  - only a college admin can give, remove or edit the college admin role or change permissions of the college admin role;
  - nobody can remove their own permission to manage users (so a college can never lock itself out);
  - a college never sees another college's data, whatever its permissions say.

Default templates ("Dept" = own department only, "Own" = own uploads only, "NBA"/"NIRF" = that body only):

| Permission | College admin | Principal | IQAC | HOD | NBA coord. | NIRF coord. | Faculty | Office |
|---|---|---|---|---|---|---|---|---|
| Upload evidence | – | optional (off) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Approve evidence, department level | – | – | – | Dept | – | – | – | – |
| Approve evidence, final | – | – | ✓ | – | NBA | – | – | – |
| View dashboards | ✓ | ✓ | ✓ | Dept | ✓ | ✓ | Own | – |
| Generate and download reports | ✓ | ✓ | ✓ | Dept | NBA | NIRF | – | – |
| Manage users and setup | ✓ | ✓ | if granted by principal | Dept faculty only | – | – | – | – |
| Manage permissions | ✓ | IQAC "users and setup" only | – | – | – | – | – | – |
| Maintain data registers | ✓ | view | ✓ | Dept | view | view | Own | ✓ |
| Manage NBA courses and outcomes | – | – | ✓ | Dept | ✓ | – | Own courses | – |

Proposed, to confirm: the College admin, NIRF coordinator and Office columns are not in the approved design; they
are a first proposal. The "Maintain data registers" row was confirmed on 2026-10-17: "view" means people who view
college dashboards can read registers but not change them; faculty ("Own") edit only their own faculty profile and
their own research entries.

## NBA outcomes (decided 2026-10-17)
- Each program has its program outcomes: NBA's POs (copied from a rules file for engineering programs, read only) and
  the program's own PSOs. Courses belong to a program and an academic year, with a course teacher.
- The course teacher enters the course outcomes (COs), the CO–PO/PSO mapping (strength 1–3) and the assessment
  results. The HOD or NBA coordinator ("Manage NBA courses and outcomes") adds courses, assigns teachers, sets the
  program's attainment rules and locks a course for the semester; locked courses are read only and count.
- Direct attainment is entered as CO totals per assessment: students who attempted and students who reached the target
  mark. No individual student's marks are stored (DPDP Act).
- Default attainment rules, changeable per program: target mark 60%; level 3 if at least 70% of students reach it,
  level 2 at 60%, level 1 at 50%; direct = 40% internal + 60% end exam; final = 80% direct + 20% indirect (course
  exit survey, entered as a level per CO until surveys fill it); CO target 2.0 of 3.
- PO attainment of a course = mapping-strength-weighted average of its COs' final attainment; a program's PO
  attainment = average over its locked courses.
- SAR (2026-10-17): one per program and academic year, on the Reports page (Word, PDF, an outcome data workbook and a
  missing-items list). Its criteria list is a rules file (apps/api/rules/nba/sar.json, not yet checked against the
  current NBA format). It compiles what YuCampus holds: vision, mission and PEOs (entered on the NBA page), courses by
  semester, COs, CO–PO matrices and attainment (locked courses only), the program's student batches and the
  department's faculty, research and facilities for the last three years. Criteria YuCampus does not hold data for are
  marked "not compiled yet", never filled in. Who may create it: reports.generate at college or NBA scope (all programs)
  or department scope (their programs).

## NIRF (decided 2026-10-18)
- The NIRF page shows data readiness for each NIRF category the college applies in, for the last three academic years:
  completeness per year, per parameter (TLR, RP, GO, OI, PR) and per sub-parameter, with the numbers themselves.
  YuCampus does not compute a score or rank; NIRF does that from the data sheets.
- What each sub-parameter needs is rules data (apps/api/rules/nirf/parameters.json, not yet checked against the current
  NIRF methodology), using the same register measures as NAAC metrics. Parameter weights are shown only where checked
  values are known; otherwise left out.
- Data the registers did not hold was added as register fields: PhD students and PhD graduates, accessible facilities
  (College figures); students from other states and countries, and students with full fee reimbursement (Student batches).
- Perception (PR) is collected by NIRF through its own surveys, so it has no data items here.
- "Ask someone" gives a sub-parameter's data collection to a person or department as a task. "Export data sheets"
  downloads an Excel workbook with every item for the three years.
- Who: the NIRF coordinator (reports.generate, NIRF) and college-wide dashboard viewers.

## AISHE and consistency checks (decided 2026-10-18)
- AISHE has no public API, so the college still types its figures into the AISHE portal. YuCampus prepares them: the
  AISHE page compiles one survey year's data forms from the Data registers and institution setup. No separate AISHE
  entry forms (enter once, reuse).
- The survey year is an academic year (by default the latest locked year, otherwise the current one); the year before
  is shown next to it. Blocks: institution profile, programmes and admissions (per programme), examination results
  (per programme), teaching staff (by designation, gender and social category), non-teaching staff, Ph.D.,
  scholarships and fee reimbursement, infrastructure, and finance. An empty value shows as "Not entered", never as 0.
- Which blocks and items exist is rules data (apps/api/rules/aishe/survey.json, not yet checked against the current
  AISHE data capture format). Student batches hold admissions per batch, not students on roll in every year of study;
  the page says so and shows the College figures total on roll next to them.
- "Ask someone" gives a block's data to a person or department as a task. "Export data forms" downloads an Excel
  workbook: one sheet per block, with the checker's findings.
- Consistency checker, on the same page (rules data: apps/api/rules/aishe/checks.json, not yet checked):
  - Record checks on each register record, e.g. women, SC, ST, OBC and EWS admissions within admitted, passed within
    appeared, placed plus higher studies within passed. Each finding names the record so it can be fixed.
  - Total checks across registers, e.g. Ph.D. students within students on roll, teachers on sanctioned posts within
    sanctioned posts.
  - Year-on-year checks: a figure that changed more than the rules allow (e.g. 30%) since the year before.
  - Profile checks: AISHE code, affiliating university and year of establishment entered.
  - Two levels: "Error" (the figures cannot both be right) and "Check" (unusual; confirm it is right).
- Submitted figures: for the common figures (students on roll, admissions, women students, full-time teachers,
  teachers with Ph.D., sanctioned posts, expenditure excluding salary, placed, Ph.D. students, and so on), the college
  records what it actually submitted to AISHE, NIRF and NAAC for a year. The checker flags a submitted figure that
  differs from the registers, and the same figure submitted differently to two portals. Nothing is sent to any portal.
- Who: college-wide dashboard viewers (IQAC, principal, college admin, NIRF coordinator) see the page and the checker;
  those who also maintain registers college-wide (IQAC, college admin) record submitted figures. Office staff keep
  entering the data in the registers. No new role or permission.

## Sign-in with Google or Microsoft (decided 2026-10-21)
- A college can let its people sign in with their Google or Microsoft (Office 365) account. Off by default. In
  Institution setup the college admin turns Google and/or Microsoft on and lists the email domains allowed
  (e.g. srec.ac.in). Password and mobile-code sign-in keep working alongside.
- Only people the college has already added can sign in this way, matched by their email address (and the address
  must be on an allowed domain). An unknown email is refused with "ask your college admin to add you". Roles always
  come from YuCampus, never from Google or Microsoft. A first SSO sign-in turns an invited person into an active one.
- A suspended college cannot sign in this way either. Each SSO sign-in is in the audit log with its provider.
- YuCampus registers one app with Google and one with Microsoft (any organisation's account). Until a server has
  them configured, the buttons do not appear and the setup section says SSO is not available yet.

## Super-admin panel and audit log (decided 2026-10-18)
- The Yubhian team has separate platform accounts, not college accounts: their own sign-in (/admin, later
  admin.yucampus.yubhiantechnologies.in) and their own token type. A platform token cannot call college APIs and a college token cannot
  call platform APIs. The first platform admin is created with a command on the server; platform admins invite
  others from the panel.
- What the team sees of a college: its profile, status and plan, the college admins' and principal's contact details,
  counts (users, people active in the last 30 days, evidence items and storage used, register records), the frameworks
  in use and the date of last activity. Never evidence files, register records, survey answers or other personal data
  (DPDP Act). Consent-based support access, where a college lets support look at its screens for a limited time, may
  come later.
- What the team does: onboard a college (name, type, state, subdomain, first college admin, who gets an invite email),
  change its plan label, suspend it and reactivate it. A suspended college cannot sign in; people already signed in
  are stopped at their next token refresh (within 15 minutes). Nothing is deleted from the panel.
- Rules (criteria templates, registers, NBA, NIRF, AISHE, surveys) stay versioned files in the repo, loaded by a
  deploy command. The panel shows them read only: version, whether checked against the official format, and how many
  colleges use each framework.
- Every platform action is recorded in a platform audit log; one that concerns a college is also recorded in that
  college's own audit log as "YuCampus support".
- Colleges see their audit log on an "Audit log" page: the college admin and the principal (anyone with "Manage
  permissions" or college-wide "Manage users and setup"). It lists who changed what and when, with filters by
  person, kind of record and date, the before and after values, and a CSV download of the filtered list (up to 5,000
  rows; narrower filters for more).
- Two-step sign-in for the team (decided 2026-10-21): after the password, a 6-digit code from an authenticator app
  (TOTP, as Google Authenticator or Microsoft Authenticator use). It is required for every team member: someone without
  one sets it up at their first sign-in by scanning a QR code, and gets 10 one-time recovery codes, shown once. A
  recovery code can stand in for the app's code. A team member who loses their phone asks another team member to
  reset their authenticator; their sessions end and they set it up again at next sign-in. Wrong codes count towards
  the same lock as wrong passwords, and a code cannot be used twice. College sign-in does not change.

## Surveys (decided 2026-10-17)
- Templates are rules data (apps/api/rules/surveys/templates.json): student satisfaction, course exit, alumni,
  employer, parent and teacher feedback on the curriculum, each with its questions and the reports it feeds.
- People answer through an open link or a QR code, without signing in. Answers are anonymous and YuCampus keeps no list
  of students, alumni, parents or employers (DPDP Act). One answer per device; reminders mean sharing the link again.
- Rating questions use 1–5, except course exit surveys: one question per CO on a 1–3 scale (3 strongly agree,
  2 agree, 1 disagree). When a course exit survey closes, each CO's average becomes its NBA indirect attainment (if the
  course is not locked).
- Written comments are listed as written (newest first, searchable). An AI summary may come in the AI phase, marked as
  a suggestion.
- IQAC (surveys.manage, college) runs every kind; the NBA coordinator (surveys.manage, NBA) runs course exit surveys;
  a course's teacher, HOD or NBA coordinator can start its course exit survey from the course page.
- WhatsApp sending comes with the WhatsApp channel (Phase 3); for now the link and QR code are shared by hand.

## Data registers (decided 2026-10-17)
- Records are entered once and reused for NAAC data tables, NBA, NIRF and AISHE.
- Registers are configurable: each register's fields and the reports it feeds live in versioned rules files
  (apps/api/rules/registers), like criteria templates. Forms, tables, Excel import and checks are built from them.
- First registers: Faculty, Student batches, Research, Activities, Infrastructure and finance, and College figures
  (added 2026-10-17: one record per year with totals such as students on roll, sanctioned posts and total expenditure
  excluding salary, which several NAAC ratios divide by). Each record belongs to
  an academic year (and a department where it has one); locked years are read only.
- Students are kept as batch totals per program (enrolled, by category, passed, placed, higher studies), not one
  record per student, so no individual student's personal data is stored (DPDP Act).
- A faculty profile can be linked to a YuCampus user (then that person can update it), but profiles can also exist
  for staff who never sign in (retired, visiting, past years).
- Records can link approved evidence as proof. Missing required fields and missing proof are counted and shown.
- The field lists are YuCampus's first proposal and are marked "not yet checked" until an IQAC expert compares them
  with the current NAAC, NIRF and AISHE formats.
- Metrics pull their numbers from registers through a data source in the criteria template (2026-10-17): per academic
  year counts and sums (e.g. UGC CARE papers, full-time teachers) and simple ratios between them. YuCampus shows these
  inputs on the metric page and in SSR/AQAR files; it does not compute NAAC's score. A metric is mapped only where its
  wording can be met from the registers; others say what data is needed.

## Evidence approval
Each college chooses one or two approval levels (setting, default two):
- Two levels: faculty uploads -> HOD approves for the department -> IQAC gives final approval.
- One level: faculty uploads -> IQAC approves.
Either reviewer can send an item back ("needs fix") or reject it, with a comment. Only finally approved evidence
counts towards readiness or appears in a report. AI suggestions never skip a level.

## Frameworks (decided 2026-10-14)
- NAAC: a college may have several framework versions on file (e.g. RAF and Binary/MBGL), but only one is active
  for each assessment cycle. Switching keeps all data.
- NBA: frameworks attach to programs, not to the college. The format depends on the discipline (engineering,
  pharmacy, management, …) and the tier (Tier I or Tier II).
- NIRF: a college can take part in several categories at once (e.g. Overall + Engineering + Management).
- AISHE: one yearly survey per college.

## Modules (brand: "YuCampus <Module>")
- Core: login (mobile OTP, email+password, Google/Microsoft SSO), institution setup, users & roles,
  academic year & calendar, notifications (in-app, email, WhatsApp), tasks with templates and reminders,
  evidence library, data registers (faculty, students, research, activities, infrastructure & finance).
- Accredit NAAC: framework selection (RAF or Binary/MBGL), criteria dashboard, metric detail, readiness check,
  SSR/AQAR generation, DVV evidence packs.
- Accredit NBA: programs (Tier I/II), CO entry, CO-PO-PSO mapping, attainment (direct/indirect weighting), SAR.
- Rank NIRF: 3-year data, parameters (TLR, RP, GO, OI, PR), sub-parameter data sheets, consistency checks.
- Report AISHE / One Nation One Data: data forms, cross-portal consistency checker.
- Smart upload (AI): OCR + extraction + suggested criterion mapping + confidence + duplicate/date checks.
- Surveys & feedback: student satisfaction, course exit, alumni, employer, parent; WhatsApp/email/QR; results feed NAAC/NBA.
- Reports & export: portal-ordered Excel data sheets, Word/PDF reports, ZIP evidence packs, fix-before-export list, export history.
- Future: placements, exams, alumni, AICTE approval data, NBA outcomes setup, peer visit kit, audit log, DVV responses, billing.

## Core loop (build first)
Setup -> faculty upload -> IQAC review/approve -> readiness tracking -> export.

## Business model
Yearly subscription per college (by size and modules). Sales via free online demo; onboarding and training online.
