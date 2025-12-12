-- CreateTable
CREATE TABLE "DailyStockValuation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "valuationDate" DATETIME NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "stockLocationId" INTEGER,
    "totalValueCts" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyStockValuation_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyStockValuation_valuationDate_scopeKey_key" ON "DailyStockValuation"("valuationDate", "scopeKey");
CREATE INDEX "DailyStockValuation_stockLocationId_idx" ON "DailyStockValuation"("stockLocationId");
