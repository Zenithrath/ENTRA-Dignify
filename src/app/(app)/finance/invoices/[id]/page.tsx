import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { FormShell } from "@/components/form-shell";
import { NotePanel } from "@/components/note-panel";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { AttachmentEntity, InvoiceStatus, InvoiceType, PaymentMethod } from "@/generated/prisma/enums";
import {
  approveInvoice,
  cancelInvoice,
  deletePayment,
  recordPayment,
  rejectInvoice,
  sendInvoice,
  sendInvoiceReminder,
  updateInvoice,
} from "@/lib/actions/invoice-actions";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canApprove, canManage, canView } from "@/lib/rbac";
import { enumOptions, titleize } from "@/lib/status";
import { formatDate, formatDateTime, toDateInput } from "@/lib/queries/common";
import { daysOverdue, outstandingOf } from "@/lib/queries/finance";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "finance")) notFound();

  const tenantId = auth.user.tenantId;
  const { id } = await params;
  const { tab = "detail" } = await searchParams;

  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: {
      customer: {
        select: { id: true, companyName: true, email: true, phone: true, whatsappNumber: true, address: true, paymentTerms: true },
      },
      order: { select: { id: true, number: true, status: true } },
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paymentDate: "desc" } },
    },
  });
  if (!invoice) notFound();

  const [attachments, comments] = await Promise.all([
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.INVOICE, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.comment.findMany({
      where: { tenantId, entityType: AttachmentEntity.INVOICE, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const canEdit = canManage(auth.user.role, "finance");
  const outstanding = outstandingOf(invoice);
  const late = daysOverdue(invoice.dueDate);
  const isPaid = invoice.status === InvoiceStatus.PAID;
  const update = updateInvoice.bind(null, invoice.id);
  const record = recordPayment.bind(null, invoice.id);

  return (
    <>
      <PageHeader
        title={invoice.number}
        breadcrumbs={[{ label: "Invoices", href: "/finance/invoices" }, { label: invoice.number }]}
        description={
          <>
            {invoice.customer.companyName}
            {invoice.order ? (
              <>
                {" · "}
                <Link href={`/orders/${invoice.order.id}`} className="text-indigo-600 hover:underline">
                  {invoice.order.number}
                </Link>
              </>
            ) : null}{" "}
            · {titleize(invoice.type)}
          </>
        }
        actions={
          <>
            <StatusBadge value={invoice.status} className="mr-2" />
            <Link href={`/print/invoices/${invoice.id}`} className={buttonClass("secondary")} target="_blank">
              Invoice PDF
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Item ditagih"
              description="Total, diskon, dan pajak dihitung otomatis dari harga jual order."
            />
            <DataTable
              rows={invoice.items}
              rowKey={(row) => row.id}
              columns={[
                { key: "description", header: "Item", render: (row) => <span className="text-sm">{row.description}</span> },
                {
                  key: "qty",
                  header: "Qty",
                  render: (row) => (
                    <span className="text-sm">
                      {qty(row.quantity)} {row.unit}
                    </span>
                  ),
                },
                { key: "price", header: "Harga", render: (row) => <span className="text-sm tabular-nums">{money(row.unitPrice)}</span> },
                {
                  key: "discount",
                  header: "Diskon",
                  render: (row) => <span className="text-sm tabular-nums">{num(row.discountPercent)}%</span>,
                },
                { key: "tax", header: "Pajak", render: (row) => <span className="text-sm tabular-nums">{num(row.taxRate)}%</span> },
                {
                  key: "total",
                  header: "Total",
                  render: (row) => <span className="text-sm font-medium tabular-nums">{money(row.lineTotal)}</span>,
                },
              ]}
            />
            <CardBody className="border-t border-slate-100">
              <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="tabular-nums">{money(invoice.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Diskon</dt>
                  <dd className="tabular-nums">−{money(invoice.discountTotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Pajak</dt>
                  <dd className="tabular-nums">{money(invoice.taxTotal)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
                  <dt>Grand total</dt>
                  <dd className="tabular-nums">{money(invoice.grandTotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Dibayar</dt>
                  <dd className="tabular-nums text-emerald-700">{money(invoice.amountPaid)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>Sisa tagihan</dt>
                  <dd className={outstanding > 0 ? "tabular-nums text-rose-700" : "tabular-nums text-emerald-700"}>
                    {money(outstanding)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Pembayaran"
              description="Outstanding dihitung otomatis dari ledger pembayaran."
              actions={<span className="text-xs text-slate-500">{invoice.payments.length} transaksi</span>}
            />
            <DataTable
              rows={invoice.payments}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada pembayaran" description="Catat pembayaran pertama dari form di bawah." />}
              columns={[
                { key: "number", header: "No.", render: (row) => <span className="text-sm font-medium">{row.number}</span> },
                { key: "date", header: "Tanggal", render: (row) => <span className="text-sm">{formatDate(row.paymentDate)}</span> },
                { key: "method", header: "Metode", render: (row) => <span className="text-sm">{titleize(row.method)}</span> },
                { key: "ref", header: "Referensi", render: (row) => <span className="text-sm">{row.referenceNumber ?? "—"}</span> },
                {
                  key: "amount",
                  header: "Jumlah",
                  render: (row) => <span className="text-sm font-medium tabular-nums text-emerald-700">{money(row.amount)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  render: (row) =>
                    canEdit ? (
                      <ActionForm action={deletePayment.bind(null, row.id)}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          Hapus
                        </SubmitButton>
                      </ActionForm>
                    ) : null,
                },
              ]}
            />

            {canEdit && !isPaid && invoice.status !== InvoiceStatus.CANCELLED ? (
              <CardBody className="border-t border-slate-100">
                <p className="mb-3 text-xs font-medium text-slate-600">Record payment</p>
                <FormShell action={record} submitLabel="Simpan pembayaran" size="sm">
                  <FormGrid columns={4}>
                    <Field label="Tanggal">
                      <Input type="date" name="paymentDate" defaultValue={new Date().toISOString().slice(0, 10)} />
                    </Field>
                    <Field label="Jumlah">
                      <Input type="number" step="0.01" name="amount" defaultValue={outstanding > 0 ? outstanding : ""} required />
                    </Field>
                    <Field label="Metode">
                      <Select name="method" defaultValue={PaymentMethod.TRANSFER}>
                        {enumOptions(PaymentMethod).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="No. referensi">
                      <Input name="referenceNumber" placeholder="cth. transfer BCA" />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Detail invoice" />
            <CardBody>
              {canEdit && invoice.payments.length === 0 && invoice.status !== InvoiceStatus.CANCELLED ? (
                <FormShell action={update} submitLabel="Save changes">
                  <FormGrid columns={3}>
                    <Field label="Tipe">
                      <Select name="type" defaultValue={invoice.type}>
                        {enumOptions(InvoiceType).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Tanggal invoice">
                      <Input type="date" name="invoiceDate" defaultValue={toDateInput(invoice.invoiceDate)} />
                    </Field>
                    <Field label="Jatuh tempo">
                      <Input type="date" name="dueDate" defaultValue={toDateInput(invoice.dueDate)} />
                    </Field>
                    <Field label="Payment terms">
                      <Input name="paymentTerms" defaultValue={invoice.paymentTerms ?? ""} />
                    </Field>
                    <Field label="Catatan" className="sm:col-span-2">
                      <Textarea name="notes" defaultValue={invoice.notes ?? ""} />
                    </Field>
                  </FormGrid>
                </FormShell>
              ) : (
                <DescriptionList
                  columns={3}
                  items={[
                    { label: "Tipe", value: titleize(invoice.type) },
                    { label: "Tanggal invoice", value: formatDate(invoice.invoiceDate) },
                    {
                      label: "Jatuh tempo",
                      value: (
                        <>
                          {formatDate(invoice.dueDate)}
                          {outstanding > 0 && late > 0 ? (
                            <span className="ml-1 text-xs font-medium text-rose-600">({late} hari terlambat)</span>
                          ) : null}
                        </>
                      ),
                    },
                    { label: "Payment terms", value: invoice.paymentTerms ?? "—" },
                    { label: "Dikirim", value: formatDateTime(invoice.sentAt) },
                    { label: "Lunas", value: formatDateTime(invoice.paidAt) },
                    { label: "Catatan", value: invoice.notes ?? "—", wide: true },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <AttachmentPanel
            entityType={AttachmentEntity.INVOICE}
            entityId={invoice.id}
            attachments={attachments}
            canEdit={canEdit}
          />

          <NotePanel
            entityType={AttachmentEntity.INVOICE}
            entityId={invoice.id}
            notes={comments}
            canEdit={canEdit}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Aksi" description="Kirim ke customer, reminder, approval, dan pembatalan." />
            <CardBody className="space-y-4">
              {canEdit && invoice.status !== InvoiceStatus.CANCELLED && !isPaid ? (
                <ActionForm action={sendInvoice.bind(null, invoice.id)} className="space-y-3">
                  <Field label="Kirim via">
                    <Select name="channel" defaultValue="WHATSAPP">
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="EMAIL">Email</option>
                    </Select>
                  </Field>
                  <SubmitButton>Kirim invoice</SubmitButton>
                </ActionForm>
              ) : null}

              {canEdit && outstanding > 0 && invoice.status !== InvoiceStatus.CANCELLED ? (
                <ActionForm action={sendInvoiceReminder.bind(null, invoice.id)}>
                  <SubmitButton variant="secondary">Kirim reminder WhatsApp</SubmitButton>
                </ActionForm>
              ) : null}

              {invoice.status === InvoiceStatus.PENDING_APPROVAL && canApprove(auth.user.role) ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <ActionForm action={approveInvoice.bind(null, invoice.id)} className="space-y-2">
                    <Field label="Catatan approval">
                      <Input name="note" placeholder="Opsional" />
                    </Field>
                    <SubmitButton>Approve invoice</SubmitButton>
                  </ActionForm>
                  <ActionForm action={rejectInvoice.bind(null, invoice.id)} className="space-y-2">
                    <Field label="Alasan penolakan">
                      <Input name="reason" placeholder="cth. nominal salah" />
                    </Field>
                    <SubmitButton variant="ghost">Reject</SubmitButton>
                  </ActionForm>
                </div>
              ) : null}

              {canEdit && invoice.payments.length === 0 && invoice.status !== InvoiceStatus.CANCELLED ? (
                <ActionForm action={cancelInvoice.bind(null, invoice.id)} className="space-y-3 border-t border-slate-100 pt-3">
                  <Field label="Alasan pembatalan">
                    <Input name="reason" placeholder="cth. invoice salah customer" />
                  </Field>
                  <SubmitButton variant="danger">Batalkan invoice</SubmitButton>
                </ActionForm>
              ) : null}

              {invoice.requiresApproval ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Invoice ini melewati threshold approval dan butuh persetujuan Manager/Owner sebelum dikirim.
                </p>
              ) : null}
              {invoice.status === InvoiceStatus.CANCELLED ? (
                <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  Dibatalkan: {invoice.cancelledReason ?? "tanpa alasan tercatat"}.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Perusahaan", value: invoice.customer.companyName },
                  { label: "Payment terms", value: invoice.customer.paymentTerms ?? "—" },
                  { label: "WhatsApp", value: invoice.customer.whatsappNumber ?? invoice.customer.phone ?? "—" },
                  { label: "Email", value: invoice.customer.email ?? "—" },
                ]}
              />
              <Link href={`/customers/${invoice.customer.id}`} className={buttonClass("ghost", "sm", "mt-3")}>
                Buka customer
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tab terkait" />
            <CardBody className="flex flex-wrap gap-2">
              <Link href={`/finance/invoices/${invoice.id}?tab=detail`} className={buttonClass(tab === "detail" ? "primary" : "ghost", "sm")}>
                Detail
              </Link>
              <Link href={`/finance/invoices/${invoice.id}?tab=payments`} className={buttonClass(tab === "payments" ? "primary" : "ghost", "sm")}>
                Payments ({invoice.payments.length})
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
