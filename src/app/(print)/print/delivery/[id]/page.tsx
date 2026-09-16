import { notFound } from "next/navigation";

import { Letterhead, PrintFooter, PrintTable, SignatureBlocks } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";
import { statusMeta } from "@/lib/status";

export default async function PrintDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;

  const [delivery, tenant] = await Promise.all([
    prisma.deliveryOrder.findFirst({
      where: { id, tenantId: auth.user.tenantId },
      include: {
        customer: true,
        order: { select: { number: true } },
        items: { include: { orderItem: { select: { description: true, unit: true, sellingPrice: true } } } },
      },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } }),
  ]);

  if (!delivery) notFound();

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Surat Jalan / Delivery Note"
        docNumber={delivery.number}
        meta={[
          { label: "Ship date", value: formatDate(delivery.shipDate) },
          { label: "Status", value: statusMeta(delivery.status).label },
          { label: "Order", value: delivery.order.number },
        ]}
      />

      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Kirim kepada</p>
          <p className="mt-1 font-medium text-slate-900">{delivery.customer.companyName}</p>
          <p className="text-xs leading-relaxed text-slate-600">{delivery.deliveryAddress ?? "—"}</p>
        </div>
        <div className="text-right text-xs leading-relaxed text-slate-600">
          <p>
            <span className="text-slate-500">Metode:</span> {delivery.shipMethod ?? "—"}
          </p>
          <p>
            <span className="text-slate-500">Driver / kurir:</span> {delivery.driverName ?? delivery.courierName ?? "—"}
          </p>
          {delivery.vehicleNumber ? (
            <p>
              <span className="text-slate-500">Kendaraan:</span> {delivery.vehicleNumber}
            </p>
          ) : null}
          {delivery.trackingNumber ? (
            <p>
              <span className="text-slate-500">Tracking:</span> {delivery.trackingNumber}
            </p>
          ) : null}
        </div>
      </section>

      <PrintTable
        showTax={false}
        lines={delivery.items.map((item) => ({
          description: item.orderItem.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: 0,
          lineTotal: 0,
          taxRate: 0,
          discountPercent: 0,
        }))}
      />

      {delivery.notes || delivery.proofNote ? (
        <section className="mt-6 text-xs leading-relaxed text-slate-600">
          {delivery.notes ? <p className="whitespace-pre-line">{delivery.notes}</p> : null}
          {delivery.proofNote ? <p className="mt-1 whitespace-pre-line">Bukti terima: {delivery.proofNote}</p> : null}
        </section>
      ) : null}

      <SignatureBlocks
        left={{ title: "Diserahkan oleh", name: delivery.driverName ?? null }}
        right={{ title: "Diterima oleh", name: delivery.receiverName ?? null }}
      />

      <PrintFooter tenant={tenant} note="Barang diterima dalam kondisi baik dan jumlah sesuai surat jalan." />
    </>
  );
}
