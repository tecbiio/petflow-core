import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Minimal seed script to create data required for the application to run
async function main() {
  
  const stockLocations: Prisma.StockLocationCreateInput[] = [
    {
      code: 'MAIN',
      name: 'Entrepôt principal',
      isDefault: true,
    },
  ];

  for (const location of stockLocations) {
    await prisma.stockLocation.upsert({
      where: { code: location.code },
      update: location,
      create: location,
    });
  }
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
