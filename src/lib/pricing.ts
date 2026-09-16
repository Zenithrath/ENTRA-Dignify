import { num, round2, type MoneyLike } from "@/lib/money";

export type PriceableLine = {
  quantity: MoneyLike;
  unitPrice: MoneyLike;
  discountPercent?: MoneyLike;
  taxRate?: MoneyLike;
  costPrice?: MoneyLike;
};

export type PricedLine = {
  /** quantity × unitPrice, before discount and tax. */
  gross: number;
  discount: number;
  /** gross − discount: the amount tax is calculated on. */
  net: number;
  tax: number;
  /** net + tax, what the customer pays for this line. */
  total: number;
  cost: number;
  margin: number;
  marginPercent: number;
};

export function priceLine(line: PriceableLine, quantityOverride?: number): PricedLine {
  const quantity = quantityOverride ?? num(line.quantity);
  const unitPrice = num(line.unitPrice);
  const discountPercent = num(line.discountPercent);
  const taxRate = num(line.taxRate);
  const unitCost = num(line.costPrice);

  const gross = round2(quantity * unitPrice);
  const discount = round2((gross * discountPercent) / 100);
  const net = round2(gross - discount);
  const tax = round2((net * taxRate) / 100);
  const cost = round2(quantity * unitCost);
  const margin = round2(net - cost);

  return {
    gross,
    discount,
    net,
    tax,
    total: round2(net + tax),
    cost,
    margin,
    marginPercent: net > 0 ? round2((margin / net) * 100) : 0,
  };
}

export type DocumentSummary = {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingCost: number;
  grandTotal: number;
  costTotal: number;
  estimatedProfit: number;
  marginPercent: number;
};

export function summarizeDocument(
  lines: PriceableLine[],
  options: { shippingCost?: MoneyLike } = {},
): DocumentSummary {
  const shippingCost = num(options.shippingCost);

  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let costTotal = 0;

  for (const line of lines) {
    const priced = priceLine(line);
    subtotal += priced.gross;
    discountTotal += priced.discount;
    taxTotal += priced.tax;
    costTotal += priced.cost;
  }

  const netRevenue = round2(subtotal - discountTotal);
  const estimatedProfit = round2(netRevenue - costTotal);

  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxTotal: round2(taxTotal),
    shippingCost: round2(shippingCost),
    grandTotal: round2(netRevenue + taxTotal + shippingCost),
    costTotal: round2(costTotal),
    estimatedProfit,
    marginPercent: netRevenue > 0 ? round2((estimatedProfit / netRevenue) * 100) : 0,
  };
}

export function isApprovalRequired(grandTotal: MoneyLike, threshold: MoneyLike): boolean {
  return num(grandTotal) >= num(threshold) && num(threshold) > 0;
}
