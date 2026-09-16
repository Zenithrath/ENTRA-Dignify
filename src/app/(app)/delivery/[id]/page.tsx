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
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { AttachmentEntity, DeliveryStatus, OrderStatus } from "@/generated/prisma/enums";
import { setDeliveryStatus, updateDeliveryOrder } from "@/lib/actions/delivery-actions";
import { requireAuth } from "@/lib/auth";
import { num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import { statusMeta } from "@/lib/status";
import { formatDate, formatDateTime, toDateInput } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Delivery order" };

const NEXT_STATUS: Record<DeliveryStatus, { to: DeliveryStatus; label: string }[]> = {
  [DeliveryStatus.NOT_READY]: [{ to: DeliveryStatus.READY_TO_SHIP, label: "Mark as ready to ship" }],
  [DeliveryStatus.READY_TO_SHIP]: [
    { to: DeliveryStatus.IN_DELIVERY, label: "Start delivery" },
    { to: DeliveryStatus.NOT_READY, label: "Belum siap kirim" },
  ],
  [DeliveryStatus.IN_DELIVERY]: [
    { to: DeliveryStatus.DELIVERED, label: "Mark as delivered" },
    { to: DeliveryStatus.READY_TO_SHIP, label: "Kembalikan ke ready" },
  ],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: [],
};

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "delivery")) notFound();

  const tenantId = auth.user.tenantId;
  const { id } = await params;

  const delivery = await prisma.deliveryOrder.findFirst({
    where: { id, tenantId },
    include: {
      customer: { select: { id: true, companyName: true, address: true, city: true } },
      order: { select: { id: true, number: true, status: true } },
      items: {
        orderBy: { id: "asc" },
        include: { orderItem: { select: { description: true, unit: true, quantity: true, deliveredQty: true } } },
      },
    },
  });
  if (!delivery) notFound();

  const [attachments, comments] = await Promise.all([
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.DELIVERY_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.comment.findMany({
      where: { tenantId, entityType: AttachmentEntity.DELIVERY_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const canEdit = canManage(auth.user.role, "delivery") && delivery.status !== DeliveryStatus.DELIVERED;
  const update = updateDeliveryOrder.bind(null, delivery.id);
  const transitions = NEXT_STATUS[delivery.status];
  const address =
    delivery.deliveryAddress ?? [delivery.customer.address, delivery.customer.city].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={delivery.number}
        breadcrumbs={[{ label: "Delivery", href: "/delivery" }, { label: delivery.number }]}
        description={
          <>
            Order{" "}
            <Link href={`/orders/${delivery.order.id}`} className="text-indigo-600 hover:underline">
              {delivery.order.number}
            </Link>{" "}
            · {delivery.customer.companyName}
          </>
        }
        actions={
          <>
            <StatusBadge value={delivery.status} className="mr-2" />
            <Link href={`/print/delivery/${delivery.id}`} className={buttonClass("secondary")} target="_blank">
              Surat jalan PDF
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Shipping details" description="Metode kirim, kurir, alamat, dan jadwal." />
            {canEdit ? (
              <CardBody>
                <FormShell action={update} submitLabel="Save changes">
                  <FormGrid columns={3}>
                    <Field label="Ship method">
                      <Input name="shipMethod" defaultValue={delivery.shipMethod ?? ""} />
                    </Field>
                    <Field label="Driver">
                      <Input name="driverName" defaultValue={delivery.driverName ?? ""} />
                    </Field>
                    <Field label="Kurir">
                      <Input name="courierName" defaultValue={delivery.courierName ?? ""} />
                    </Field>
                    <Field label="Vehicle number">
                      <Input name="vehicleNumber" defaultValue={delivery.vehicleNumber ?? ""} />
                    </Field>
                    <Field label="Tracking number">
                      <Input name="trackingNumber" defaultValue={delivery.trackingNumber ?? ""} />
                    </Field>
                    <Field label="Ship date">
                      <Input type="date" name="shipDate" defaultValue={toDateInput(delivery.shipDate)} />
                    </Field>
                    <Field label="Delivery address" className="sm:col-span-3">
                      <Textarea name="deliveryAddress" defaultValue={address} />
                    </Field>
                    <Field label="Notes" className="sm:col-span-3">
                      <Textarea name="notes" defaultValue={delivery.notes ?? ""} />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : (
              <CardBody>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: "Ship method", value: delivery.shipMethod ?? "—" },
                    { label: "Driver", value: delivery.driverName ?? "—" },
                    { label: "Kurir", value: delivery.courierName ?? "—" },
                    { label: "Vehicle", value: delivery.vehicleNumber ?? "—" },
                    { label: "Tracking", value: delivery.trackingNumber ?? "—" },
                    { label: "Ship date", value: formatDate(delivery.shipDate) },
                    { label: "Delivered", value: formatDate(delivery.deliveredDate) },
                    { label: "Address", value: address || "—", wide: true },
                    { label: "Notes", value: delivery.notes ?? "—", wide: true },
                  ]}
                />
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Items" description="Qty pada surat jalan ini dan progres per baris order." />
            <DataTable
              rows={delivery.items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  render: (row) => (
                    <div>
                      <p className="text-sm text-slate-800">{row.orderItem.description}</p>
                      {row.note ? <p className="text-xs text-slate-500">{row.note}</p> : null}
                    </div>
                  ),
                },
                {
                  key: "qty",
                  header: "Qty kirim",
                  render: (row) => (
                    <span className="text-sm font-medium">
                      {qty(row.quantity)} {row.unit || row.orderItem.unit || ""}
                    </span>
                  ),
                },
                {
                  key: "ordered",
                  header: "Ordered",
                  render: (row) => <span className="text-sm">{qty(row.orderItem.quantity)}</span>,
                },
                {
                  key: "delivered",
                  header: "Terkirim",
                  render: (row) => (
                    <span className="text-sm text-slate-600">
                      {qty(row.orderItem.deliveredQty)} / {qty(row.orderItem.quantity)}
                      {num(row.orderItem.deliveredQty) >= num(row.orderItem.quantity) ? (
                        <span className="ml-2 text-xs text-emerald-600">selesai</span>
                      ) : null}
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          {delivery.status === DeliveryStatus.DELIVERED ? (
            <Card>
              <CardHeader title="Proof of delivery" description="Penerima, catatan, dan tanda tangan." />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: "Penerima", value: delivery.receiverName ?? "—" },
                    { label: "Waktu terima", value: formatDateTime(delivery.deliveredDate) },
                    { label: "Catatan", value: delivery.proofNote ?? "—", wide: true },
                    { label: "Tanda tangan", value: delivery.receiverSignatureUrl ?? "—", wide: true },
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <AttachmentPanel
            entityType={AttachmentEntity.DELIVERY_ORDER}
            entityId={delivery.id}
            attachments={attachments}
            canEdit={canManage(auth.user.role, "delivery")}
          />

          <NotePanel
            entityType={AttachmentEntity.DELIVERY_ORDER}
            entityId={delivery.id}
            notes={comments}
            canEdit={canManage(auth.user.role, "delivery")}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Status" description="Not Ready → Ready to Ship → In Delivery → Delivered." />
            <CardBody className="space-y-4">
              {transitions.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {delivery.status === DeliveryStatus.DELIVERED
                    ? "Pengiriman selesai dan tidak bisa diubah lagi."
                    : "Pengiriman ini dibatalkan."}{" "}
                  Status order terkait: {statusMeta(delivery.order.status).label}.
                </p>
              ) : (
                transitions.map((transition) => {
                  const isDelivered = transition.to === DeliveryStatus.DELIVERED;
                  return (
                    <ActionForm key={transition.to} action={setDeliveryStatus.bind(null, delivery.id)} className="space-y-3">
                      <input type="hidden" name="status" value={transition.to} />
                      {isDelivered ? (
                        <>
                          <Field label="Nama penerima">
                            <Input name="receiverName" placeholder="Nama & jabatan penerima" />
                          </Field>
                          <Field label="Catatan bukti terima">
                            <Textarea name="proofNote" placeholder="cth. Barang diterima lengkap, segel utuh" />
                          </Field>
                          <Field label="URL tanda tangan / foto">
                            <Input name="receiverSignatureUrl" placeholder="https://…" />
                          </Field>
                        </>
                      ) : null}
                      <SubmitButton variant={isDelivered ? "primary" : "secondary"}>{transition.label}</SubmitButton>
                    </ActionForm>
                  );
                })
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ringkasan" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Customer", value: delivery.customer.companyName },
                  { label: "Order status", value: statusMeta(delivery.order.status).label },
                  { label: "Dibuat", value: formatDateTime(delivery.createdAt) },
                  { label: "Update terakhir", value: formatDateTime(delivery.updatedAt) },
                ]}
              />
              {delivery.order.status === OrderStatus.FULFILLED ? (
                <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  Seluruh qty order sudah terkirim — order otomatis berstatus Fulfilled.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Pengiriman lain" description="Semua DO untuk order ini." />
            <CardBody>
              <Link href={`/delivery?q=${delivery.order.number}`} className={buttonClass("ghost", "sm")}>
                Lihat riwayat DO order {delivery.order.number}
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
