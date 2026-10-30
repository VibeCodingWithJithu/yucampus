// Runs the real migration SQL in an in-process Postgres (PGlite), so tenant isolation is tested on every
// run without Docker. All data here is dummy.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../prisma/migrations');

/** Global rule tables: deliberately not tenant-owned. */
const GLOBAL_TABLES = ['frameworks', 'criteria', 'metrics', 'register_definitions', 'report_templates', 'task_templates'];
/** The YuCampus team's own tables (platform panel): global, hold no college data, used only by the platform module. */
const PLATFORM_TABLES = ['platform_admins', 'platform_audit_logs', 'platform_password_links', 'platform_recovery_codes', 'platform_refresh_tokens'];

let db: PGlite;
let collegeA: string;
let collegeB: string;

async function asApp(collegeId: string | null) {
  await db.exec('SET ROLE yucampus_app');
  await db.query(`SELECT set_config('app.college_id', $1, false)`, [collegeId ?? '']);
}

async function asOwner() {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('app.college_id', '', false)`);
}

beforeAll(async () => {
  db = new PGlite();
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
  }

  const colleges = await db.query<{ id: string; subdomain: string }>(`
    INSERT INTO colleges (name, type, subdomain, state, updated_at) VALUES
      ('Sample College A', 'affiliated', 'sample-a', 'Andhra Pradesh', now()),
      ('Sample College B', 'autonomous', 'sample-b', 'Andhra Pradesh', now())
    RETURNING id, subdomain`);
  collegeA = colleges.rows.find((row) => row.subdomain === 'sample-a')!.id;
  collegeB = colleges.rows.find((row) => row.subdomain === 'sample-b')!.id;

  await db.query(
    `INSERT INTO departments (college_id, name, code) VALUES
       ($1, 'Computer Science', 'CSE'), ($1, 'Electronics', 'ECE'), ($2, 'Pharmacy', 'PHARM')`,
    [collegeA, collegeB],
  );
  await db.query(
    `INSERT INTO users (college_id, name, email, updated_at) VALUES
       ($1, 'Sample User A', 'a@example.test', now()),
       ($2, 'Sample User B', 'b@example.test', now()),
       (NULL, 'Sample Super Admin', 'admin@example.test', now())`,
    [collegeA, collegeB],
  );
  await db.query(
    `INSERT INTO audit_logs (college_id, entity, entity_id, action) VALUES ($1, 'department', 'x', 'create')`,
    [collegeA],
  );
  await db.exec(
    `INSERT INTO frameworks (body, code, version, name, status) VALUES ('NAAC', 'NAAC_RAF', 'test', 'Test', 'active')`,
  );
}, 60_000);

afterEach(asOwner);
afterAll(() => db.close());

describe('row-level security coverage', () => {
  it('protects every table that has a college_id column, and colleges itself', async () => {
    const { rows } = await db.query<{ table_name: string; rls: boolean; policies: number }>(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND (c.relname = 'colleges' OR EXISTS (
          SELECT FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'college_id'))`);

    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => !row.rls || row.policies === 0).map((row) => row.table_name)).toEqual([]);
  });

  it('has no table that is neither tenant-owned nor a known global table', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(rows.map((row) => row.relname).sort()).toEqual([...GLOBAL_TABLES, ...PLATFORM_TABLES].sort());
  });
});

describe('tenant isolation for the app role', () => {
  it('shows a college only its own rows', async () => {
    await asApp(collegeA);
    const departments = await db.query<{ code: string }>('SELECT code FROM departments ORDER BY code');
    expect(departments.rows.map((row) => row.code)).toEqual(['CSE', 'ECE']);
    const users = await db.query<{ email: string }>('SELECT email FROM users');
    expect(users.rows.map((row) => row.email)).toEqual(['a@example.test']);
    const colleges = await db.query<{ id: string }>('SELECT id FROM colleges');
    expect(colleges.rows.map((row) => row.id)).toEqual([collegeA]);

    await asApp(collegeB);
    const other = await db.query<{ code: string }>('SELECT code FROM departments');
    expect(other.rows.map((row) => row.code)).toEqual(['PHARM']);
  });

  it('shows nothing when no college is set', async () => {
    await asApp(null);
    for (const table of ['colleges', 'departments', 'users', 'audit_logs']) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0]!.n, table).toBe(0);
    }
  });

  it('cannot write into another college', async () => {
    await asApp(collegeA);
    await expect(
      db.query(`INSERT INTO departments (college_id, name, code) VALUES ($1, 'Intruder', 'BAD')`, [collegeB]),
    ).rejects.toThrow(/row-level security/);

    const updated = await db.query(`UPDATE departments SET name = 'Hacked' WHERE college_id = $1`, [collegeB]);
    expect(updated.affectedRows).toBe(0);
    const deleted = await db.query(`DELETE FROM departments WHERE code = 'PHARM'`);
    expect(deleted.affectedRows).toBe(0);

    // Moving one of its own rows to another college is also refused.
    await expect(
      db.query(`UPDATE departments SET college_id = $1 WHERE code = 'CSE'`, [collegeB]),
    ).rejects.toThrow(/row-level security/);
  });

  it('can write its own rows', async () => {
    await asApp(collegeA);
    const inserted = await db.query(
      `INSERT INTO departments (college_id, name, code) VALUES ($1, 'Mechanical', 'MECH')`,
      [collegeA],
    );
    expect(inserted.affectedRows).toBe(1);
  });

  it('can resolve a subdomain to a college id before a tenant is set, and nothing more', async () => {
    await asApp(null);
    const found = await db.query<{ id: string | null }>(`SELECT resolve_college_id('Sample-B') AS id`);
    expect(found.rows[0]!.id).toBe(collegeB);
    const missing = await db.query<{ id: string | null }>(`SELECT resolve_college_id('nope') AS id`);
    expect(missing.rows[0]!.id).toBeNull();
  });
});

describe('protected tables for the app role', () => {
  it('can read rules but not change them', async () => {
    await asApp(collegeA);
    const { rows } = await db.query<{ code: string }>('SELECT code FROM frameworks');
    expect(rows).toHaveLength(1);
    for (const table of GLOBAL_TABLES) {
      await expect(db.exec(`DELETE FROM ${table}`), table).rejects.toThrow(/permission denied/);
    }
  });

  it('cannot create or delete colleges', async () => {
    await asApp(collegeA);
    await expect(
      db.exec(
        `INSERT INTO colleges (name, type, subdomain, state, updated_at) VALUES ('X', 'affiliated', 'x', 'AP', now())`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.exec('DELETE FROM colleges')).rejects.toThrow(/permission denied/);
  });

  it('adds a college only through create_college()', async () => {
    await asApp(null);
    const { rows } = await db.query<{ id: string }>("SELECT create_college('Platform College', 'affiliated', 'Platform', 'AP', 'trial') AS id");
    await asOwner();
    const made = await db.query<{ subdomain: string }>('SELECT subdomain FROM colleges WHERE id = $1', [rows[0]!.id]);
    expect(made.rows).toEqual([{ subdomain: 'platform' }]);
  });

  it('keeps the platform audit log append-only and team accounts undeletable', async () => {
    await asApp(null);
    await db.exec("INSERT INTO platform_audit_logs (action) VALUES ('sign_in')");
    await expect(db.exec("UPDATE platform_audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(db.exec('DELETE FROM platform_audit_logs')).rejects.toThrow(/permission denied/);
    await expect(db.exec('DELETE FROM platform_admins')).rejects.toThrow(/permission denied/);
  });

  it('can add to the audit log but never edit or delete it', async () => {
    await asApp(collegeA);
    await db.query(
      `INSERT INTO audit_logs (college_id, entity, entity_id, action) VALUES ($1, 'department', 'y', 'update')`,
      [collegeA],
    );
    await expect(db.exec(`UPDATE audit_logs SET action = 'changed'`)).rejects.toThrow(/permission denied/);
    await expect(db.exec('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
  });
});
