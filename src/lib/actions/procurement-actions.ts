"use server";

import { redirect } from "next/navigation";

import {
  ApprovalStatus,
  AttachmentEntity,
  DocType,
  OrderStatus,
  PoStatus,
  ReceiptStatus,
  SourcingStatus,
  SupplierQuoteStatus,
} from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { approvalRuleFor, decideApproval, openApproval, requiresApproval } from "@/lib/approvals";
import { requirePermission } from "@/lib/auth";
import { canApprove } from "@/lib/rbac";
import { inventoryEnabled, recordStockIn, resolveWarehouse } from "@/lib/inventory";
import { money, num } from "@/lib/money";
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

const PATHS = ["/procurement", "/procurement/purchase-orders", "/dashboard"];

/** Creates an RFQ from the order's unsourced lines and invites the chosen suppliers. */
export async function createRfqFromOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  let rfqId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("procurement", "manage");
    const tenantId = auth.user.tenantId;
    const supplierIds = formData.getAll("supplierIds").map(String).filter(Boolean);

    if (supplierIds.length === 0) return fail("Pilih minimal satu supplier untuk diundang RFQ.");

    const rfq = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: {
          items: { where: { sourcingStatus: { in: [SourcingStatus.NOT_SOURCED, SourcingStatus.SOURCING] } } },
        },
      });

      if (order.items.length === 0) throw new Error("Semua item order sudah tersourcing.");

      const number = await nextDocumentNumber(tx, tenantId, DocType.RFQ);
      const created = await tx.rfq.create({
        data: {
          tenantId,
          number,
          orderId: order.id,
          rfqDate: new Date(),
          dueDate: dateField(formData, "dueDate"),
          status: "SENT",
          sentAt: new Date(),
          notes: optionalString(formData, "notes"),
          createdById: auth.user.id,
          items: {
            create: order.items.map((item) => ({
              orderItemId: item.id,
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
            })),
          },
          suppliers: {
            create: supplierIds.map((supplierId) => ({ supplierId, status: "SENT" as const, sentAt: new Date() })),
          },
        },
      });

      await tx.orderItem.updateMany({
        where: { id: { in: order.items.map((item) => item.id) } },
        data: { sourcingStatus: SourcingStatus.SOURCING },
      });

      await logActivity(tx, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.RFQ,
        entityId: created.id,
        entityLabel: created.number,
        summary: `RFQ ${created.number} sent to ${supplierIds.length} suppliers for order ${order.number}`,
      });

      return created;
    });

    rfqId = rfq.id;
    return ok("RFQ dibuat dan dikirim ke supplier.", rfq.id);
  }, [...PATHS, `/orders/${orderId}`]);

  if (!result.ok) return result;
  redirect(`/procurement/rfq/${rfqId}`);
}

/** Records a supplier's quoted prices against an RFQ. */
export async function recordSupplierQuote(rfqId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");
      const tenantId = auth.user.tenantId;
      const supplierId = requiredString(formData, "supplierId", "Supplier");

      await prisma.$transaction(async (tx) => {
        const rfq = await tx.rfq.findFirstOrThrow({
          where: { id: rfqId, tenantId },
          include: { items: { orderBy: { id: "asc" } } },
        });

        const existing = await tx.supplierQuotation.findUnique({
          where: { rfqId_supplierId: { rfqId, supplierId } },
        });
        if (existing) throw new Error("Supplier ini sudah punya penawaran pada RFQ ini.");

        const lines = rfq.items
          .map((item) => ({
            rfqItemId: item.id,
            productId: item.productId,
            description: item.description,
            quantity: num(item.quantity),
            unit: item.unit,
            unitPrice: numberField(formData, `price[${item.id}]`),
          }))
          .filter((line) => line.unitPrice > 0);

        if (lines.length === 0) throw new Error("Isi minimal satu harga satuan.");

        const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

        await tx.supplierQuotation.create({
          data: {
            tenantId,
            rfqId,
            supplierId,
            quotedAt: new Date(),
            validUntil: dateField(formData, "validUntil"),
            leadTimeDays: numberField(formData, "leadTimeDays", 7),
            shippingTerms: optionalString(formData, "shippingTerms"),
            notes: optionalString(formData, "notes"),
            status: SupplierQuoteStatus.RECEIVED,
            total,
            items: {
              create: lines.map((line) => ({
                rfqItemId: line.rfqItemId,
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                taxRate: 11,
                leadTimeDays: numberField(formData, "leadTimeDays", 7),
                lineTotal: line.unitPrice * line.quantity,
              })),
            },
          },
        });

        await tx.rfqSupplier.updateMany({
          where: { rfqId, supplierId },
          data: { status: "RESPONDED" },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.RFQ,
          entityId: rfq.id,
          entityLabel: rfq.number,
          summary: `Supplier quotation recorded for ${rfq.number} (${money(total)})`,
        });
      });

      return ok("Penawaran supplier dicatat.");
    },
    [...PATHS, `/procurement/rfq/${rfqId}`],
  );
}

/** Marks the winning quote per item, then raises one PO per winning supplier. */
export async function selectWinnersAndGeneratePo(rfqId: string): Promise<ActionResult> {
  let firstPoId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("procurement", "manage");
    const tenantId = auth.user.tenantId;

    const outcome = await prisma.$transaction(async (tx) => {
      const rfq = await tx.rfq.findFirstOrThrow({
        where: { id: rfqId, tenantId },
        include: {
          items: { include: { quotes: true } },
          order: { select: { id: true, number: true } },
        },
      });

      const winnersBySupplier = new Map<string, { quoteItemId: string; rfqItem: (typeof rfq.items)[number]; unitPrice: number; leadTimeDays: number | null }[]>();

      for (const item of rfq.items) {
        const candidates = item.quotes.filter((quote) => num(quote.unitPrice) > 0);
        if (candidates.length === 0) continue;

        const winner = candidates.reduce((best, quote) => {
          const bestScore = num(best.unitPrice) * Math.max(1, best.leadTimeDays ?? 1);
          const score = num(quote.unitPrice) * Math.max(1, quote.leadTimeDays ?? 1);
          return score < bestScore ? quote : best;
        });

        const supplierId = (
          await tx.supplierQuotation.findUniqueOrThrow({
            where: { id: winner.supplierQuotationId },
            select: { supplierId: true },
          })
        ).supplierId;

        const bucket = winnersBySupplier.get(supplierId) ?? [];
        bucket.push({
          quoteItemId: winner.id,
          rfqItem: item,
          unitPrice: num(winner.unitPrice),
          leadTimeDays: winner.leadTimeDays,
        });
        winnersBySupplier.set(supplierId, bucket);

        await tx.supplierQuotationItem.updateMany({ where: { rfqItemId: item.id }, data: { isWinner: false } });
        await tx.supplierQuotationItem.update({ where: { id: winner.id }, data: { isWinner: true } });
      }

      if (winnersBySupplier.size === 0) throw new Error("Belum ada penawaran supplier yang bisa dipilih.");

      const rule = await approvalRuleFor(tx, tenantId, DocType.PURCHASE_ORDER);
      const poIds: string[] = [];
      const poNumbers: string[] = [];

      for (const [supplierId, winners] of winnersBySupplier) {
        const supplier = await tx.supplier.findFirstOrThrow({
          where: { id: supplierId, tenantId },
          select: { name: true, leadTimeDays: true },
        });

        const subtotal = winners.reduce((sum, winner) => sum + winner.unitPrice * num(winner.rfqItem.quantity), 0);
        const taxTotal = subtotal * 0.11;
        const grandTotal = subtotal + taxTotal;
        const gate = requiresApproval(grandTotal, rule);
        const number = await nextDocumentNumber(tx, tenantId, DocType.PURCHASE_ORDER);

        const po = await tx.purchaseOrder.create({
          data: {
            tenantId,
            number,
            supplierId,
            orderId: rfq.order?.id ?? null,
            rfqId: rfq.id,
            poDate: new Date(),
            expectedDate: new Date(Date.now() + (supplier.leadTimeDays ?? 7) * 86_400_000),
            status: gate ? PoStatus.PENDING_APPROVAL : PoStatus.DRAFT,
            requiresApproval: gate,
            subtotal,
            taxTotal,
            grandTotal,
            createdById: auth.user.id,
            items: {
              create: winners.map((winner, index) => ({
                orderItemId: winner.rfqItem.orderItemId,
                productId: winner.rfqItem.productId,
                description: winner.rfqItem.description,
                quantity: winner.rfqItem.quantity,
                unit: winner.rfqItem.unit,
                unitPrice: winner.unitPrice,
                taxRate: 11,
                lineTotal: winner.unitPrice * num(winner.rfqItem.quantity),
                sortOrder: index,
              })),
            },
          },
        });

        if (gate && rule) {
          await openApproval(tx, {
            tenantId,
            docType: DocType.PURCHASE_ORDER,
            recordId: po.id,
            recordNumber: po.number,
            amount: grandTotal,
            requestedById: auth.user.id,
            approverRole: rule.approverRole,
          });
        }

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.PURCHASE_ORDER,
          entityId: po.id,
          entityLabel: po.number,
          summary: `PO ${po.number} generated from RFQ ${rfq.number} for ${supplier.name}`,
        });

        poIds.push(po.id);
        poNumbers.push(po.number);
      }

      await tx.rfq.update({ where: { id: rfq.id }, data: { status: "CLOSED" } });

      return { poIds, poNumbers };
    });

    firstPoId = outcome.poIds[0] ?? "";
    return ok(`PO dibuat: ${outcome.poNumbers.join(", ")}`);
  }, [...PATHS, `/procurement/rfq/${rfqId}`]);

  if (!result.ok) return result;
  if (firstPoId) redirect(`/procurement/purchase-orders/${firstPoId}`);
  return result;
}

export async function sendPurchaseOrder(poId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");
      const channel = String(formData.get("channel") ?? "WHATSAPP") === "EMAIL" ? "EMAIL" : "WHATSAPP";

      await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: poId, tenantId: auth.user.tenantId },
          include: { supplier: { select: { name: true, email: true, whatsappNumber: true, phone: true } } },
        });

        if (po.requiresApproval && !po.approvedAt) {
          throw new Error("PO ini butuh approval sebelum dikirim ke supplier.");
        }

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PoStatus.SENT, sentAt: new Date() },
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "MANUAL_SEND",
          channel,
          recipient: channel === "WHATSAPP" ? (po.supplier.whatsappNumber ?? po.supplier.phone) : po.supplier.email,
          recipientName: po.supplier.name,
          subject: `Purchase order ${po.number}`,
          body: `PO ${po.number} senilai ${money(po.grandTotal)}. Mohon konfirmasi ketersediaan dan tanggal kirim.`,
          entityType: "PURCHASE_ORDER",
          entityId: po.id,
          entityLabel: po.number,
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "SEND",
          entityType: AttachmentEntity.PURCHASE_ORDER,
          entityId: po.id,
          entityLabel: po.number,
          summary: `PO ${po.number} sent to ${po.supplier.name} via ${channel}`,
          changes: { status: { from: po.status, to: PoStatus.SENT } },
        });
      });

      return ok("PO terkirim ke supplier.");
    },
    [...PATHS, `/procurement/purchase-orders/${poId}`],
  );
}

export async function confirmPurchaseOrder(poId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");

      await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: poId, tenantId: auth.user.tenantId },
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PoStatus.CONFIRMED, confirmedAt: new Date() },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.PURCHASE_ORDER,
          entityId: po.id,
          entityLabel: po.number,
          summary: `PO ${po.number} confirmed by supplier`,
          changes: { status: { from: po.status, to: PoStatus.CONFIRMED } },
        });
      });

      return ok("PO dikonfirmasi supplier.");
    },
    [...PATHS, `/procurement/purchase-orders/${poId}`],
  );
}

export async function approvePurchaseOrder(poId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");
      if (!canApprove(auth.user.role)) return fail("Hanya Manager atau Owner yang bisa approve PO.");

      await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: poId, tenantId: auth.user.tenantId } });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { approvedAt: new Date(), approvedById: auth.user.id, status: PoStatus.DRAFT },
        });

        await decideApproval(tx, {
          tenantId: auth.user.tenantId,
          docType: DocType.PURCHASE_ORDER,
          recordId: po.id,
          decidedById: auth.user.id,
          status: ApprovalStatus.APPROVED,
          note: optionalString(formData, "note"),
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "APPROVE",
          entityType: AttachmentEntity.PURCHASE_ORDER,
          entityId: po.id,
          entityLabel: po.number,
          summary: `PO ${po.number} approved`,
        });
      });

      return ok("PO approved.");
    },
    [...PATHS, `/procurement/purchase-orders/${poId}`],
  );
}

/** Books received quantities and, when inventory is on, increases stock balances. */
export async function receiveGoods(poId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");
      const tenantId = auth.user.tenantId;

      const receiptNumber = await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: poId, tenantId },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        const received = po.items
          .map((item) => ({
            item,
            quantity: numberField(formData, `received[${item.id}]`),
            rejected: numberField(formData, `rejected[${item.id}]`),
          }))
          .filter((line) => line.quantity > 0 || line.rejected > 0);

        if (received.length === 0) throw new Error("Isi jumlah barang yang diterima.");

        const warehouseId = await resolveWarehouse(tx, tenantId, optionalString(formData, "warehouseId"));
        const number = await nextDocumentNumber(tx, tenantId, DocType.GOODS_RECEIPT);

        await tx.goodsReceipt.create({
          data: {
            tenantId,
            number,
            purchaseOrderId: po.id,
            receivedDate: dateField(formData, "receivedDate", new Date()) ?? new Date(),
            warehouseId,
            notes: optionalString(formData, "notes"),
            createdById: auth.user.id,
            items: {
              create: received.map((line) => ({
                purchaseOrderItemId: line.item.id,
                productId: line.item.productId,
                quantityReceived: line.quantity,
                quantityRejected: line.rejected,
                note: optionalString(formData, `note[${line.item.id}]`),
              })),
            },
          },
        });

        for (const line of received) {
          await tx.purchaseOrderItem.update({
            where: { id: line.item.id },
            data: { receivedQty: { increment: line.quantity } },
          });
        }

        const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
        const fullyReceived = refreshed.every((item) => num(item.receivedQty) >= num(item.quantity));
        const anyReceived = refreshed.some((item) => num(item.receivedQty) > 0);

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: fullyReceived ? PoStatus.RECEIVED : anyReceived ? PoStatus.PARTIAL_RECEIVED : po.status },
        });

        if (await inventoryEnabled(tx, tenantId)) {
          for (const line of received) {
            if (!line.item.productId || !warehouseId) continue;
            await recordStockIn(tx, {
              tenantId,
              productId: line.item.productId,
              warehouseId,
              quantity: line.quantity,
              referenceType: "GOODS_RECEIPT",
              referenceId: number,
              note: `Penerimaan ${po.number}`,
              createdById: auth.user.id,
            });
          }
        }

        // Order lines become "sourced" once their PO delivers everything.
        const orderItemIds = refreshed.map((item) => item.orderItemId).filter(Boolean) as string[];
        for (const orderItemId of orderItemIds) {
          const relatedItems = await tx.purchaseOrderItem.findMany({ where: { orderItemId } });
          const allReceived = relatedItems.every((item) => num(item.receivedQty) >= num(item.quantity));
          await tx.orderItem.update({
            where: { id: orderItemId },
            data: { sourcingStatus: allReceived ? SourcingStatus.SOURCED : SourcingStatus.SOURCING },
          });
        }

        if (po.orderId && fullyReceived) {
          const orderItems = await tx.orderItem.findMany({ where: { orderId: po.orderId } });
          const everythingSourced = orderItems.every((item) => item.sourcingStatus === SourcingStatus.SOURCED);
          if (everythingSourced) {
            const order = await tx.order.findUnique({ where: { id: po.orderId } });
            if (order && order.status === OrderStatus.CONFIRMED) {
              await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.IN_PROGRESS } });
            }
          }
        }

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.GOODS_RECEIPT,
          entityId: po.id,
          entityLabel: number,
          summary: `Goods receipt ${number} booked against ${po.number}`,
        });

        return { number, fullyReceived };
      });

      return ok(
        receiptNumber.fullyReceived
          ? `Penerimaan ${receiptNumber.number} selesai — PO fully received.`
          : `Penerimaan sebagian ${receiptNumber.number} tercatat.`,
      );
    },
    [...PATHS, `/procurement/purchase-orders/${poId}`, "/inventory"],
  );
}

export async function cancelPurchaseOrder(poId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("procurement", "manage");
      const reason = requiredString(formData, "reason", "Alasan pembatalan");

      await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: poId, tenantId: auth.user.tenantId } });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PoStatus.CANCELLED, cancelledReason: reason },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.PURCHASE_ORDER,
          entityId: po.id,
          entityLabel: po.number,
          summary: `PO ${po.number} cancelled — ${reason}`,
          changes: { status: { from: po.status, to: PoStatus.CANCELLED } },
        });
      });

      return ok("PO dibatalkan.");
    },
    [...PATHS, `/procurement/purchase-orders/${poId}`],
  );
}

export async function setReceiptStatus(receiptId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requirePermission("procurement", "manage");
    const status = String(formData.get("status") ?? "");
    if (status !== ReceiptStatus.PARTIAL && status !== ReceiptStatus.FULL) return fail("Status penerimaan tidak dikenal.");

    await prisma.goodsReceipt.updateMany({
      where: { id: receiptId, tenantId: auth.user.tenantId },
      data: { status },
    });

    return ok("Status penerimaan diperbarui.");
  }, PATHS);
}
