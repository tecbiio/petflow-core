-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL NOT NULL,
    "sku" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "axonautProductId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("axonautProductId", "createdAt", "description", "id", "name", "price", "sku", "updatedAt") SELECT "axonautProductId", "createdAt", "description", "id", "name", "price", "sku", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_axonautProductId_key" ON "Product"("axonautProductId");
CREATE TABLE "new_StockLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StockLocation" ("code", "createdAt", "id", "isDefault", "name", "updatedAt") SELECT "code", "createdAt", "id", "isDefault", "name", "updatedAt" FROM "StockLocation";
DROP TABLE "StockLocation";
ALTER TABLE "new_StockLocation" RENAME TO "StockLocation";
CREATE UNIQUE INDEX "StockLocation_code_key" ON "StockLocation"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
