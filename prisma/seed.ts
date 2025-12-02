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
    {
      code: 'PARIS_STORE',
      name: 'Boutique Paris',
      isDefault: false,
    },
    {
      code: 'LYON_HUB',
      name: 'Hub logistique Lyon',
      isDefault: false,
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
    {
      name: 'Friandises saumon',
      description: 'Snack hypoallergénique pour chiens sensibles.',
      price: new Prisma.Decimal('6.50'),
      sku: 'TREAT-SAL-150',
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product,
    });
  }

  const dbProducts = await prisma.product.findMany();
  const dbLocations = await prisma.stockLocation.findMany();

  const productId = (sku: string) => {
    const id = dbProducts.find((p) => p.sku === sku)?.id;
    if (!id) throw new Error(`Product ${sku} not found after upsert`);
    return id;
  };
  const locationId = (code: string) => {
    const id = dbLocations.find((l) => l.code === code)?.id;
    if (!id) throw new Error(`Location ${code} not found after upsert`);
    return id;
  };

  // Reset movements/inventories to keep seed idempotent
  await prisma.stockMovement.deleteMany();
  await prisma.inventory.deleteMany();

  const inventories: Prisma.InventoryCreateManyInput[] = [
    {
      productId: productId('FOOD-CHK-10KG'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantity: 120,
      createdAt: new Date('2025-01-01T08:00:00Z'),
    },
    {
      productId: productId('FOOD-CHK-10KG'),
      stockLocationId: locationId('PARIS_STORE'),
      quantity: 32,
      createdAt: new Date('2025-01-05T08:00:00Z'),
    },
    {
      productId: productId('LIT-VEG-15L'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantity: 80,
      createdAt: new Date('2025-01-03T08:00:00Z'),
    },
    {
      productId: productId('TOY-ROPE-M'),
      stockLocationId: locationId('LYON_HUB'),
      quantity: 45,
      createdAt: new Date('2025-01-02T08:00:00Z'),
    },
    {
      productId: productId('TREAT-SAL-150'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantity: 60,
      createdAt: new Date('2025-01-04T08:00:00Z'),
    },
  ];

  await prisma.inventory.createMany({ data: inventories });

  const movements: Prisma.StockMovementCreateManyInput[] = [
    {
      productId: productId('FOOD-CHK-10KG'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantityDelta: -4,
      reason: 'Commande e-commerce #49584',
      createdAt: new Date('2025-01-01T10:00:00Z'),
    },
    {
      productId: productId('FOOD-CHK-10KG'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantityDelta: -2,
      reason: 'Commande pro #49585',
      createdAt: new Date('2025-01-10T15:00:00Z'),
    },
    {
      productId: productId('FOOD-CHK-10KG'),
      stockLocationId: locationId('PARIS_STORE'),
      quantityDelta: 7,
      reason: 'Réassort boutique Paris',
      createdAt: new Date('2025-01-12T09:00:00Z'),
    },
    {
      productId: productId('LIT-VEG-15L'),
      stockLocationId: locationId('PARIS_STORE'),
      quantityDelta: -5,
      reason: 'Vente comptoir',
      createdAt: new Date('2025-01-06T11:00:00Z'),
    },
    {
      productId: productId('TOY-ROPE-M'),
      stockLocationId: locationId('LYON_HUB'),
      quantityDelta: -3,
      reason: 'Commande client #50010',
      createdAt: new Date('2025-01-08T14:00:00Z'),
    },
    {
      productId: productId('TREAT-SAL-150'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantityDelta: 20,
      reason: 'Réception fournisseur',
      createdAt: new Date('2025-01-09T07:00:00Z'),
    },
    {
      productId: productId('TREAT-SAL-150'),
      stockLocationId: locationId('MAIN_WAREHOUSE'),
      quantityDelta: -6,
      reason: 'DLC courte détruite',
      createdAt: new Date('2025-01-11T08:30:00Z'),
    },
  ];

  await prisma.stockMovement.createMany({ data: movements });
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
