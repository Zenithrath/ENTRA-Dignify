"use server";

import { redirect } from "next/navigation";

import { AttachmentEntity, LineType } from "@/generated/prisma/enums";
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

const PATHS = ["/products", "/dashboard"];

function productPayload(formData: FormData, tenantId: string) {
  const typeRaw = String(formData.get("type") ?? LineType.PRODUCT);
  const type = Object.values(LineType).includes(typeRaw as LineType) ? (typeRaw as LineType) : LineType.PRODUCT;

  return {
    tenantId,
    sku: requiredString(formData, "sku", "SKU"),
    name: requiredString(formData, "name", "Nama produk"),
    description: optionalString(formData, "description"),
    type,
    category: optionalString(formData, "category"),
    unit: String(formData.get("unit") ?? "pcs").trim() || "pcs",
    costPrice: numberField(formData, "costPrice"),
    sellingPrice: numberField(formData, "sellingPrice"),
    taxRate: numberField(formData, "taxRate", 11),
    defaultSupplierId: optionalString(formData, "defaultSupplierId"),
    // Services and labour are never stock-tracked, whatever the checkbox says.
    isInventoryTracked: booleanField(formData, "isInventoryTracked") && (type === LineType.PRODUCT || type === LineType.PACKAGE),
    reorderPoint: numberField(formData, "reorderPoint"),
  };
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  let productId = "";
  const result = await runAction(async () => {
    const auth = await requirePermission("products", "manage");
    const data = productPayload(formData, auth.user.tenantId);

    const existing = await prisma.product.findFirst({
      where: { tenantId: auth.user.tenantId, sku: data.sku, deletedAt: null },
      select: { id: true },
    });
    if (existing) return fail(`SKU ${data.sku} sudah dipakai produk lain.`);

    const product = await prisma.product.create({
      data: { ...data, createdById: auth.user.id, isActive: true },
    });

    await logActivity(prisma, {
      tenantId: auth.user.tenantId,
      actor: { id: auth.user.id, name: auth.user.name },
      action: "CREATE",
      entityType: AttachmentEntity.PRODUCT,
      entityId: product.id,
      entityLabel: product.sku,
      summary: `Product ${product.sku} — ${product.name} created`,
    });

    productId = product.id;
    return ok("Produk dibuat.", product.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/products/${productId}`);
}

export async function updateProduct(productId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");
      const tenantId = auth.user.tenantId;
      const data = productPayload(formData, tenantId);

      await prisma.$transaction(async (tx) => {
        const before = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId } });

        const duplicate = await tx.product.findFirst({
          where: { tenantId, sku: data.sku, id: { not: before.id }, deletedAt: null },
          select: { id: true },
        });
        if (duplicate) throw new Error(`SKU ${data.sku} sudah dipakai produk lain.`);

        const updated = await tx.product.update({ where: { id: before.id }, data });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: updated.id,
          entityLabel: updated.sku,
          summary: `Product ${updated.sku} updated`,
          changes: {
            sellingPrice: { from: before.sellingPrice.toString(), to: updated.sellingPrice.toString() },
            costPrice: { from: before.costPrice.toString(), to: updated.costPrice.toString() },
            reorderPoint: { from: before.reorderPoint.toString(), to: updated.reorderPoint.toString() },
          },
        });
      });

      return ok("Produk diperbarui.");
    },
    [...PATHS, `/products/${productId}`],
  );
}

/** Archive keeps history intact — archived items drop out of pickers but stay in old documents. */
export async function archiveProduct(productId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");
      const restore = String(formData.get("restore") ?? "") === "true";

      await prisma.$transaction(async (tx) => {
        const product = await tx.product.findFirstOrThrow({
          where: { id: productId, tenantId: auth.user.tenantId },
        });

        const updated = await tx.product.update({
          where: { id: product.id },
          data: restore
            ? { isActive: true, archivedAt: null }
            : { isActive: false, archivedAt: new Date() },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: restore ? "UPDATE" : "ARCHIVE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: updated.id,
          entityLabel: updated.sku,
          summary: restore ? `Product ${updated.sku} restored` : `Product ${updated.sku} archived`,
        });
      });

      return ok(restore ? "Produk diaktifkan kembali." : "Produk diarsipkan.");
    },
    [...PATHS, `/products/${productId}`],
  );
}

/** Customer-specific price list (Power tier) — one row per customer × product. */
export async function saveCustomerPrice(productId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");
      const customerId = requiredString(formData, "customerId", "Customer");
      const price = numberField(formData, "price");
      const minQty = numberField(formData, "minQuantity", 1);

      await prisma.customerPrice.upsert({
        where: { customerId_productId_minQty: { customerId, productId, minQty } },
        create: { tenantId: auth.user.tenantId, customerId, productId, price, minQty },
        update: { price },
      });

      await logActivity(prisma, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "UPDATE",
        entityType: AttachmentEntity.PRODUCT,
        entityId: productId,
        summary: `Customer-specific price updated`,
      });

      return ok("Harga khusus customer disimpan.");
    },
    [`/products/${productId}`],
  );
}

export async function deleteCustomerPrice(customerPriceId: string, productId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");

      const price = await prisma.customerPrice.findFirstOrThrow({
        where: { id: customerPriceId, tenantId: auth.user.tenantId },
      });
      await prisma.customerPrice.delete({ where: { id: price.id } });

      return ok("Harga khusus dihapus.");
    },
    [`/products/${productId}`],
  );
}

/** Multi-unit conversions (buy per box, sell per piece). */
export async function saveProductUnit(productId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");
      const name = requiredString(formData, "name", "Nama unit");
      const conversionFactor = numberField(formData, "conversionFactor", 1);
      if (conversionFactor <= 0) return fail("Faktor konversi harus lebih dari 0.");

      await prisma.productUnit.create({
        data: {
          tenantId: auth.user.tenantId,
          productId,
          unitName: name,
          conversionFactor,
          sellingPrice: numberField(formData, "price") || null,
          costPrice: numberField(formData, "costPrice") || null,
        },
      });

      await logActivity(prisma, {
        tenantId: auth.user.tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.PRODUCT,
        entityId: productId,
        summary: `Unit ${name} (×${conversionFactor}) added`,
      });

      return ok("Satuan tambahan disimpan.");
    },
    [`/products/${productId}`],
  );
}

export async function deleteProductUnit(unitId: string, productId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("products", "manage");

      const unit = await prisma.productUnit.findFirstOrThrow({
        where: { id: unitId, tenantId: auth.user.tenantId },
      });
      await prisma.productUnit.delete({ where: { id: unit.id } });

      return ok("Satuan dihapus.");
    },
    [`/products/${productId}`],
  );
}
