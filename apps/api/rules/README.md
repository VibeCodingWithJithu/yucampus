# Criteria templates

NAAC, NBA, NIRF and AISHE rules live in these files, never in code (CLAUDE.md rule 1).
The format is checked by `rulesTemplateSchema` in `packages/validation/src/rules.ts`.

| File | What it is | Metrics |
|---|---|---|
| `naac-raf-affiliated.json` | NAAC RAF, affiliated/constituent colleges. Extracted from the Affiliated College Manual (20-07-2023). | 56 |
| `naac-raf-autonomous.json` | NAAC RAF, autonomous colleges. Extracted from the Autonomous College Manual (29-03-2023, updated 09-08-2023). | 85 |
| `naac-raf-university.json` | NAAC RAF, universities. Extracted from the Simplified University Manual (29-03-2023, updated 09-08-2023). | 87 |
| `naac-raf-demo.json` | **Made-up demo metrics** used by automated tests. Never for a real college. | 15 |

The three NAAC files were extracted automatically from the manuals (in `/documents`, not in git). Checks done
on the extraction: the number of metrics and the qualitative/quantitative split match each manual's Table 1, and
each criterion's metric marks add up to its total (1,000 per manual). They are **not yet checked line by line**,
so `source.verified` is `false` and the app shows a warning on every NAAC screen.

## Checking a template (for an IQAC expert)

1. Open the review sheet in `review/` (e.g. `review/naac-raf-affiliated.md`). It lists every metric with its
   code, type, marks, years and documents, and the manual line it came from. Items to look at first are at the top.
2. Compare each metric with the manual and tick it. Note corrections.
3. Make the corrections in the template file, set `"verified": true` under `source`, and import it again.
   Once verified, a template may be made `"status": "active"`.

## Loading a template

```sh
pnpm rules:import rules/naac-raf-affiliated.json      # from apps/api
```

Uses `DATABASE_MIGRATE_URL` (the owner role; the app can only read rules). The seed loads all four files above.

## Rules

- `source.verified` is `true` only after someone has checked every line against the official manual.
  The importer refuses to make an unverified template `active`.
- An `active` version is never changed in place. To change wording, copy the file, raise `version`, and import it.
  Evidence linked to the old version keeps its meaning.
- A metric with evidence linked to it cannot be removed.
- Each metric lists `requiredDocuments` and its `weight` (marks). A metric's readiness is the share of its required
  documents with at least one finally approved evidence item in the years it covers (`yearsRequired`). A
  criterion's readiness is the marks-weighted average of its metrics; overall readiness is weighted by criterion marks.
- `reports` lists the reports a framework can produce (e.g. NAAC `SSR` and `AQAR`), each with a layout `version`, a
  `name`, a `description` and a `period`: `cycle` (every year each metric covers) or `year` (one academic year, chosen
  when exporting). The version shows in the export history. A report layout that past exports used is kept.

## Data registers

`rules/registers/*.json` describe the data registers (fields, which reports they feed, whether a record links a person,
a department and proof). They are checked by `registerDefinitionSchema` in packages/validation and loaded with the same
`pnpm rules:import` command. A version that colleges have records in can gain fields, but fields cannot be removed or
change type; publish a new version for that. The first field lists are a proposal (`source.verified: false`) until an
IQAC expert compares them with the current NAAC, NIRF and AISHE formats.
