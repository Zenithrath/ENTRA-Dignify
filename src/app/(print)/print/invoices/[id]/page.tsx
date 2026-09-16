import { notFound } from "next/navigation";

import { Letterhead, PrintFooter, PrintTable, PrintTotals, SignatureBlocks } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { money, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";
import { statusMeta } from "@/lib/status";

export default async function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;

  const [invoice, tenant, template] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id, tenantId: auth.user.tenantId },
      include: {
        customer: true,
        items: { orderBy: { sortOrder: "asc" } },
        order: { select: { number: true } },
        payments: { orderBy: { paymentDate: "asc" } },
      },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } }),
    prisma.documentTemplate.findFirst({ where: { tenantId: auth.user.tenantId, docType: "INVOICE", isDefault: true } }),
  ]);

  if (!invoice) notFound();
  const outstanding = num(invoice.grandTotal) - num(invoice.amountPaid);

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Invoice"
        docNumber={invoice.number}
        meta={[
          { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
          { label: "Due date", value: formatDate(invoice.dueDate) },
          { label: "Type", value: statusMeta(invoice.type).label },
          { label: "Status", value: statusMeta(invoice.status).label },
        ]}
      />

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Tagihan kepada</p>
          <p className="mt-1 font-medium text-slate-900">{invoice.customer.companyName}</p>
          <p className="text-xs leading-relaxed text-slate-600">
            {[invoice.customer.address, invoice.customer.city].filter(Boolean).join(", ")}
            {invoice.customer.taxNumber ? <br /> : null}
            {invoice.customer.taxNumber ? `NPWP ${invoice.customer.taxNumber}` : ""}
          </p>
        </div>
        <div className="text-right text-xs leading-relaxed text-slate-600">
          {invoice.order ? (
            <p>
              <span className="text-slate-500">Order:</span> {invoice.order.number}
            </p>
          ) : null}
          <p>
            <span className="text-slate-500">Payment terms:</span> {invoice.paymentTerms ?? "—"}
          </p>
        </div>
      </section>

      <PrintTable lines={invoice.items} />

      <PrintTotals
        rows={[
          { label: "Subtotal", value: invoice.subtotal },
          { label: "Discount", value: invoice.discountTotal, show: Number(invoice.discountTotal) > 0 },
          { label: "Tax (PPN)", value: invoice.taxTotal },
          { label: "Paid to date", value: invoice.amountPaid, show: Number(invoice.amountPaid) > 0 },
        ]}
        highlight={{ label: outstanding > 0 ? "Amount due" : "Grand total", value: outstanding > 0 ? outstanding : invoice.grandTotal }}
      />

      {invoice.payments.length > 0 ? (
        <section className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-600">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment history</p>
          <ul className="space-y-1">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between">
                <span>
                  {formatDate(payment.paymentDate)} · {payment.method}
                  {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ""}
                </span>
                <span className="font-medium text-slate-800">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.notes ? (
        <section className="mt-6 text-xs leading-relaxed text-slate-600">
          <p className="whitespace-pre-line">{invoice.notes}</p>
        </section>
      ) : null}

      <SignatureBlocks left={{ title: "Hormat kami", name: tenant.name }} right={{ title: "Diterima oleh customer", name: null }} />

      <PrintFooter tenant={tenant} note={template?.footer ?? null} />
    </>
  );
}
