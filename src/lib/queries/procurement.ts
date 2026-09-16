import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export type ComparisonRow = {
  rfqItemId: string;
  description: string;
  unit: string;
  quantity: number;
  quotes: {
    quoteId: string;
    supplierId: string;
    supplierName: string;
    unitPrice: number;
    leadTimeDays: number | null;
    isWinner: boolean;
    lineTotal: number;
  }[];
  cheapestQuoteId: string | null;
  fastestQuoteId: string | null;
};

/**
 * Builds the RFQ price-comparison matrix, flagging the cheapest price and the
 * fastest lead time per item so the buyer does not have to eyeball the table.
 */
export async function rfqComparison(tenantId: string, rfqId: string): Promise<ComparisonRow[]> {
  const items = await prisma.rfqItem.findMany({
    where: { rfqId, rfq: { tenantId } },
    include: {
      quotes: { include: { supplierQuotation: { include: { supplier: { select: { id: true, name: true } } } } } },
    },
    orderBy: { id: "asc" },
  });

  return items.map((item) => {
    const quotes = item.quotes.map((quote) => ({
      quoteId: quote.id,
      supplierId: quote.supplierQuotation.supplier.id,
      supplierName: quote.supplierQuotation.supplier.name,
      unitPrice: num(quote.unitPrice),
      leadTimeDays: quote.leadTimeDays ?? quote.supplierQuotation.leadTimeDays,
      isWinner: quote.isWinner,
      lineTotal: num(quote.lineTotal),
    }));

    const priced = quotes.filter((quote) => quote.unitPrice > 0);
    const cheapest = priced.length > 0 ? priced.reduce((best, quote) => (quote.unitPrice < best.unitPrice ? quote : best)) : null;
    const withLeadTime = quotes.filter((quote) => quote.leadTimeDays !== null);
    const fastest =
      withLeadTime.length > 0
        ? withLeadTime.reduce((best, quote) => ((quote.leadTimeDays ?? 999) < (best.leadTimeDays ?? 999) ? quote : best))
        : null;

    return {
      rfqItemId: item.id,
      description: item.description,
      unit: item.unit,
      quantity: num(item.quantity),
      quotes,
      cheapestQuoteId: cheapest?.quoteId ?? null,
      fastestQuoteId: fastest?.quoteId ?? null,
    };
  });
}

export async function suppliersForComparison(tenantId: string, rfqId: string) {
  const rows = await prisma.rfqSupplier.findMany({
    where: { rfqId, rfq: { tenantId } },
    include: { supplier: { select: { id: true, name: true, leadTimeDays: true } } },
  });
  return rows.map((row) => ({
    id: row.supplier.id,
    name: row.supplier.name,
    leadTimeDays: row.supplier.leadTimeDays,
    status: row.status,
  }));
}
