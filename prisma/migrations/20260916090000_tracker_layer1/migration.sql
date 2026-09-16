-- CreateEnum
CREATE TYPE "TrackerStatus" AS ENUM ('WAITING_PO', 'PO_RECEIVED', 'LOST');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('TO_SOURCE', 'ORDERED', 'READY_TO_SHIP', 'DELIVERED');

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "customerPoDate" TIMESTAMP(3),
ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "trackerStatus" "TrackerStatus" NOT NULL DEFAULT 'WAITING_PO';

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "deliveryMethod" TEXT,
ADD COLUMN     "vendor" TEXT,
ADD COLUMN     "workStatus" "WorkStatus" NOT NULL DEFAULT 'TO_SOURCE';

-- CreateIndex
CREATE INDEX "Quotation_tenantId_trackerStatus_idx" ON "Quotation"("tenantId", "trackerStatus");

-- CreateIndex
CREATE INDEX "QuotationItem_workStatus_idx" ON "QuotationItem"("workStatus");
