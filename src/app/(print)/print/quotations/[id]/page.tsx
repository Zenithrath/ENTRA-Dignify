import { notFound } from "next/navigation";

import { Letterhead, PrintFooter, PrintTable, PrintTotals, SignatureBlocks } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";

export default async function PrintQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;

  const [quotation, tenant, template] = await Promise.all([
    prisma.quotation.findFirst({
      where: { id, tenantId: auth.user.tenantId },
      include: {
        customer: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
        items: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } }),
    prisma.documentTemplate.findFirst({ where: { tenantId: auth.user.tenantId, docType: "QUOTATION", isDefault: true } }),
  ]);

  if (!quotation) notFound();
  const contact = quotation.customer.contacts[0];

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Quotation"
        docNumber={`${quotation.number} v${quotation.version}`}
        meta={[
          { label: "Date", value: formatDate(quotation.quotationDate) },
          { label: "Valid until", value: formatDate(quotation.validUntil) },
        ]}
      />

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Kepada</p>
          <p className="mt-1 font-medium text-slate-900">{quotation.customer.companyName}</p>
          <p className="text-xs leading-relaxed text-slate-600">
            {[quotation.customer.address, quotation.customer.city].filter(Boolean).join(", ")}
            {quotation.customer.taxNumber ? <br /> : null}
            {quotation.customer.taxNumber ? `NPWP ${quotation.customer.taxNumber}` : ""}
          </p>
          {contact ? (
            <p className="mt-1 text-xs text-slate-600">
              UP: {contact.name}
              {contact.phone ? ` · ${contact.phone}` : ""}
            </p>
          ) : null}
        </div>
        <div className="text-right text-xs leading-relaxed text-slate-600">
          <p>
            <span className="text-slate-500">Payment terms:</span> {quotation.paymentTerms ?? "—"}
          </p>
          <p>
            <span className="text-slate-500">Delivery:</span> {quotation.deliveryTerms ?? "—"}
          </p>
        </div>
      </section>

      <PrintTable
        lines={quotation.items.map((item) => ({
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
          { label: "Subtotal", value: quotation.subtotal },
          { label: "Discount", value: quotation.discountTotal, show: Number(quotation.discountTotal) > 0 },
          { label: "Tax (PPN)", value: quotation.taxTotal },
          { label: "Shipping & other", value: quotation.shippingCost, show: Number(quotation.shippingCost) > 0 },
        ]}
        highlight={{ label: "Grand total", value: quotation.grandTotal }}
      />

      {quotation.notes || quotation.termsAndConditions ? (
        <section className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-600">
          {quotation.notes ? <p className="mb-2 whitespace-pre-line">{quotation.notes}</p> : null}
          {quotation.termsAndConditions ? (
            <p className="whitespace-pre-line">{quotation.termsAndConditions}</p>
          ) : null}
        </section>
      ) : null}

      <SignatureBlocks
        left={{ title: "Hormat kami", name: `${tenant.name}` }}
        right={{ title: "Diterima oleh customer", name: contact?.name ?? null }}
      />

      <PrintFooter
        tenant={tenant}
        note={
          template?.footer ??
          "Harga belum termasuk PPN kecuali disebutkan lain. Pembayaran sesuai termin yang disepakati."
        }
      />
    </>
  );
}
