/*
  Warnings:

  - A unique constraint covering the columns `[axonautProductId]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN "axonautProductId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Product_axonautProductId_key" ON "Product"("axonautProductId");
