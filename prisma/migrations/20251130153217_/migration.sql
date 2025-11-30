/*
  Warnings:

  - Added the required column `code` to the `StockLocation` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StockLocation" ("createdAt", "id", "isDefault", "name", "updatedAt") SELECT "createdAt", "id", "isDefault", "name", "updatedAt" FROM "StockLocation";
DROP TABLE "StockLocation";
ALTER TABLE "new_StockLocation" RENAME TO "StockLocation";
CREATE UNIQUE INDEX "StockLocation_code_key" ON "StockLocation"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
