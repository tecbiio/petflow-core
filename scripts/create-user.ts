#!/usr/bin/env ts-node
import 'dotenv/config';
import { PrismaClient as MasterPrismaClient } from '@prisma/master-client';
import path from 'path';
import { randomBytes, scryptSync } from 'crypto';

type Args = {
  tenant: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'USER';
  masterDbUrl?: string;
};

function parseArgs(): Args {
  const raw = Object.fromEntries(
    process.argv
      .slice(2)
      .map((arg) => arg.replace(/^--/, '').split('='))
      .filter(([k]) => k),
  );

  const tenant = (raw.tenant ?? raw.tenantCode ?? process.env.USER_TENANT ?? '').trim().toLowerCase();
  const email = (raw.email ?? process.env.USER_EMAIL ?? '').trim().toLowerCase();
  const password = raw.password ?? process.env.USER_PASSWORD;
  const roleInput = (raw.role ?? process.env.USER_ROLE ?? 'USER').trim().toUpperCase();
  const masterDbUrl = raw.masterDbUrl ?? process.env.MASTER_DATABASE_URL;

  if (!tenant) throw new Error('tenant manquant (--tenant=... ou USER_TENANT)');
  if (!email) throw new Error('email manquant (--email=... ou USER_EMAIL)');
  if (!password) throw new Error('password manquant (--password=... ou USER_PASSWORD)');
  if (roleInput !== 'ADMIN' && roleInput !== 'USER') {
    throw new Error('role invalide (ADMIN|USER)');
  }

  return { tenant, email, password, role: roleInput as Args['role'], masterDbUrl };
}

function resolveDbUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('file:')) {
    const p = url.replace(/^file:/, '');
    const abs = path.resolve(p);
    return `file:${abs}`;
  }
  return url;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function main() {
  const args = parseArgs();
  const masterUrl = resolveDbUrl(args.masterDbUrl);

  if (!masterUrl) {
    throw new Error('MASTER_DATABASE_URL manquant (ou --masterDbUrl=...)');
  }

  const master = new MasterPrismaClient({ datasources: { db: { url: masterUrl } } });
  const tenant = await master.tenant.findUnique({ where: { code: args.tenant } });
  if (!tenant) {
    throw new Error(`Tenant introuvable: ${args.tenant}`);
  }

  const passwordHash = hashPassword(args.password);
  const user = await master.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: args.email } },
    update: { passwordHash, role: args.role },
    create: { tenantId: tenant.id, email: args.email, passwordHash, role: args.role },
  });

  console.log(`OK: user=${user.email}, role=${user.role}, tenant=${tenant.code}`);
  await master.$disconnect();
}

main().catch(async (err) => {
  console.error('Create user failed:', err);
  process.exitCode = 1;
});
