# YuCampus · project memory for Claude Code

YuCampus (by Yubhian Technologies LLP) is a multi-tenant SaaS that keeps Indian colleges
accreditation-ready all year: NAAC, NBA, NIRF and AISHE. Faculty upload evidence, AI suggests
where it belongs, IQAC approves, dashboards track readiness, and the app exports portal-ready reports.

Read these before any task:
- docs/PRODUCT.md        what we are building, users, roles, modules
- docs/ARCHITECTURE.md   tech stack, monorepo, multi-tenancy, security
- docs/DATA_MODEL.md     database entities and relationships
- docs/DESIGN_SYSTEM.md  colours, type, spacing, components
- docs/SCREENS.md        every screen, what it contains, its design file
- docs/ROADMAP.md        build order and phases
- design-reference/screens/*.dc.html   approved UI designs (HTML with inline styles; treat as the visual spec)
- design-reference/logo/               official logo files

## Non-negotiable rules
1. Rules are configuration, never hard-coded. NAAC (RAF 7 criteria AND Binary/MBGL 10 criteria), NBA, NIRF
   and AISHE criteria, metrics, assessment periods and report formats live in versioned DB templates.
2. Multi-tenancy: every tenant-owned row has college_id. Enforce with PostgreSQL row-level security AND
   service-layer checks. One college must never see another college's data.
3. AI only suggests. Nothing enters a report until an IQAC user approves it. Never invent or inflate data.
4. Slow work (OCR, AI extraction, report generation, bulk import, notifications) runs as background jobs.
5. Files upload directly to object storage with pre-signed URLs; never stream large files through the API.
6. Data stays in India (Mumbai/Hyderabad regions). Follow India's DPDP Act: consent, purpose, export, deletion.
7. Frontend is fully API-driven (so the same UI can become a PWA, Tauri desktop app and React Native app).
8. Shared TypeScript types and Zod schemas live in packages/, not duplicated in apps.
9. Accessibility: labelled inputs, 44px touch targets, keyboard navigation, text labels on every status colour.
10. YuCampus is not affiliated with NAAC, NBA, NIRF, AISHE or AICTE. Never use their logos.

## Working style
- Build one module at a time following docs/ROADMAP.md. Ask before large structural changes.
- Write tests for business rules (permissions, tenancy, calculations such as CO-PO attainment).
- Use sample/dummy data only; never real student or faculty data in seeds or tests.
- Keep UI copy short, plain English, friendly to non-technical faculty.
