"use server";

import { redirect } from "next/navigation";

import {
  AttachmentEntity,
  DocType,
  LineType,
  OrderStatus,
  PoStatus,
  ProductionStatus,
  SourcingStatus,
  StageStatus,
  WorkOrderStatus,
} from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { approvalRuleFor, openApproval, requiresApproval } from "@/lib/approvals";
import { requirePermission } from "@/lib/auth";
import { inventoryEnabled, reserveStockForOrder, resolveWarehouse } from "@/lib/inventory";
import { num } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import {
  booleanField,
  dateField,
  fail,
  numberField,
  ok,
  optionalString,
  requiredString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const ACTIVE_PO_STATUSES = [PoStatus.DRAFT, PoStatus.PENDING_APPROVAL, PoStatus.SENT, PoStatus.CONFIRMED, PoStatus.PARTIAL_RECEIVED];

export async function updateOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("orders", "manage");

      await prisma.$transaction(async (tx) => {
        const before = await tx.order.findFirstOrThrow({ where: { id: orderId, tenantId: auth.user.tenantId } });

        const payload = {
          customerPoNumber: optionalString(formData, "customerPoNumber"),
          customerPoDate: dateField(formData, "customerPoDate", before.customerPoDate),
          expectedDeliveryDate: dateField(formData, "expectedDeliveryDate", before.expectedDeliveryDate),
          estimatedFulfillmentDate: dateField(formData, "estimatedFulfillmentDate", before.estimatedFulfillmentDate),
          notes: optionalString(formData, "notes"),
        };

        const updated = await tx.order.update({ where: { id: before.id }, data: payload });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.ORDER,
          entityId: updated.id,
          entityLabel: updated.number,
          summary: `Order ${updated.number} updated`,
          changes: {
            customerPoNumber: { from: before.customerPoNumber, to: updated.customerPoNumber },
            estimatedFulfillmentDate: { from: before.estimatedFulfillmentDate, to: updated.estimatedFulfillmentDate },
          },
        });
      });

      return ok("Order updated.");
    },
    ["/orders", "/dashboard", `/orders/${orderId}`],
  );
}

export async function setOrderStatus(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("orders", "manage");
      const status = String(formData.get("status") ?? "");
      if (!Object.values(OrderStatus).includes(status as OrderStatus)) return fail("Status tidak dikenal.");

      await prisma.$transaction(async (tx) => {
        const before = await tx.order.findFirstOrThrow({ where: { id: orderId, tenantId: auth.user.tenantId } });

        const updated = await tx.order.update({
          where: { id: before.id },
          data: {
            status: status as OrderStatus,
            confirmedAt: status === OrderStatus.CONFIRMED ? new Date() : before.confirmedAt,
            completedAt: status === OrderStatus.COMPLETED ? new Date() : before.completedAt,
          },
        });

        if (status === OrderStatus.CONFIRMED && before.status === OrderStatus.DRAFT) {
          if (await inventoryEnabled(tx, auth.user.tenantId)) {
            const warehouseId = await resolveWarehouse(tx, auth.user.tenantId);
            const items = await tx.orderItem.findMany({ where: { orderId: before.id } });
            await reserveStockForOrder(tx, { tenantId: auth.user.tenantId, warehouseId, items });
          }
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.ORDER,
          entityId: updated.id,
          entityLabel: updated.number,
          summary: `Order ${updated.number} status → ${status}`,
          changes: { status: { from: before.status, to: status } },
        });
      });

      return ok("Order status updated.");
    },
    ["/orders", "/dashboard", `/orders/${orderId}`, "/fulfillment"],
  );
}

/**
 * Cancelling warns about live POs and work orders first. The caller must tick
 * "cascade" to cancel them too — otherwise the order stays open.
 */
export async function cancelOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("orders", "manage");
      const reason = requiredString(formData, "reason", "Alasan pembatalan");
      const cascade = booleanField(formData, "cascade");

      const active = await prisma.purchaseOrder.findMany({
        where: { tenantId: auth.user.tenantId, orderId, status: { in: ACTIVE_PO_STATUSES } },
        select: { number: true, status: true },
      });
      const activeWorkOrders = await prisma.workOrder.findMany({
        where: { tenantId: auth.user.tenantId, orderId, status: { in: [WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS] } },
        select: { number: true, status: true },
      });

      if (!cascade && (active.length > 0 || activeWorkOrders.length > 0)) {
        const parts = [
          ...active.map((po) => `${po.number} (${po.status})`),
          ...activeWorkOrders.map((wo) => `${wo.number} (${wo.status})`),
        ];
        return fail(
          `Masih ada dokumen aktif terkait: ${parts.join(", ")}. Centang "cascade cancel" untuk membatalkan semuanya sekaligus.`,
        );
      }

      await prisma.$transaction(async (tx) => {
        const before = await tx.order.findFirstOrThrow({ where: { id: orderId, tenantId: auth.user.tenantId } });

        await tx.order.update({
          where: { id: before.id },
          data: { status: OrderStatus.CANCELLED, cancelReason: reason, cancelledAt: new Date() },
        });

        if (cascade) {
          await tx.purchaseOrder.updateMany({
            where: { tenantId: auth.user.tenantId, orderId, status: { in: ACTIVE_PO_STATUSES } },
            data: { status: PoStatus.CANCELLED, cancelledReason: `Order ${before.number} dibatalkan: ${reason}` },
          });
          await tx.workOrder.updateMany({
            where: { tenantId: auth.user.tenantId, orderId, status: { in: [WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS] } },
            data: { status: WorkOrderStatus.CANCELLED },
          });
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.ORDER,
          entityId: before.id,
          entityLabel: before.number,
          summary: `Order ${before.number} cancelled — ${reason}${cascade ? " (cascade)" : ""}`,
          changes: { status: { from: before.status, to: OrderStatus.CANCELLED } },
        });
      });

      return ok("Order dibatalkan.");
    },
    ["/orders", "/dashboard", `/orders/${orderId}`],
  );
}

/** Groups unsourced order lines per supplier and raises one PO per supplier. */
export async function generatePurchaseOrders(orderId: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const auth = await requirePermission("orders", "manage");
    const tenantId = auth.user.tenantId;

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: {
          items: {
            where: {
              sourcingStatus: { in: [SourcingStatus.NOT_SOURCED, SourcingStatus.SOURCING] },
              lineType: { in: [LineType.PRODUCT, LineType.PACKAGE] },
            },
            include: { product: { select: { id: true, name: true, defaultSupplierId: true } } },
          },
        },
      });

      const bySupplier = new Map<string, typeof order.items>();
      const missing: string[] = [];

      for (const item of order.items) {
        const supplierId = item.product?.defaultSupplierId;
        if (!supplierId) {
          missing.push(item.description);
          continue;
        }
        const bucket = bySupplier.get(supplierId) ?? [];
        bucket.push(item);
        bySupplier.set(supplierId, bucket);
      }

      if (bySupplier.size === 0) {
        throw new Error(
          missing.length > 0
            ? `Tidak ada item dengan supplier default. Set supplier default untuk: ${missing.join(", ")}`
            : "Semua item order sudah tersourcing.",
        );
      }

      const rule = await approvalRuleFor(tx, tenantId, DocType.PURCHASE_ORDER);
      const results: string[] = [];

      for (const [supplierId, items] of bySupplier) {
        const supplier = await tx.supplier.findFirstOrThrow({
          where: { id: supplierId, tenantId },
          select: { name: true, leadTimeDays: true },
        });

        const subtotal = items.reduce((total, item) => total + num(item.costPrice) * num(item.quantity), 0);
        const taxTotal = items.reduce(
          (total, item) => total + num(item.costPrice) * num(item.quantity) * (num(item.taxRate) / 100),
          0,
        );
        const grandTotal = subtotal + taxTotal;
        const gate = requiresApproval(grandTotal, rule);
        const number = await nextDocumentNumber(tx, tenantId, DocType.PURCHASE_ORDER);

        const po = await tx.purchaseOrder.create({
          data: {
            tenantId,
            number,
            supplierId,
            orderId: order.id,
            poDate: new Date(),
            expectedDate: new Date(Date.now() + (supplier.leadTimeDays ?? 7) * 86_400_000),
            status: gate ? PoStatus.PENDING_APPROVAL : PoStatus.DRAFT,
            requiresApproval: gate,
            subtotal,
            taxTotal,
            grandTotal,
            createdById: auth.user.id,
            items: {
              create: items.map((item, index) => ({
                orderItemId: item.id,
                productId: item.productId,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.costPrice,
                taxRate: item.taxRate,
                lineTotal: num(item.costPrice) * num(item.quantity),
                sortOrder: index,
              })),
            },
          },
        });

        await tx.orderItem.updateMany({
          where: { id: { in: items.map((item) => item.id) } },
          data: { sourcingStatus: SourcingStatus.SOURCING },
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
          summary: `PO ${po.number} generated for ${supplier.name} from order ${order.number}`,
        });

        results.push(po.number);
      }

      if (missing.length > 0) {
        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.ORDER,
          entityId: order.id,
          entityLabel: order.number,
          summary: `Items without default supplier skipped: ${missing.join(", ")}`,
        });
      }

      return { numbers: results, skipped: missing };
    });

    return ok(
      `PO dibuat: ${created.numbers.join(", ")}${created.skipped.length > 0 ? `. Dilewati (tanpa supplier default): ${created.skipped.join(", ")}` : ""}`,
    );
  }, ["/orders", `/orders/${orderId}`, "/procurement", "/procurement/purchase-orders"]);

  if (!result.ok) return result;
  redirect(`/orders/${orderId}?tab=procurement`);
}

/** Work order for service/labor lines on the order. */
export async function generateWorkOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");
      const tenantId = auth.user.tenantId;

      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirstOrThrow({
          where: { id: orderId, tenantId },
          include: { items: true },
        });

        const serviceItems = order.items.filter(
          (item) => item.lineType === LineType.SERVICE || item.lineType === LineType.LABOR,
        );

        const number = await nextDocumentNumber(tx, tenantId, DocType.WORK_ORDER);
        const workOrder = await tx.workOrder.create({
          data: {
            tenantId,
            number,
            orderId: order.id,
            title: optionalString(formData, "title") ?? `Fulfillment jasa untuk ${order.number}`,
            description:
              optionalString(formData, "description") ??
              serviceItems.map((item) => item.description).join(", ") ??
              null,
            assigneeId: optionalString(formData, "assigneeId"),
            teamName: optionalString(formData, "teamName"),
            scheduledStart: dateField(formData, "scheduledStart"),
            scheduledEnd: dateField(formData, "scheduledEnd"),
            status: WorkOrderStatus.SCHEDULED,
            createdById: auth.user.id,
            tasks: {
              create: serviceItems.map((item, index) => ({ name: item.description, sortOrder: index })),
            },
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.WORK_ORDER,
          entityId: workOrder.id,
          entityLabel: workOrder.number,
          summary: `Work order ${workOrder.number} created for order ${order.number}`,
        });
      });

      return ok("Work order dibuat.");
    },
    ["/orders", `/orders/${orderId}`, "/fulfillment"],
  );
}

export async function createProductionOrder(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");
      const tenantId = auth.user.tenantId;

      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirstOrThrow({ where: { id: orderId, tenantId } });
        const stages = await tx.workflowStage.findMany({
          where: { tenantId, scope: "PRODUCTION", isActive: true },
          orderBy: { sortOrder: "asc" },
        });

        const number = await nextDocumentNumber(tx, tenantId, DocType.PRODUCTION_ORDER);
        const production = await tx.productionOrder.create({
          data: {
            tenantId,
            number,
            orderId: order.id,
            productId: optionalString(formData, "productId"),
            description: requiredString(formData, "description", "Deskripsi produksi"),
            quantity: numberField(formData, "quantity", 1),
            unit: String(formData.get("unit") ?? "pcs"),
            status: ProductionStatus.DRAFT,
            scheduledStart: dateField(formData, "scheduledStart"),
            scheduledEnd: dateField(formData, "scheduledEnd"),
            createdById: auth.user.id,
            stages: {
              create: (stages.length > 0 ? stages : [{ name: "Produksi", sortOrder: 0 }]).map((stage) => ({
                name: stage.name,
                sortOrder: "sortOrder" in stage ? stage.sortOrder : 0,
                status: StageStatus.PENDING,
              })),
            },
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.PRODUCTION_ORDER,
          entityId: production.id,
          entityLabel: production.number,
          summary: `Production order ${production.number} created for order ${order.number}`,
        });
      });

      return ok("Production order dibuat.");
    },
    ["/orders", `/orders/${orderId}`, "/fulfillment"],
  );
}

export async function createSubcontract(orderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");
      const tenantId = auth.user.tenantId;

      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirstOrThrow({ where: { id: orderId, tenantId } });
        const number = await nextDocumentNumber(tx, tenantId, DocType.SUBCONTRACT);

        const subcontract = await tx.subcontract.create({
          data: {
            tenantId,
            number,
            orderId: order.id,
            supplierId: requiredString(formData, "supplierId", "Subcontractor"),
            scope: requiredString(formData, "scope", "Scope pekerjaan"),
            description: optionalString(formData, "description"),
            value: numberField(formData, "value"),
            scheduledStart: dateField(formData, "scheduledStart"),
            scheduledEnd: dateField(formData, "scheduledEnd"),
            createdById: auth.user.id,
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.SUBCONTRACT,
          entityId: subcontract.id,
          entityLabel: subcontract.number,
          summary: `Subcontract ${subcontract.number} created for order ${order.number}`,
        });
      });

      return ok("Subcontract dibuat.");
    },
    ["/orders", `/orders/${orderId}`, "/fulfillment"],
  );
}
