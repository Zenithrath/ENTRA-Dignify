import { PoStatus } from "@/generated/prisma/enums";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export type SupplierPerformance = {
  totalPos: number;
  receivedPos: number;
  onTimePercent: number | null;
  averageLeadTimeDays: number | null;
  score: number | null;
  lastPoDate: Date | null;
};

const DAY = 86_400_000;

/**
 * Success rate, average lead time and on-time delivery — all derived from PO history
 * so the number the buyer trusts is the same one procurement actually produced.
 */
export async function supplierPerformance(tenantId: string, supplierId: string): Promise<SupplierPerformance> {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { tenantId, supplierId },
    include: { receipts: { orderBy: { receivedDate: "asc" } } },
    orderBy: { poDate: "desc" },
  });

  const received = purchaseOrders.filter((po) => po.status === PoStatus.RECEIVED);
  const leadTimes: number[] = [];
  let onTime = 0;

  for (const po of received) {
    const firstReceipt = po.receipts[0];
    const lastReceipt = po.receipts[po.receipts.length - 1];
    if (!lastReceipt) continue;

    leadTimes.push(Math.max(0, Math.round((lastReceipt.receivedDate.getTime() - po.poDate.getTime()) / DAY)));
    if (po.expectedDate && firstReceipt.receivedDate.getTime() <= po.expectedDate.getTime() + DAY) onTime += 1;
  }

  const averageLeadTimeDays =
    leadTimes.length > 0 ? Math.round((leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length) * 10) / 10 : null;

  const onTimePercent = received.length > 0 ? Math.round((onTime / received.length) * 100) : null;
  const successRate = purchaseOrders.length > 0 ? received.length / purchaseOrders.length : null;

  const scoreParts = [successRate === null ? null : successRate, onTimePercent === null ? null : onTimePercent / 100].filter(
    (value): value is number => value !== null,
  );
  const score =
    scoreParts.length > 0 ? Math.round((scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length) * 100) / 10 : null;

  return {
    totalPos: purchaseOrders.length,
    receivedPos: received.length,
    onTimePercent,
    averageLeadTimeDays,
    score,
    lastPoDate: purchaseOrders[0]?.poDate ?? null,
  };
}

export type SuppliedProduct = {
  productId: string | null;
  description: string;
  unit: string;
  lastPrice: number;
  lastOrderedAt: Date;
  totalQuantity: number;
};

/** Products this supplier has actually quoted or shipped, with the last known price. */
export async function suppliedProducts(tenantId: string, supplierId: string): Promise<SuppliedProduct[]> {
  const items = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrder: { tenantId, supplierId } },
    include: { purchaseOrder: { select: { poDate: true } } },
    orderBy: { purchaseOrder: { poDate: "desc" } },
  });

  const byProduct = new Map<string, SuppliedProduct>();

  for (const item of items) {
    const key = item.productId ?? item.description;
    const existing = byProduct.get(key);
    if (existing) {
      existing.totalQuantity += num(item.quantity);
      continue;
    }
    byProduct.set(key, {
      productId: item.productId,
      description: item.description,
      unit: item.unit,
      lastPrice: num(item.unitPrice),
      lastOrderedAt: item.purchaseOrder.poDate,
      totalQuantity: num(item.quantity),
    });
  }

  return [...byProduct.values()];
}
