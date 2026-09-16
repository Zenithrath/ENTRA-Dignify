import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";

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
import { Tabs } from "@/components/ui/tabs";
import { AttachmentEntity, OrderStatus } from "@/generated/prisma/enums";
import {
  cancelOrder,
  createProductionOrder,
  createSubcontract,
  generatePurchaseOrders,
  generateWorkOrder,
  setOrderStatus,
  updateOrder,
} from "@/lib/actions/order-actions";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { statusMeta } from "@/lib/status";
import { formatDate, formatDateTime, supplierOptions, tenantModules, tenantUsers, toDateInput } from "@/lib/queries/common";
import { productOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Order" };

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const { tab = "order" } = await searchParams;
  const tenantId = auth.user.tenantId;

  const order = await prisma.order.findFirst({
    where: { id, tenantId },
    include: {
      customer: { select: { id: true, companyName: true, paymentTerms: true, whatsappNumber: true, email: true } },
      quotation: { select: { id: true, number: true, version: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { product: { select: { id: true, name: true, sku: true } } } },
      purchaseOrders: {
        include: {
          supplier: { select: { id: true, name: true } },
          items: true,
          receipts: { orderBy: { receivedDate: "desc" } },
        },
        orderBy: { poDate: "desc" },
      },
      rfqs: { include: { _count: { select: { suppliers: true, items: true } } }, orderBy: { rfqDate: "desc" } },
      workOrders: { orderBy: { createdAt: "desc" } },
      productionOrders: { orderBy: { createdAt: "desc" } },
      subcontracts: { include: { supplier: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      deliveryOrders: { include: { items: { include: { orderItem: { select: { description: true } } } } }, orderBy: { createdAt: "desc" } },
      invoices: { include: { payments: true }, orderBy: { invoiceDate: "desc" } },
    },
  });
  if (!order) notFound();

  const [comments, attachments, activity, users, suppliers, products, modules] = await Promise.all([
    prisma.comment.findMany({
      where: { tenantId, entityType: AttachmentEntity.ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: AttachmentEntity.ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    tenantUsers(tenantId),
    supplierOptions(tenantId),
    productOptions(tenantId),
    tenantModules(tenantId),
  ]);

  const canEdit = canManage(auth.user.role, "orders");
  const canFulfill = canManage(auth.user.role, "fulfillment");
  const billedTotal = order.invoices.reduce((total, invoice) => total + num(invoice.grandTotal), 0);
  const paidTotal = order.invoices.reduce((total, invoice) => total + num(invoice.amountPaid), 0);
  const deliveredValue = order.items.reduce(
    (total, item) => total + num(item.deliveredQty) * num(item.sellingPrice),
    0,
  );
  const openPoCount = order.purchaseOrders.filter((po) => !["RECEIVED", "CANCELLED"].includes(po.status)).length;

  const tabs = [
    { id: "order", label: "Customer order", href: `/orders/${id}?tab=order` },
    { id: "procurement", label: "Procurement", href: `/orders/${id}?tab=procurement`, count: order.purchaseOrders.length },
    { id: "fulfillment", label: "Fulfillment", href: `/orders/${id}?tab=fulfillment` },
    { id: "delivery", label: "Delivery", href: `/orders/${id}?tab=delivery`, count: order.deliveryOrders.length },
    { id: "finance", label: "Finance", href: `/orders/${id}?tab=finance`, count: order.invoices.length },
    { id: "activity", label: "Activity", href: `/orders/${id}?tab=activity` },
  ];

  return (
    <>
      <PageHeader
        title={`Order ${order.number}`}
        breadcrumbs={[{ label: "Orders", href: "/orders" }, { label: order.number }]}
        meta={
          <>
            <StatusBadge value={order.status} />
            <Link href={`/customers/${order.customer.id}`} className="text-xs text-indigo-600 hover:underline">
              {order.customer.companyName}
            </Link>
            {order.quotation ? (
              <Link href={`/quotations/${order.quotation.id}`} className="text-xs text-slate-500 hover:underline">
                from {order.quotation.number} v{order.quotation.version}
              </Link>
            ) : null}
            <span className="text-xs text-slate-500">PO customer: {order.customerPoNumber ?? "belum diinput"}</span>
            {order.estimatedFulfillmentDate ? (
              <span
                className={`text-xs ${
                  order.estimatedFulfillmentDate < new Date() && !["FULFILLED", "COMPLETED", "CANCELLED"].includes(order.status)
                    ? "font-medium text-rose-600"
                    : "text-slate-500"
                }`}
              >
                Est. fulfillment {formatDate(order.estimatedFulfillmentDate)}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Link href={`/print/orders/${order.id}`} className={buttonClass("secondary")} target="_blank">
              <Printer className="h-4 w-4" />
              Sales order PDF
            </Link>
            {canEdit && order.status === OrderStatus.CONFIRMED ? (
              <ActionForm action={setOrderStatus.bind(null, order.id)}>
                <input type="hidden" name="status" value={OrderStatus.IN_PROGRESS} />
                <SubmitButton pendingLabel="…">Start progress</SubmitButton>
              </ActionForm>
            ) : null}
            {canEdit && order.status === OrderStatus.IN_PROGRESS ? (
              <ActionForm action={setOrderStatus.bind(null, order.id)}>
                <input type="hidden" name="status" value={OrderStatus.FULFILLED} />
                <SubmitButton pendingLabel="…">Mark fulfilled</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Order value" value={money(order.grandTotal)} hint={`${order.items.length} baris item`} />
        <Stat label="Delivered value" value={money(deliveredValue)} hint="Nilai item yang sudah terkirim" />
        <Stat label="Open POs" value={String(openPoCount)} hint={`${order.purchaseOrders.length} PO total`} tone={openPoCount > 0 ? "warning" : "neutral"} />
        <Stat
          label="Billed / paid"
          value={`${money(billedTotal)}`}
          hint={`Terbayar ${money(paidTotal)} · sisa ${money(billedTotal - paidTotal)}`}
          tone={billedTotal - paidTotal > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="mb-4">
        <Tabs items={tabs} active={tab} />
      </div>

      <div className="space-y-5">
        {tab === "order" ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Customer order items" description="Status sourcing per item" />
              <DataTable
                rows={order.items}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "item",
                    header: "Item",
                    render: (row) => (
                      <div>
                        <p className="text-sm text-slate-900">{row.description}</p>
                        <p className="text-xs text-slate-500">
                          {statusMeta(row.lineType).label}
                          {row.product ? ` · ${row.product.sku}` : ""}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "qty",
                    header: "Qty",
                    render: (row) => (
                      <span className="text-sm">
                        {qty(row.quantity)} {row.unit}
                      </span>
                    ),
                  },
                  {
                    key: "progress",
                    header: "Delivered / fulfilled",
                    render: (row) => (
                      <span className="text-xs text-slate-600">
                        {qty(row.deliveredQty)} terkirim · {qty(row.fulfilledQty)} terpenuhi
                      </span>
                    ),
                  },
                  { key: "sourcing", header: "Sourcing", render: (row) => <StatusBadge value={row.sourcingStatus} /> },
                  {
                    key: "total",
                    header: "Line total",
                    className: "text-right",
                    render: (row) => <span className="text-sm font-medium">{money(row.lineTotal)}</span>,
                  },
                ]}
              />
            </Card>

            <div className="space-y-5">
              {canEdit ? (
                <Card>
                  <CardHeader title="Customer PO" description="Nomor PO dan dokumen PO asli customer." />
                  <CardBody>
                    <FormShell action={updateOrder.bind(null, order.id)} submitLabel="Save order" size="sm">
                      <div className="space-y-3">
                        <FormGrid>
                          <Field label="Customer PO number">
                            <Input name="customerPoNumber" defaultValue={order.customerPoNumber ?? ""} />
                          </Field>
                          <Field label="PO date">
                            <Input type="date" name="customerPoDate" defaultValue={toDateInput(order.customerPoDate)} />
                          </Field>
                          <Field label="Expected delivery">
                            <Input type="date" name="expectedDeliveryDate" defaultValue={toDateInput(order.expectedDeliveryDate)} />
                          </Field>
                          <Field label="Estimated fulfillment">
                            <Input
                              type="date"
                              name="estimatedFulfillmentDate"
                              defaultValue={toDateInput(order.estimatedFulfillmentDate)}
                            />
                          </Field>
                        </FormGrid>
                        <Field label="Notes">
                          <Textarea name="notes" defaultValue={order.notes ?? ""} />
                        </Field>
                      </div>
                    </FormShell>
                  </CardBody>
                </Card>
              ) : null}

              {canEdit ? (
                <Card>
                  <CardHeader title="Cancel order" description="Ada PO atau work order aktif? Centang cascade." />
                  <CardBody>
                    <FormShell action={cancelOrder.bind(null, order.id)} submitLabel="Cancel order" size="sm" variant="danger">
                      <div className="space-y-3">
                        <Field label="Reason" required>
                          <Textarea name="reason" required placeholder="Alasan pembatalan" />
                        </Field>
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" name="cascade" className="h-4 w-4 rounded border-slate-300" />
                          Cascade cancel semua PO & work order aktif
                        </label>
                      </div>
                    </FormShell>
                  </CardBody>
                </Card>
              ) : null}

              <Card>
                <CardHeader title="Order details" />
                <CardBody>
                  <DescriptionList
                    items={[
                      { label: "Order date", value: formatDate(order.orderDate) },
                      { label: "Customer PO date", value: formatDate(order.customerPoDate) },
                      { label: "Payment terms", value: order.customer.paymentTerms ?? "—" },
                      { label: "Confirmed at", value: order.confirmedAt ? formatDateTime(order.confirmedAt) : "—" },
                      { label: "Cancel reason", value: order.cancelReason ?? "—" },
                      { label: "Notes", value: order.notes ?? "—" },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "procurement" ? (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Purchase orders"
                description="PO ke supplier untuk item order yang perlu dibeli."
                actions={
                  canEdit ? (
                    <ActionForm action={generatePurchaseOrders.bind(null, order.id)}>
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Generating…">
                        Generate purchase order
                      </SubmitButton>
                    </ActionForm>
                  ) : null
                }
              />
              {order.purchaseOrders.length === 0 ? (
                <EmptyState
                  title="Belum ada PO"
                  description="Generate PO otomatis mengelompokkan item yang butuh dibeli per supplier default."
                />
              ) : (
                <DataTable
                  rows={order.purchaseOrders}
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
                    { key: "supplier", header: "Supplier", render: (row) => <span className="text-sm">{row.supplier.name}</span> },
                    {
                      key: "progress",
                      header: "Receiving",
                      render: (row) => {
                        const total = row.items.reduce((sum, item) => sum + num(item.quantity), 0);
                        const received = row.items.reduce((sum, item) => sum + num(item.receivedQty), 0);
                        return (
                          <span className="text-xs text-slate-600">
                            {qty(received)} / {qty(total)} diterima
                          </span>
                        );
                      },
                    },
                    { key: "expected", header: "Expected", render: (row) => <span className="text-sm">{formatDate(row.expectedDate)}</span> },
                    { key: "total", header: "Value", render: (row) => <span className="text-sm font-medium">{money(row.grandTotal)}</span> },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  ]}
                />
              )}
            </Card>

            {order.rfqs.length > 0 ? (
              <Card>
                <CardHeader title="RFQ" description="Permintaan penawaran ke beberapa supplier." />
                <DataTable
                  rows={order.rfqs}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "number",
                      header: "RFQ",
                      render: (row) => (
                        <Link href={`/procurement/rfq/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                          {row.number}
                        </Link>
                      ),
                    },
                    { key: "date", header: "Date", render: (row) => <span className="text-sm">{formatDate(row.rfqDate)}</span> },
                    {
                      key: "scope",
                      header: "Scope",
                      render: (row) => (
                        <span className="text-xs text-slate-600">
                          {row._count.items} item · {row._count.suppliers} supplier
                        </span>
                      ),
                    },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  ]}
                />
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "fulfillment" ? (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Work orders (jasa)"
                description="Fulfillment untuk item bertipe Service / Labor."
                actions={
                  canFulfill ? (
                    <FormShell action={generateWorkOrder.bind(null, order.id)} submitLabel="+ Work order" size="sm">
                      <div className="space-y-3">
                        <Field label="Title">
                          <Input name="title" placeholder={`Fulfillment jasa untuk ${order.number}`} />
                        </Field>
                        <Field label="Assignee">
                          <Select name="assigneeId" defaultValue="">
                            <option value="">Unassigned</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <FormGrid>
                          <Field label="Scheduled start">
                            <Input type="date" name="scheduledStart" />
                          </Field>
                          <Field label="Scheduled end">
                            <Input type="date" name="scheduledEnd" />
                          </Field>
                        </FormGrid>
                      </div>
                    </FormShell>
                  ) : null
                }
              />
              {order.workOrders.length === 0 ? (
                <EmptyState title="Belum ada work order" />
              ) : (
                <DataTable
                  rows={order.workOrders}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "number",
                      header: "WO",
                      render: (row) => (
                        <Link href={`/fulfillment/work-orders/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                          {row.number}
                        </Link>
                      ),
                    },
                    { key: "title", header: "Scope", render: (row) => <span className="text-sm">{row.title}</span> },
                    {
                      key: "progress",
                      header: "Progress",
                      render: (row) => <span className="text-sm">{num(row.progressPercent)}%</span>,
                    },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  ]}
                />
              )}
            </Card>

            {modules.get("PRODUCTION") ? (
              <Card>
                <CardHeader
                  title="Production orders"
                  description="Tracking tahap produksi dan QC."
                  actions={
                    canFulfill ? (
                      <FormShell action={createProductionOrder.bind(null, order.id)} submitLabel="+ Production order" size="sm">
                        <div className="space-y-3">
                          <Field label="Description" required>
                            <Input name="description" required placeholder="cth. Fabrikasi skid WTP 20 m3/jam" />
                          </Field>
                          <FormGrid>
                            <Field label="Product">
                              <Select name="productId" defaultValue="">
                                <option value="">—</option>
                                {products.map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {product.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Quantity">
                              <Input name="quantity" type="number" step="1" defaultValue={1} />
                            </Field>
                            <Field label="Start">
                              <Input type="date" name="scheduledStart" />
                            </Field>
                            <Field label="End">
                              <Input type="date" name="scheduledEnd" />
                            </Field>
                          </FormGrid>
                        </div>
                      </FormShell>
                    ) : null
                  }
                />
                {order.productionOrders.length === 0 ? (
                  <EmptyState title="Belum ada production order" />
                ) : (
                  <DataTable
                    rows={order.productionOrders}
                    rowKey={(row) => row.id}
                    columns={[
                      {
                        key: "number",
                        header: "Production",
                        render: (row) => (
                          <Link href={`/fulfillment/production/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                            {row.number}
                          </Link>
                        ),
                      },
                      { key: "stage", header: "Current stage", render: (row) => <span className="text-sm">{row.currentStage ?? "—"}</span> },
                      { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                    ]}
                  />
                )}
              </Card>
            ) : null}

            {modules.get("SUBCONTRACT") ? (
              <Card>
                <CardHeader
                  title="Subcontracts"
                  description="Pekerjaan yang dialihkan ke subcontractor."
                  actions={
                    canFulfill ? (
                      <FormShell action={createSubcontract.bind(null, order.id)} submitLabel="+ Subcontract" size="sm">
                        <div className="space-y-3">
                          <Field label="Subcontractor" required>
                            <Select name="supplierId" required defaultValue="">
                              <option value="">Select supplier…</option>
                              {suppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Scope" required>
                            <Input name="scope" required />
                          </Field>
                          <Field label="Value (IDR)">
                            <Input name="value" type="number" step="1000" />
                          </Field>
                        </div>
                      </FormShell>
                    ) : null
                  }
                />
                {order.subcontracts.length === 0 ? (
                  <EmptyState title="Belum ada subcontract" />
                ) : (
                  <DataTable
                    rows={order.subcontracts}
                    rowKey={(row) => row.id}
                    columns={[
                      {
                        key: "number",
                        header: "Subcontract",
                        render: (row) => (
                          <Link href={`/fulfillment/subcontracts/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                            {row.number}
                          </Link>
                        ),
                      },
                      { key: "supplier", header: "Subcontractor", render: (row) => <span className="text-sm">{row.supplier.name}</span> },
                      { key: "progress", header: "Progress", render: (row) => <span className="text-sm">{num(row.progressPercent)}%</span> },
                      { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                    ]}
                  />
                )}
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "delivery" ? (
          <Card>
            <CardHeader
              title="Delivery orders"
              description="Pengiriman penuh atau sebagian; setiap DO punya surat jalan sendiri."
              actions={
                <Link href={`/delivery/new?orderId=${order.id}`} className={buttonClass("secondary", "sm")}>
                  + Delivery order
                </Link>
              }
            />
            {order.deliveryOrders.length === 0 ? (
              <EmptyState title="Belum ada delivery order" />
            ) : (
              <DataTable
                rows={order.deliveryOrders}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "number",
                    header: "DO",
                    render: (row) => (
                      <Link href={`/delivery/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  {
                    key: "items",
                    header: "Items",
                    render: (row) => (
                      <span className="text-xs text-slate-600">
                        {row.items.map((item) => `${item.orderItem.description} (${qty(item.quantity)})`).join(", ")}
                      </span>
                    ),
                  },
                  { key: "ship", header: "Ship date", render: (row) => <span className="text-sm">{formatDate(row.shipDate)}</span> },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                ]}
              />
            )}
          </Card>
        ) : null}

        {tab === "finance" ? (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Invoices"
                description="Bisa lebih dari satu invoice (progress/milestone billing)."
                actions={
                  <Link href={`/finance/invoices/new?orderId=${order.id}`} className={buttonClass("secondary", "sm")}>
                    + Generate invoice
                  </Link>
                }
              />
              {order.invoices.length === 0 ? (
                <EmptyState title="Belum ada invoice" />
              ) : (
                <DataTable
                  rows={order.invoices}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "number",
                      header: "Invoice",
                      render: (row) => (
                        <Link href={`/finance/invoices/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                          {row.number}
                        </Link>
                      ),
                    },
                    { key: "type", header: "Type", render: (row) => <span className="text-sm">{statusMeta(row.type).label}</span> },
                    { key: "due", header: "Due", render: (row) => <span className="text-sm">{formatDate(row.dueDate)}</span> },
                    {
                      key: "amounts",
                      header: "Amount",
                      render: (row) => (
                        <span className="text-xs text-slate-600">
                          {money(row.grandTotal)} · paid {money(row.amountPaid)}
                        </span>
                      ),
                    },
                    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  ]}
                />
              )}
            </Card>

            <Card>
              <CardHeader title="Payments received" />
              {order.invoices.flatMap((invoice) => invoice.payments).length === 0 ? (
                <EmptyState title="Belum ada pembayaran" />
              ) : (
                <DataTable
                  rows={order.invoices.flatMap((invoice) => invoice.payments.map((payment) => ({ ...payment, invoiceNumber: invoice.number })))}
                  rowKey={(row) => row.id}
                  columns={[
                    { key: "date", header: "Date", render: (row) => <span className="text-sm">{formatDate(row.paymentDate)}</span> },
                    { key: "invoice", header: "Invoice", render: (row) => <span className="text-sm">{row.invoiceNumber}</span> },
                    { key: "amount", header: "Amount", render: (row) => <span className="text-sm font-medium">{money(row.amount)}</span> },
                    { key: "method", header: "Method", render: (row) => <StatusBadge value={row.method} /> },
                    { key: "ref", header: "Reference", render: (row) => <span className="text-sm">{row.referenceNumber ?? "—"}</span> },
                  ]}
                />
              )}
            </Card>
          </div>
        ) : null}

        {tab === "activity" ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader title="Activity" description="Audit trail order ini (read-only)." />
              {activity.length === 0 ? (
                <EmptyState title="Belum ada aktivitas" />
              ) : (
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
              )}
            </Card>
            <div className="space-y-5">
              <NotePanel entityType={AttachmentEntity.ORDER} entityId={order.id} notes={comments} canEdit={canEdit} />
              <AttachmentPanel
                entityType={AttachmentEntity.ORDER}
                entityId={order.id}
                attachments={attachments}
                canEdit={canEdit}
              />
            </div>
          </div>
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
