import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  
  const stockLocations: Prisma.StockLocationCreateInput[] = [
    {
      code: 'MAIN_WAREHOUSE',
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

  const products: Prisma.ProductCreateInput[] = [
    {
      name: 'Croquettes premium poulet',
      description: 'Croquettes riches en protéines pour chien adulte.',
      price: new Prisma.Decimal('39.90'),
      sku: 'FOOD-CHK-10KG',
    },
    {
      name: 'Litière agglomérante',
      description: 'Litière végétale agglomérante faible poussière.',
      price: new Prisma.Decimal('12.50'),
      sku: 'LIT-VEG-15L',
    },
    {
      name: 'Jouet corde tressée',
      description: 'Corde résistante pour mâchouille et jeu de traction.',
      price: new Prisma.Decimal('8.90'),
      sku: 'TOY-ROPE-M',
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product,
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
