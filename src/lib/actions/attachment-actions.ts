"use server";

import { revalidatePath } from "next/cache";

import { AttachmentEntity } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { requireAuth, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moduleForEntity } from "@/lib/rbac";
import { saveUpload } from "@/lib/storage";
import { fail, ok, optionalString, requiredString, runAction, type ActionResult } from "@/lib/actions/helpers";

export async function uploadAttachment(
  entityType: AttachmentEntity,
  entityId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requirePermission(moduleForEntity(entityType), "view");

    const file = formData.get("file");
    const externalUrl = optionalString(formData, "url");
    const label = optionalString(formData, "label");

    if (!(file instanceof File) && !externalUrl) {
      return fail("Attach a file or paste a document URL.");
    }

    if (file instanceof File && file.size > 15 * 1024 * 1024) {
      return fail("Files must be 15 MB or smaller.");
    }

    const existingCount = await prisma.attachment.count({
      where: { tenantId: auth.user.tenantId, entityType, entityId },
    });

    const stored =
      file instanceof File && file.size > 0
        ? await saveUpload(file)
        : {
            url: externalUrl as string,
            fileName: externalUrl?.split("/").pop() ?? "link",
            size: 0,
            mimeType: "text/uri-list",
          };

    await prisma.attachment.create({
      data: {
        tenantId: auth.user.tenantId,
        entityType,
        entityId,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.size,
        url: stored.url,
        label,
        version: existingCount + 1,
        uploadedById: auth.user.id,
      },
    });

    await logActivity(prisma, {
      tenantId: auth.user.tenantId,
      actor: { id: auth.user.id, name: auth.user.name },
      action: "CREATE",
      entityType,
      entityId,
      entityLabel: stored.fileName,
      summary: `Attachment "${stored.fileName}" uploaded`,
    });

    revalidatePath("/", "layout");
    return ok("Attachment uploaded.");
  });
}

export async function deleteAttachment(attachmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requireAuth();

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, tenantId: auth.user.tenantId },
    });
    if (!attachment) return fail("Attachment not found.");

    await requirePermission(moduleForEntity(attachment.entityType), "view");

    await prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachment.id } });
      await logActivity(tx, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "DELETE",
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        entityLabel: attachment.fileName,
        summary: `Attachment "${attachment.fileName}" removed`,
      });
    });

    revalidatePath("/", "layout");
    return ok("Attachment removed.");
  });
}

export async function addNote(entityType: AttachmentEntity, entityId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requirePermission(moduleForEntity(entityType), "view");

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

    revalidatePath("/", "layout");
    return ok("Note added.");
  });
}
