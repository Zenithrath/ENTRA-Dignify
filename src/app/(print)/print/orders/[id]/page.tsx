import { notFound } from "next/navigation";

import { Letterhead, PrintFooter, PrintTable, PrintTotals, SignatureBlocks } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";
import { statusMeta } from "@/lib/status";

export default async function PrintOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;

  const [order, tenant] = await Promise.all([
    prisma.order.findFirst({
      where: { id, tenantId: auth.user.tenantId },
      include: {
        customer: true,
        items: { orderBy: { sortOrder: "asc" } },
        quotation: { select: { number: true, version: true } },
      },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } }),
  ]);

  if (!order) notFound();

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Sales Order Confirmation"
        docNumber={order.number}
        meta={[
          { label: "Order date", value: formatDate(order.orderDate) },
          { label: "Customer PO", value: order.customerPoNumber ?? "—" },
          { label: "Est. fulfillment", value: formatDate(order.estimatedFulfillmentDate) },
          { label: "Status", value: statusMeta(order.status).label },
        ]}
      />

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Customer</p>
          <p className="mt-1 font-medium text-slate-900">{order.customer.companyName}</p>
          <p className="text-xs leading-relaxed text-slate-600">
            {[order.customer.address, order.customer.city].filter(Boolean).join(", ")}
          </p>
        </div>
        <div className="text-right text-xs leading-relaxed text-slate-600">
          <p>
            <span className="text-slate-500">Reference quotation:</span>{" "}
            {order.quotation ? `${order.quotation.number} v${order.quotation.version}` : "—"}
          </p>
          <p>
            <span className="text-slate-500">Payment terms:</span> {order.customer.paymentTerms ?? "—"}
          </p>
        </div>
      </section>

      <PrintTable
        lines={order.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.sellingPrice,
          discountPercent: item.discountPercent,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
        }))}
      />

      <PrintTotals
        rows={[
          { label: "Subtotal", value: order.subtotal },
          { label: "Discount", value: order.discountTotal, show: Number(order.discountTotal) > 0 },
          { label: "Tax (PPN)", value: order.taxTotal },
          { label: "Shipping & other", value: order.shippingCost, show: Number(order.shippingCost) > 0 },
        ]}
        highlight={{ label: "Grand total", value: order.grandTotal }}
      />

      {order.notes ? (
        <section className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-600">
          <p className="whitespace-pre-line">{order.notes}</p>
        </section>
      ) : null}

      <SignatureBlocks
        left={{ title: "Hormat kami", name: tenant.name }}
        right={{ title: "Diterima oleh customer", name: null }}
      />

      <PrintFooter tenant={tenant} note="Dokumen ini adalah konfirmasi order, bukan invoice." />
    </>
  );
}
