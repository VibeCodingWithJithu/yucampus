import { Injectable } from '@nestjs/common';
import {
  type Grant,
  type RegisterDefinitionView,
  type RegisterImportResult,
  type RegisterPage,
  type RegisterRecordView,
  type RegisterSummary,
  type RegisterValue,
  can,
  departmentsFor,
} from '@yucampus/types';
import {
  type RegisterDefinitionInput,
  type RegisterImportInput,
  type RegisterQuery,
  type RegisterRecordInput,
  missingFields,
  registerDataSchema,
  registerImportSchema,
  registerRecordSchema,
} from '@yucampus/validation';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

/**
 * Who sees and edits which records (docs/PRODUCT.md, decided 2026-10-17):
 * - registers.edit at college (admin, IQAC, office): everything;
 * - registers.edit at department (HOD): records of their departments;
 * - registers.edit "own" (faculty): records linked to them, in registers that link a person;
 * - dashboards.view at college or department (principal, coordinators): read only, same reach.
 */
interface Access {
  read: { college: true } | { college: false; departments: string[]; own: boolean };
  edit: { college: true } | { college: false; departments: string[]; own: boolean };
}

type Definition = RegisterDefinitionInput & { id: string };
type RecordRow = Prisma.RegisterRecordGetPayload<{ include: { proofs: { include: { evidence: { select: { id: true; title: true; status: true } } } } } }>;

const MAX_ROWS = 5000;
const blank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function accessFrom(grants: readonly Grant[]): Access | null {
  const editCollege = can(grants, 'registers.edit', ['college']);
  const editDepartments = departmentsFor(grants, 'registers.edit');
  const editOwn = can(grants, 'registers.edit', ['own']);
  const viewCollege = can(grants, 'dashboards.view', ['college']);
  const viewDepartments = departmentsFor(grants, 'dashboards.view');
  const edit: Access['edit'] = editCollege ? { college: true } : { college: false, departments: editDepartments, own: editOwn };
  const read: Access['read'] =
    editCollege || viewCollege
      ? { college: true }
      : { college: false, departments: [...new Set([...editDepartments, ...viewDepartments])], own: editOwn };
  const none = !read.college && read.departments.length === 0 && !read.own;
  return none ? null : { read, edit };
}

@Injectable()
export class RegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async access(actor: AuthUser): Promise<Access> {
    const access = accessFrom(await this.permissions.grantsFor(actor.collegeId, actor.roles));
    if (!access) throw apiError(403, 'forbidden', 'Data registers are for IQAC, office staff and heads of department.');
    return access;
  }

  /** The newest usable version of each register, in display order. */
  private async definitions(db: TenantClient): Promise<Definition[]> {
    const rows = await db.registerDefinition.findMany({ where: { status: { not: 'retired' } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    const latest = new Map<string, Definition>();
    for (const row of rows) if (!latest.has(row.code)) latest.set(row.code, { ...(row.definition as unknown as RegisterDefinitionInput), id: row.id });
    return [...latest.values()];
  }

  private async definition(db: TenantClient, code: string): Promise<Definition> {
    const found = (await this.definitions(db)).find((d) => d.code === code.toUpperCase());
    if (!found) throw notFound('register');
    return found;
  }

  /** Faculty with "own" access only see registers that link a person (their profile, their research). */
  private visibleTo(access: Access, definition: Definition) {
    return access.read.college || access.read.departments.length > 0 || Boolean(definition.person);
  }

  private readWhere(access: Access, actor: AuthUser): Prisma.RegisterRecordWhereInput {
    if (access.read.college) return {};
    return {
      OR: [
        ...(access.read.departments.length ? [{ departmentId: { in: access.read.departments } }] : []),
        ...(access.read.own ? [{ userId: actor.id }] : []),
      ],
    };
  }

  private canEdit(access: Access, actor: AuthUser, record: { departmentId: string | null; userId: string | null }) {
    if (access.edit.college) return true;
    if (record.departmentId && access.edit.departments.includes(record.departmentId)) return true;
    return access.edit.own && record.userId === actor.id;
  }

  private canImport(access: Access) {
    return access.edit.college || access.edit.departments.length > 0;
  }

  private canAdd(access: Access, definition: Definition) {
    return access.edit.college || access.edit.departments.length > 0 || (access.edit.own && Boolean(definition.person));
  }

  private async year(db: TenantClient, collegeId: string, yearId?: string) {
    const year = yearId
      ? await db.academicYear.findFirst({ where: { id: yearId, collegeId } })
      : await db.academicYear.findFirst({ where: { collegeId, status: 'current' } });
    if (!year) throw yearId ? notFound('academic year') : apiError(409, 'no_current_year', 'Your college has no current academic year.');
    return year;
  }

  private missing(definition: Definition, data: Record<string, unknown>, proofs: number, record: { departmentId: string | null; userId: string | null }) {
    const missing = missingFields(definition, data);
    if (definition.department === 'required' && !record.departmentId) missing.push('department');
    if (definition.person?.required && !record.userId) missing.push('person');
    if (definition.proof === 'required' && proofs === 0) missing.push('proof');
    return missing;
  }

  private view(definition: Definition, row: RecordRow, access: Access, actor: AuthUser, names: Map<string, string>, codes: Map<string, string>, locked: boolean): RegisterRecordView {
    const data = (row.data ?? {}) as Record<string, RegisterValue>;
    const proofs = row.proofs.filter((p) => p.evidence.status === 'approved').map((p) => ({ id: p.evidence.id, title: p.evidence.title }));
    return {
      id: row.id,
      title: String(data[definition.titleField] ?? ''),
      data,
      department: row.departmentId ? { id: row.departmentId, code: codes.get(row.departmentId) ?? '' } : null,
      person: row.userId ? { id: row.userId, name: names.get(row.userId) ?? 'Someone' } : null,
      proofs,
      missing: this.missing(definition, data, proofs.length, row),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: names.get(row.updatedById) ?? 'Someone',
      can: { edit: !locked && this.canEdit(access, actor, row) },
    };
  }

  private toDefinitionView(definition: Definition, summary: Omit<RegisterSummary, 'code' | 'name' | 'description' | 'feeds' | 'verified' | 'sourceTitle'>): RegisterDefinitionView {
    return {
      id: definition.id,
      code: definition.code,
      version: definition.version,
      name: definition.name,
      description: definition.description,
      feeds: definition.feeds,
      verified: definition.source.verified,
      sourceTitle: definition.source.title,
      department: definition.department,
      person: definition.person ?? null,
      proof: definition.proof,
      singlePerYear: definition.singlePerYear ?? false,
      titleField: definition.titleField,
      fields: definition.fields.map((f) => ({ ...f, options: f.options, integer: f.integer ?? false, column: f.column ?? false, required: f.required ?? false })),
      ...summary,
    };
  }

  private async rows(db: TenantClient, collegeId: string, definition: Definition, yearId: string, where: Prisma.RegisterRecordWhereInput) {
    return db.registerRecord.findMany({
      where: { collegeId, definitionId: definition.id, academicYearId: yearId, AND: [where] },
      include: { proofs: { include: { evidence: { select: { id: true, title: true, status: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
    });
  }

  // ---------------------------------------------------------------- Reading

  /** The registers (tabs) with record counts for the year. */
  async list(actor: AuthUser, yearId?: string): Promise<RegisterSummary[]> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const year = await this.year(db, actor.collegeId, yearId);
      const out: RegisterSummary[] = [];
      for (const definition of await this.definitions(db)) {
        if (!this.visibleTo(access, definition)) continue;
        const rows = await this.rows(db, actor.collegeId, definition, year.id, this.readWhere(access, actor));
        const incomplete = rows.filter(
          (r) => this.missing(definition, r.data as Record<string, unknown>, r.proofs.filter((p) => p.evidence.status === 'approved').length, r).length > 0,
        ).length;
        out.push({
          code: definition.code,
          name: definition.name,
          description: definition.description,
          feeds: definition.feeds,
          verified: definition.source.verified,
          sourceTitle: definition.source.title,
          records: rows.length,
          incomplete,
          can: {
            add: year.status !== 'locked' && this.canAdd(access, definition) && !(definition.singlePerYear && rows.length > 0),
            import: year.status !== 'locked' && this.canImport(access) && !(definition.singlePerYear && rows.length > 0),
          },
        });
      }
      return out;
    });
  }

  async page(actor: AuthUser, code: string, query: RegisterQuery): Promise<RegisterPage> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const definition = await this.definition(db, code);
      if (!this.visibleTo(access, definition)) throw notFound('register');
      const year = await this.year(db, collegeId, query.year);
      const locked = year.status === 'locked';
      const rows = await this.rows(db, collegeId, definition, year.id, {
        AND: [this.readWhere(access, actor), ...(query.department ? [{ departmentId: query.department }] : [])],
      });
      const [users, departments, programs] = await Promise.all([
        db.user.findMany({
          where: { collegeId, id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.updatedById]).filter((id): id is string => Boolean(id)))] } },
          select: { id: true, name: true },
        }),
        db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
        db.program.findMany({ where: { collegeId }, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' } }),
      ]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      const codes = new Map(departments.map((d) => [d.id, d.code]));
      let items = rows.map((row) => this.view(definition, row, access, actor, names, codes, locked));
      const incomplete = items.filter((i) => i.missing.length > 0).length;
      if (query.search) {
        const term = query.search.toLowerCase();
        items = items.filter((i) => Object.values(i.data).some((v) => typeof v === 'string' && v.toLowerCase().includes(term)) || i.person?.name.toLowerCase().includes(term));
      }
      if (query.missing === 'true') items = items.filter((i) => i.missing.length > 0);
      const total = items.length;
      items = items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

      // Who a record can be linked to: everyone for college-wide editors, department people for HODs, oneself for faculty.
      const people = definition.person
        ? access.edit.college
          ? await db.user.findMany({ where: { collegeId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 3000 })
          : access.edit.departments.length
            ? await db.user.findMany({
                where: { collegeId, roles: { some: { departmentId: { in: access.edit.departments } } } },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
              })
            : await db.user.findMany({ where: { id: actor.id, collegeId }, select: { id: true, name: true } })
        : [];

      let copyFrom: RegisterPage['copyFrom'] = null;
      if (rows.length === 0 && !locked && this.canAdd(access, definition)) {
        const earlier = await db.academicYear.findMany({ where: { collegeId, startDate: { lt: year.startDate } }, orderBy: { startDate: 'desc' }, take: 1 });
        if (earlier[0]) {
          const count = await db.registerRecord.count({
            where: { collegeId, definitionId: definition.id, academicYearId: earlier[0].id, AND: [this.editWhere(access, actor)] },
          });
          if (count) copyFrom = { id: earlier[0].id, label: earlier[0].label, records: count };
        }
      }

      return {
        definition: this.toDefinitionView(definition, {
          records: rows.length,
          incomplete,
          can: {
            add: !locked && this.canAdd(access, definition) && !(definition.singlePerYear && rows.length > 0),
            import: !locked && this.canImport(access) && !(definition.singlePerYear && rows.length > 0),
          },
        }),
        year: { id: year.id, label: year.label, locked },
        items,
        total,
        incomplete,
        programs,
        people,
        copyFrom,
      };
    });
  }

  private editWhere(access: Access, actor: AuthUser): Prisma.RegisterRecordWhereInput {
    if (access.edit.college) return {};
    return {
      OR: [
        ...(access.edit.departments.length ? [{ departmentId: { in: access.edit.departments } }] : []),
        ...(access.edit.own ? [{ userId: actor.id }] : []),
      ],
    };
  }

  // ---------------------------------------------------------------- Changing

  /**
   * Checks and normalises one record: values against the definition, the department and person against the
   * actor's reach, programs and proof against the college. Throws with a plain message when something is wrong.
   */
  private async prepare(db: TenantClient, actor: AuthUser, access: Access, definition: Definition, input: RegisterRecordInput) {
    const parsed = registerRecordSchema.parse(input);
    const result = registerDataSchema(definition).safeParse(parsed.data);
    if (!result.success) throw apiError(400, 'invalid_input', result.error.issues[0]?.message ?? 'Check the values.');
    const data = result.data as Record<string, RegisterValue>;

    // A program decides the department (student batches).
    let departmentId = definition.department === 'none' ? null : (parsed.departmentId ?? null);
    for (const field of definition.fields.filter((f) => f.type === 'program')) {
      const programId = data[field.key];
      if (blank(programId)) continue;
      const program = await db.program.findFirst({ where: { id: String(programId), collegeId: actor.collegeId } });
      if (!program) throw apiError(400, 'invalid_input', `${field.label}: that program is not in your college.`);
      departmentId = program.departmentId;
    }
    if (departmentId && !(await db.department.findFirst({ where: { id: departmentId, collegeId: actor.collegeId } }))) throw notFound('department');

    let userId = definition.person ? (parsed.userId ?? null) : null;
    if (userId && !(await db.user.findFirst({ where: { id: userId, collegeId: actor.collegeId } }))) throw notFound('person');
    // Faculty add and keep records about themselves only.
    if (!access.edit.college && !(departmentId && access.edit.departments.includes(departmentId))) {
      if (!(access.edit.own && definition.person)) {
        throw apiError(403, 'department_only', 'You can add and change records of your own department only.');
      }
      userId = actor.id;
    }

    const proofIds = [...new Set(parsed.proofIds)];
    if (proofIds.length) {
      const approved = await db.evidence.count({ where: { collegeId: actor.collegeId, id: { in: proofIds }, status: 'approved' } });
      if (approved !== proofIds.length) throw apiError(400, 'invalid_input', 'Proof must be evidence that has been approved.');
    }
    return { data, departmentId, userId, proofIds, academicYearId: parsed.academicYearId };
  }

  /** Registers kept as one record a year (College figures) refuse a second one. */
  private async onePerYear(db: TenantClient, collegeId: string, definition: Definition, yearId: string, adding: number) {
    if (!definition.singlePerYear) return;
    const existing = await db.registerRecord.count({ where: { collegeId, definitionId: { in: await this.versionIds(db, definition.code) }, academicYearId: yearId } });
    if (existing + adding > 1) throw apiError(409, 'one_per_year', `${definition.name} has one record per year. Edit the existing one.`);
  }

  private async versionIds(db: TenantClient, code: string) {
    return (await db.registerDefinition.findMany({ where: { code }, select: { id: true } })).map((d) => d.id);
  }

  private async openYear(db: TenantClient, collegeId: string, yearId: string) {
    const year = await this.year(db, collegeId, yearId);
    if (year.status === 'locked') throw apiError(409, 'year_locked', `${year.label} is locked. Records of a locked year cannot change.`);
    return year;
  }

  async create(actor: AuthUser, code: string, input: RegisterRecordInput): Promise<RegisterRecordView> {
    const access = await this.access(actor);
    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const definition = await this.definition(db, code);
      if (!this.canAdd(access, definition)) throw apiError(403, 'forbidden', 'You cannot add records to this register.');
      const record = await this.prepare(db, actor, access, definition, input);
      await this.openYear(db, actor.collegeId, record.academicYearId);
      await this.onePerYear(db, actor.collegeId, definition, record.academicYearId, 1);
      const row = await db.registerRecord.create({
        data: {
          collegeId: actor.collegeId,
          definitionId: definition.id,
          academicYearId: record.academicYearId,
          departmentId: record.departmentId,
          userId: record.userId,
          data: record.data as Prisma.InputJsonObject,
          createdById: actor.id,
          updatedById: actor.id,
          proofs: { create: record.proofIds.map((evidenceId) => ({ collegeId: actor.collegeId, evidenceId })) },
        },
      });
      await audit(db, actor, 'register_record', row.id, 'create', { after: { register: definition.code, ...record } });
      return row.id;
    });
    return this.record(actor, id);
  }

  async update(actor: AuthUser, id: string, input: RegisterRecordInput): Promise<RegisterRecordView> {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.registerRecord.findFirst({ where: { id, collegeId: actor.collegeId }, include: { definition: true, academicYear: true } });
      if (!before || !this.readable(access, actor, before)) throw notFound('record');
      if (!this.canEdit(access, actor, before)) throw apiError(403, 'forbidden', 'You cannot change this record.');
      if (before.academicYear.status === 'locked') throw apiError(409, 'year_locked', `${before.academicYear.label} is locked. Records of a locked year cannot change.`);
      const definition = { ...(before.definition.definition as unknown as RegisterDefinitionInput), id: before.definitionId };
      const record = await this.prepare(db, actor, access, definition, { ...input, academicYearId: before.academicYearId });
      await db.registerRecordEvidence.deleteMany({ where: { recordId: id, collegeId: actor.collegeId } });
      await db.registerRecord.update({
        where: { id },
        data: {
          departmentId: record.departmentId,
          userId: record.userId,
          data: record.data as Prisma.InputJsonObject,
          updatedById: actor.id,
          proofs: { create: record.proofIds.map((evidenceId) => ({ collegeId: actor.collegeId, evidenceId })) },
        },
      });
      await audit(db, actor, 'register_record', id, 'update', { before: { data: before.data }, after: record });
    });
    return this.record(actor, id);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.registerRecord.findFirst({ where: { id, collegeId: actor.collegeId }, include: { academicYear: true, definition: true } });
      if (!row || !this.readable(access, actor, row)) throw notFound('record');
      if (!this.canEdit(access, actor, row)) throw apiError(403, 'forbidden', 'You cannot delete this record.');
      if (row.academicYear.status === 'locked') throw apiError(409, 'year_locked', `${row.academicYear.label} is locked. Records of a locked year cannot change.`);
      await db.registerRecord.delete({ where: { id } });
      await audit(db, actor, 'register_record', id, 'delete', { before: { register: row.definition.code, data: row.data } });
    });
  }

  private readable(access: Access, actor: AuthUser, row: { departmentId: string | null; userId: string | null }) {
    if (access.read.college) return true;
    return Boolean((row.departmentId && access.read.departments.includes(row.departmentId)) || (access.read.own && row.userId === actor.id));
  }

  async record(actor: AuthUser, id: string): Promise<RegisterRecordView> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.registerRecord.findFirst({
        where: { id, collegeId: actor.collegeId },
        include: { definition: true, academicYear: true, proofs: { include: { evidence: { select: { id: true, title: true, status: true } } } } },
      });
      if (!row || !this.readable(access, actor, row)) throw notFound('record');
      const definition = { ...(row.definition.definition as unknown as RegisterDefinitionInput), id: row.definitionId };
      const [users, departments] = await Promise.all([
        db.user.findMany({ where: { collegeId: actor.collegeId, id: { in: [row.userId, row.updatedById].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
        db.department.findMany({ where: { collegeId: actor.collegeId }, select: { id: true, code: true } }),
      ]);
      return this.view(
        definition,
        row,
        access,
        actor,
        new Map(users.map((u) => [u.id, u.name])),
        new Map(departments.map((d) => [d.id, d.code])),
        row.academicYear.status === 'locked',
      );
    });
  }

  // ---------------------------------------------------------------- Bulk

  /** Adds rows from a spreadsheet. All or nothing: if any row has a problem, nothing is saved. */
  async import(actor: AuthUser, code: string, raw: RegisterImportInput): Promise<RegisterImportResult> {
    const access = await this.access(actor);
    const input = registerImportSchema.parse(raw);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const definition = await this.definition(db, code);
      if (!this.canImport(access)) throw apiError(403, 'forbidden', 'Importing is for IQAC, office staff and heads of department.');
      await this.openYear(db, collegeId, input.academicYearId);
      const [departments, programs, users] = await Promise.all([
        db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
        db.program.findMany({ where: { collegeId }, select: { id: true, name: true } }),
        definition.person ? db.user.findMany({ where: { collegeId, email: { not: null } }, select: { id: true, email: true } }) : Promise.resolve([]),
      ]);
      const departmentByCode = new Map(departments.map((d) => [d.code.toLowerCase(), d.id]));
      const programByName = new Map(programs.map((p) => [p.name.toLowerCase(), p.id]));
      const userByEmail = new Map(users.map((u) => [u.email!.toLowerCase(), u.id]));

      const problems: RegisterImportResult['problems'] = [];
      const ready: Awaited<ReturnType<RegistersService['prepare']>>[] = [];
      for (const [index, row] of input.rows.entries()) {
        const at = index + 2; // Row 1 is the heading.
        const data: Record<string, unknown> = { ...row.data };
        const unknownProgram = definition.fields.find(
          (f) => f.type === 'program' && !blank(data[f.key]) && !programByName.has(String(data[f.key]).trim().toLowerCase()),
        );
        if (unknownProgram) {
          problems.push({ row: at, message: `${unknownProgram.label}: there is no program called "${String(data[unknownProgram.key])}".` });
          continue;
        }
        for (const field of definition.fields.filter((f) => f.type === 'program' && !blank(data[f.key]))) {
          data[field.key] = programByName.get(String(data[field.key]).trim().toLowerCase());
        }
        const departmentId = row.departmentCode ? departmentByCode.get(row.departmentCode.toLowerCase()) : null;
        if (row.departmentCode && !departmentId) {
          problems.push({ row: at, message: `There is no department with the code ${row.departmentCode}.` });
          continue;
        }
        const userId = row.personEmail ? userByEmail.get(row.personEmail.toLowerCase()) : null;
        if (row.personEmail && !userId) {
          problems.push({ row: at, message: `No one in YuCampus has the email ${row.personEmail}. Leave it empty or add the person first.` });
          continue;
        }
        try {
          ready.push(await this.prepare(db, actor, access, definition, { academicYearId: input.academicYearId, departmentId, userId, data, proofIds: [] }));
        } catch (error) {
          const message = error instanceof Error && 'getResponse' in error ? (error as { getResponse(): { message: string } }).getResponse().message : 'Check this row';
          problems.push({ row: at, message });
        }
      }
      if (definition.singlePerYear && input.rows.length > 1) {
        problems.push({ row: 3, message: `${definition.name} has one record per year; the sheet has ${input.rows.length} rows.` });
      }
      if (definition.singlePerYear && !problems.length) {
        const existing = await db.registerRecord.count({ where: { collegeId, definitionId: definition.id, academicYearId: input.academicYearId } });
        if (existing) problems.push({ row: 2, message: `${definition.name} already has its record for this year. Edit it instead.` });
      }
      const result: RegisterImportResult = { created: ready.length, problems, saved: false };
      if (input.dryRun || problems.length) return result;
      for (const record of ready) {
        await db.registerRecord.create({
          data: {
            collegeId,
            definitionId: definition.id,
            academicYearId: record.academicYearId,
            departmentId: record.departmentId,
            userId: record.userId,
            data: record.data as Prisma.InputJsonObject,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
      }
      await audit(db, actor, 'register', definition.code, 'import', { after: { rows: ready.length, year: input.academicYearId } });
      return { ...result, saved: true };
    });
  }

  /** Copies last year's records (without proof) into an empty year, e.g. faculty profiles to update. */
  async copy(actor: AuthUser, code: string, toYearId: string): Promise<{ copied: number }> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const definition = await this.definition(db, code);
      if (!this.canAdd(access, definition)) throw apiError(403, 'forbidden', 'You cannot add records to this register.');
      const to = await this.openYear(db, collegeId, toYearId);
      const mine = this.editWhere(access, actor);
      const already = await db.registerRecord.count({ where: { collegeId, definitionId: definition.id, academicYearId: to.id, AND: [mine] } });
      if (already) throw apiError(409, 'not_empty', `${to.label} already has records. Add the rest by hand or import them.`);
      const from = (await db.academicYear.findMany({ where: { collegeId, startDate: { lt: to.startDate } }, orderBy: { startDate: 'desc' }, take: 1 }))[0];
      if (!from) throw apiError(409, 'nothing_to_copy', 'There is no earlier academic year to copy from.');
      const rows = await db.registerRecord.findMany({ where: { collegeId, definitionId: definition.id, academicYearId: from.id, AND: [mine] } });
      for (const row of rows) {
        await db.registerRecord.create({
          data: {
            collegeId,
            definitionId: definition.id,
            academicYearId: to.id,
            departmentId: row.departmentId,
            userId: row.userId,
            data: row.data as Prisma.InputJsonObject,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
      }
      await audit(db, actor, 'register', definition.code, 'copy_year', { after: { from: from.label, to: to.label, rows: rows.length } });
      return { copied: rows.length };
    });
  }

  /** A blank Excel sheet with the register's columns, and the allowed choices on a second sheet. */
  async sheet(actor: AuthUser, code: string): Promise<{ name: string; body: Buffer }> {
    const access = await this.access(actor);
    const definition = await this.prisma.forTenant(actor.collegeId, (db) => this.definition(db, code));
    if (!this.canImport(access)) throw apiError(403, 'forbidden', 'Importing is for IQAC, office staff and heads of department.');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(definition.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    const columns = [
      ...(definition.department !== 'none' && !definition.fields.some((f) => f.type === 'program') ? [{ header: 'Department code', width: 16 }] : []),
      ...(definition.person ? [{ header: `${definition.person.label} (email)`, width: 30 }] : []),
      ...definition.fields.map((f) => ({ header: f.unit ? `${f.label} (${f.unit})` : f.label, width: Math.min(40, Math.max(14, f.label.length + 4)) })),
    ];
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    const choices = workbook.addWorksheet('Choices');
    choices.addRow(['Column', 'Allowed values']).font = { bold: true };
    for (const field of definition.fields) {
      if (field.type === 'choice') choices.addRow([field.label, (field.options ?? []).join(', ')]);
      if (field.type === 'boolean') choices.addRow([field.label, 'Yes or No']);
      if (field.type === 'date') choices.addRow([field.label, 'A date like 2026-08-20']);
      if (field.type === 'program') choices.addRow([field.label, 'The program name exactly as in Institution setup']);
    }
    choices.getColumn(1).width = 36;
    choices.getColumn(2).width = 90;
    return { name: `${definition.name} - import sheet.xlsx`, body: Buffer.from(await workbook.xlsx.writeBuffer()) };
  }
}
