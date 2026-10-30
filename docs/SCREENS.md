# Screens (design files in design-reference/screens)

| Screen | File | Main users |
|---|---|---|
| Sign in | Login.dc.html | Everyone |
| Principal dashboard | Main.dc.html | Principal, Dean |
| Faculty mobile home | FacultyMobile.dc.html | Faculty |
| IQAC review with AI extraction | SmartUpload.dc.html | IQAC |
| NAAC criteria (RAF / Binary-MBGL switch) | NaacCriteria.dc.html | IQAC |
| NAAC metric detail | MetricDetail.dc.html | IQAC, metric owners |
| NBA CO-PO mapping and attainment | CoPoMatrix.dc.html | NBA coordinator, faculty |
| NIRF data readiness | NirfDashboard.dc.html | NIRF/IQAC |
| Tasks | AssignTasks.dc.html | IQAC, HODs |
| Evidence library | EvidenceLibrary.dc.html | IQAC, HODs |
| Data registers | DataRegisters.dc.html | HODs, office, cells |
| Surveys and feedback | Surveys.dc.html | IQAC, NBA |
| Reports and export | ReportsExport.dc.html | IQAC |
| Notifications | Notifications.dc.html | Everyone |
| Institution setup | AdminSetup.dc.html | College admin |
| Users and roles | AdminUsers.dc.html | College admin |
| Academic year and calendar | AcademicYear.dc.html | College admin |
| Shared sidebar | Sidebar.dc.html | All desktop screens |

Notes: the .dc.html files are HTML with inline styles plus a small script returning sample data.
Recreate them as React components with Tailwind; do not copy the design-tool runtime (support.js, sc-for, sc-if).
Data in them is dummy sample data.
