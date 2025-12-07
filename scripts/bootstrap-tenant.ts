#!/usr/bin/env ts-node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as MasterPrismaClient } from '@prisma/master-client';
import { execSync } from 'child_process';
import path from 'path';
import { randomBytes, scryptSync } from 'crypto';

type Args = {
  code: string;
  name: string;
  dbUrl: string;
  email: string;
  password: string;
  locationCode: string;
  locationName: string;
};

function parseArgs(): Args {
  const raw = Object.fromEntries(
    process.argv
      .slice(2)
      .map((arg) => arg.replace(/^--/, '').split('='))
      .filter(([k]) => k),
  );

  const code = (raw.code ?? process.env.BOOTSTRAP_CODE ?? 'default').toLowerCase();
  const name = raw.name ?? process.env.BOOTSTRAP_NAME ?? 'Default tenant';
  const dbUrl = raw.dbUrl ?? process.env.BOOTSTRAP_DB_URL;
  const email = (raw.email ?? process.env.BOOTSTRAP_EMAIL ?? '').toLowerCase();
  const password = raw.password ?? process.env.BOOTSTRAP_PASSWORD;
  const locationCode = (raw.locationCode ?? process.env.BOOTSTRAP_LOCATION_CODE ?? 'DEFAULT').toUpperCase();
  const locationName = raw.locationName ?? process.env.BOOTSTRAP_LOCATION_NAME ?? 'Emplacement principal';

  if (!dbUrl) throw new Error('dbUrl manquant (--dbUrl=… ou BOOTSTRAP_DB_URL)');
  if (!email) throw new Error('email manquant (--email=… ou BOOTSTRAP_EMAIL)');
  if (!password) throw new Error('password manquant (--password=… ou BOOTSTRAP_PASSWORD)');

  return { code, name, dbUrl, email, password, locationCode, locationName };
}

function resolveDbUrl(url: string): string {
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

async function ensureMigrations(dbUrl: string) {
  try {
    execSync(`npx prisma migrate deploy --schema prisma/schema.prisma`, {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
  } catch (err) {
    console.warn('> migrate deploy a échoué, tentative db push…');
    try {
      execSync(`npx prisma db push --schema prisma/schema.prisma --skip-generate`, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl },
      });
    } catch (pushErr) {
      console.warn('> db push a échoué, on continue sans appliquer les migrations (base supposée prête).');
    }
  }
}

async function main() {
  const args = parseArgs();
  const masterUrl = resolveDbUrl(process.env.MASTER_DATABASE_URL || '');
  const tenantUrl = resolveDbUrl(args.dbUrl);

  console.log(`> Bootstrap tenant "${args.code}"`);

  // 1) Migrations master (DATABASE_URL)
  if (!masterUrl) {
    throw new Error('DATABASE_URL (master) n’est pas défini dans l’environnement');
  }
  console.log('> Migrations master (MASTER_DATABASE_URL)');
  try {
    execSync(`npx prisma migrate deploy --schema prisma/master.prisma`, {
      stdio: 'inherit',
      env: { ...process.env, MASTER_DATABASE_URL: masterUrl },
    });
  } catch (err) {
    console.warn('> migrate deploy master a échoué, tentative db push…');
    try {
      execSync(`npx prisma db push --schema prisma/master.prisma --skip-generate`, {
        stdio: 'inherit',
        env: { ...process.env, MASTER_DATABASE_URL: masterUrl },
      });
    } catch {
      console.warn('> db push master a échoué, on continue.');
    }
  }

  // 2) Migrations base tenant
  console.log('> Migrations tenant DB');
  await ensureMigrations(tenantUrl);

  const master = new MasterPrismaClient({ datasources: { db: { url: masterUrl } } });
  const tenantClient = new PrismaClient({ datasources: { db: { url: tenantUrl } } });

  const tenant = await master.tenant.upsert({
    where: { code: args.code },
    update: { name: args.name, databaseUrl: tenantUrl },
    create: { code: args.code, name: args.name, databaseUrl: tenantUrl },
  });

  const passwordHash = hashPassword(args.password);
  await master.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: args.email } },
    update: { passwordHash, role: 'ADMIN' },
    create: { tenantId: tenant.id, email: args.email, passwordHash, role: 'ADMIN' },
  });

  await tenantClient.stockLocation.upsert({
    where: { code: args.locationCode },
    update: { name: args.locationName, isDefault: true },
    create: { code: args.locationCode, name: args.locationName, isDefault: true, isActive: true },
  });

  console.log(
    `OK: tenant=${args.code}, db=${args.dbUrl}, admin=${args.email}, location=${args.locationCode}/${args.locationName}`,
  );
  await master.$disconnect();
  await tenantClient.$disconnect();
}

main().catch(async (err) => {
  console.error('Bootstrap tenant failed:', err);
  process.exitCode = 1;
});
