import type { OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { Database } from './database.js';

export type TenantClient = Prisma.TransactionClient;

/**
 * Database access for the API. It connects as the yucampus_app role, so row-level security applies.
 *
 * The raw client is private on purpose: tenant data is only reachable through forTenant(), which names
 * the college for the length of one transaction. A query that forgets the tenant sees no rows.
 */
export class PrismaService implements OnModuleDestroy {
  constructor(private readonly database: Database) {}

  private get client() {
    return this.database.client;
  }

  /**
   * Runs `work` in a transaction that can only see and change rows of the given college.
   * If `work` throws, everything it wrote is rolled back.
   */
  forTenant<T>(collegeId: string, work: (db: TenantClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (db) => {
      await db.$queryRaw`SELECT set_config('app.college_id', ${collegeId}, true)`;
      return work(db);
    });
  }

  /** Turns a subdomain (abc.yucampus.yubhiantechnologies.in -> "abc") into a college id. Used before sign-in. */
  async resolveCollegeId(subdomain: string): Promise<string | null> {
    const rows = await this.client.$queryRaw<{ id: string | null }[]>`SELECT resolve_college_id(${subdomain}) AS id`;
    return rows[0]?.id ?? null;
  }

  /** Turns a survey's open-link token into its college id. Used by the public form, before any tenant is known. */
  async surveyCollegeId(token: string): Promise<string | null> {
    const rows = await this.client.$queryRaw<{ id: string | null }[]>`SELECT survey_college_id(${token}) AS id`;
    return rows[0]?.id ?? null;
  }

  /** Every college's id, for background jobs that visit colleges one at a time. Nothing else is readable this way. */
  async collegeIds(): Promise<string[]> {
    const rows = await this.client.$queryRaw<{ id: string }[]>`SELECT college_ids() AS id`;
    return rows.map((row) => row.id);
  }

  /**
   * The platform's own global tables (YuCampus team accounts, sessions, links, platform audit log). They hold no
   * college data; the platform reads colleges only through forTenant(), one college at a time.
   */
  get platform() {
    const { platformAdmin, platformRefreshToken, platformPasswordLink, platformRecoveryCode, platformAuditLog, registerDefinition } = this.client;
    return { platformAdmin, platformRefreshToken, platformPasswordLink, platformRecoveryCode, platformAuditLog, registerDefinition };
  }

  /** Several platform-table writes that must succeed or fail together. */
  platformTransaction<T>(work: (db: TenantClient) => Promise<T>): Promise<T> {
    return this.client.$transaction((db) => work(db));
  }

  /** Adds a college through create_college(), the only way the app role can insert one. Returns its id. */
  async createCollege(input: { name: string; type: string; subdomain: string; state: string; plan: string }): Promise<string> {
    const rows = await this.client.$queryRaw<{ id: string }[]>`SELECT create_college(${input.name}, ${input.type}::college_type, ${input.subdomain}, ${input.state}, ${input.plan}) AS id`;
    return rows[0]!.id;
  }

  /** Rules (frameworks, criteria, metrics, templates) are global and read-only for the app role. */
  get rules() {
    const { framework, criterion, metric, reportTemplate, taskTemplate } = this.client;
    return { framework, criterion, metric, reportTemplate, taskTemplate };
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.database.close();
  }
}
