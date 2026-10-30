// Caddy's on-demand certificates: the API agrees only for an existing college's own address.

import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../src/config.js';
import { TlsController } from '../src/health/tls.controller.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';

const ROOT = 'yucampus.yubhiantechnologies.in';
let database: Database;
let tls: TlsController;

beforeAll(async () => {
  database = await openLocalDatabase({ setup: (owner) => seed(owner) });
  tls = new TlsController(new PrismaService(database), Object.assign(new AppConfig(), { rootDomain: ROOT }));
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('certificate check for college addresses', () => {
  it('agrees for an existing college, in any letter case', async () => {
    expect(await tls.allowed(`sample.${ROOT}`)).toEqual({ allowed: true });
    expect(await tls.isCollegeAddress(`SAMPLE.${ROOT.toUpperCase()}`)).toBe(true);
  });

  it('refuses made-up colleges, other domains, deeper names and the bare root', async () => {
    for (const domain of [`nosuch.${ROOT}`, 'sample.example.com', `sample.${ROOT}.evil.com`, `a.sample.${ROOT}`, ROOT, '', undefined]) {
      expect(await tls.isCollegeAddress(domain), String(domain)).toBe(false);
    }
    await expect(tls.allowed(`nosuch.${ROOT}`)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses everything when no root domain is set', async () => {
    const unset = new TlsController(new PrismaService(database), new AppConfig());
    expect(await unset.isCollegeAddress(`sample.${ROOT}`)).toBe(false);
  });
});
