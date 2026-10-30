-- Institution setup.

-- The head of department is whoever holds the "hod" role for that department (user_roles).
-- A second copy on departments could disagree with it, so it goes.
ALTER TABLE "departments" DROP COLUMN "hod_user_id";

-- Semesters of each academic year.
ALTER TABLE "academic_years" ADD COLUMN "terms" JSONB NOT NULL DEFAULT '[]';

-- Postgres treats NULLs as different by default, so a college-wide duty (department_id NULL) could be given
-- to the same person twice. NULLS NOT DISTINCT closes that.
DROP INDEX "user_roles_user_id_role_department_id_key";
CREATE UNIQUE INDEX "user_roles_user_id_role_department_id_key"
  ON "user_roles"("user_id", "role", "department_id") NULLS NOT DISTINCT;

-- One head per department.
CREATE UNIQUE INDEX "user_roles_one_hod_per_department"
  ON "user_roles"("department_id") WHERE "role" = 'hod';

-- Department-scoped duties must name a department; college-wide duties must not.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_department_scope" CHECK (
  ("role" IN ('hod', 'faculty') AND "department_id" IS NOT NULL)
  OR ("role" NOT IN ('hod', 'faculty'))
);

-- Only one current and one next year per college at a time.
CREATE UNIQUE INDEX "academic_years_one_current" ON "academic_years"("college_id") WHERE "status" = 'current';
CREATE UNIQUE INDEX "academic_years_one_next" ON "academic_years"("college_id") WHERE "status" = 'next';
