"use server";

import { redirect } from "next/navigation";

import {
  AttachmentEntity,
  LineType,
  LostReason,
  RequestSource,
  RequestStatus,
} from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { nextDocumentNumber } from "@/lib/numbering";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { queueNotification } from "@/lib/notifications";
import {
  dateField,
  fail,
  ok,
  optionalString,
  parseRequestItems,
  requiredString,
  runAction,
  selectField,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/requests", "/dashboard"];

export async function createRequest(formData: FormData): Promise<ActionResult> {
  let newId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("requests", "manage");
    const items = parseRequestItems(formData);

    if (items.length === 0) return fail("Tambahkan minimal satu item permintaan.");

    const customerId = requiredString(formData, "customerId", "Customer");
    const source = selectField(formData, "source", RequestSource, RequestSource.MANUAL);

    const request = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId: auth.user.tenantId },
        select: { companyName: true },
      });
      if (!customer) throw new Error("Customer not found.");

      const number = await nextDocumentNumber(tx, auth.user.tenantId, "REQUEST");

      const created = await tx.request.create({
        data: {
          tenantId: auth.user.tenantId,
          number,
          customerId,
          requestDate: dateField(formData, "requestDate", new Date()) ?? new Date(),
          source,
          status: RequestStatus.NEW,
          assignedToId: optionalString(formData, "assignedToId"),
          customerRef: optionalString(formData, "customerRef"),
          notes: optionalString(formData, "notes"),
          createdById: auth.user.id,
          items: {
            create: items.map((item, index) => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              targetPrice: item.targetPrice,
              note: item.note,
              sortOrder: index,
            })),
          },
        },
        include: { customer: { select: { companyName: true } } },
      });

      await logActivity(tx, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.REQUEST,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Request ${created.number} for ${created.customer.companyName} created (${source})`,
      });

      return created;
    });

    newId = request.id;
    return ok("Request created.", request.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/requests/${newId}`);
}

export async function assignRequest(requestId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("requests", "manage");
      const assignedToId = optionalString(formData, "assignedToId");

      await prisma.$transaction(async (tx) => {
        const before = await tx.request.findFirstOrThrow({
          where: { id: requestId, tenantId: auth.user.tenantId },
        });

        await tx.request.update({ where: { id: before.id }, data: { assignedToId } });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.REQUEST,
          entityId: before.id,
          entityLabel: before.number,
          summary: assignedToId ? "Request reassigned" : "Request unassigned",
          changes: { assignedToId: { from: before.assignedToId, to: assignedToId } },
        });
      });

      return ok("Assignment updated.");
    },
    [...PATHS, `/requests/${requestId}`],
  );
}

export async function closeRequest(requestId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("requests", "manage");
      const outcome = String(formData.get("outcome") ?? "");
      if (outcome !== "won" && outcome !== "lost") return fail("Pilih hasil: won atau lost.");

      await prisma.$transaction(async (tx) => {
        const before = await tx.request.findFirstOrThrow({
          where: { id: requestId, tenantId: auth.user.tenantId },
        });

        const lostReason = outcome === "lost" ? selectField(formData, "lostReason", LostReason, LostReason.OTHER) : null;
        const nextStatus = outcome === "won" ? RequestStatus.CLOSED_WON : RequestStatus.CLOSED_LOST;

        await tx.request.update({
          where: { id: before.id },
          data: {
            status: nextStatus,
            lostReason,
            lostNote: outcome === "lost" ? optionalString(formData, "lostNote") : null,
            closedAt: new Date(),
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.REQUEST,
          entityId: before.id,
          entityLabel: before.number,
          summary:
            outcome === "won"
              ? `Request ${before.number} closed as won`
              : `Request ${before.number} closed as lost (${lostReason})`,
          changes: { status: { from: before.status, to: nextStatus } },
        });
      });

      return ok("Request closed.");
    },
    [...PATHS, `/requests/${requestId}`],
  );
}

/** Copies the request lines into a new draft quotation so nothing is typed twice. */
export async function createQuotationFromRequest(requestId: string): Promise<ActionResult> {
  let quotationId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("quotations", "manage");

    const quotation = await prisma.$transaction(async (tx) => {
      const request = await tx.request.findFirstOrThrow({
        where: { id: requestId, tenantId: auth.user.tenantId },
        include: { items: { orderBy: { sortOrder: "asc" } }, customer: { select: { paymentTerms: true, companyName: true } } },
      });

      const number = await nextDocumentNumber(tx, auth.user.tenantId, "QUOTATION");

      const created = await tx.quotation.create({
        data: {
          tenantId: auth.user.tenantId,
          number,
          customerId: request.customerId,
          requestId: request.id,
          quotationDate: new Date(),
          validUntil: new Date(Date.now() + 14 * 86_400_000),
          paymentTerms: request.customer.paymentTerms,
          status: "DRAFT",
          createdById: auth.user.id,
          items: {
            create: request.items.map((item, index) => ({
              productId: item.productId,
              lineType: LineType.PRODUCT,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              sellingPrice: num(item.targetPrice),
              costPrice: 0,
              discountPercent: 0,
              taxRate: 11,
              lineTotal: num(item.targetPrice) * num(item.quantity),
              sortOrder: index,
            })),
          },
        },
      });

      await tx.request.update({ where: { id: request.id }, data: { status: RequestStatus.PREPARING_QUOTATION } });

      await logActivity(tx, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CONVERT",
        entityType: AttachmentEntity.QUOTATION,
        entityId: created.id,
        entityLabel: created.number,
        summary: `Quotation ${created.number} drafted from request ${request.number}`,
      });

      return created;
    });

    quotationId = quotation.id;
    return ok("Quotation drafted from request.", quotation.id);
  }, [...PATHS, `/requests/${requestId}`]);

  if (!result.ok) return result;
  redirect(`/quotations/${quotationId}`);
}

export async function notifyAgingRequests(): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requirePermission("requests", "manage");
    const threshold = new Date(Date.now() - 3 * 86_400_000);

    const stale = await prisma.request.findMany({
      where: { tenantId: auth.user.tenantId, status: "NEW", requestDate: { lt: threshold } },
      include: { customer: { select: { companyName: true } } },
      take: 20,
    });

    for (const request of stale) {
      await queueNotification({
        tenantId: auth.user.tenantId,
        event: "REQUEST_AGING",
        channel: "IN_APP",
        recipient: auth.user.email,
        recipientName: auth.user.name,
        subject: `Request ${request.number} belum ditindaklanjuti`,
        body: `Request dari ${request.customer.companyName} masih berstatus New sejak ${request.requestDate.toLocaleDateString("id-ID")}.`,
        entityType: "REQUEST",
        entityId: request.id,
        entityLabel: request.number,
      });
    }

    return ok(`${stale.length} reminder aging dibuat.`);
  });
}

