"use server";

import { redirect } from "next/navigation";

import { AttachmentEntity, SupplierStatus } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  booleanField,
  fail,
  numberField,
  ok,
  optionalString,
  requiredString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/suppliers", "/dashboard"];

function supplierPayload(formData: FormData) {
  return {
    name: requiredString(formData, "name", "Supplier name"),
    category: optionalString(formData, "category"),
    taxNumber: optionalString(formData, "taxNumber"),
    address: optionalString(formData, "address"),
    city: optionalString(formData, "city"),
    phone: optionalString(formData, "phone"),
    email: optionalString(formData, "email"),
    whatsappNumber: optionalString(formData, "whatsappNumber"),
    paymentTerms: optionalString(formData, "paymentTerms"),
    leadTimeDays: optionalNumber(formData, "leadTimeDays"),
    notes: optionalString(formData, "notes"),
  };
}

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  return raw ? numberField(formData, key) : null;
}

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  let newId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("suppliers", "manage");
    const payload = supplierPayload(formData);

    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          tenantId: auth.user.tenantId,
          status: SupplierStatus.ACTIVE,
          createdById: auth.user.id,
          ...payload,
        },
      });

      if (booleanField(formData, "addPrimaryContact")) {
        const contactName = optionalString(formData, "contactName");
        if (contactName) {
          await tx.contact.create({
            data: {
              tenantId: auth.user.tenantId,
              supplierId: created.id,
              name: contactName,
              jobTitle: optionalString(formData, "contactJobTitle"),
              phone: optionalString(formData, "contactPhone"),
              email: optionalString(formData, "contactEmail"),
              whatsappNumber: optionalString(formData, "contactWhatsapp"),
              isPrimary: true,
            },
          });
        }
      }

      await logActivity(tx, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.SUPPLIER,
        entityId: created.id,
        entityLabel: created.name,
        summary: `Supplier ${created.name} created`,
      });

      return created;
    });

    newId = supplier.id;
    return ok("Supplier created.", supplier.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/suppliers/${newId}`);
}

export async function updateSupplier(supplierId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("suppliers", "manage");
      const payload = supplierPayload(formData);

      await prisma.$transaction(async (tx) => {
        const before = await tx.supplier.findFirstOrThrow({
          where: { id: supplierId, tenantId: auth.user.tenantId },
        });
        const updated = await tx.supplier.update({ where: { id: before.id }, data: payload });

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(payload) as (keyof typeof payload)[]) {
          if (String(before[key as keyof typeof before] ?? "") !== String(updated[key as keyof typeof updated] ?? "")) {
            changes[key] = { from: before[key as keyof typeof before] ?? null, to: updated[key as keyof typeof updated] ?? null };
          }
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.SUPPLIER,
          entityId: updated.id,
          entityLabel: updated.name,
          summary: `Supplier ${updated.name} updated`,
          changes: Object.keys(changes).length > 0 ? changes : null,
        });
      });

      return ok("Supplier updated.");
    },
    [...PATHS, `/suppliers/${supplierId}`],
  );
}

export async function setSupplierStatus(supplierId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("suppliers", "manage");
      const nextStatus = String(formData.get("status") ?? "");
      if (nextStatus !== SupplierStatus.ACTIVE && nextStatus !== SupplierStatus.BLACKLISTED) {
        return fail("Unknown supplier status.");
      }

      await prisma.$transaction(async (tx) => {
        const before = await tx.supplier.findFirstOrThrow({
          where: { id: supplierId, tenantId: auth.user.tenantId },
        });

        await tx.supplier.update({
          where: { id: before.id },
          data: {
            status: nextStatus,
            archivedAt: nextStatus === SupplierStatus.BLACKLISTED ? new Date() : null,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: nextStatus === SupplierStatus.BLACKLISTED ? "ARCHIVE" : "STATUS_CHANGE",
          entityType: AttachmentEntity.SUPPLIER,
          entityId: before.id,
          entityLabel: before.name,
          summary:
            nextStatus === SupplierStatus.BLACKLISTED
              ? `Supplier ${before.name} blacklisted`
              : `Supplier ${before.name} reactivated`,
          changes: { status: { from: before.status, to: nextStatus } },
        });
      });

      return ok("Supplier status updated.");
    },
    [...PATHS, `/suppliers/${supplierId}`],
  );
}

export async function addSupplierContact(supplierId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("suppliers", "manage");
      const name = requiredString(formData, "name", "Contact name");
      const isPrimary = booleanField(formData, "isPrimary");

      await prisma.$transaction(async (tx) => {
        if (isPrimary) {
          await tx.contact.updateMany({
            where: { tenantId: auth.user.tenantId, supplierId },
            data: { isPrimary: false },
          });
        }

        await tx.contact.create({
          data: {
            tenantId: auth.user.tenantId,
            supplierId,
            name,
            jobTitle: optionalString(formData, "jobTitle"),
            phone: optionalString(formData, "phone"),
            email: optionalString(formData, "email"),
            whatsappNumber: optionalString(formData, "whatsappNumber"),
            isPrimary,
          },
        });
      });

      return ok("Contact added.");
    },
    [`/suppliers/${supplierId}`],
  );
}
