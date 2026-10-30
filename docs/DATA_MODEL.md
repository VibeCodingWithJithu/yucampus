# Data model

The live schema is apps/api/prisma/schema.prisma. Every tenant-owned table has college_id and a row-level
security policy. "(planned)" marks entities decided but not built yet.

Tenancy & people
- College(id, name, type[affiliated|autonomous|university], subdomain, state, plan, status[active|suspended], settings)
  // status set by the platform only (2026-10-18); a suspended college cannot sign in or refresh tokens
  // settings.sso = { google: bool, microsoft: bool, domains: string[] } (2026-10-21), off by default
- SsoHandoff(id, college_id, user_id, provider[google|microsoft], code_hash, expires_at, used_at?)  // one-time code
  // that carries a finished SSO sign-in back to the college's own address; 60 seconds (2026-10-21)
  // settings holds profile extras (city, AISHE code, affiliating university, year established) and
  // approval_levels (1 or 2, default 2)
- User(id, college_id, name, email, mobile, password_hash, status[active|invited|not_joined], failed_logins, locked_until)
- Role(code: super_admin|college_admin|principal|iqac|hod|nba_coord|nirf_coord|faculty|office)
- UserRole(user_id, role, department_id?)  // a person can hold several duties; hod and faculty need a department.
  // The head of department is the user holding the hod role for it (at most one per department).
- Department(id, college_id, name, code)
- Program(id, college_id, department_id, name, level[UG|PG|Diploma|PhD], discipline (planned))
- AcademicYear(id, college_id, label, start, end, status[current|locked|next], terms json)
  // at most one current and one next per college; locked years are read only
- KeyDate(id, college_id, academic_year_id, title, date, reminder_rule)
- OtpCode(id, college_id, mobile, code_hash, expires_at, attempts, consumed_at) ; RefreshToken(id, college_id, user_id, token_hash, expires_at, revoked_at)

Permissions (planned, decided 2026-10-14; see docs/PRODUCT.md "Permissions")
- Permission(code, label, scopes_allowed[])  // global catalogue, e.g. evidence.upload, evidence.approve_department,
  // evidence.approve_final, dashboards.view, reports.generate, users_setup.manage, permissions.manage, registers.edit
- RolePermissionTemplate(role, permission, scope[college|department|own|nba|nirf], version)  // global defaults shipped by YuCampus
- CollegeRolePermission(college_id, role, permission, scope, allowed, changed_by, changed_at)  // a college's
  // adjustments on top of the template; no row = template default. Every change is audit-logged.
- Effective permissions of a user = union over their UserRole rows of (template + college adjustment), with
  department scope bound to that UserRole's department. Computed on the server; the web app only hides what the
  API would refuse anyway.

Rules as configuration (global, versioned; colleges reference a version)
- Framework(id, body[NAAC|NBA|NIRF|AISHE], code, version, valid_from, status)
  // NAAC: NAAC_RAF, NAAC_BINARY_MBGL. NBA: one per discipline and tier, e.g. NBA_ENGG_TIER1, NBA_ENGG_TIER2,
  // NBA_PHARMACY, NBA_MANAGEMENT. NIRF: one per category, e.g. NIRF_OVERALL, NIRF_ENGINEERING, NIRF_MANAGEMENT.
- Criterion(id, framework_id, number, name, weights json (by institution type), applies_to_institution_types[])
- Metric(id, criterion_id, code, name, plain_language, type[quantitative|qualitative], years_required, required_documents json)
- ReportTemplate(id, framework_id, kind[SSR|AQAR|SAR|NIRF_SHEET|AISHE], version, layout json)
- TaskTemplate(id, name, framework_id, tasks json)

Which frameworks apply (planned changes, decided 2026-10-14)
- AssessmentCycle(id, college_id, body, label e.g. "NAAC cycle 3", start, end, status[planned|active|closed])
- CollegeFramework(id, college_id, framework_id, cycle_id?, active, adopted_at, retired_at)
  // many rows per body. NAAC: several versions may be on file, at most one active per cycle (partial unique
  // index). NIRF: one active row per category the college takes part in (the college's NIRF categories).
  // Replaces the current one-row-per-framework table; existing rows become active rows.
- ProgramFramework(id, college_id, program_id, framework_id, cycle_id?, active)  // NBA attaches per program;
  // the framework encodes discipline and tier, so Program.nba_tier is removed.

Evidence & workflow
- Evidence(id, college_id, academic_year_id, department_id, uploaded_by, file_key, file_type, file_size, title,
  status[in_review|department_approved|approved|needs_fix|rejected], version, extracted json, ai_confidence)
  // department_approved is used only when the college has two approval levels; only "approved" (final)
  // evidence counts in readiness and reports.
- EvidenceMetric(evidence_id, metric_id)  // one document can count for several metrics
- ReviewAction(id, evidence_id, user_id, level[department|final], action, comment, at)
- Task(id, college_id, title, metric_id?, assignee (user/department), due, repeat_rule, reminder_rule, status)
- Comment(id, college_id, entity_type, entity_id, user_id, body, at)
- Notification(id, user_id, kind, text, link, read_at) ; NotificationPreference(user_id, event, channels[])

Data registers (entered once, reused by many metrics; configurable, decided 2026-10-17)
- RegisterDefinition(id, code[FACULTY|STUDENT_BATCHES|RESEARCH|ACTIVITIES|INFRA_FINANCE|COLLEGE_FIGURES], version, name,
  description, fields json, feeds json, proof[none|optional|required], person_field?, single_per_year, status,
  source{title, verified})  // single_per_year: at most one record per year (College figures)
  // global rules data, loaded from apps/api/rules/registers like criteria templates
- RegisterRecord(id, college_id, definition_id, academic_year_id, department_id?, user_id? (linked person),
  data jsonb (field key -> value), created_by, updated_by, created_at, updated_at)
  // students are batch totals, never one record per student (DPDP Act)
- RegisterRecordEvidence(record_id, evidence_id, college_id)  // proof
- Metric.data_source json (built 2026-10-17; was "MetricDataSource")  // how a metric pulls register data: measures
  // {key, label, register, op[count|sum], fields?, where{field: values[]}, atLeast{field: n}} per academic year,
  // and ratios between them.
  // Part of the criteria template (rules), so it is versioned and unverified until the template is checked.

NBA (decided 2026-10-17)
- Program.nba_settings json  // attainment rules; defaults DEFAULT_ATTAINMENT_RULES in packages/types
- Program.nba_profile json  // vision, mission, PEOs [{code, statement}] for SAR criterion 1
- ProgramOutcome(id, college_id, program_id, kind[PO|PSO], code, statement, sort_order)  // POs copied from
  // apps/api/rules/nba/program-outcomes.json for engineering programs (read only); PSOs written by the program
- Course(id, college_id, program_id, academic_year_id, code, name, semester?, teacher_id?, status[draft|locked],
  locked_by?, locked_at?)
- CourseOutcome(id, college_id, course_id, code, statement, sort_order, indirect_level?)  // indirect: course exit survey
- CoPoMapping(college_id, course_outcome_id, program_outcome_id, strength[1-3])
- AssessmentResult(id, college_id, course_id, course_outcome_id, kind[internal|end_exam], name, attempted, reached)
  // CO totals only, never individual students' marks
- Attainment is computed, not stored: level per assessment kind -> direct -> final -> PO attainment.

Platform (Yubhian team; decided 2026-10-18). Global tables: no college_id and no row-level security.
- PlatformAdmin(id, email unique, name, password_hash, status[active|invited|disabled], failed_logins, locked_until,
  last_sign_in_at, invited_by?, created_at, totp_secret? (encrypted), totp_confirmed_at?, totp_last_step?)
  // totp_secret: AES-256-GCM with a key derived from TOTP_KEY (or JWT_SECRET); last_step stops a code being reused
- PlatformRecoveryCode(id, admin_id, code_hash, used_at?)  // 10 one-time codes, only hashes stored (2026-10-21)
- PlatformRefreshToken(id, admin_id, token_hash, expires_at, replaced_at?, created_at)
- PlatformPasswordLink(id, admin_id, token_hash, expires_at, used_at?)  // invite links for platform admins
- PlatformAuditLog(id, admin_id?, action, college_id?, detail json, at)  // append-only
- create_college(name, type, subdomain, state, plan): SECURITY DEFINER function, the only way the app role can add a
  college (INSERT on colleges stays revoked)

AISHE and consistency checks (decided 2026-10-18)
- Rules files, not tables: apps/api/rules/aishe/survey.json (blocks of data items, each a register measure like a
  metric data source; a block can be per programme) and apps/api/rules/aishe/checks.json (record, total, change and
  profile checks with level error|check, and the list of common figures colleges submit to several portals).
- SubmittedFigure(id, college_id, academic_year_id, portal[AISHE|NIRF|NAAC], figure_key, value numeric, note?,
  updated_by, updated_at)  unique (college_id, academic_year_id, portal, figure_key)
  // what the college actually typed into a portal; compared with the registers and across portals
- Findings are computed, not stored.

Surveys
- Survey(id, college_id, template_code, title, audience, academic_year_id, course_id?, status[draft|open|closed],
  public_token (unique), expected_responses?, closes_at?, created_by)  (decided 2026-10-17)
- SurveyQuestion(id, college_id, survey_id, sort_order, kind[rating|comment], text, scale[3|5], course_outcome_id?)
- SurveyResponse(id, college_id, survey_id, device_hash (unique per survey), submitted_at)  // anonymous: no person
- SurveyAnswer(college_id, response_id, question_id, rating?, comment?)
- survey_college_id(token): SECURITY DEFINER lookup so the public form can find its college before any tenant is set

Reports
- ExportJob(id, college_id, template_id, label, params{academic_year_id?, department_ids?, program_id?}, outputs[report|index|pack|missing],
  status, created_by, files[{key, name, kind, size}], error, created_at, finished_at)

Audit
- AuditLog(id, college_id, user_id, entity, entity_id, action, before json, after json, at)
