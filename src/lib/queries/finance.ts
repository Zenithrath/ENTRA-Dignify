import { cache } from "react";

import { InvoiceStatus } from "@/generated/prisma/enums";
import { num, round2, type MoneyLike } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/** Invoices that still owe money — drafts and cancellations never count as receivable. */
export const OPEN_INVOICE_STATUSES = [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

export type AgingBucket = {
  label: string;
  amount: number;
  count: number;
};

export type ReceivablesSummary = {
  outstanding: number;
  overdue: number;
  overdueCount: number;
  openCount: number;
  collectedThisMonth: number;
  aging: AgingBucket[];
};

const BUCKETS = [
  { label: "Belum jatuh tempo", from: Number.NEGATIVE_INFINITY, to: 0 },
  { label: "1–30 hari", from: 1, to: 30 },
  { label: "31–60 hari", from: 31, to: 60 },
  { label: "61–90 hari", from: 61, to: 90 },
  { label: "> 90 hari", from: 91, to: Number.POSITIVE_INFINITY },
];

export const receivablesSummary = cache(async (tenantId: string): Promise<ReceivablesSummary> => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [invoices, paymentsThisMonth] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, status: { in: OPEN_INVOICE_STATUSES } },
      select: { grandTotal: true, amountPaid: true, dueDate: true, status: true },
    }),
    prisma.payment.aggregate({
      where: { tenantId, paymentDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
  ]);

  const aging: AgingBucket[] = BUCKETS.map((bucket) => ({ label: bucket.label, amount: 0, count: 0 }));
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;

  for (const invoice of invoices) {
    const due = round2(num(invoice.grandTotal) - num(invoice.amountPaid));
    if (due <= 0) continue;
    outstanding += due;

    const daysLate = Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000);
    if (daysLate > 0) {
      overdue += due;
      overdueCount += 1;
    }

    const index = BUCKETS.findIndex((bucket) => daysLate >= bucket.from && daysLate <= bucket.to);
    const bucket = aging[index === -1 ? BUCKETS.length - 1 : index];
    bucket.amount = round2(bucket.amount + due);
    bucket.count += 1;
  }

  return {
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    overdueCount,
    openCount: invoices.filter((invoice) => round2(num(invoice.grandTotal) - num(invoice.amountPaid)) > 0).length,
    collectedThisMonth: round2(num(paymentsThisMonth._sum.amount)),
    aging,
  };
});

/** Same shape for payables, but derived from supplier POs instead of invoices. */
export const payablesSummary = cache(async (tenantId: string) => {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { tenantId, status: { in: ["SENT", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED"] } },
    select: { grandTotal: true, expectedDate: true, status: true },
  });

  const outstanding = purchaseOrders.reduce((total, po) => total + num(po.grandTotal), 0);
  const overdue = purchaseOrders
    .filter((po) => po.expectedDate && po.expectedDate.getTime() < Date.now())
    .reduce((total, po) => total + num(po.grandTotal), 0);

  return { outstanding: round2(outstanding), overdue: round2(overdue), count: purchaseOrders.length };
});

export function daysOverdue(dueDate: Date): number {
  return Math.floor((Date.now() - dueDate.getTime()) / 86_400_000);
}

export function outstandingOf(invoice: { grandTotal: MoneyLike; amountPaid: MoneyLike }): number {
  return round2(num(invoice.grandTotal) - num(invoice.amountPaid));
}
