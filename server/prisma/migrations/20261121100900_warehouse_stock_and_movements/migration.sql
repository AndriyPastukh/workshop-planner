-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('receipt', 'reserve', 'release', 'consume', 'waste', 'adjustment');

-- AlterTable (rename existing columns to preserve historical rows)
ALTER TABLE "material_stock_movements" RENAME COLUMN "deltaQty" TO "qty";
ALTER TABLE "material_stock_movements" RENAME COLUMN "reason" TO "comment";

ALTER TABLE "material_stock_movements"
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "type" "StockMovementType" NOT NULL DEFAULT 'adjustment',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "reservedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "actualMaterialQty" DOUBLE PRECISION,
ADD COLUMN     "plannedMaterialQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "machines_type_isActive_idx" ON "machines"("type", "isActive");

-- CreateIndex
CREATE INDEX "material_stock_movements_orderId_idx" ON "material_stock_movements"("orderId");

-- CreateIndex
CREATE INDEX "material_stock_movements_orderItemId_idx" ON "material_stock_movements"("orderItemId");

-- CreateIndex
CREATE INDEX "material_stock_movements_userId_idx" ON "material_stock_movements"("userId");

-- CreateIndex
CREATE INDEX "material_stock_movements_type_idx" ON "material_stock_movements"("type");

-- CreateIndex
CREATE INDEX "materials_machineType_idx" ON "materials"("machineType");

-- CreateIndex
CREATE INDEX "order_items_materialId_idx" ON "order_items"("materialId");

-- CreateIndex
CREATE INDEX "order_items_machineType_idx" ON "order_items"("machineType");

-- CreateIndex
CREATE INDEX "product_templates_materialId_idx" ON "product_templates"("materialId");

-- CreateIndex
CREATE INDEX "product_templates_machineType_idx" ON "product_templates"("machineType");

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce non-negative warehouse stock & planned/actual quantities at DB level
ALTER TABLE "materials" ADD CONSTRAINT "materials_stock_qty_nonnegative" CHECK ("stockQty" >= 0);
ALTER TABLE "materials" ADD CONSTRAINT "materials_reserved_qty_nonnegative" CHECK ("reservedQty" >= 0);
ALTER TABLE "materials" ADD CONSTRAINT "materials_min_stock_qty_nonnegative" CHECK ("minStockQty" >= 0);
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_qty_nonzero" CHECK ("qty" <> 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_planned_qty_nonnegative" CHECK ("plannedMaterialQty" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_actual_qty_nonnegative" CHECK ("actualMaterialQty" IS NULL OR "actualMaterialQty" >= 0);
