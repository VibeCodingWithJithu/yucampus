import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Asked by Caddy before it gets an HTTPS certificate for a college address (on-demand TLS, decided 2026-10-30).
 * Says yes only for <subdomain>.<rootDomain> where the subdomain is an existing college, so nobody can make the
 * server request certificates for made-up names. Lives outside /api/v1, so the web app never forwards it: only
 * Caddy, inside the server, can reach it.
 */
@ApiExcludeController()
@Controller('health/tls')
export class TlsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async allowed(@Query('domain') domain: string | undefined) {
    if (!(await this.isCollegeAddress(domain))) throw new NotFoundException();
    return { allowed: true };
  }

  async isCollegeAddress(domain: string | undefined): Promise<boolean> {
    const root = this.config.rootDomain;
    if (!root || !domain) return false;
    const host = domain.toLowerCase();
    if (!host.endsWith(`.${root}`)) return false;
    const subdomain = host.slice(0, -(root.length + 1));
    if (!/^[a-z0-9-]{1,63}$/.test(subdomain)) return false;
    return (await this.prisma.resolveCollegeId(subdomain)) !== null;
  }
}
