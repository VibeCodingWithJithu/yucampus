import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type BulkDownloadInput,
  type BulkLinkInput,
  type CreateEvidenceInput,
  type EvidenceMetricsInput,
  type LibraryQuery,
  type ResubmitEvidenceInput,
  type ReviewInput,
  type UploadRequestInput,
  bulkDownloadSchema,
  bulkLinkSchema,
  createEvidenceSchema,
  evidenceMetricsSchema,
  libraryQuerySchema,
  resubmitEvidenceSchema,
  reviewSchema,
  uploadRequestSchema,
} from '@yucampus/validation';
import { CurrentUser, RequirePermission, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { z } from 'zod';
import { EvidenceLibraryService } from './evidence-library.service.js';
import { EvidenceService } from './evidence.service.js';

@ApiTags('evidence')
@ApiBearerAuth()
@Controller()
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly library: EvidenceLibraryService,
  ) {}

  @Post('evidence/uploads')
  @HttpCode(200)
  @RequirePermission('evidence.upload')
  @ApiZodBody(uploadRequestSchema)
  @ApiOperation({ summary: 'Step 1: get a pre-signed link to upload one file directly to storage' })
  requestUpload(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(uploadRequestSchema)) body: UploadRequestInput) {
    return this.evidence.requestUpload(actor, body);
  }

  @Post('evidence')
  @RequirePermission('evidence.upload')
  @ApiZodBody(createEvidenceSchema)
  @ApiOperation({ summary: 'Step 2: after uploading, check the file and create the evidence (goes to review)' })
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createEvidenceSchema)) body: CreateEvidenceInput) {
    return this.evidence.create(actor, body);
  }

  @Get('evidence/library')
  @ApiOperation({ summary: 'Search and filter the evidence the person may see, newest first' })
  search(@CurrentUser() actor: AuthUser, @ZodQuery(libraryQuerySchema) query: LibraryQuery) {
    return this.library.search(actor, query);
  }

  @Post('evidence/bulk/link')
  @HttpCode(200)
  @ApiZodBody(bulkLinkSchema)
  @ApiOperation({ summary: 'Link many items to one metric; items the person may not change are skipped' })
  bulkLink(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(bulkLinkSchema)) body: BulkLinkInput) {
    return this.library.bulkLink(actor, body);
  }

  @Post('evidence/bulk/download-links')
  @HttpCode(200)
  @ApiZodBody(bulkDownloadSchema)
  @ApiOperation({ summary: 'Short-lived download links for many items (the browser builds the ZIP)' })
  downloadLinks(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(bulkDownloadSchema)) body: BulkDownloadInput) {
    return this.library.downloadLinks(actor, body.evidenceIds);
  }

  @Get('evidence/mine')
  @ApiOperation({ summary: 'My uploads with counts, newest first' })
  mine(@CurrentUser() actor: AuthUser) {
    return this.evidence.mine(actor);
  }

  @Get('evidence/:id')
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.evidence.get(actor, id);
  }

  @Get('evidence/:id/file')
  @ApiQuery({ name: 'view', required: false, description: '"inline" to show in the browser; otherwise a download' })
  @ApiOperation({ summary: 'A short-lived link to the file' })
  file(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Query('view') view?: string) {
    return this.evidence.fileLink(actor, id, view === 'inline');
  }

  @Get('evidence/:id/versions')
  @ApiOperation({ summary: 'Every file the item has had, newest first' })
  versions(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.library.versions(actor, id);
  }

  @Get('evidence/:id/versions/:version/file')
  @ApiQuery({ name: 'view', required: false })
  versionFile(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Param('version', new ZodPipe(z.coerce.number().int().min(1))) version: number,
    @Query('view') view?: string,
  ) {
    return this.library.versionLink(actor, id, version, view === 'inline');
  }

  @Post('evidence/:id/resubmit')
  @HttpCode(200)
  @RequirePermission('evidence.upload')
  @ApiZodBody(resubmitEvidenceSchema)
  @ApiOperation({ summary: 'Send evidence again after it was sent back for fixing' })
  resubmit(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(resubmitEvidenceSchema)) body: ResubmitEvidenceInput) {
    return this.evidence.resubmit(actor, id, body);
  }

  @Put('evidence/:id/metrics')
  @ApiZodBody(evidenceMetricsSchema)
  @ApiOperation({ summary: 'Set which metrics (and required documents) this evidence counts for' })
  setMetrics(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(evidenceMetricsSchema)) body: EvidenceMetricsInput) {
    return this.evidence.setMetrics(actor, id, body);
  }

  @Get('review/queue')
  @RequireSection('review')
  @ApiOperation({ summary: 'Evidence waiting for my approval, oldest first' })
  queue(@CurrentUser() actor: AuthUser) {
    return this.evidence.queue(actor);
  }

  @Post('evidence/:id/review')
  @HttpCode(200)
  @RequireSection('review')
  @ApiZodBody(reviewSchema)
  @ApiOperation({ summary: 'Approve, send back for fixing, or reject (at the approval level that is mine)' })
  review(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(reviewSchema)) body: ReviewInput & { decision: 'approve' | 'needs_fix' | 'reject' },
  ) {
    return this.evidence.review(actor, id, body);
  }
}
