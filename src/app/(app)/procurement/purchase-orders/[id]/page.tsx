import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
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
import { AttachmentEntity, PoStatus } from "@/generated/prisma/enums";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  receiveGoods,
  sendPurchaseOrder,
} from "@/lib/actions/procurement-actions";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canApprove, canManage } from "@/lib/rbac";
import { formatDate, formatDateTime, tenantModules, warehouseOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId },
    include: {
      supplier: true,
      order: { select: { id: true, number: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { product: { select: { id: true, sku: true } } } },
      receipts: {
        orderBy: { receivedDate: "desc" },
        include: { items: true, _count: { select: { items: true } } },
      },
    },
  });
  if (!po) notFound();

  const [attachments, activity, warehouses, modules, approvals] = await Promise.all([
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    warehouseOptions(tenantId),
    tenantModules(tenantId),
    prisma.approval.findMany({ where: { tenantId, docType: "PURCHASE_ORDER", recordId: id }, orderBy: { createdAt: "desc" } }),
  ]);

  const canEdit = canManage(auth.user.role, "procurement");
  const isApprover = canApprove(auth.user.role);
  const pendingApproval = approvals.find((approval) => approval.status === "PENDING");
  const receivable = po.items.filter((item) => num(item.receivedQty) < num(item.quantity));

  return (
    <>
      <PageHeader
        title={`PO ${po.number}`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Purchase orders", href: "/procurement/purchase-orders" },
          { label: po.number },
        ]}
        meta={
          <>
            <StatusBadge value={po.status} />
            <Link href={`/suppliers/${po.supplier.id}`} className="text-xs text-indigo-600 hover:underline">
              {po.supplier.name}
            </Link>
            {po.order ? (
              <Link href={`/orders/${po.order.id}`} className="text-xs text-slate-500 hover:underline">
                order {po.order.number}
              </Link>
            ) : null}
            <span className="text-xs text-slate-500">Expected {formatDate(po.expectedDate)}</span>
            {po.approvedAt ? <span className="text-xs text-emerald-700">Approved {formatDate(po.approvedAt)}</span> : null}
          </>
        }
        actions={
          <>
            {canEdit && po.status === PoStatus.DRAFT ? (
              <FormShell action={sendPurchaseOrder.bind(null, po.id)} submitLabel="Send to supplier" size="md">
                <Select name="channel" defaultValue={po.supplier.whatsappNumber ? "WHATSAPP" : "EMAIL"} className="h-9 w-52">
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                </Select>
              </FormShell>
            ) : null}
            {canEdit && po.status === PoStatus.SENT ? (
              <ActionForm action={confirmPurchaseOrder.bind(null, po.id)}>
                <SubmitButton pendingLabel="…">Supplier confirmed</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="PO items" description="Kuantitas, harga, dan progres penerimaan per baris." />
            <DataTable
              rows={po.items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  render: (row) => (
                    <div>
                      <p className="text-sm text-slate-900">{row.description}</p>
                      {row.product ? <p className="text-xs text-slate-500">{row.product.sku}</p> : null}
                    </div>
                  ),
                },
                {
                  key: "qty",
                  header: "Ordered",
                  render: (row) => (
                    <span className="text-sm">
                      {qty(row.quantity)} {row.unit}
                    </span>
                  ),
                },
                {
                  key: "received",
                  header: "Received",
                  render: (row) => (
                    <span className={`text-sm ${num(row.receivedQty) >= num(row.quantity) ? "text-emerald-700" : "text-slate-600"}`}>
                      {qty(row.receivedQty)}
                    </span>
                  ),
                },
                { key: "price", header: "Unit price", render: (row) => <span className="text-sm">{money(row.unitPrice)}</span> },
                { key: "tax", header: "Tax", render: (row) => <span className="text-sm">{num(row.taxRate)}%</span> },
                {
                  key: "total",
                  header: "Line total",
                  className: "text-right",
                  render: (row) => <span className="text-sm font-medium">{money(row.lineTotal)}</span>,
                },
              ]}
            />
            <CardBody className="border-t border-slate-100">
              <div className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="text-right text-slate-700">{money(po.subtotal)}</span>
                <span className="text-slate-500">Tax</span>
                <span className="text-right text-slate-700">{money(po.taxTotal)}</span>
                <span className="font-medium text-slate-700">Grand total</span>
                <span className="text-right font-semibold text-slate-900">{money(po.grandTotal)}</span>
              </div>
            </CardBody>
          </Card>

          {canEdit && receivable.length > 0 && po.status !== PoStatus.CANCELLED ? (
            <Card>
              <CardHeader
                title="Receiving"
                description={
                  modules.get("INVENTORY")
                    ? "Stok otomatis bertambah saat penerimaan dicatat."
                    : "Inventory dimatikan, penerimaan hanya dicatat sebagai riwayat."
                }
              />
              <CardBody>
                <FormShell action={receiveGoods.bind(null, po.id)} submitLabel="Record receiving" size="sm">
                  <div className="space-y-3">
                    <FormGrid>
                      <Field label="Received date">
                        <Input type="date" name="receivedDate" defaultValue={new Date().toISOString().slice(0, 10)} />
                      </Field>
                      <Field label="Warehouse">
                        <Select name="warehouseId" defaultValue="">
                          <option value="">Default warehouse</option>
                          {warehouses.map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </FormGrid>

                    <div className="space-y-2">
                      {receivable.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3">
                          <div className="min-w-[200px] flex-1">
                            <p className="text-sm text-slate-800">{item.description}</p>
                            <p className="text-xs text-slate-500">
                              Sisa {qty(num(item.quantity) - num(item.receivedQty))} {item.unit} dari {qty(item.quantity)}
                            </p>
                          </div>
                          <Field label="Received">
                            <Input
                              name={`received[${item.id}]`}
                              type="number"
                              step="0.01"
                              defaultValue={num(item.quantity) - num(item.receivedQty)}
                              className="h-9 w-28"
                            />
                          </Field>
                          <Field label="Rejected">
                            <Input name={`rejected[${item.id}]`} type="number" step="0.01" defaultValue={0} className="h-9 w-24" />
                          </Field>
                          <Field label="Note">
                            <Input name={`note[${item.id}]`} className="h-9 w-48" />
                          </Field>
                        </div>
                      ))}
                    </div>

                    <Field label="Receiving notes">
                      <Textarea name="notes" placeholder="cth. pengiriman tahap 2 dari 3" />
                    </Field>
                  </div>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Receiving history" />
            {po.receipts.length === 0 ? (
              <EmptyState title="Belum ada penerimaan" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {po.receipts.map((receipt) => (
                  <li key={receipt.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">{receipt.number}</p>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {formatDate(receipt.receivedDate)}
                        <StatusBadge value={receipt.status} />
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {receipt._count.items} baris · {receipt.notes ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {isApprover && pendingApproval ? (
            <Card>
              <CardHeader title="Approval required" description={`Diminta ${formatDateTime(pendingApproval.createdAt)}`} />
              <CardBody>
                <FormShell action={approvePurchaseOrder.bind(null, po.id)} submitLabel="Approve PO" size="sm">
                  <Field label="Note">
                    <Input name="note" placeholder="Catatan approval" />
                  </Field>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="PO details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "PO date", value: formatDate(po.poDate) },
                  { label: "Expected date", value: formatDate(po.expectedDate) },
                  { label: "Shipping terms", value: po.shippingTerms ?? "—" },
                  { label: "Sent at", value: po.sentAt ? formatDateTime(po.sentAt) : "—" },
                  { label: "Confirmed at", value: po.confirmedAt ? formatDateTime(po.confirmedAt) : "—" },
                  { label: "Supplier contact", value: po.supplier.whatsappNumber ?? po.supplier.phone ?? "—" },
                  { label: "Notes", value: po.notes ?? "—", wide: true },
                  { label: "Cancel reason", value: po.cancelledReason ?? "—", wide: true },
                ]}
              />
            </CardBody>
          </Card>

          {canEdit && po.status !== PoStatus.RECEIVED && po.status !== PoStatus.CANCELLED ? (
            <Card>
              <CardHeader title="Cancel PO" />
              <CardBody>
                <FormShell action={cancelPurchaseOrder.bind(null, po.id)} submitLabel="Cancel PO" size="sm" variant="danger">
                  <Field label="Reason" required>
                    <Textarea name="reason" required />
                  </Field>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          <AttachmentPanel
            entityType={AttachmentEntity.PURCHASE_ORDER}
            entityId={po.id}
            attachments={attachments}
            canEdit={canEdit}
          />

          {activity.length > 0 ? (
            <Card>
              <CardHeader title="Activity" />
              <ul className="divide-y divide-slate-100">
                {activity.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-sm text-slate-800">{entry.summary ?? entry.action}</p>
                    <p className="text-xs text-slate-500">
                      {entry.userName ?? "System"} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Link href="/procurement/purchase-orders" className={buttonClass("ghost", "sm")} prefetch={false}>
            ← Back to purchase orders
          </Link>
        </div>
      </div>
    </>
  );
}
