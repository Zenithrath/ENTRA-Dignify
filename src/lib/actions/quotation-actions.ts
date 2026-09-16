"use server";

import { redirect } from "next/navigation";

import {
  ApprovalStatus,
  AttachmentEntity,
  DocType,
  LineType,
  OrderStatus,
  QuotationStatus,
  RequestStatus,
  Role,
  SourcingStatus,
} from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { approvalRuleFor, decideApproval, openApproval, requiresApproval } from "@/lib/approvals";
import { requirePermission } from "@/lib/auth";
import { canApprove } from "@/lib/rbac";
import { inventoryEnabled, reserveStockForOrder, resolveWarehouse } from "@/lib/inventory";
import { money, num } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { queueNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { priceLine, summarizeDocument } from "@/lib/pricing";
import {
  dateField,
  fail,
  numberField,
  ok,
  optionalString,
  parseLineItems,
  requiredString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/quotations", "/dashboard"];

export function buildQuotationLines(formData: FormData) {
  const rows = parseLineItems(formData);

  const items = rows.map((row, index) => {
    const priced = priceLine({
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountPercent: row.discountPercent,
      taxRate: row.taxRate,
      costPrice: row.costPrice,
    });
    return {
      productId: row.productId,
      lineType: Object.values(LineType).includes(row.lineType as LineType)
        ? (row.lineType as LineType)
        : LineType.PRODUCT,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      costPrice: row.costPrice,
      sellingPrice: row.unitPrice,
      discountPercent: row.discountPercent,
      taxRate: row.taxRate,
      lineTotal: priced.net,
      lineCost: priced.cost,
      marginPercent: priced.marginPercent,
      supplierId: row.supplierId,
      supplierLeadTimeDays: row.supplierLeadTimeDays,
      sortOrder: index,
    };
  });

  const summary = summarizeDocument(
    rows.map((row) => ({
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountPercent: row.discountPercent,
      taxRate: row.taxRate,
      costPrice: row.costPrice,
    })),
    { shippingCost: numberField(formData, "shippingCost") },
  );

  return { items, summary, rowCount: rows.length };
}

/** Creates a new quotation or replaces the lines of an existing draft. */
export async function saveQuotation(formData: FormData): Promise<ActionResult> {
  let savedId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("quotations", "manage");
    const tenantId = auth.user.tenantId;
    const quotationId = optionalString(formData, "quotationId");
    const { items, summary, rowCount } = buildQuotationLines(formData);

    if (rowCount === 0) return fail("Tambahkan minimal satu item penawaran.");

    const customerId = requiredString(formData, "customerId", "Customer");

    const quotation = await prisma.$transaction(async (tx) => {
      const rule = await approvalRuleFor(tx, tenantId, DocType.QUOTATION);
      const gate = requiresApproval(summary.grandTotal, rule);

      const header = {
        customerId,
        quotationDate: dateField(formData, "quotationDate", new Date()) ?? new Date(),
        validUntil: dateField(formData, "validUntil"),
        currency: "IDR",
        paymentTerms: optionalString(formData, "paymentTerms"),
        deliveryTerms: optionalString(formData, "deliveryTerms"),
        notes: optionalString(formData, "notes"),
        termsAndConditions: optionalString(formData, "termsAndConditions"),
        subtotal: summary.subtotal,
        discountTotal: summary.discountTotal,
        taxTotal: summary.taxTotal,
        shippingCost: summary.shippingCost,
        grandTotal: summary.grandTotal,
        costTotal: summary.costTotal,
        estimatedProfit: summary.estimatedProfit,
        marginPercent: summary.marginPercent,
      };

      if (quotationId) {
        const before = await tx.quotation.findFirstOrThrow({ where: { id: quotationId, tenantId } });
        if (before.status === QuotationStatus.APPROVED) {
          throw new Error("Quotation sudah approved. Buat revisi baru agar versi lama tetap tersimpan.");
        }

        await tx.quotationItem.deleteMany({ where: { quotationId: before.id } });
        const updated = await tx.quotation.update({
          where: { id: before.id },
          data: {
            ...header,
            requiresApproval: before.requiresApproval || gate,
            status:
              before.status === QuotationStatus.WAITING_APPROVAL || before.requiresApproval
                ? before.status
                : gate
                  ? QuotationStatus.WAITING_APPROVAL
                  : before.status,
            items: { create: items },
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.QUOTATION,
          entityId: updated.id,
          entityLabel: `${updated.number} v${updated.version}`,
          summary: `Quotation ${updated.number} v${updated.version} updated`,
          changes: {
            grandTotal: { from: num(before.grandTotal), to: summary.grandTotal },
            marginPercent: { from: num(before.marginPercent), to: summary.marginPercent },
          },
        });

        if (gate && !before.requiresApproval && rule) {
          await openApproval(tx, {
            tenantId,
            docType: DocType.QUOTATION,
            recordId: updated.id,
            recordNumber: updated.number,
            amount: summary.grandTotal,
            requestedById: auth.user.id,
            approverRole: rule.approverRole,
          });
          await queueNotification({
            tenantId,
            event: "QUOTATION_APPROVAL_REQUESTED",
            channel: "IN_APP",
            recipient: null,
            recipientName: rule.approverRole,
            subject: `Quotation ${updated.number} menunggu approval`,
            body: `Nilai ${money(summary.grandTotal)} di atas threshold ${money(rule.thresholdAmount)}.`,
            entityType: "QUOTATION",
            entityId: updated.id,
            entityLabel: updated.number,
          });
        }

        return updated;
      }

      const number = await nextDocumentNumber(tx, tenantId, DocType.QUOTATION);
      const created = await tx.quotation.create({
        data: {
          tenantId,
          number,
          version: 1,
          ...header,
          requestId: optionalString(formData, "requestId"),
          requiresApproval: gate,
          status: gate ? QuotationStatus.WAITING_APPROVAL : QuotationStatus.DRAFT,
          createdById: auth.user.id,
          items: { create: items },
        },
      });

      if (created.requestId) {
        await tx.request.update({
          where: { id: created.requestId },
          data: { status: RequestStatus.PREPARING_QUOTATION },
        });
      }

      await logActivity(tx, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.QUOTATION,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Quotation ${created.number} created (${money(summary.grandTotal)})`,
      });

      if (gate && rule) {
        await openApproval(tx, {
          tenantId,
          docType: DocType.QUOTATION,
          recordId: created.id,
          recordNumber: created.number,
          amount: summary.grandTotal,
          requestedById: auth.user.id,
          approverRole: rule.approverRole,
        });

        await queueNotification({
          tenantId,
          event: "QUOTATION_APPROVAL_REQUESTED",
          channel: "IN_APP",
          recipient: null,
          recipientName: rule.approverRole,
          subject: `Quotation ${created.number} menunggu approval`,
          body: `Nilai ${money(summary.grandTotal)} di atas threshold ${money(rule.thresholdAmount)}.`,
          entityType: "QUOTATION",
          entityId: created.id,
          entityLabel: created.number,
        });
      }

      return created;
    });

    savedId = quotation.id;
    return ok("Quotation saved.", quotation.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/quotations/${savedId}`);
}

export async function sendQuotation(quotationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("quotations", "manage");
      const channel = String(formData.get("channel") ?? "WHATSAPP") === "EMAIL" ? "EMAIL" : "WHATSAPP";

      await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findFirstOrThrow({
          where: { id: quotationId, tenantId: auth.user.tenantId },
          include: { customer: { select: { companyName: true, email: true, whatsappNumber: true, phone: true } } },
        });

        if (quotation.requiresApproval && quotation.status !== QuotationStatus.APPROVED) {
          throw new Error("Quotation ini butuh approval Manager/Owner sebelum dikirim ke customer.");
        }
        if (quotation.status === QuotationStatus.APPROVED) {
          throw new Error("Quotation sudah approved dan siap di-convert ke order.");
        }

        await tx.quotation.update({
          where: { id: quotation.id },
          data: { status: QuotationStatus.SENT, sentAt: new Date() },
        });

        if (quotation.requestId) {
          await tx.request.update({ where: { id: quotation.requestId }, data: { status: RequestStatus.QUOTATION_SENT } });
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "SEND",
          entityType: AttachmentEntity.QUOTATION,
          entityId: quotation.id,
          entityLabel: quotation.number,
          summary: `Quotation ${quotation.number} sent via ${channel}`,
          changes: { status: { from: quotation.status, to: QuotationStatus.SENT } },
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "MANUAL_SEND",
          channel,
          recipient:
            channel === "WHATSAPP"
              ? (quotation.customer.whatsappNumber ?? quotation.customer.phone)
              : quotation.customer.email,
          recipientName: quotation.customer.companyName,
          subject: `Quotation ${quotation.number}`,
          body: `Penawaran ${quotation.number} untuk ${quotation.customer.companyName} senilai ${money(quotation.grandTotal)}. Dokumen: /print/quotations/${quotation.id}`,
          entityType: "QUOTATION",
          entityId: quotation.id,
          entityLabel: quotation.number,
        });
      });

      return ok("Quotation terkirim.");
    },
    [...PATHS, `/quotations/${quotationId}`],
  );
}

export async function markQuotationResponded(quotationId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("quotations", "manage");

      await prisma.quotation.updateMany({
        where: { id: quotationId, tenantId: auth.user.tenantId, status: QuotationStatus.SENT },
        data: { status: QuotationStatus.WAITING_RESPONSE },
      });

      return ok("Ditandai menunggu respons.");
    },
    [...PATHS, `/quotations/${quotationId}`],
  );
}

export async function approveQuotation(quotationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("quotations", "manage");
      if (!canApprove(auth.user.role)) return fail("Hanya Manager atau Owner yang bisa approve.");

      await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findFirstOrThrow({
          where: { id: quotationId, tenantId: auth.user.tenantId },
        });

        await tx.quotation.update({
          where: { id: quotation.id },
          data: { status: QuotationStatus.APPROVED, approvedAt: new Date(), approvedById: auth.user.id, respondedAt: new Date() },
        });

        await decideApproval(tx, {
          tenantId: auth.user.tenantId,
          docType: DocType.QUOTATION,
          recordId: quotation.id,
          decidedById: auth.user.id,
          status: ApprovalStatus.APPROVED,
          note: optionalString(formData, "note"),
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "APPROVE",
          entityType: AttachmentEntity.QUOTATION,
          entityId: quotation.id,
          entityLabel: quotation.number,
          summary: `Quotation ${quotation.number} approved`,
          changes: { status: { from: quotation.status, to: QuotationStatus.APPROVED } },
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "QUOTATION_APPROVED",
          channel: "IN_APP",
          recipient: null,
          subject: `Quotation ${quotation.number} approved`,
          body: `Disetujui oleh ${auth.user.name}. Siap dikonversi ke order setelah PO customer diterima.`,
          entityType: "QUOTATION",
          entityId: quotation.id,
          entityLabel: quotation.number,
        });
      });

      return ok("Quotation approved.");
    },
    [...PATHS, `/quotations/${quotationId}`],
  );
}

export async function rejectQuotation(quotationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("quotations", "manage");
      if (!canApprove(auth.user.role)) return fail("Hanya Manager atau Owner yang bisa menolak.");
      const reason = optionalString(formData, "reason");

      await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findFirstOrThrow({
          where: { id: quotationId, tenantId: auth.user.tenantId },
        });

        await tx.quotation.update({
          where: { id: quotation.id },
          data: {
            status:
              quotation.status === QuotationStatus.WAITING_APPROVAL
                ? QuotationStatus.DRAFT
                : QuotationStatus.REJECTED,
            rejectionReason: reason,
            respondedAt: new Date(),
          },
        });

        await decideApproval(tx, {
          tenantId: auth.user.tenantId,
          docType: DocType.QUOTATION,
          recordId: quotation.id,
          decidedById: auth.user.id,
          status: ApprovalStatus.REJECTED,
          note: reason,
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "REJECT",
          entityType: AttachmentEntity.QUOTATION,
          entityId: quotation.id,
          entityLabel: quotation.number,
          summary: `Quotation ${quotation.number} rejected${reason ? `: ${reason}` : ""}`,
        });
      });

      return ok("Quotation rejected.");
    },
    [...PATHS, `/quotations/${quotationId}`],
  );
}

/** Creates a new version and keeps the previous one as immutable history. */
export async function reviseQuotation(quotationId: string): Promise<ActionResult> {
  let newId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("quotations", "manage");

    const revised = await prisma.$transaction(async (tx) => {
      const source = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId, tenantId: auth.user.tenantId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      const latest = await tx.quotation.findFirst({
        where: { tenantId: auth.user.tenantId, number: source.number },
        orderBy: { version: "desc" },
      });

      const created = await tx.quotation.create({
        data: {
          tenantId: auth.user.tenantId,
          number: source.number,
          version: (latest?.version ?? source.version) + 1,
          customerId: source.customerId,
          requestId: source.requestId,
          supersedesId: source.id,
          quotationDate: new Date(),
          validUntil: new Date(Date.now() + 14 * 86_400_000),
          currency: source.currency,
          paymentTerms: source.paymentTerms,
          deliveryTerms: source.deliveryTerms,
          notes: source.notes,
          termsAndConditions: source.termsAndConditions,
          status: QuotationStatus.DRAFT,
          subtotal: source.subtotal,
          discountTotal: source.discountTotal,
          taxTotal: source.taxTotal,
          shippingCost: source.shippingCost,
          grandTotal: source.grandTotal,
          costTotal: source.costTotal,
          estimatedProfit: source.estimatedProfit,
          marginPercent: source.marginPercent,
          requiresApproval: source.requiresApproval,
          createdById: auth.user.id,
          items: {
            create: source.items.map((item) => ({
              productId: item.productId,
              lineType: item.lineType,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              discountPercent: item.discountPercent,
              taxRate: item.taxRate,
              lineTotal: item.lineTotal,
              lineCost: item.lineCost,
              marginPercent: item.marginPercent,
              supplierId: item.supplierId,
              supplierLeadTimeDays: item.supplierLeadTimeDays,
              note: item.note,
              sortOrder: item.sortOrder,
            })),
          },
        },
      });

      await logActivity(tx, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CONVERT",
        entityType: AttachmentEntity.QUOTATION,
        entityId: created.id,
        entityLabel: `${created.number} v${created.version}`,
        summary: `Quotation ${source.number} revised to v${created.version}`,
      });

      return created;
    });

    newId = revised.id;
    return ok(`Revisi v${revised.version} dibuat.`, revised.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/quotations/${newId}`);
}

/** One-click conversion: items, totals and sourcing status all carry over. */
export async function convertQuotationToOrder(quotationId: string, formData: FormData): Promise<ActionResult> {
  let orderId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("orders", "manage");
    const tenantId = auth.user.tenantId;

    const order = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId, tenantId },
        include: { items: { orderBy: { sortOrder: "asc" } }, order: true },
      });

      if (quotation.order) return quotation.order;
      if (quotation.status !== QuotationStatus.APPROVED) {
        throw new Error("Hanya quotation berstatus Approved yang bisa dikonversi ke order.");
      }

      const customerPoNumber = requiredString(formData, "customerPoNumber", "Nomor PO customer");
      const number = await nextDocumentNumber(tx, tenantId, DocType.SALES_ORDER);

      const created = await tx.order.create({
        data: {
          tenantId,
          number,
          customerId: quotation.customerId,
          quotationId: quotation.id,
          orderDate: new Date(),
          customerPoNumber,
          customerPoDate: dateField(formData, "customerPoDate", new Date()) ?? new Date(),
          expectedDeliveryDate: dateField(formData, "expectedDeliveryDate"),
          estimatedFulfillmentDate:
            dateField(formData, "estimatedFulfillmentDate", new Date(Date.now() + 14 * 86_400_000)) ?? undefined,
          status: OrderStatus.CONFIRMED,
          confirmedAt: new Date(),
          subtotal: quotation.subtotal,
          discountTotal: quotation.discountTotal,
          taxTotal: quotation.taxTotal,
          shippingCost: quotation.shippingCost,
          grandTotal: quotation.grandTotal,
          notes: optionalString(formData, "notes"),
          createdById: auth.user.id,
          items: {
            create: quotation.items.map((item, index) => ({
              productId: item.productId,
              lineType: item.lineType,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              sellingPrice: item.sellingPrice,
              costPrice: item.costPrice,
              discountPercent: item.discountPercent,
              taxRate: item.taxRate,
              lineTotal: item.lineTotal,
              sourcingStatus: item.lineType === LineType.SERVICE || item.lineType === LineType.LABOR
                ? SourcingStatus.SOURCED
                : SourcingStatus.NOT_SOURCED,
              sortOrder: index,
            })),
          },
        },
        include: { items: true },
      });

      if (quotation.requestId) {
        await tx.request.update({
          where: { id: quotation.requestId },
          data: { status: RequestStatus.CLOSED_WON, closedAt: new Date() },
        });
      }

      if (await inventoryEnabled(tx, tenantId)) {
        const warehouseId = await resolveWarehouse(tx, tenantId);
        await reserveStockForOrder(tx, { tenantId, warehouseId, items: created.items });
      }

      await logActivity(tx, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CONVERT",
        entityType: AttachmentEntity.ORDER,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Order ${created.number} created from quotation ${quotation.number}`,
      });

      await queueNotification({
        tenantId,
        event: "MANUAL_SEND",
        channel: "IN_APP",
        recipient: null,
        recipientName: "Procurement",
        subject: `Order ${created.number} siap disourcing`,
        body: `Order ${created.number} dari ${quotation.number} butuh pengadaan untuk item yang belum tersedia.`,
        entityType: "ORDER",
        entityId: created.id,
        entityLabel: created.number,
      });

      return created;
    });

    orderId = order.id;
    return ok("Order dibuat dari quotation.", order.id);
  }, [...PATHS, "/orders", `/quotations/${quotationId}`]);

  if (!result.ok) return result;
  redirect(`/orders/${orderId}`);
}

export async function setQuotationStatus(quotationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("quotations", "manage");
      const status = String(formData.get("status") ?? "");
      if (!Object.values(QuotationStatus).includes(status as QuotationStatus)) return fail("Status tidak dikenal.");

      await prisma.$transaction(async (tx) => {
        const before = await tx.quotation.findFirstOrThrow({ where: { id: quotationId, tenantId: auth.user.tenantId } });
        await tx.quotation.update({ where: { id: before.id }, data: { status: status as QuotationStatus } });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.QUOTATION,
          entityId: before.id,
          entityLabel: before.number,
          summary: `Quotation ${before.number} status → ${status}`,
          changes: { status: { from: before.status, to: status } },
        });
      });

      return ok("Status diperbarui.");
    },
    [...PATHS, `/quotations/${quotationId}`],
  );
}

export async function canUserApprove(role: Role): Promise<boolean> {
  return canApprove(role);
}
