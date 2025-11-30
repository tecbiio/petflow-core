import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } });

  if (products.length === 0) {
    console.log('Aucun produit en base. Lancez `npm run prisma:seed` pour créer des données de test.');
    return;
  }

  console.log(`Produits (${products.length}) :`);
  for (const product of products) {
    console.log(
      `- #${product.id} ${product.name} ${product.sku} — ${product.price.toFixed(
        2,
      )}€`,
    );
  }
}

main()
  .catch((error) => {
    console.error('Erreur lors de la récupération des produits', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
