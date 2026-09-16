"use server";

import { redirect } from "next/navigation";

import { AttachmentEntity, DeliveryStatus, DocType, OrderStatus } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { inventoryEnabled, recordStockOut, resolveWarehouse } from "@/lib/inventory";
import { num } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { queueNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  dateField,
  fail,
  numberField,
  ok,
  optionalString,
  requiredString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/delivery", "/dashboard", "/fulfillment"];

/** Creates a DO for a subset of the order's undelivered quantities (partial delivery). */
export async function createDeliveryOrder(formData: FormData): Promise<ActionResult> {
  let deliveryId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("delivery", "manage");
    const tenantId = auth.user.tenantId;
    const orderId = requiredString(formData, "orderId", "Order");

    const delivery = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      const lines = order.items
        .map((item) => ({
          orderItem: item,
          quantity: numberField(formData, `quantity[${item.id}]`),
        }))
        .filter((line) => line.quantity > 0 && num(line.orderItem.deliveredQty) < num(line.orderItem.quantity));

      if (lines.length === 0) throw new Error("Belum ada item yang siap dikirim atau qty belum diisi.");

      const number = await nextDocumentNumber(tx, tenantId, DocType.DELIVERY_ORDER);
      const created = await tx.deliveryOrder.create({
        data: {
          tenantId,
          number,
          orderId: order.id,
          customerId: order.customerId,
          status: DeliveryStatus.READY_TO_SHIP,
          shipMethod: optionalString(formData, "shipMethod"),
          courierName: optionalString(formData, "courierName"),
          driverName: optionalString(formData, "driverName"),
          vehicleNumber: optionalString(formData, "vehicleNumber"),
          trackingNumber: optionalString(formData, "trackingNumber"),
          deliveryAddress: optionalString(formData, "deliveryAddress"),
          shipDate: dateField(formData, "shipDate"),
          notes: optionalString(formData, "notes"),
          createdById: auth.user.id,
          items: {
            create: lines.map((line) => ({
              orderItemId: line.orderItem.id,
              quantity: line.quantity,
              unit: line.orderItem.unit,
              note: optionalString(formData, `note[${line.orderItem.id}]`),
            })),
          },
        },
      });

      await logActivity(tx, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.DELIVERY_ORDER,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Delivery order ${created.number} created for order ${order.number}`,
      });

      return created;
    });

    deliveryId = delivery.id;
    return ok("Delivery order dibuat.", delivery.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/delivery/${deliveryId}`);
}

export async function updateDeliveryOrder(deliveryId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("delivery", "manage");

      await prisma.$transaction(async (tx) => {
        const before = await tx.deliveryOrder.findFirstOrThrow({ where: { id: deliveryId, tenantId: auth.user.tenantId } });

        const updated = await tx.deliveryOrder.update({
          where: { id: before.id },
          data: {
            shipMethod: optionalString(formData, "shipMethod") ?? before.shipMethod,
            courierName: optionalString(formData, "courierName") ?? before.courierName,
            driverName: optionalString(formData, "driverName") ?? before.driverName,
            vehicleNumber: optionalString(formData, "vehicleNumber") ?? before.vehicleNumber,
            trackingNumber: optionalString(formData, "trackingNumber") ?? before.trackingNumber,
            deliveryAddress: optionalString(formData, "deliveryAddress") ?? before.deliveryAddress,
            shipDate: dateField(formData, "shipDate", before.shipDate),
            notes: optionalString(formData, "notes") ?? before.notes,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.DELIVERY_ORDER,
          entityId: updated.id,
          entityLabel: updated.number,
          summary: `Delivery order ${updated.number} updated`,
        });
      });

      return ok("Delivery order diperbarui.");
    },
    [...PATHS, `/delivery/${deliveryId}`],
  );
}

/**
 * Moves a DO along Not Ready → Ready → In Delivery → Delivered. Marking a DO
 * delivered books the stock out, updates order line progress and can fulfil the order.
 */
export async function setDeliveryStatus(deliveryId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("delivery", "manage");
      const tenantId = auth.user.tenantId;
      const status = String(formData.get("status") ?? "");
      if (!Object.values(DeliveryStatus).includes(status as DeliveryStatus)) return fail("Status pengiriman tidak dikenal.");

      await prisma.$transaction(async (tx) => {
        const delivery = await tx.deliveryOrder.findFirstOrThrow({
          where: { id: deliveryId, tenantId },
          include: { items: true, order: { include: { customer: { select: { companyName: true, whatsappNumber: true, phone: true } } } } },
        });

        if (delivery.status === DeliveryStatus.DELIVERED) {
          throw new Error("Delivery ini sudah selesai dan tidak bisa diubah lagi.");
        }

        await tx.deliveryOrder.update({
          where: { id: delivery.id },
          data: {
            status: status as DeliveryStatus,
            shipDate: status === DeliveryStatus.IN_DELIVERY ? (delivery.shipDate ?? new Date()) : delivery.shipDate,
            deliveredDate: status === DeliveryStatus.DELIVERED ? new Date() : delivery.deliveredDate,
            receiverName: status === DeliveryStatus.DELIVERED ? optionalString(formData, "receiverName") : delivery.receiverName,
            proofNote: status === DeliveryStatus.DELIVERED ? optionalString(formData, "proofNote") : delivery.proofNote,
            receiverSignatureUrl:
              status === DeliveryStatus.DELIVERED ? optionalString(formData, "receiverSignatureUrl") : delivery.receiverSignatureUrl,
          },
        });

        if (status === DeliveryStatus.DELIVERED) {
          for (const item of delivery.items) {
            await tx.orderItem.update({
              where: { id: item.orderItemId },
              data: { deliveredQty: { increment: item.quantity } },
            });
          }

          if (await inventoryEnabled(tx, tenantId)) {
            const warehouseId = await resolveWarehouse(tx, tenantId);
            if (warehouseId) {
              for (const item of delivery.items) {
                const orderItem = await tx.orderItem.findUnique({ where: { id: item.orderItemId } });
                if (!orderItem?.productId) continue;
                await recordStockOut(tx, {
                  tenantId,
                  productId: orderItem.productId,
                  warehouseId,
                  quantity: num(item.quantity),
                  referenceType: "DELIVERY_ORDER",
                  referenceId: delivery.number,
                  note: `Pengiriman ${delivery.number}`,
                  createdById: auth.user.id,
                });
                await tx.stockLevel.updateMany({
                  where: { productId: orderItem.productId, warehouseId },
                  data: { reserved: { decrement: num(item.quantity) } },
                });
              }
            }
          }

          const orderItems = await tx.orderItem.findMany({ where: { orderId: delivery.orderId } });
          const allDelivered = orderItems.every((item) => num(item.deliveredQty) >= num(item.quantity));

          if (allDelivered) {
            const order = await tx.order.findUnique({ where: { id: delivery.orderId } });
            if (order && order.status !== OrderStatus.COMPLETED) {
              await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.FULFILLED },
              });
            }
          }

          await queueNotification({
            tenantId,
            event: "DELIVERY_COMPLETED",
            channel: "WHATSAPP",
            recipient: delivery.order.customer.whatsappNumber ?? delivery.order.customer.phone,
            recipientName: delivery.order.customer.companyName,
            subject: `Pengiriman ${delivery.number} selesai`,
            body: `Barang untuk order ${delivery.order.number} sudah dikirim. Surat jalan: /print/delivery/${delivery.id}`,
            entityType: "DELIVERY_ORDER",
            entityId: delivery.id,
            entityLabel: delivery.number,
          });
        }

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.DELIVERY_ORDER,
          entityId: delivery.id,
          entityLabel: delivery.number,
          summary: `Delivery ${delivery.number} → ${status}`,
          changes: { status: { from: delivery.status, to: status } },
        });
      });

      return ok("Status pengiriman diperbarui.");
    },
    [...PATHS, `/delivery/${deliveryId}`, "/orders", "/inventory"],
  );
}
