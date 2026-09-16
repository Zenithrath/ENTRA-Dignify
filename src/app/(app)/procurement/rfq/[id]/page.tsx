import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate, supplierOptions } from "@/lib/queries/common";
import { rfqComparison, suppliersForComparison } from "@/lib/queries/procurement";
import { recordSupplierQuote, selectWinnersAndGeneratePo } from "@/lib/actions/procurement-actions";

export const metadata: Metadata = { title: "RFQ" };

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const rfq = await prisma.rfq.findFirst({
    where: { id, tenantId },
    include: {
      order: { select: { id: true, number: true, customer: { select: { companyName: true } } } },
      items: { orderBy: { id: "asc" } },
      supplierQuotations: { include: { supplier: { select: { name: true } } }, orderBy: { quotedAt: "desc" } },
    },
  });
  if (!rfq) notFound();

  const [comparison, invited, suppliers, activity] = await Promise.all([
    rfqComparison(tenantId, id),
    suppliersForComparison(tenantId, id),
    supplierOptions(tenantId),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: "RFQ", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const canEdit = canManage(auth.user.role, "procurement");
  const quotedSupplierIds = new Set(rfq.supplierQuotations.map((quote) => quote.supplierId));
  const suppliersWithoutQuote = invited.filter((supplier) => !quotedSupplierIds.has(supplier.id));
  const winnerCount = comparison.filter((row) => row.quotes.some((quote) => quote.isWinner)).length;

  return (
    <>
      <PageHeader
        title={`RFQ ${rfq.number}`}
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: rfq.number }]}
        meta={
          <>
            <StatusBadge value={rfq.status} />
            {rfq.order ? (
              <Link href={`/orders/${rfq.order.id}?tab=procurement`} className="text-xs text-indigo-600 hover:underline">
                Order {rfq.order.number} · {rfq.order.customer.companyName}
              </Link>
            ) : null}
            <span className="text-xs text-slate-500">Due {formatDate(rfq.dueDate)}</span>
            <span className="text-xs text-slate-500">
              {rfq.supplierQuotations.length}/{invited.length} supplier sudah membalas
            </span>
          </>
        }
        actions={
          canEdit && winnerCount > 0 ? (
            <ActionForm action={selectWinnersAndGeneratePo.bind(null, rfq.id)}>
              <SubmitButton pendingLabel="Generating…">Generate PO dari pemenang</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Price comparison"
            description="Harga termurah dan lead time tercepat ditandai otomatis."
          />
          {comparison.length === 0 ? (
            <EmptyState title="Belum ada item RFQ" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    {invited.map((supplier) => (
                      <th key={supplier.id} className="px-3 py-2 text-right">
                        {supplier.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.rfqItemId} className="border-t border-slate-100">
                      <td className="px-5 py-3">
                        <p className="text-slate-800">{row.description}</p>
                        <p className="text-xs text-slate-500">
                          {row.quotes.length} penawaran
                          {row.cheapestQuoteId ? "" : " · belum ada harga"}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700">
                        {qty(row.quantity)} {row.unit}
                      </td>
                      {invited.map((supplier) => {
                        const quote = row.quotes.find((item) => item.supplierId === supplier.id);
                        if (!quote) {
                          return (
                            <td key={supplier.id} className="px-3 py-3 text-right text-xs text-slate-400">
                              —
                            </td>
                          );
                        }
                        const cheapest = row.cheapestQuoteId === quote.quoteId;
                        const fastest = row.fastestQuoteId === quote.quoteId;
                        return (
                          <td key={supplier.id} className="px-3 py-3 text-right">
                            <p className={`text-sm ${cheapest ? "font-semibold text-emerald-700" : "text-slate-700"}`}>
                              {money(quote.unitPrice)}
                              {cheapest ? " ★" : ""}
                            </p>
                            <p className="text-xs text-slate-500">
                              {quote.leadTimeDays ? `${quote.leadTimeDays} hari` : "—"}
                              {fastest ? " ⚡" : ""}
                              {quote.isWinner ? " · winner" : ""}
                            </p>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CardBody className="border-t border-slate-100 text-xs text-slate-500">
            ★ harga termurah · ⚡ lead time tercepat · Ranking pemenang memakai kombinasi harga × lead time.
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardHeader title="Supplier responses" />
            {rfq.supplierQuotations.length === 0 ? (
              <EmptyState title="Belum ada penawaran masuk" description="Catat harga dari supplier di panel sebelah." />
            ) : (
              <DataTable
                rows={rfq.supplierQuotations}
                rowKey={(row) => row.id}
                columns={[
                  { key: "supplier", header: "Supplier", render: (row) => <span className="text-sm font-medium">{row.supplier.name}</span> },
                  { key: "date", header: "Quoted", render: (row) => <span className="text-sm">{formatDate(row.quotedAt)}</span> },
                  {
                    key: "lead",
                    header: "Lead time",
                    render: (row) => <span className="text-sm">{row.leadTimeDays ? `${row.leadTimeDays} hari` : "—"}</span>,
                  },
                  { key: "total", header: "Total", render: (row) => <span className="text-sm font-medium">{money(row.total)}</span> },
                  {
                    key: "winners",
                    header: "Winning items",
                    render: (row) => {
                      const suppliersWins = comparison.filter((item) =>
                        item.quotes.some((quote) => quote.supplierId === row.supplierId && quote.isWinner),
                      ).length;
                      return <span className="text-xs text-slate-600">{suppliersWins} item</span>;
                    },
                  },
                ]}
              />
            )}
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="RFQ details" />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: "RFQ date", value: formatDate(rfq.rfqDate) },
                    { label: "Due date", value: formatDate(rfq.dueDate) },
                    { label: "Sent at", value: formatDate(rfq.sentAt) },
                    { label: "Order", value: rfq.order?.number ?? "—" },
                    { label: "Notes", value: rfq.notes ?? "—", wide: true },
                  ]}
                />
              </CardBody>
            </Card>

            {canEdit && suppliersWithoutQuote.length > 0 ? (
              <Card>
                <CardHeader title="Record supplier quotation" description="Input harga balasan dari supplier." />
                <CardBody>
                  <FormShell action={recordSupplierQuote.bind(null, rfq.id)} submitLabel="Save quotation" size="sm">
                    <div className="space-y-3">
                      <Field label="Supplier" required>
                        <Select name="supplierId" required defaultValue="">
                          <option value="">Select supplier…</option>
                          {suppliersWithoutQuote.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <FormGrid>
                        <Field label="Lead time (hari)">
                          <Input name="leadTimeDays" type="number" step="1" defaultValue={7} />
                        </Field>
                        <Field label="Valid until">
                          <Input type="date" name="validUntil" defaultValue={new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)} />
                        </Field>
                      </FormGrid>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-600">Harga satuan per item</p>
                        {rfq.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-3">
                            <span className="flex-1 text-xs text-slate-600">
                              {item.description} ({qty(item.quantity)} {item.unit})
                            </span>
                            <Input
                              name={`price[${item.id}]`}
                              type="number"
                              step="100"
                              placeholder="harga"
                              className="h-9 w-32 text-xs"
                            />
                          </div>
                        ))}
                      </div>

                      <FormGrid>
                        <Field label="Shipping terms">
                          <Input name="shippingTerms" placeholder="cth. Franco Jakarta" />
                        </Field>
                        <Field label="Notes">
                          <Input name="notes" />
                        </Field>
                      </FormGrid>
                    </div>
                  </FormShell>
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Invited suppliers" />
              <CardBody className="space-y-2">
                {invited.map((supplier) => (
                  <div key={supplier.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">{supplier.name}</span>
                    <StatusBadge value={supplier.status} />
                  </div>
                ))}
                {suppliers.length === 0 ? <p className="text-xs text-slate-500">Tidak ada supplier terdaftar.</p> : null}
              </CardBody>
            </Card>

            {activity.length > 0 ? (
              <Card>
                <CardHeader title="Activity" />
                <ul className="divide-y divide-slate-100">
                  {activity.map((entry) => (
                    <li key={entry.id} className="px-5 py-3">
                      <p className="text-sm text-slate-800">{entry.summary ?? entry.action}</p>
                      <p className="text-xs text-slate-500">{entry.userName ?? "System"}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Link href="/procurement" className={buttonClass("ghost", "sm")} prefetch={false}>
              ← Back to procurement
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
