import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormShell } from "@/components/form-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { createInvoice } from "@/lib/actions/invoice-actions";
import { requirePermission } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { enumOptions } from "@/lib/status";
import { InvoiceType } from "@/generated/prisma/enums";
import { customerOptions, formatDate } from "@/lib/queries/common";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const auth = await requirePermission("finance", "manage");
  const { orderId } = await searchParams;
  const tenantId = auth.user.tenantId;

  const [orders, customers] = await Promise.all([
    prisma.order.findMany({
      where: {
        tenantId,
        status: { in: ["CONFIRMED", "IN_PROGRESS", "FULFILLED", "COMPLETED"] },
        items: { some: { invoicedQty: { lt: prisma.orderItem.fields.quantity } } },
      },
      orderBy: { orderDate: "desc" },
      take: 30,
      include: {
        customer: { select: { companyName: true, paymentTerms: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
    }),
    customerOptions(tenantId),
  ]);

  const selected = orderId ? orders.find((order) => order.id === orderId) : undefined;
  if (orderId && !selected) notFound();

  const billableItems = selected?.items.filter((item) => num(item.invoicedQty) < num(item.quantity)) ?? [];
  const defaultDueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="New invoice"
        breadcrumbs={[{ label: "Invoices", href: "/finance/invoices" }, { label: "New" }]}
        description="Tagih dari order (full/partial/progress/milestone) atau buat invoice manual."
        actions={
          <Link href="/finance/invoices" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />

      <FormShell action={createInvoice} submitLabel="Create invoice" className="max-w-4xl space-y-5">
        <Card>
          <CardHeader title="Sumber tagihan" description="Kosongkan order untuk invoice manual (tanpa order)." />
          <CardBody className="space-y-4">
            <FormGrid columns={2}>
              <Field label="Order">
                <Select name="orderId" defaultValue={selected?.id ?? ""}>
                  <option value="">Tanpa order (manual)</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.number} — {order.customer.companyName} ({formatDate(order.orderDate)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipe invoice">
                <Select name="type" defaultValue={InvoiceType.FULL}>
                  {enumOptions(InvoiceType).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>

            {selected ? (
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="mb-3 text-xs font-medium text-slate-600">
                  Item yang masih bisa ditagih — {selected.number} ({selected.customer.companyName})
                </p>
                <div className="space-y-2">
                  {billableItems.map((item) => {
                    const remaining = num(item.quantity) - num(item.invoicedQty);
                    return (
                      <div key={item.id} className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[240px] flex-1">
                          <p className="text-sm text-slate-800">{item.description}</p>
                          <p className="text-xs text-slate-500">
                            Belum ditagih {qty(remaining)} {item.unit} dari {qty(item.quantity)} · {money(item.sellingPrice)} /{" "}
                            {item.unit}
                          </p>
                        </div>
                        <Field label="Qty tagih">
                          <Input
                            name={`quantity[${item.id}]`}
                            type="number"
                            step="0.01"
                            max={remaining}
                            defaultValue={remaining}
                            className="h-9 w-28"
                          />
                        </Field>
                        <p className="w-32 pb-2 text-right text-xs text-slate-600">
                          ≈ {money(remaining * num(item.sellingPrice))}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <FormGrid columns={3}>
                <Field label="Customer (untuk invoice manual)" className="sm:col-span-1">
                  <Select name="customerId" defaultValue="">
                    <option value="">Pilih customer…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.companyName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Deskripsi" className="sm:col-span-2">
                  <Input name="description" placeholder="cth. Jasa konsultasi periode Agustus" />
                </Field>
                <Field label="Qty">
                  <Input name="quantity" type="number" step="0.01" defaultValue="1" />
                </Field>
                <Field label="Unit">
                  <Input name="unit" defaultValue="lot" />
                </Field>
                <Field label="Harga satuan">
                  <Input name="unitPrice" type="number" step="0.01" placeholder="0" />
                </Field>
                <Field label="Diskon %">
                  <Input name="discountPercent" type="number" step="0.01" defaultValue="0" />
                </Field>
                <Field label="Pajak %">
                  <Input name="taxRate" type="number" step="0.01" defaultValue="11" />
                </Field>
              </FormGrid>
            )}

            <FormGrid columns={3}>
              <Field label="Tanggal invoice">
                <Input type="date" name="invoiceDate" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Jatuh tempo">
                <Input type="date" name="dueDate" defaultValue={defaultDueDate} />
              </Field>
              <Field label="Payment terms">
                <Input name="paymentTerms" defaultValue={selected?.customer.paymentTerms ?? ""} placeholder="cth. NET 30" />
              </Field>
              <Field label="Biaya kirim (opsional)">
                <Input name="shippingCost" type="number" step="0.01" defaultValue="0" />
              </Field>
              <Field label="Catatan" className="sm:col-span-2">
                <Textarea name="notes" placeholder="Catatan yang tercetak di invoice…" />
              </Field>
            </FormGrid>

            <p className="text-xs text-slate-500">
              Qty yang sudah pernah ditagih akan otomatis dikurangi, jadi satu order bisa ditagih beberapa kali (progress /
              milestone) tanpa dobel. Bila nominal melewati threshold approval di Settings, invoice masuk status Menunggu
              Approval sebelum bisa dikirim.
            </p>
          </CardBody>
        </Card>
      </FormShell>
    </>
  );
}
