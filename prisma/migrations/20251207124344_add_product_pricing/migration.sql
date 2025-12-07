-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL NOT NULL,
    "priceVdiHt" DECIMAL NOT NULL DEFAULT 0,
    "priceDistributorHt" DECIMAL NOT NULL DEFAULT 0,
    "priceSaleHt" DECIMAL NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL NOT NULL DEFAULT 0,
    "tvaRate" DECIMAL NOT NULL DEFAULT 0,
    "packaging" TEXT,
    "sku" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "axonautProductId" INTEGER,
    "familyId" INTEGER,
    "subFamilyId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_subFamilyId_fkey" FOREIGN KEY ("subFamilyId") REFERENCES "SubFamily" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("axonautProductId", "createdAt", "description", "familyId", "id", "isActive", "name", "price", "sku", "subFamilyId", "updatedAt") SELECT "axonautProductId", "createdAt", "description", "familyId", "id", "isActive", "name", "price", "sku", "subFamilyId", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
UPDATE "Product"
SET
  "priceVdiHt" = "price",
  "priceDistributorHt" = "price",
  "priceSaleHt" = "price";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_axonautProductId_key" ON "Product"("axonautProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
