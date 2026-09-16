import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { FormShell } from "@/components/form-shell";
import { AttachmentEntity, SupplierStatus } from "@/generated/prisma/enums";
import { addSupplierContact, setSupplierStatus } from "@/lib/actions/supplier-actions";
import { requireAuth } from "@/lib/auth";
import { money, moneyShort, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate } from "@/lib/queries/common";
import { suppliedProducts, supplierPerformance } from "@/lib/queries/supplier-performance";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const tenantId = auth.user.tenantId;

  const supplier = await prisma.supplier.findFirst({
    where: { id, tenantId },
    include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } },
  });
  if (!supplier) notFound();

  const [performance, supplied, purchaseOrders, attachments, rfqHistory] = await Promise.all([
    supplierPerformance(tenantId, id),
    suppliedProducts(tenantId, id),
    prisma.purchaseOrder.findMany({
      where: { tenantId, supplierId: id },
      orderBy: { poDate: "desc" },
      take: 25,
      include: { order: { select: { number: true } }, _count: { select: { items: true, receipts: true } } },
    }),
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.SUPPLIER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rfqSupplier.findMany({
      where: { supplierId: id, rfq: { tenantId } },
      include: { rfq: { select: { number: true, status: true, rfqDate: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const canEdit = canManage(auth.user.role, "suppliers");
  const outstanding = purchaseOrders
    .filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED")
    .reduce((total, po) => total + num(po.grandTotal), 0);

  return (
    <>
      <PageHeader
        title={supplier.name}
        breadcrumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: supplier.name }]}
        meta={
          <>
            <StatusBadge value={supplier.status} />
            {supplier.category ? <span className="text-xs text-slate-500">{supplier.category}</span> : null}
            <span className="text-xs text-slate-500">Terms: {supplier.paymentTerms ?? "—"}</span>
            {performance.score !== null ? (
              <span className={`text-xs font-medium ${performance.score >= 75 ? "text-emerald-700" : "text-amber-700"}`}>
                Performance score {performance.score.toFixed(1)}/100
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {canEdit ? (
              <Link href={`/suppliers/${supplier.id}/edit`} className={buttonClass("secondary")} prefetch={false}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            ) : null}
            {canEdit ? (
              <ActionForm action={setSupplierStatus.bind(null, supplier.id)}>
                <input
                  type="hidden"
                  name="status"
                  value={supplier.status === SupplierStatus.ACTIVE ? SupplierStatus.BLACKLISTED : SupplierStatus.ACTIVE}
                />
                <SubmitButton variant={supplier.status === SupplierStatus.ACTIVE ? "danger" : "primary"} pendingLabel="…">
                  {supplier.status === SupplierStatus.ACTIVE ? "Blacklist" : "Reactivate"}
                </SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="POs" value={`${performance.receivedPos}/${performance.totalPos}`} hint="received / total" />
        <Stat label="On-time delivery" value={performance.onTimePercent === null ? "—" : `${performance.onTimePercent}%`} />
        <Stat
          label="Avg lead time"
          value={performance.averageLeadTimeDays === null ? "—" : `${performance.averageLeadTimeDays} hari`}
          hint={supplier.leadTimeDays ? `Standar ${supplier.leadTimeDays} hari` : undefined}
        />
        <Stat label="Open PO value" value={moneyShort(outstanding)} tone={outstanding > 0 ? "warning" : "neutral"} />
      </div>

      <div className="mb-4">
        <Tabs
          items={[
            { id: "overview", label: "Overview", href: `/suppliers/${id}?tab=overview` },
            { id: "contacts", label: "Contacts", href: `/suppliers/${id}?tab=contacts`, count: supplier.contacts.length },
            { id: "products", label: "Products supplied", href: `/suppliers/${id}?tab=products`, count: supplied.length },
            { id: "pos", label: "Purchase orders", href: `/suppliers/${id}?tab=pos`, count: purchaseOrders.length },
            { id: "docs", label: "Documents", href: `/suppliers/${id}?tab=docs`, count: attachments.length },
          ]}
          active={tab}
        />
      </div>

      <div className="space-y-5">
        {tab === "overview" ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Supplier information" />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: "Code", value: supplier.code ?? "—" },
                    { label: "Category", value: supplier.category ?? "—" },
                    { label: "NPWP", value: supplier.taxNumber ?? "—" },
                    { label: "Payment terms", value: supplier.paymentTerms ?? "—" },
                    { label: "Phone", value: supplier.phone ?? "—" },
                    { label: "Email", value: supplier.email ?? "—" },
                    { label: "WhatsApp", value: supplier.whatsappNumber ?? "—" },
                    { label: "Rating manual", value: supplier.rating ? num(supplier.rating).toFixed(1) : "—" },
                    { label: "Address", value: supplier.address ?? "—", wide: true },
                    { label: "Notes", value: supplier.notes ?? "—", wide: true },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="RFQ participation"
                description="Permintaan penawaran yang pernah dikirim ke supplier ini."
              />
              {rfqHistory.length === 0 ? (
                <EmptyState title="Belum pernah diundang RFQ" />
              ) : (
                <DataTable
                  rows={rfqHistory}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "rfq",
                      header: "RFQ",
                      render: (row) => (
                        <Link href={`/procurement/rfq/${row.rfqId}`} className="text-sm font-medium text-indigo-600 hover:underline">
                          {row.rfq.number}
                        </Link>
                      ),
                    },
                    { key: "date", header: "Date", render: (row) => <span className="text-sm">{formatDate(row.rfq.rfqDate)}</span> },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  ]}
                />
              )}
            </Card>
          </div>
        ) : null}

        {tab === "contacts" ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader title="PIC & contacts" />
              {supplier.contacts.length === 0 ? (
                <EmptyState title="No contacts yet" />
              ) : (
                <DataTable
                  rows={supplier.contacts}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "name",
                      header: "Name",
                      render: (row) => (
                        <span className="text-sm font-medium text-slate-900">
                          {row.name}
                          {row.isPrimary ? <span className="ml-2 text-[11px] font-normal text-indigo-600">primary</span> : null}
                        </span>
                      ),
                    },
                    { key: "title", header: "Title", render: (row) => <span className="text-sm">{row.jobTitle ?? "—"}</span> },
                    { key: "phone", header: "Phone", render: (row) => <span className="text-sm">{row.phone ?? "—"}</span> },
                    { key: "email", header: "Email", render: (row) => <span className="text-sm">{row.email ?? "—"}</span> },
                  ]}
                />
              )}
            </Card>

            {canEdit ? (
              <Card>
                <CardHeader title="Add contact" />
                <CardBody>
                  <FormShell action={addSupplierContact.bind(null, supplier.id)} submitLabel="Add contact" size="sm">
                    <FormGrid>
                      <Field label="Name" required>
                        <Input name="name" required />
                      </Field>
                      <Field label="Job title">
                        <Input name="jobTitle" />
                      </Field>
                      <Field label="Phone">
                        <Input name="phone" />
                      </Field>
                      <Field label="Email">
                        <Input name="email" type="email" />
                      </Field>
                      <Field label="WhatsApp">
                        <Input name="whatsappNumber" />
                      </Field>
                      <label className="flex items-center gap-2 self-end text-sm text-slate-700">
                        <input type="checkbox" name="isPrimary" className="h-4 w-4 rounded border-slate-300" />
                        Primary
                      </label>
                    </FormGrid>
                  </FormShell>
                </CardBody>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "products" ? (
          <Card>
            <CardHeader
              title="Products supplied"
              description="Harga terakhir dan lead time tercatat otomatis dari histori PO."
            />
            {supplied.length === 0 ? (
              <EmptyState title="Belum ada histori pembelian" description="Riwayat muncul setelah PO pertama diterima." />
            ) : (
              <DataTable
                rows={supplied}
                rowKey={(row) => row.productId ?? row.description}
                columns={[
                  { key: "desc", header: "Item", render: (row) => <span className="text-sm">{row.description}</span> },
                  {
                    key: "price",
                    header: "Last price",
                    render: (row) => <span className="text-sm font-medium">{money(row.lastPrice)}</span>,
                  },
                  {
                    key: "qty",
                    header: "Total qty",
                    render: (row) => (
                      <span className="text-sm">
                        {row.totalQuantity.toLocaleString("id-ID")} {row.unit}
                      </span>
                    ),
                  },
                  {
                    key: "date",
                    header: "Last ordered",
                    render: (row) => <span className="text-sm">{formatDate(row.lastOrderedAt)}</span>,
                  },
                ]}
              />
            )}
          </Card>
        ) : null}

        {tab === "pos" ? (
          <Card>
            <CardHeader title="Purchase order history" />
            {purchaseOrders.length === 0 ? (
              <EmptyState title="No purchase orders" />
            ) : (
              <DataTable
                rows={purchaseOrders}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "number",
                    header: "PO",
                    render: (row) => (
                      <Link href={`/procurement/purchase-orders/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  { key: "date", header: "PO date", render: (row) => <span className="text-sm">{formatDate(row.poDate)}</span> },
                  {
                    key: "expected",
                    header: "Expected",
                    render: (row) => (
                      <span className={`text-sm ${row.expectedDate && row.expectedDate < new Date() && row.status !== "RECEIVED" ? "text-rose-600" : ""}`}>
                        {formatDate(row.expectedDate)}
                      </span>
                    ),
                  },
                  { key: "order", header: "Order", render: (row) => <span className="text-sm">{row.order?.number ?? "—"}</span> },
                  { key: "total", header: "Value", render: (row) => <span className="text-sm font-medium">{money(row.grandTotal)}</span> },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                ]}
              />
            )}
          </Card>
        ) : null}

        {tab === "docs" ? (
          <AttachmentPanel
            entityType={AttachmentEntity.SUPPLIER}
            entityId={supplier.id}
            attachments={attachments}
            canEdit={canEdit}
          />
        ) : null}
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "warning" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
