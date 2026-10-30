import { Injectable } from '@nestjs/common';
import type {
  AccreditationBody,
  AccreditationOverview,
  CriterionView,
  FrameworkRef,
  LinkableMetric,
  MetricComment,
  MetricDetailView,
} from '@yucampus/types';
import type { AuthUser } from '../auth/tokens.service.js';
import { audit } from '../common/audit.js';
import { notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { metricData, parseDataSource } from '../registers/metric-data.js';
import {
  type ApprovedLink,
  type MetricFacts,
  type RequiredDocument,
  average,
  metricReadiness,
  statusFor,
  yearsWindow,
} from './readiness.js';

type FrameworkRow = Prisma.FrameworkGetPayload<object>;

const toRef = (framework: FrameworkRow): FrameworkRef => {
  const source = (framework.source ?? {}) as { title?: string; verified?: boolean };
  return {
    id: framework.id,
    body: framework.body,
    code: framework.code,
    version: framework.version,
    name: framework.name,
    verified: source.verified === true,
    sourceTitle: source.title ?? '',
  };
};

const documentsOf = (value: Prisma.JsonValue): RequiredDocument[] =>
  Array.isArray(value)
    ? value.filter((d): d is { key: string; name: string } => typeof d === 'object' && d !== null && 'key' in d && 'name' in d)
    : [];

@Injectable()
export class AccreditationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Frameworks the college works against now: active college-level rows (the newest cycle first) and
   * frameworks active on any of its programs (NBA).
   */
  async activeFrameworkIds(db: TenantClient, collegeId: string): Promise<string[]> {
    const [college, programs] = await Promise.all([
      db.collegeFramework.findMany({
        where: { collegeId, active: true },
        select: { frameworkId: true, cycle: { select: { startDate: true, createdAt: true } } },
      }),
      db.programFramework.findMany({ where: { collegeId, active: true }, select: { frameworkId: true } }),
    ]);
    const newest = (row: (typeof college)[number]) => (row.cycle?.startDate ?? row.cycle?.createdAt ?? new Date(0)).getTime();
    return [...new Set([...college.sort((a, b) => newest(b) - newest(a)).map((r) => r.frameworkId), ...programs.map((r) => r.frameworkId)])];
  }

  /** Metrics evidence can be linked to: those of the frameworks the college works against now. */
  async linkableMetrics(actor: AuthUser): Promise<LinkableMetric[]> {
    const ids = await this.prisma.forTenant(actor.collegeId, (db) => this.activeFrameworkIds(db, actor.collegeId));
    const metrics = await this.prisma.rules.metric.findMany({
      where: { criterion: { frameworkId: { in: ids } } },
      include: { criterion: { include: { framework: true } } },
      orderBy: [{ criterion: { framework: { body: 'asc' } } }, { criterion: { number: 'asc' } }, { sortOrder: 'asc' }],
    });
    return metrics.map((metric) => ({
      id: metric.id,
      code: metric.code,
      name: metric.name,
      criterion: { number: metric.criterion.number, name: metric.criterion.name },
      framework: {
        id: metric.criterion.framework.id,
        body: metric.criterion.framework.body,
        name: metric.criterion.framework.name,
        verified: toRef(metric.criterion.framework).verified,
      },
      documents: documentsOf(metric.requiredDocuments),
    }));
  }

  /** The readiness dashboard for one body (e.g. NAAC). `frameworkId` picks one of several active ones. */
  async overview(actor: AuthUser, body: AccreditationBody, frameworkId?: string): Promise<AccreditationOverview | null> {
    return this.prisma.forTenant(actor.collegeId, (db) => this.computeOverview(db, actor.collegeId, body, frameworkId));
  }

  /**
   * The overview inside the caller's transaction. With `approvedBy`, readiness is worked out as it stood then:
   * only evidence whose final approval happened by that moment counts (used for "up 6% this month").
   */
  async computeOverview(
    db: TenantClient,
    collegeId: string,
    body: AccreditationBody,
    frameworkId?: string,
    approvedBy?: Date,
  ): Promise<AccreditationOverview | null> {
    const activeIds = await this.activeFrameworkIds(db, collegeId);
    // Rules are read inside the same transaction: a second connection here could wait on this one.
    const frameworks = await db.framework.findMany({ where: { id: { in: activeIds }, body, attachesTo: 'college' } });
    if (frameworks.length === 0) return null;
    frameworks.sort((a, b) => activeIds.indexOf(a.id) - activeIds.indexOf(b.id));
    const framework = frameworks.find((f) => f.id === frameworkId) ?? frameworks[0]!;

    const [college, criteria, cycleRow, facts] = await Promise.all([
      db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { type: true } }),
      db.criterion.findMany({
        where: { frameworkId: framework.id },
        include: { metrics: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { number: 'asc' },
      }),
      db.collegeFramework.findFirst({
        where: { collegeId: collegeId, frameworkId: framework.id, active: true },
        select: { cycle: { select: { id: true, label: true } } },
      }),
      this.readinessFacts(db, collegeId, approvedBy),
    ]);

    const metricsOf = (criterion: (typeof criteria)[number]) =>
      criterion.metrics.map((metric) => this.factsFor(metric, criterion.number));
    const perMetric = new Map(
      criteria.flatMap((criterion) =>
        metricsOf(criterion).map((metric) => [
          metric.id,
          metricReadiness(metric, facts.links, yearsWindow(facts.years, metric.yearsRequired)),
        ]),
      ),
    );

    const criteriaView = criteria
      .filter((criterion) => criterion.appliesToInstitutionTypes.includes(college.type))
      .map((criterion) => {
        const results = criterion.metrics.map((metric) => perMetric.get(metric.id)!);
        // Weighted by each metric's marks, as NAAC scores them.
        const percent = average(
          results.map((r) => r.percent),
          criterion.metrics.map((m) => m.weight ?? 0),
        );
        return {
          number: criterion.number,
          name: criterion.name,
          pending: criterion.metrics.length === 0,
          percent,
          status: statusFor(percent),
          metricsComplete: results.filter((r) => r.percent === 100).length,
          metricsTotal: results.length,
          evidence: new Set(
            facts.links.filter((link) => criterion.metrics.some((m) => m.id === link.metricId)).map((l) => l.evidenceId),
          ).size,
          missing: results.reduce((sum, r) => sum + r.missing.length, 0),
          weight: (criterion.weights as Record<string, number> | null)?.[college.type] ?? 0,
        };
      });

    const loaded = criteriaView.filter((c) => !c.pending);
    const percent = average(
      loaded.map((c) => c.percent),
      loaded.map((c) => c.weight),
    );
    const attention = criteria
      .flatMap((criterion) =>
        criterion.metrics.map((metric) => ({ metric, criterion, result: perMetric.get(metric.id)! })),
      )
      .filter(({ result }) => result.missing.length > 0)
      .sort((a, b) => a.result.percent - b.result.percent || a.criterion.number - b.criterion.number)
      .slice(0, 10)
      .map(({ metric, criterion, result }) => ({
        metricId: metric.id,
        code: metric.code,
        name: metric.name,
        criterionNumber: criterion.number,
        missing: result.missing.map((doc) => doc.name),
        percent: result.percent,
      }));

    return {
      framework: toRef(framework),
      others: frameworks.filter((f) => f.id !== framework.id).map(toRef),
      cycle: cycleRow?.cycle ?? null,
      academicYear: facts.years.find((y) => y.status === 'current')?.label ?? null,
      percent,
      status: statusFor(percent),
      criteria: criteriaView.map(({ weight: _weight, ...c }) => c),
      attention,
    };
  }

  /** One criterion's metrics with their readiness. The framework must be one the college works against. */
  async criterion(actor: AuthUser, frameworkId: string, number: number): Promise<CriterionView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const activeIds = await this.activeFrameworkIds(db, actor.collegeId);
      if (!activeIds.includes(frameworkId)) throw notFound('framework');
      const criterion = await db.criterion.findUnique({
        where: { frameworkId_number: { frameworkId, number } },
        include: { framework: true, metrics: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!criterion) throw notFound('criterion');
      const facts = await this.readinessFacts(db, actor.collegeId);
      const rows = criterion.metrics.map((metric) => {
        const result = metricReadiness(this.factsFor(metric, number), facts.links, yearsWindow(facts.years, metric.yearsRequired));
        return {
          id: metric.id,
          code: metric.code,
          name: metric.name,
          percent: result.percent,
          status: statusFor(result.percent),
          missing: result.missing.map((doc) => doc.name),
          evidenceCount: result.evidenceCount,
        };
      });
      const percent = average(
        rows.map((r) => r.percent),
        criterion.metrics.map((m) => m.weight ?? 0),
      );
      return { framework: toRef(criterion.framework), number, name: criterion.name, percent, status: statusFor(percent), metrics: rows };
    });
  }

  async metric(actor: AuthUser, metricId: string): Promise<MetricDetailView> {
    const metric = await this.prisma.rules.metric.findUnique({
      where: { id: metricId },
      include: { criterion: { include: { framework: true } } },
    });
    if (!metric) throw notFound('metric');

    return this.prisma.forTenant(actor.collegeId, async (db) => {
      // A metric is visible only if the college uses (or used) its framework.
      const uses =
        (await db.collegeFramework.count({ where: { collegeId: actor.collegeId, frameworkId: metric.criterion.frameworkId } })) +
        (await db.programFramework.count({ where: { collegeId: actor.collegeId, frameworkId: metric.criterion.frameworkId } }));
      if (uses === 0) throw notFound('metric');

      const facts = await this.readinessFacts(db, actor.collegeId);
      const metricFacts = this.factsFor(metric, metric.criterion.number);
      const window = yearsWindow(facts.years, metric.yearsRequired);
      const result = metricReadiness(metricFacts, facts.links, window);

      const [links, comments] = await Promise.all([
        db.evidenceMetric.findMany({
          where: { collegeId: actor.collegeId, metricId, evidence: { status: { not: 'rejected' } } },
          select: {
            documentKey: true,
            evidence: {
              select: { id: true, title: true, status: true, academicYearId: true, uploadedById: true, updatedAt: true },
            },
          },
          orderBy: { evidence: { updatedAt: 'desc' } },
          take: 100,
        }),
        db.comment.findMany({
          where: { collegeId: actor.collegeId, entityType: 'metric', entityId: metricId },
          orderBy: { at: 'asc' },
          take: 100,
        }),
      ]);
      const people = await db.user.findMany({
        where: {
          collegeId: actor.collegeId,
          id: { in: [...new Set([...links.map((l) => l.evidence.uploadedById), ...comments.map((c) => c.userId)])] },
        },
        select: { id: true, name: true },
      });
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      const yearLabel = new Map(facts.years.map((y) => [y.id, y.label]));
      const source = parseDataSource(metric.dataSource);
      const dataYears = facts.years
        .filter((y) => window.has(y.id))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
        .map((y) => ({ id: y.id, label: y.label }));
      const data = source ? await metricData(db, actor.collegeId, source, dataYears) : null;
      const only = metricFacts.requiredDocuments.length === 1 ? metricFacts.requiredDocuments[0]!.key : null;
      const documentOf = (link: { documentKey: string | null }) => link.documentKey ?? only;

      return {
        id: metric.id,
        code: metric.code,
        name: metric.name,
        plainLanguage: metric.plainLanguage,
        type: metric.type,
        yearsRequired: metric.yearsRequired,
        criterion: { number: metric.criterion.number, name: metric.criterion.name },
        framework: toRef(metric.criterion.framework),
        percent: result.percent,
        status: statusFor(result.percent),
        years: [...window].map((id) => yearLabel.get(id) ?? ''),
        documents: metricFacts.requiredDocuments.map((doc) => {
          const forDoc = links.filter((link) => documentOf(link) === doc.key && window.has(link.evidence.academicYearId));
          return {
            key: doc.key,
            name: doc.name,
            satisfied: result.satisfied.includes(doc.key),
            approved: forDoc.filter((l) => l.evidence.status === 'approved').length,
            pending: forDoc.filter((l) => l.evidence.status !== 'approved').length,
          };
        }),
        evidence: links.map((link) => ({
          id: link.evidence.id,
          title: link.evidence.title,
          status: link.evidence.status,
          stageLabel: link.evidence.status === 'approved' ? 'Approved' : link.evidence.status === 'needs_fix' ? 'Needs fix' : 'In review',
          documentKey: documentOf(link),
          academicYear: yearLabel.get(link.evidence.academicYearId) ?? '',
          uploadedBy: nameOf.get(link.evidence.uploadedById) ?? 'Someone',
          counts: link.evidence.status === 'approved' && window.has(link.evidence.academicYearId),
        })),
        comments: comments.map(
          (comment): MetricComment => ({ id: comment.id, by: nameOf.get(comment.userId) ?? 'Someone', body: comment.body, at: comment.at.toISOString() }),
        ),
        data,
      };
    });
  }

  async addComment(actor: AuthUser, metricId: string, body: string): Promise<MetricDetailView> {
    await this.metric(actor, metricId); // Same visibility rule.
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const comment = await db.comment.create({
        data: { collegeId: actor.collegeId, entityType: 'metric', entityId: metricId, userId: actor.id, body },
      });
      await audit(db, actor, 'comment', comment.id, 'create', { after: { metricId, body } });
    });
    return this.metric(actor, metricId);
  }

  private factsFor(
    metric: { id: string; code: string; name: string; yearsRequired: number; weight: number | null; requiredDocuments: Prisma.JsonValue },
    criterionNumber: number,
  ): MetricFacts {
    return {
      id: metric.id,
      code: metric.code,
      name: metric.name,
      criterionNumber,
      yearsRequired: metric.yearsRequired,
      weight: metric.weight,
      requiredDocuments: documentsOf(metric.requiredDocuments),
    };
  }

  /** Approved evidence links and the academic years: everything readiness is computed from. */
  private async readinessFacts(db: TenantClient, collegeId: string, approvedBy?: Date) {
    const [years, links] = await Promise.all([
      db.academicYear.findMany({ where: { collegeId }, select: { id: true, label: true, startDate: true, status: true } }),
      db.evidenceMetric.findMany({
        where: {
          collegeId,
          evidence: {
            status: 'approved',
            ...(approvedBy ? { reviewActions: { some: { action: 'approved', level: 'final', at: { lte: approvedBy } } } } : {}),
          },
        },
        select: { evidenceId: true, metricId: true, documentKey: true, evidence: { select: { academicYearId: true } } },
      }),
    ]);
    return {
      years,
      links: links.map(
        (link): ApprovedLink => ({
          evidenceId: link.evidenceId,
          metricId: link.metricId,
          documentKey: link.documentKey,
          academicYearId: link.evidence.academicYearId,
        }),
      ),
    };
  }
}
