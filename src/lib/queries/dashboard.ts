import {
  InvoiceStatus,
  OrderStatus,
  PoStatus,
  QuotationStatus,
  RequestStatus,
  Role,
  SourcingStatus,
} from "@/generated/prisma/enums";
import { moneyShort, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import type { Tone } from "@/lib/status";

const OPEN_REQUEST_STATUSES = [
  RequestStatus.NEW,
  RequestStatus.PREPARING_QUOTATION,
  RequestStatus.QUOTATION_SENT,
  RequestStatus.WAITING_RESPONSE,
];

const AWAITING_QUOTATION_STATUSES = [QuotationStatus.SENT, QuotationStatus.WAITING_RESPONSE];
const ACTIVE_ORDER_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.IN_PROGRESS];
const BILLABLE_ORDER_STATUSES = [OrderStatus.FULFILLED, OrderStatus.COMPLETED];
const OPEN_PO_STATUSES = [PoStatus.SENT, PoStatus.CONFIRMED, PoStatus.PARTIAL_RECEIVED];
const UNPAID_INVOICE_STATUSES = [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

export type RangeKey = "week" | "month" | "quarter" | "custom";

export const RANGE_LABELS: Record<RangeKey, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  custom: "Custom range",
};

const DAY = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function resolveRange(key: RangeKey, from?: string, to?: string) {
  const now = new Date();

  if (key === "custom" && from) {
    const start = startOfDay(new Date(from));
    const end = to ? new Date(startOfDay(new Date(to)).getTime() + DAY - 1) : now;
    return { key, from: start, to: end };
  }
  if (key === "week") {
    return { key, from: startOfDay(new Date(now.getTime() - 6 * DAY)), to: now };
  }
  if (key === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { key, from: new Date(now.getFullYear(), quarterStartMonth, 1), to: now };
  }
  return { key: "month" as RangeKey, from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
}

export type DashboardSettings = {
  requestWarningDays: number;
  quotationFollowUpDays: number;
  invoiceReminderDays: number;
  delayedAfterDays: number;
};

const SETTING_DEFAULTS: DashboardSettings = {
  requestWarningDays: 3,
  quotationFollowUpDays: 7,
  invoiceReminderDays: 3,
  delayedAfterDays: 14,
};

async function loadSettings(tenantId: string): Promise<DashboardSettings> {
  const rows = await prisma.setting.findMany({ where: { tenantId } });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const read = (key: string, fallback: number): number => {
    const raw = byKey.get(key);
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    requestWarningDays: read("aging.requestWarningDays", SETTING_DEFAULTS.requestWarningDays),
    quotationFollowUpDays: read("aging.quotationFollowUpDays", SETTING_DEFAULTS.quotationFollowUpDays),
    invoiceReminderDays: read("aging.invoiceReminderDays", SETTING_DEFAULTS.invoiceReminderDays),
    delayedAfterDays: read("fulfillment.delayedAfterDays", SETTING_DEFAULTS.delayedAfterDays),
  };
}

export type Metric = {
  id: string;
  label: string;
  value: string;
  hint?: string;
  href: string;
  tone: Tone;
  roles?: Role[];
};

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  tone: Tone;
};

export async function dashboardData(tenantId: string, range: { from: Date; to: Date }, role: Role) {
  const settings = await loadSettings(tenantId);
  const now = new Date();
  const period = { gte: range.from, lte: range.to };

  const [
    openRequests,
    requestsInPeriod,
    awaitingQuotation,
    pendingQuotations,
    activeOrders,
    unfulfilledItems,
    openPos,
    invoiceTotals,
    overdueTotals,
    periodPayments,
    billedOrderIds,
    approvalsPending,
    recentActivity,
    delayedOrders,
    agingRequests,
    agingQuotations,
    latePos,
    dueInvoices,
    overdueInvoices,
    overdueValue,
    unbilledOrders,
    salesThisPeriod,
    quotationWonLost,
  ] = await Promise.all([
    prisma.request.count({ where: { tenantId, status: { in: OPEN_REQUEST_STATUSES } } }),
    prisma.request.count({ where: { tenantId, requestDate: period } }),
    prisma.quotation.count({ where: { tenantId, status: QuotationStatus.WAITING_APPROVAL } }),
    prisma.quotation.count({ where: { tenantId, status: { in: AWAITING_QUOTATION_STATUSES } } }),
    prisma.order.count({ where: { tenantId, status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.orderItem.count({
      where: {
        deliveredQty: { lt: prisma.orderItem.fields.quantity },
        order: { tenantId, status: { in: [...ACTIVE_ORDER_STATUSES, OrderStatus.FULFILLED] } },
      },
    }),
    prisma.purchaseOrder.count({ where: { tenantId, status: { in: OPEN_PO_STATUSES } } }),
    prisma.invoice.aggregate({
      where: { tenantId, status: { in: UNPAID_INVOICE_STATUSES } },
      _sum: { grandTotal: true, amountPaid: true },
    }),
    prisma.invoice.aggregate({
      where: {
        tenantId,
        status: { in: UNPAID_INVOICE_STATUSES },
        dueDate: { lt: now },
      },
      _sum: { grandTotal: true, amountPaid: true },
    }),
    prisma.payment.aggregate({ where: { tenantId, paymentDate: period }, _sum: { amount: true } }),
    prisma.invoice.findMany({
      where: { tenantId, orderId: { not: null } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
    prisma.approval.count({ where: { tenantId, status: "PENDING" } }),
    prisma.activityLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.order.findMany({
      where: {
        tenantId,
        status: { in: ACTIVE_ORDER_STATUSES },
        estimatedFulfillmentDate: { lt: now },
      },
      include: { customer: { select: { companyName: true } } },
      orderBy: { estimatedFulfillmentDate: "asc" },
      take: 5,
    }),
    prisma.request.findMany({
      where: { tenantId, status: { in: OPEN_REQUEST_STATUSES }, requestDate: { lt: new Date(now.getTime() - settings.requestWarningDays * DAY) } },
      include: { customer: { select: { companyName: true } } },
      orderBy: { requestDate: "asc" },
      take: 5,
    }),
    prisma.quotation.findMany({
      where: {
        tenantId,
        status: { in: AWAITING_QUOTATION_STATUSES },
        sentAt: { lt: new Date(now.getTime() - settings.quotationFollowUpDays * DAY) },
      },
      include: { customer: { select: { companyName: true, whatsappNumber: true, phone: true } } },
      orderBy: { sentAt: "asc" },
      take: 5,
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, status: { in: OPEN_PO_STATUSES }, expectedDate: { lt: now } },
      include: { supplier: { select: { name: true, whatsappNumber: true, phone: true } } },
      orderBy: { expectedDate: "asc" },
      take: 5,
    }),
    prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: UNPAID_INVOICE_STATUSES },
        dueDate: { gte: now, lte: new Date(now.getTime() + settings.invoiceReminderDays * DAY) },
      },
      include: { customer: { select: { companyName: true } } },
      take: 5,
    }),
    prisma.invoice.findMany({
      where: { tenantId, status: { in: UNPAID_INVOICE_STATUSES }, dueDate: { lt: now } },
      include: { customer: { select: { companyName: true } } },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.invoice.aggregate({
      where: { tenantId, status: { in: UNPAID_INVOICE_STATUSES }, dueDate: { lt: now } },
      _sum: { grandTotal: true, amountPaid: true },
    }),
    prisma.order.findMany({
      where: { tenantId, status: { in: BILLABLE_ORDER_STATUSES } },
      select: { id: true, grandTotal: true, number: true, status: true },
    }),
    prisma.invoice.aggregate({
      where: { tenantId, invoiceDate: period },
      _sum: { grandTotal: true },
      _count: true,
    }),
    prisma.quotation.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
  ]);

  const billedIds = new Set(billedOrderIds.map((row) => row.orderId).filter(Boolean));
  const unbilled = unbilledOrders.filter((order) => !billedIds.has(order.id));
  const unbilledValue = unbilled.reduce((total, order) => total + num(order.grandTotal), 0);

  const outstanding = num(invoiceTotals._sum.grandTotal) - num(invoiceTotals._sum.amountPaid);
  const overdue = num(overdueTotals._sum.grandTotal) - num(overdueTotals._sum.amountPaid);
  const overdueValueAmount = num(overdueValue._sum.grandTotal) - num(overdueValue._sum.amountPaid);
  const revenue = num(periodPayments._sum.amount);

  const won = quotationWonLost.find((row) => row.status === QuotationStatus.APPROVED)?._count ?? 0;
  const lost = quotationWonLost.find((row) => row.status === QuotationStatus.REJECTED)?._count ?? 0;
  const conversionRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

  const allMetrics: Metric[] = [
    {
      id: "openRequests",
      label: "Open Requests",
      value: openRequests.toLocaleString("id-ID"),
      hint: `${requestsInPeriod} masuk pada periode ini`,
      href: "/requests?status=open",
      tone: "info",
      roles: [Role.OWNER, Role.MANAGER, Role.SALES],
    },
    {
      id: "pendingQuotation",
      label: "Pending Quotation",
      value: pendingQuotations.toLocaleString("id-ID"),
      hint: "Sudah dikirim, belum ada jawaban",
      href: "/quotations?status=SENT,WAITING_RESPONSE",
      tone: "warning",
      roles: [Role.OWNER, Role.MANAGER, Role.SALES],
    },
    {
      id: "activeOrders",
      label: "Active Orders",
      value: activeOrders.toLocaleString("id-ID"),
      hint: `${unfulfilledItems} baris belum terkirim`,
      href: "/orders?status=CONFIRMED,IN_PROGRESS",
      tone: "accent",
      roles: [Role.OWNER, Role.MANAGER, Role.SALES, Role.OPERATIONS],
    },
    {
      id: "inProcurement",
      label: "In Procurement",
      value: openPos.toLocaleString("id-ID"),
      hint: "PO berjalan ke supplier",
      href: "/procurement/purchase-orders?status=SENT,CONFIRMED,PARTIAL_RECEIVED",
      tone: "info",
      roles: [Role.OWNER, Role.MANAGER, Role.PROCUREMENT],
    },
    {
      id: "unfulfilled",
      label: "Unfulfilled",
      value: unfulfilledItems.toLocaleString("id-ID"),
      hint: "Baris order menunggu pemenuhan",
      href: "/fulfillment",
      tone: "warning",
      roles: [Role.OWNER, Role.MANAGER, Role.OPERATIONS, Role.SALES],
    },
    {
      id: "unbilled",
      label: "Unbilled",
      value: moneyShort(billedTotal(unbilled)),
      hint: `${unbilled.length} order selesai belum ditagih`,
      href: "/finance/invoices?status=none",
      tone: "warning",
      roles: [Role.OWNER, Role.MANAGER, Role.FINANCE],
    },
    {
      id: "outstanding",
      label: "Outstanding",
      value: moneyShort(outstanding),
      hint: "Piutang belum tertagih",
      href: "/finance/invoices?status=SENT,PARTIALLY_PAID,OVERDUE",
      tone: "accent",
      roles: [Role.OWNER, Role.MANAGER, Role.FINANCE],
    },
    {
      id: "overdue",
      label: "Overdue",
      value: moneyShort(overdue),
      hint: "Melewati jatuh tempo",
      href: "/finance/invoices?status=OVERDUE",
      tone: "danger",
      roles: [Role.OWNER, Role.MANAGER, Role.FINANCE],
    },
    {
      id: "revenue",
      label: "Revenue (period)",
      value: moneyShort(revenue),
      hint: `${salesThisPeriod._count} invoice, ${moneyShort(salesThisPeriod._sum.grandTotal)} nilai tagihan`,
      href: "/reports?report=sales",
      tone: "success",
      roles: [Role.OWNER, Role.MANAGER, Role.FINANCE, Role.SALES],
    },
    {
      id: "conversion",
      label: "Quotation Win Rate",
      value: `${conversionRate}%`,
      hint: `${won} menang / ${lost} kalah`,
      href: "/reports?report=sales",
      tone: conversionRate >= 50 ? "success" : "warning",
      roles: [Role.OWNER, Role.MANAGER, Role.SALES],
    },
    {
      id: "approvals",
      label: "Waiting Approval",
      value: approvalsPending.toLocaleString("id-ID"),
      hint: "Dokumen menunggu persetujuan",
      href: "/settings/approvals",
      tone: approvalsPending > 0 ? "warning" : "neutral",
      roles: [Role.OWNER, Role.MANAGER],
    },
  ];

  const metrics = allMetrics.filter((metric) => !metric.roles || metric.roles.includes(role));

  const attention: AttentionItem[] = [];

  for (const request of agingRequests) {
    const days = Math.floor((now.getTime() - request.requestDate.getTime()) / DAY);
    attention.push({
      id: `request-${request.id}`,
      title: `${request.number} · ${request.customer.companyName}`,
      detail: `Request belum ditindaklanjuti ${days} hari (threshold ${settings.requestWarningDays} hari).`,
      href: `/requests/${request.id}`,
      actionLabel: "View",
      tone: days > settings.requestWarningDays * 2 ? "danger" : "warning",
    });
  }

  for (const quotation of agingQuotations) {
    const days = quotation.sentAt ? Math.floor((now.getTime() - quotation.sentAt.getTime()) / DAY) : 0;
    const whatsapp = quotation.customer.whatsappNumber ?? quotation.customer.phone;
    attention.push({
      id: `quotation-${quotation.id}`,
      title: `${quotation.number} v${quotation.version} · ${quotation.customer.companyName}`,
      detail: `Terkirim ${days} hari tanpa respons (threshold ${settings.quotationFollowUpDays} hari).`,
      href: whatsapp ? `https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}` : `/quotations/${quotation.id}`,
      actionLabel: whatsapp ? "Follow up" : "View",
      tone: days > settings.quotationFollowUpDays * 2 ? "danger" : "warning",
    });
  }

  for (const order of delayedOrders) {
    const days = order.estimatedFulfillmentDate
      ? Math.floor((now.getTime() - order.estimatedFulfillmentDate.getTime()) / DAY)
      : 0;
    attention.push({
      id: `order-${order.id}`,
      title: `${order.number} · ${order.customer.companyName}`,
      detail: `Melewati estimasi fulfillment ${days} hari.`,
      href: `/orders/${order.id}`,
      actionLabel: "View",
      tone: "danger",
    });
  }

  for (const po of latePos) {
    const days = po.expectedDate ? Math.floor((now.getTime() - po.expectedDate.getTime()) / DAY) : 0;
    const whatsapp = po.supplier.whatsappNumber ?? po.supplier.phone;
    attention.push({
      id: `po-${po.id}`,
      title: `${po.number} · ${po.supplier.name}`,
      detail: `PO telat ${days} hari dari expected date.`,
      href: whatsapp ? `https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}` : `/procurement/purchase-orders/${po.id}`,
      actionLabel: whatsapp ? "Follow up" : "View",
      tone: "warning",
    });
  }

  for (const invoice of overdueInvoices) {
    const days = Math.floor((now.getTime() - invoice.dueDate.getTime()) / DAY);
    attention.push({
      id: `invoice-overdue-${invoice.id}`,
      title: `${invoice.number} · ${invoice.customer.companyName}`,
      detail: `Invoice lewat jatuh tempo ${days} hari — ${moneyShort(num(invoice.grandTotal) - num(invoice.amountPaid))}.`,
      href: `/finance/invoices/${invoice.id}`,
      actionLabel: "Send reminder",
      tone: "danger",
    });
  }

  for (const invoice of dueInvoices) {
    const days = Math.ceil((invoice.dueDate.getTime() - now.getTime()) / DAY);
    attention.push({
      id: `invoice-due-${invoice.id}`,
      title: `${invoice.number} · ${invoice.customer.companyName}`,
      detail: `Jatuh tempo dalam ${days} hari.`,
      href: `/finance/invoices/${invoice.id}`,
      actionLabel: "View",
      tone: "warning",
    });
  }

  const insights: string[] = [];
  if (delayedOrders.length > 0) insights.push(`${delayedOrders.length} order sudah melewati estimasi fulfillment.`);
  if (overdueValueAmount > 0) insights.push(`${moneyShort(overdueValueAmount)} invoice sudah melewati jatuh tempo.`);
  if (agingRequests.length > 0) insights.push(`${agingRequests.length} request belum ditindaklanjuti lebih dari ${settings.requestWarningDays} hari.`);
  if (latePos.length > 0) insights.push(`${latePos.length} PO supplier melewati expected date.`);
  if (approvalsPending > 0) insights.push(`${approvalsPending} dokumen menunggu approval internal.`);
  if (unbilled.length > 0) insights.push(`${unbilled.length} order selesai belum ditagih (${moneyShort(unbilledValue)}).`);
  if (insights.length === 0) insights.push("Semua indikator operasional dalam batas normal.");

  return {
    metrics,
    attention: attention.slice(0, 8),
    insights,
    recentActivity,
    settings,
    unbilledOrders: unbilled.slice(0, 5),
  };
}

function billedTotal(orders: { grandTotal: unknown }[]): number {
  return orders.reduce((total, order) => total + Number(order.grandTotal ?? 0), 0);
}

/** Kept separate so the UI and reports agree on what "unbilled" means. */
export async function sourcingBreakdown(tenantId: string) {
  const rows = await prisma.orderItem.groupBy({
    by: ["sourcingStatus"],
    where: { order: { tenantId, status: { in: ACTIVE_ORDER_STATUSES } } },
    _count: true,
  });
  return rows.map((row) => ({
    status: row.sourcingStatus as SourcingStatus,
    count: row._count,
  }));
}
