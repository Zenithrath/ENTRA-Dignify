import { num, round2 } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const DAY = 86_400_000;

export type DateRange = { from: Date; to: Date };

export function defaultRange(days = 90): DateRange {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  return { from: new Date(to.getTime() - days * DAY), to };
}

export function parseRange(from?: string, to?: string): DateRange {
  const fallback = defaultRange();
  const start = from ? new Date(from) : fallback.from;
  const end = to ? new Date(`${to}T23:59:59`) : fallback.to;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;
  return { from: start, to: end };
}

export type SalesReport = {
  orderCount: number;
  orderValue: number;
  quotationCount: number;
  wonQuotations: number;
  conversionRate: number;
  averageOrderValue: number;
  byCustomer: { id: string; name: string; orders: number; value: number }[];
  byProduct: { description: string; quantity: number; value: number; margin: number }[];
  byMonth: { label: string; value: number; orders: number }[];
};

export async function salesReport(tenantId: string, range: DateRange): Promise<SalesReport> {
  const [orders, quotations] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, orderDate: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } },
      include: {
        customer: { select: { id: true, companyName: true } },
        items: { select: { description: true, quantity: true, sellingPrice: true, costPrice: true, discountPercent: true } },
      },
    }),
    prisma.quotation.findMany({
      where: { tenantId, quotationDate: { gte: range.from, lte: range.to } },
      select: { status: true },
    }),
  ]);

  let orderValue = 0;
  const customerMap = new Map<string, { id: string; name: string; orders: number; value: number }>();
  const productMap = new Map<string, { description: string; quantity: number; value: number; margin: number }>();
  const monthMap = new Map<string, { label: string; value: number; orders: number }>();

  for (const order of orders) {
    const total = num(order.grandTotal);
    orderValue += total;

    const customer = customerMap.get(order.customerId) ?? {
      id: order.customerId,
      name: order.customer.companyName,
      orders: 0,
      value: 0,
    };
    customer.orders += 1;
    customer.value = round2(customer.value + total);
    customerMap.set(order.customerId, customer);

    const key = `${order.orderDate.getFullYear()}-${String(order.orderDate.getMonth() + 1).padStart(2, "0")}`;
    const month = monthMap.get(key) ?? { label: key, value: 0, orders: 0 };
    month.value = round2(month.value + total);
    month.orders += 1;
    monthMap.set(key, month);

    for (const item of order.items) {
      const quantity = num(item.quantity);
      const gross = quantity * num(item.sellingPrice);
      const net = gross * (1 - num(item.discountPercent) / 100);
      const entry = productMap.get(item.description) ?? { description: item.description, quantity: 0, value: 0, margin: 0 };
      entry.quantity += quantity;
      entry.value = round2(entry.value + net);
      entry.margin = round2(entry.margin + (net - quantity * num(item.costPrice)));
      productMap.set(item.description, entry);
    }
  }

  const wonQuotations = quotations.filter((quotation) => quotation.status === "APPROVED").length;

  return {
    orderCount: orders.length,
    orderValue: round2(orderValue),
    quotationCount: quotations.length,
    wonQuotations,
    conversionRate: quotations.length > 0 ? round2((wonQuotations / quotations.length) * 100) : 0,
    averageOrderValue: orders.length > 0 ? round2(orderValue / orders.length) : 0,
    byCustomer: [...customerMap.values()].sort((a, b) => b.value - a.value).slice(0, 12),
    byProduct: [...productMap.values()].sort((a, b) => b.value - a.value).slice(0, 12),
    byMonth: [...monthMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export type ProcurementReport = {
  poCount: number;
  poValue: number;
  outstandingValue: number;
  outstandingCount: number;
  bySupplier: {
    id: string;
    name: string;
    pos: number;
    value: number;
    received: number;
    onTimePercent: number | null;
    averageLeadTimeDays: number | null;
  }[];
};

export async function procurementReport(tenantId: string, range: DateRange): Promise<ProcurementReport> {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { tenantId, poDate: { gte: range.from, lte: range.to } },
    include: {
      supplier: { select: { id: true, name: true } },
      receipts: { orderBy: { receivedDate: "asc" } },
    },
  });

  const supplierMap = new Map<string, ProcurementReport["bySupplier"][number]>();
  let poValue = 0;

  for (const po of purchaseOrders) {
    const total = num(po.grandTotal);
    poValue += total;

    const entry = supplierMap.get(po.supplierId) ?? {
      id: po.supplierId,
      name: po.supplier.name,
      pos: 0,
      value: 0,
      received: 0,
      onTimePercent: null,
      averageLeadTimeDays: null,
    };
    entry.pos += 1;
    entry.value = round2(entry.value + total);
    supplierMap.set(po.supplierId, entry);
  }

  // Second pass per supplier so lead-time maths stays exact rather than averaged averages.
  for (const [supplierId, entry] of supplierMap) {
    const supplierPos = purchaseOrders.filter((po) => po.supplierId === supplierId);
    const receivedPos = supplierPos.filter((po) => po.status === "RECEIVED");
    const leadTimes: number[] = [];
    let onTime = 0;

    for (const po of receivedPos) {
      const last = po.receipts[po.receipts.length - 1];
      const first = po.receipts[0];
      if (!last || !first) continue;
      leadTimes.push(Math.max(0, Math.round((last.receivedDate.getTime() - po.poDate.getTime()) / DAY)));
      if (po.expectedDate && first.receivedDate.getTime() <= po.expectedDate.getTime() + DAY) onTime += 1;
    }

    entry.received = receivedPos.length;
    entry.onTimePercent = receivedPos.length > 0 ? Math.round((onTime / receivedPos.length) * 100) : null;
    entry.averageLeadTimeDays =
      leadTimes.length > 0 ? round2(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length) : null;
  }

  const outstanding = await prisma.purchaseOrder.findMany({
    where: { tenantId, status: { in: ["DRAFT", "SENT", "CONFIRMED", "PARTIAL_RECEIVED"] } },
    select: { grandTotal: true },
  });

  return {
    poCount: purchaseOrders.length,
    poValue: round2(poValue),
    outstandingValue: round2(outstanding.reduce((sum, po) => sum + num(po.grandTotal), 0)),
    outstandingCount: outstanding.length,
    bySupplier: [...supplierMap.values()].sort((a, b) => b.value - a.value),
  };
}

export type FinanceReport = {
  invoiced: number;
  collected: number;
  outstanding: number;
  overdue: number;
  profit: number;
  marginPercent: number;
  byMonth: { label: string; invoiced: number; collected: number }[];
  overdueInvoices: {
    id: string;
    number: string;
    customer: string;
    dueDate: Date;
    outstanding: number;
    daysLate: number;
  }[];
};

export async function financeReport(tenantId: string, range: DateRange): Promise<FinanceReport> {
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      status: { notIn: ["CANCELLED"] },
      OR: [
        { invoiceDate: { gte: range.from, lte: range.to } },
        { dueDate: { gte: range.from, lte: range.to } },
      ],
    },
    include: {
      customer: { select: { companyName: true } },
      payments: { select: { amount: true, paymentDate: true } },
      items: { select: { quantity: true, unitPrice: true, discountPercent: true, orderItem: { select: { costPrice: true } } } },
    },
  });

  const monthMap = new Map<string, { label: string; invoiced: number; collected: number }>();
  let invoiced = 0;
  let collected = 0;
  let outstanding = 0;
  let overdue = 0;
  let profit = 0;
  let revenueBase = 0;

  const overdueInvoices: FinanceReport["overdueInvoices"] = [];

  for (const invoice of invoices) {
    const total = num(invoice.grandTotal);
    const paid = invoice.payments.reduce((sum, payment) => sum + num(payment.amount), 0);
    const due = round2(total - paid);
    invoiced += total;
    collected += paid;
    if (due > 0) outstanding += due;

    const key = `${invoice.invoiceDate.getFullYear()}-${String(invoice.invoiceDate.getMonth() + 1).padStart(2, "0")}`;
    const month = monthMap.get(key) ?? { label: key, invoiced: 0, collected: 0 };
    month.invoiced = round2(month.invoiced + total);
    for (const payment of invoice.payments) {
      const payKey = `${payment.paymentDate.getFullYear()}-${String(payment.paymentDate.getMonth() + 1).padStart(2, "0")}`;
      const payMonth = monthMap.get(payKey) ?? { label: payKey, invoiced: 0, collected: 0 };
      payMonth.collected = round2(payMonth.collected + num(payment.amount));
      monthMap.set(payKey, payMonth);
    }
    monthMap.set(key, month);

    let cost = 0;
    for (const item of invoice.items) {
      const gross = num(item.quantity) * num(item.unitPrice);
      const net = gross * (1 - num(item.discountPercent) / 100);
      revenueBase += net;
      cost += num(item.quantity) * num(item.orderItem?.costPrice);
    }
    profit += total - cost;

    const daysLate = Math.floor((Date.now() - invoice.dueDate.getTime()) / DAY);
    if (due > 0 && daysLate > 0) {
      overdue += due;
      overdueInvoices.push({
        id: invoice.id,
        number: invoice.number,
        customer: invoice.customer.companyName,
        dueDate: invoice.dueDate,
        outstanding: due,
        daysLate,
      });
    }
  }

  return {
    invoiced: round2(invoiced),
    collected: round2(collected),
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    profit: round2(profit),
    marginPercent: revenueBase > 0 ? round2((profit / revenueBase) * 100) : 0,
    byMonth: [...monthMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    overdueInvoices: overdueInvoices.sort((a, b) => b.daysLate - a.daysLate).slice(0, 15),
  };
}

export type OperationsReport = {
  openOrders: number;
  delayedOrders: number;
  openWorkOrders: number;
  openProduction: number;
  openSubcontracts: number;
  openDeliveries: number;
  statusBreakdown: { status: string; count: number }[];
  delayedList: { id: string; number: string; customer: string; expected: Date | null; daysLate: number }[];
};

export async function operationsReport(tenantId: string): Promise<OperationsReport> {
  const openStatuses = ["CONFIRMED", "IN_PROGRESS", "FULFILLED"] as const;

  const [orders, workOrders, productionOrders, subcontracts, deliveries] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId },
      include: { customer: { select: { companyName: true } } },
      orderBy: { orderDate: "desc" },
      take: 500,
    }),
    prisma.workOrder.count({ where: { tenantId, status: { in: ["DRAFT", "SCHEDULED", "IN_PROGRESS"] } } }),
    prisma.productionOrder.count({ where: { tenantId, status: { in: ["DRAFT", "IN_PROGRESS", "QC", "REWORK"] } } }),
    prisma.subcontract.count({ where: { tenantId, status: { in: ["DRAFT", "ASSIGNED", "IN_PROGRESS", "INSPECTION"] } } }),
    prisma.deliveryOrder.count({ where: { tenantId, status: { in: ["NOT_READY", "READY_TO_SHIP", "IN_DELIVERY"] } } }),
  ]);

  const statusMap = new Map<string, number>();
  for (const order of orders) statusMap.set(order.status, (statusMap.get(order.status) ?? 0) + 1);

  const delayed = orders
    .filter((order) => openStatuses.includes(order.status as (typeof openStatuses)[number]))
    .map((order) => {
      const expected = order.estimatedFulfillmentDate ?? order.expectedDeliveryDate;
      const daysLate = expected ? Math.floor((Date.now() - expected.getTime()) / DAY) : 0;
      return {
        id: order.id,
        number: order.number,
        customer: order.customer.companyName,
        expected,
        daysLate,
      };
    })
    .filter((row) => row.daysLate > 0)
    .sort((a, b) => b.daysLate - a.daysLate);

  return {
    openOrders: orders.filter((order) => openStatuses.includes(order.status as (typeof openStatuses)[0])).length,
    delayedOrders: delayed.length,
    openWorkOrders: workOrders,
    openProduction: productionOrders,
    openSubcontracts: subcontracts,
    openDeliveries: deliveries,
    statusBreakdown: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    delayedList: delayed.slice(0, 15),
  };
}
