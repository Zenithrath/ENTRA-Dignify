"use server";

import { redirect } from "next/navigation";

import {
  ApprovalStatus,
  AttachmentEntity,
  DocType,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity";
import { approvalRuleFor, decideApproval, openApproval, requiresApproval } from "@/lib/approvals";
import { requirePermission } from "@/lib/auth";
import { money, num, round2 } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { priceLine, summarizeDocument } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";
import { canApprove } from "@/lib/rbac";
import { queueNotification } from "@/lib/notifications";
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

const PATHS = ["/finance/invoices", "/finance/payments", "/dashboard", "/orders"];

type Db = Prisma.TransactionClient;

/**
 * Payments are the source of truth: the invoice's paid amount and status are always
 * derived from the ledger so a deleted payment can never leave a stale PAID flag.
 */
async function syncInvoicePaymentState(db: Db, invoiceId: string, actor: { id: string; name: string }): Promise<void> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  if (!invoice) return;

  const paid = round2(invoice.payments.reduce((total, payment) => total + num(payment.amount), 0));
  const grandTotal = num(invoice.grandTotal);

  const status =
    paid >= grandTotal && grandTotal > 0
      ? InvoiceStatus.PAID
      : paid > 0
        ? InvoiceStatus.PARTIALLY_PAID
        : invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.PARTIALLY_PAID
          ? InvoiceStatus.SENT
          : invoice.status;

  if (status === invoice.status && round2(num(invoice.amountPaid)) === paid) return;

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid: paid,
      status,
      paidAt: status === InvoiceStatus.PAID ? (invoice.paidAt ?? new Date()) : null,
    },
  });

  await logActivity(db, {
    tenantId: invoice.tenantId,
    actor,
    action: status === InvoiceStatus.PAID ? "STATUS_CHANGE" : "UPDATE",
    entityType: AttachmentEntity.INVOICE,
    entityId: invoice.id,
    entityLabel: invoice.number,
    summary:
      status === InvoiceStatus.PAID
        ? `Invoice ${invoice.number} fully paid (${money(paid)})`
        : `Invoice ${invoice.number} payment recorded — outstanding ${money(Math.max(0, grandTotal - paid))}`,
    changes: { amountPaid: { from: num(invoice.amountPaid), to: paid }, status: { from: invoice.status, to: status } },
  });
}

/**
 * Creates an invoice from an order, billing only the quantities that have not been
 * invoiced yet so progress/milestone billing can reuse the same order safely.
 */
export async function createInvoice(formData: FormData): Promise<ActionResult> {
  let invoiceId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("finance", "manage");
    const tenantId = auth.user.tenantId;
    const orderId = optionalString(formData, "orderId");
    const typeRaw = String(formData.get("type") ?? InvoiceType.FULL);
    const type = Object.values(InvoiceType).includes(typeRaw as InvoiceType) ? (typeRaw as InvoiceType) : InvoiceType.FULL;

    const invoice = await prisma.$transaction(async (tx) => {
      const order = orderId
        ? await tx.order.findFirstOrThrow({
            where: { id: orderId, tenantId },
            include: {
              customer: true,
              items: { orderBy: { sortOrder: "asc" }, include: { invoiceItems: true } },
            },
          })
        : null;

      const customerId = order?.customerId ?? requiredString(formData, "customerId", "Customer");
      const customer = order?.customer ?? (await tx.customer.findFirstOrThrow({ where: { id: customerId, tenantId } }));

      const lines = order
        ? order.items
            .map((item) => {
              const requested = numberField(formData, `quantity[${item.id}]`, 0);
              const alreadyBilled = item.invoiceItems.reduce((total, invoiceItem) => total + num(invoiceItem.quantity), 0);
              const remaining = num(item.quantity) - alreadyBilled;
              const quantity = Math.min(requested > 0 ? requested : remaining, remaining);
              return { item, quantity };
            })
            .filter((line) => line.quantity > 0)
        : [];

      if (order && lines.length === 0) {
        throw new Error("Tidak ada qty yang bisa ditagih — semua item order sudah pernah ditagih atau qty kosong.");
      }

      const priced = lines.map((line) => {
        const price = priceLine(
          {
            quantity: line.quantity,
            unitPrice: line.item.sellingPrice,
            discountPercent: line.item.discountPercent,
            taxRate: line.item.taxRate,
          },
          line.quantity,
        );
        return { ...line, price, costPrice: num(line.item.costPrice) };
      });

      const summary = summarizeDocument(
        priced.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.item.sellingPrice,
          discountPercent: line.item.discountPercent,
          taxRate: line.item.taxRate,
        })),
        { shippingCost: numberField(formData, "shippingCost", num(order?.shippingCost)) },
      );

      const rule = await approvalRuleFor(tx, tenantId, DocType.INVOICE);
      const needsApproval = requiresApproval(summary.grandTotal, rule);

      const number = await nextDocumentNumber(tx, tenantId, DocType.INVOICE);
      const dueDate =
        dateField(formData, "dueDate") ??
        new Date(Date.now() + 30 * 86_400_000);

      const created = await tx.invoice.create({
        data: {
          tenantId,
          number,
          customerId,
          orderId: order?.id ?? null,
          type,
          status: needsApproval ? InvoiceStatus.PENDING_APPROVAL : InvoiceStatus.DRAFT,
          invoiceDate: dateField(formData, "invoiceDate", new Date()) ?? new Date(),
          dueDate,
          paymentTerms: optionalString(formData, "paymentTerms") ?? customer.paymentTerms,
          notes: optionalString(formData, "notes"),
          subtotal: summary.subtotal,
          discountTotal: summary.discountTotal,
          taxTotal: summary.taxTotal,
          grandTotal: summary.grandTotal,
          requiresApproval: needsApproval,
          createdById: auth.user.id,
          items: {
            create:
              priced.length > 0
                ? priced.map((line, index) => ({
                    orderItemId: line.item.id,
                    description: line.item.description,
                    quantity: line.quantity,
                    unit: line.item.unit,
                    unitPrice: line.item.sellingPrice,
                    discountPercent: num(line.item.discountPercent),
                    taxRate: num(line.item.taxRate),
                    lineTotal: line.price.total,
                    sortOrder: index,
                  }))
                : [
                    {
                      description: requiredString(formData, "description", "Item description"),
                      quantity: numberField(formData, "quantity", 1),
                      unit: String(formData.get("unit") ?? "pcs"),
                      unitPrice: numberField(formData, "unitPrice", summary.subtotal),
                      discountPercent: numberField(formData, "discountPercent", 0),
                      taxRate: numberField(formData, "taxRate", 11),
                      lineTotal: summary.grandTotal,
                      sortOrder: 0,
                    },
                  ],
          },
        },
      });

      // Track billed quantities on the order so progress billing never double-charges.
      for (const line of priced) {
        await tx.orderItem.update({
          where: { id: line.item.id },
          data: { invoicedQty: { increment: line.quantity } },
        });
      }

      if (needsApproval && rule) {
        await openApproval(tx, {
          tenantId,
          docType: DocType.INVOICE,
          recordId: created.id,
          recordNumber: created.number,
          amount: summary.grandTotal,
          requestedById: auth.user.id,
          approverRole: rule.approverRole,
        });
      }

      await logActivity(tx, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.INVOICE,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Invoice ${created.number} created${order ? ` from order ${order.number}` : ""} (${money(summary.grandTotal)})`,
      });

      return created;
    });

    invoiceId = invoice.id;
    return ok("Invoice dibuat.", invoice.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/finance/invoices/${invoiceId}`);
}

export async function updateInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
          include: { payments: true },
        });

        if (invoice.payments.length > 0 && num(invoice.amountPaid) > 0) {
          throw new Error("Invoice sudah punya pembayaran — ubah item tidak diizinkan.");
        }
        if (invoice.status === InvoiceStatus.CANCELLED) throw new Error("Invoice sudah dibatalkan.");

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            invoiceDate: dateField(formData, "invoiceDate", invoice.invoiceDate) ?? invoice.invoiceDate,
            dueDate: dateField(formData, "dueDate", invoice.dueDate) ?? invoice.dueDate,
            paymentTerms: optionalString(formData, "paymentTerms") ?? invoice.paymentTerms,
            notes: optionalString(formData, "notes") ?? invoice.notes,
            type: Object.values(InvoiceType).includes(String(formData.get("type")) as InvoiceType)
              ? (String(formData.get("type")) as InvoiceType)
              : invoice.type,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.INVOICE,
          entityId: invoice.id,
          entityLabel: invoice.number,
          summary: `Invoice ${invoice.number} updated`,
        });
      });

      return ok("Invoice diperbarui.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function approveInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");
      if (!canApprove(auth.user.role)) return fail("Hanya Manager atau Owner yang bisa approve invoice.");

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
        });

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.DRAFT, approvedAt: new Date(), approvedById: auth.user.id },
        });

        await decideApproval(tx, {
          tenantId: auth.user.tenantId,
          docType: DocType.INVOICE,
          recordId: invoice.id,
          decidedById: auth.user.id,
          status: ApprovalStatus.APPROVED,
          note: optionalString(formData, "note"),
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "APPROVE",
          entityType: AttachmentEntity.INVOICE,
          entityId: invoice.id,
          entityLabel: invoice.number,
          summary: `Invoice ${invoice.number} approved (${money(invoice.grandTotal)})`,
        });
      });

      return ok("Invoice approved.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function rejectInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");
      if (!canApprove(auth.user.role)) return fail("Hanya Manager atau Owner yang bisa menolak invoice.");
      const reason = optionalString(formData, "reason");

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
        });

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.CANCELLED, cancelledReason: reason ?? "Ditolak saat approval" },
        });

        await decideApproval(tx, {
          tenantId: auth.user.tenantId,
          docType: DocType.INVOICE,
          recordId: invoice.id,
          decidedById: auth.user.id,
          status: ApprovalStatus.REJECTED,
          note: reason,
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "REJECT",
          entityType: AttachmentEntity.INVOICE,
          entityId: invoice.id,
          entityLabel: invoice.number,
          summary: `Invoice ${invoice.number} rejected${reason ? ` — ${reason}` : ""}`,
        });
      });

      return ok("Invoice ditolak.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function sendInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");
      const channel = String(formData.get("channel") ?? "WHATSAPP") === "EMAIL" ? "EMAIL" : "WHATSAPP";

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
          include: {
            customer: { select: { companyName: true, email: true, whatsappNumber: true, phone: true } },
          },
        });

        if (invoice.requiresApproval && invoice.status === InvoiceStatus.PENDING_APPROVAL) {
          throw new Error("Invoice ini masih menunggu approval Manager/Owner.");
        }
        if (invoice.status === InvoiceStatus.CANCELLED) throw new Error("Invoice sudah dibatalkan.");

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: invoice.status === InvoiceStatus.SENT ? invoice.status : InvoiceStatus.SENT, sentAt: new Date() },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "SEND",
          entityType: AttachmentEntity.INVOICE,
          entityId: invoice.id,
          entityLabel: invoice.number,
          summary: `Invoice ${invoice.number} sent via ${channel}`,
          changes: { status: { from: invoice.status, to: InvoiceStatus.SENT } },
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "MANUAL_SEND",
          channel,
          recipient:
            channel === "WHATSAPP"
              ? (invoice.customer.whatsappNumber ?? invoice.customer.phone)
              : invoice.customer.email,
          recipientName: invoice.customer.companyName,
          subject: `Invoice ${invoice.number}`,
          body: `Invoice ${invoice.number} sebesar ${money(invoice.grandTotal)} jatuh tempo ${invoice.dueDate.toLocaleDateString("id-ID")}. Dokumen: /print/invoices/${invoice.id}`,
          entityType: "INVOICE",
          entityId: invoice.id,
          entityLabel: invoice.number,
        });
      });

      return ok("Invoice terkirim.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function cancelInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");
      const reason = optionalString(formData, "reason");

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
          include: { payments: true, items: true },
        });

        if (invoice.payments.length > 0) throw new Error("Invoice dengan pembayaran tidak bisa dibatalkan.");

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.CANCELLED, cancelledReason: reason },
        });

        for (const item of invoice.items) {
          if (!item.orderItemId) continue;
          await tx.orderItem.update({
            where: { id: item.orderItemId },
            data: { invoicedQty: { decrement: num(item.quantity) } },
          });
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.INVOICE,
          entityId: invoice.id,
          entityLabel: invoice.number,
          summary: `Invoice ${invoice.number} cancelled${reason ? ` — ${reason}` : ""}`,
          changes: { status: { from: invoice.status, to: InvoiceStatus.CANCELLED } },
        });
      });

      return ok("Invoice dibatalkan.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function recordPayment(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");
      const amount = numberField(formData, "amount");
      if (amount <= 0) return fail("Jumlah pembayaran harus lebih dari 0.");
      const methodRaw = String(formData.get("method") ?? PaymentMethod.TRANSFER);
      const method = Object.values(PaymentMethod).includes(methodRaw as PaymentMethod)
        ? (methodRaw as PaymentMethod)
        : PaymentMethod.TRANSFER;

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId, tenantId: auth.user.tenantId },
          include: { customer: { select: { companyName: true } } },
        });

        if (invoice.status === InvoiceStatus.CANCELLED) throw new Error("Invoice sudah dibatalkan.");

        const number = await nextDocumentNumber(tx, auth.user.tenantId, DocType.PAYMENT);
        await tx.payment.create({
          data: {
            tenantId: auth.user.tenantId,
            number,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            paymentDate: dateField(formData, "paymentDate", new Date()) ?? new Date(),
            amount,
            method,
            referenceNumber: optionalString(formData, "referenceNumber"),
            notes: optionalString(formData, "notes"),
            createdById: auth.user.id,
          },
        });

        await syncInvoicePaymentState(tx, invoice.id, { id: auth.user.id, name: auth.user.name });

        const updated = await tx.invoice.findUnique({ where: { id: invoice.id } });
        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.PAYMENT,
          entityId: invoice.id,
          entityLabel: number,
          summary: `Payment ${money(amount)} recorded for invoice ${invoice.number}`,
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "PAYMENT_RECEIVED",
          channel: "IN_APP",
          recipient: null,
          subject: `Pembayaran diterima — ${invoice.number}`,
          body: `${invoice.customer.companyName} membayar ${money(amount)}. Sisa tagihan ${money(
            Math.max(0, num(updated?.grandTotal) - num(updated?.amountPaid)),
          )}.`,
          entityType: "INVOICE",
          entityId: invoice.id,
          entityLabel: invoice.number,
        });
      });

      return ok("Pembayaran dicatat.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}

export async function deletePayment(paymentId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");

      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirstOrThrow({
          where: { id: paymentId, tenantId: auth.user.tenantId },
        });

        await tx.payment.delete({ where: { id: payment.id } });
        await syncInvoicePaymentState(tx, payment.invoiceId, { id: auth.user.id, name: auth.user.name });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "DELETE",
          entityType: AttachmentEntity.PAYMENT,
          entityId: payment.invoiceId,
          entityLabel: payment.number,
          summary: `Payment ${payment.number} (${money(payment.amount)}) deleted`,
        });
      });

      return ok("Pembayaran dihapus.");
    },
    PATHS,
  );
}

/** Manual nudge — the daily job queues these automatically, this is the on-demand version. */
export async function sendInvoiceReminder(invoiceId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("finance", "manage");

      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { id: invoiceId, tenantId: auth.user.tenantId },
        include: { customer: { select: { companyName: true, whatsappNumber: true, phone: true } } },
      });

      const outstanding = round2(num(invoice.grandTotal) - num(invoice.amountPaid));
      const overdueDays = Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000);

      await queueNotification({
        tenantId: auth.user.tenantId,
        event: overdueDays > 0 ? "INVOICE_OVERDUE" : "INVOICE_DUE_SOON",
        channel: "WHATSAPP",
        recipient: invoice.customer.whatsappNumber ?? invoice.customer.phone,
        recipientName: invoice.customer.companyName,
        subject: `Reminder invoice ${invoice.number}`,
        body:
          overdueDays > 0
            ? `Invoice ${invoice.number} sudah melewati jatuh tempo ${overdueDays} hari. Sisa tagihan ${money(outstanding)}.`
            : `Reminder: invoice ${invoice.number} sebesar ${money(outstanding)} jatuh tempo ${invoice.dueDate.toLocaleDateString("id-ID")}.`,
        entityType: "INVOICE",
        entityId: invoice.id,
        entityLabel: invoice.number,
      });

      await logActivity(prisma, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "SEND",
        entityType: AttachmentEntity.INVOICE,
        entityId: invoice.id,
        entityLabel: invoice.number,
        summary: `Payment reminder queued for invoice ${invoice.number}`,
      });

      return ok("Reminder dikirim ke antrean WhatsApp.");
    },
    [...PATHS, `/finance/invoices/${invoiceId}`],
  );
}
