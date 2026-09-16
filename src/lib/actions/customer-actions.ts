"use server";

import { redirect } from "next/navigation";

import { AttachmentEntity, CustomerStatus } from "@/generated/prisma/enums";
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

const PATHS = ["/customers", "/dashboard"];

function customerPayload(formData: FormData) {
  return {
    companyName: requiredString(formData, "companyName", "Company name"),
    industry: optionalString(formData, "industry"),
    taxNumber: optionalString(formData, "taxNumber"),
    address: optionalString(formData, "address"),
    city: optionalString(formData, "city"),
    phone: optionalString(formData, "phone"),
    email: optionalString(formData, "email"),
    website: optionalString(formData, "website"),
    whatsappNumber: optionalString(formData, "whatsappNumber"),
    paymentTerms: optionalString(formData, "paymentTerms"),
    creditLimit: optionalNumberOrNull(formData, "creditLimit"),
    salesOwnerId: optionalString(formData, "salesOwnerId"),
    notes: optionalString(formData, "notes"),
  };
}

function optionalNumberOrNull(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  return numberField(formData, key);
}

export async function createCustomer(formData: FormData): Promise<ActionResult> {
  let newId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("customers", "manage");
    const payload = customerPayload(formData);

    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          tenantId: auth.user.tenantId,
          status: CustomerStatus.ACTIVE,
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
              customerId: created.id,
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
        entityType: AttachmentEntity.CUSTOMER,
        entityId: created.id,
        entityLabel: created.companyName,
        summary: `Customer ${created.companyName} created`,
      });

      return created;
    });

    newId = customer.id;
    return ok("Customer created.", customer.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/customers/${newId}`);
}

export async function updateCustomer(customerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("customers", "manage");
      const payload = customerPayload(formData);

      await prisma.$transaction(async (tx) => {
        const before = await tx.customer.findFirstOrThrow({
          where: { id: customerId, tenantId: auth.user.tenantId },
        });

        const updated = await tx.customer.update({ where: { id: before.id }, data: payload });

        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of Object.keys(payload) as (keyof typeof payload)[]) {
          const from = before[key as keyof typeof before];
          const to = updated[key as keyof typeof updated];
          if (String(from ?? "") !== String(to ?? "")) {
            changed[key] = { from: from ?? null, to: to ?? null };
          }
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.CUSTOMER,
          entityId: updated.id,
          entityLabel: updated.companyName,
          summary: `Customer ${updated.companyName} updated`,
          changes: Object.keys(changed).length > 0 ? changed : null,
        });
      });

      return ok("Customer updated.");
    },
    [...PATHS, `/customers/${customerId}`],
  );
}

export async function setCustomerStatus(customerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("customers", "manage");
      const nextStatus = String(formData.get("status") ?? "");
      if (nextStatus !== CustomerStatus.ACTIVE && nextStatus !== CustomerStatus.INACTIVE) {
        return fail("Unknown customer status.");
      }

      await prisma.$transaction(async (tx) => {
        const before = await tx.customer.findFirstOrThrow({
          where: { id: customerId, tenantId: auth.user.tenantId },
        });

        await tx.customer.update({
          where: { id: before.id },
          data: {
            status: nextStatus,
            archivedAt: nextStatus === CustomerStatus.INACTIVE ? new Date() : null,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: nextStatus === CustomerStatus.INACTIVE ? "ARCHIVE" : "STATUS_CHANGE",
          entityType: AttachmentEntity.CUSTOMER,
          entityId: before.id,
          entityLabel: before.companyName,
          summary:
            nextStatus === CustomerStatus.INACTIVE
              ? `Customer ${before.companyName} archived`
              : `Customer ${before.companyName} reactivated`,
          changes: { status: { from: before.status, to: nextStatus } },
        });
      });

      return ok("Customer status updated.");
    },
    [...PATHS, `/customers/${customerId}`],
  );
}

export async function addContact(customerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("customers", "manage");
      const name = requiredString(formData, "name", "Contact name");
      const isPrimary = booleanField(formData, "isPrimary");

      await prisma.$transaction(async (tx) => {
        if (isPrimary) {
          await tx.contact.updateMany({
            where: { tenantId: auth.user.tenantId, customerId },
            data: { isPrimary: false },
          });
        }

        const contact = await tx.contact.create({
          data: {
            tenantId: auth.user.tenantId,
            customerId,
            name,
            jobTitle: optionalString(formData, "jobTitle"),
            department: optionalString(formData, "department"),
            phone: optionalString(formData, "phone"),
            email: optionalString(formData, "email"),
            whatsappNumber: optionalString(formData, "whatsappNumber"),
            isPrimary,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.CONTACT,
          entityId: contact.id,
          entityLabel: contact.name,
          summary: `Contact ${contact.name} added to customer`,
        });
      });

      return ok("Contact added.");
    },
    [`/customers/${customerId}`],
  );
}

export async function setCustomerPrice(customerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("customers", "manage");
      const productId = requiredString(formData, "productId", "Product");
      const price = numberField(formData, "price");
      const minQty = numberField(formData, "minQty", 1);

      if (price <= 0) return fail("Price must be greater than zero.");

      await prisma.$transaction(async (tx) => {
        await tx.customerPrice.upsert({
          where: { customerId_productId_minQty: { customerId, productId, minQty } },
          create: { tenantId: auth.user.tenantId, customerId, productId, price, minQty },
          update: { price },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.CUSTOMER,
          entityId: customerId,
          summary: `Customer-specific price set (min qty ${minQty})`,
        });
      });

      return ok("Customer price saved.");
    },
    [`/customers/${customerId}`],
  );
}

export async function addInternalNote(
  entityType: AttachmentEntity,
  entityId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requirePermission("customers", "view");
    const body = requiredString(formData, "body", "Note");

    await prisma.comment.create({
      data: {
        tenantId: auth.user.tenantId,
        entityType,
        entityId,
        body,
        authorId: auth.user.id,
        authorName: auth.user.name,
        isInternal: true,
      },
    });

    return ok("Note added.");
  });
}
