"use server";

import { AttachmentEntity, StockMoveType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { adjustStock, inventoryEnabled, resolveWarehouse } from "@/lib/inventory";
import { num } from "@/lib/money";
import { queueNotification } from "@/lib/notifications";
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

const PATHS = ["/inventory", "/products", "/dashboard"];

type Db = Prisma.TransactionClient;

/** Raises the low-stock notification once a level crosses the reorder point. */
async function notifyIfLow(
  db: Db,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    actor: { id: string; name: string };
  },
): Promise<void> {
  const [product, level] = await Promise.all([
    db.product.findUnique({ where: { id: params.productId }, select: { name: true, sku: true, reorderPoint: true } }),
    db.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: params.productId, warehouseId: params.warehouseId } },
      select: { onHand: true, reserved: true, minThreshold: true },
    }),
  ]);
  if (!product || !level) return;

  const available = num(level.onHand) - num(level.reserved);
  const threshold = Math.max(num(level.minThreshold), num(product.reorderPoint));
  if (threshold <= 0 || available > threshold) return;

  await queueNotification({
    tenantId: params.tenantId,
    event: "STOCK_LOW",
    channel: "IN_APP",
    recipient: null,
    subject: `Stok ${product.sku} menipis`,
    body: `${product.name} tersisa ${available} (threshold ${threshold}). Pertimbangkan restock.`,
    entityType: "PRODUCT",
    entityId: params.productId,
    entityLabel: product.sku,
  });

  await logActivity(db, {
    tenantId: params.tenantId,
    actor: params.actor,
    action: "UPDATE",
    entityType: AttachmentEntity.PRODUCT,
    entityId: params.productId,
    entityLabel: product.sku,
    summary: `Low stock alert — ${product.name} available ${available} ≤ ${threshold}`,
  });
}

/** Physical count correction: sets on-hand to the counted quantity and logs the delta. */
export async function recordStockAdjustment(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("inventory", "manage");
      const tenantId = auth.user.tenantId;
      const productId = requiredString(formData, "productId", "Produk");
      const countedQuantity = numberField(formData, "countedQuantity", Number.NaN);
      if (!Number.isFinite(countedQuantity) || countedQuantity < 0) return fail("Qty hasil hitung fisik tidak valid.");

      await prisma.$transaction(async (tx) => {
        const warehouseId = await resolveWarehouse(tx, tenantId, optionalString(formData, "warehouseId"));
        if (!warehouseId) throw new Error("Belum ada gudang aktif. Tambahkan gudang dulu di Inventory.");

        const product = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId } });

        const { previous, counted } = await adjustStock(tx, {
          tenantId,
          productId,
          warehouseId,
          countedQuantity,
          note: optionalString(formData, "note") ?? "Stock adjustment",
          createdById: auth.user.id,
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: product.id,
          entityLabel: product.sku,
          summary: `Stock adjustment on ${product.sku}: ${previous} → ${counted}`,
          changes: { onHand: { from: previous, to: counted } },
        });

        await notifyIfLow(tx, { tenantId, productId, warehouseId, actor: { id: auth.user.id, name: auth.user.name } });
      });

      return ok("Stock adjustment tercatat.");
    },
    PATHS,
  );
}

/** Manual stock in/out that is not tied to a PO or DO (sample, damage, internal use). */
export async function recordManualMovement(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("inventory", "manage");
      const tenantId = auth.user.tenantId;
      const productId = requiredString(formData, "productId", "Produk");
      const quantity = numberField(formData, "quantity");
      if (quantity <= 0) return fail("Qty harus lebih dari 0.");

      const direction = String(formData.get("direction") ?? "IN");
      if (direction !== "IN" && direction !== "OUT") return fail("Pilih arah pergerakan stok.");

      await prisma.$transaction(async (tx) => {
        const warehouseId = await resolveWarehouse(tx, tenantId, optionalString(formData, "warehouseId"));
        if (!warehouseId) throw new Error("Belum ada gudang aktif.");

        const product = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId } });
        const type = direction === "IN" ? StockMoveType.IN : StockMoveType.OUT;

        const level = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId } },
        });
        const current = level ? num(level.onHand) : 0;
        const next = direction === "IN" ? current + quantity : current - quantity;
        if (next < 0) throw new Error(`Stok tidak cukup: tersedia ${current}, diminta keluar ${quantity}.`);

        await tx.stockLevel.upsert({
          where: { productId_warehouseId: { productId, warehouseId } },
          create: { tenantId, productId, warehouseId, onHand: next },
          update: { onHand: next },
        });

        await tx.stockMovement.create({
          data: {
            tenantId,
            productId,
            warehouseId,
            type,
            quantity,
            balanceAfter: next,
            referenceType: "MANUAL",
            referenceId: optionalString(formData, "referenceId"),
            note: optionalString(formData, "note") ?? (direction === "IN" ? "Manual stock in" : "Manual stock out"),
            createdById: auth.user.id,
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: product.id,
          entityLabel: product.sku,
          summary: `Manual stock ${direction} ${quantity} ${product.unit} for ${product.sku}`,
          changes: { onHand: { from: current, to: next } },
        });

        if (direction === "OUT") {
          await notifyIfLow(tx, { tenantId, productId, warehouseId, actor: { id: auth.user.id, name: auth.user.name } });
        }
      });

      return ok("Pergerakan stok tercatat.");
    },
    PATHS,
  );
}

/** Multi-warehouse transfer (Power tier): one OUT movement and one IN movement. */
export async function transferStock(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("inventory", "manage");
      const tenantId = auth.user.tenantId;
      const productId = requiredString(formData, "productId", "Produk");
      const fromWarehouseId = requiredString(formData, "fromWarehouseId", "Gudang asal");
      const toWarehouseId = requiredString(formData, "toWarehouseId", "Gudang tujuan");
      const quantity = numberField(formData, "quantity");
      if (quantity <= 0) return fail("Qty transfer harus lebih dari 0.");
      if (fromWarehouseId === toWarehouseId) return fail("Gudang asal dan tujuan tidak boleh sama.");

      await prisma.$transaction(async (tx) => {
        const product = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId } });

        const source = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
        });
        const available = source ? num(source.onHand) : 0;
        if (available < quantity) throw new Error(`Stok gudang asal hanya ${available}.`);

        const target = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        });
        const targetBalance = (target ? num(target.onHand) : 0) + quantity;

        await tx.stockLevel.update({
          where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
          data: { onHand: available - quantity },
        });
        await tx.stockLevel.upsert({
          where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
          create: { tenantId, productId, warehouseId: toWarehouseId, onHand: targetBalance },
          update: { onHand: targetBalance },
        });

        await tx.stockMovement.createMany({
          data: [
            {
              tenantId,
              productId,
              warehouseId: fromWarehouseId,
              type: StockMoveType.TRANSFER_OUT,
              quantity,
              balanceAfter: available - quantity,
              referenceType: "TRANSFER",
              note: optionalString(formData, "note") ?? "Stock transfer out",
              createdById: auth.user.id,
            },
            {
              tenantId,
              productId,
              warehouseId: toWarehouseId,
              type: StockMoveType.TRANSFER_IN,
              quantity,
              balanceAfter: targetBalance,
              referenceType: "TRANSFER",
              note: optionalString(formData, "note") ?? "Stock transfer in",
              createdById: auth.user.id,
            },
          ],
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: product.id,
          entityLabel: product.sku,
          summary: `Stock transfer ${quantity} ${product.unit} between warehouses`,
        });
      });

      return ok("Stock transfer tercatat.");
    },
    PATHS,
  );
}

export async function setStockThreshold(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("inventory", "manage");
      const tenantId = auth.user.tenantId;
      const productId = requiredString(formData, "productId", "Produk");
      const threshold = numberField(formData, "minThreshold", Number.NaN);
      if (!Number.isFinite(threshold) || threshold < 0) return fail("Threshold tidak valid.");

      await prisma.$transaction(async (tx) => {
        const warehouseId = await resolveWarehouse(tx, tenantId, optionalString(formData, "warehouseId"));
        if (!warehouseId) throw new Error("Belum ada gudang aktif.");

        await tx.stockLevel.upsert({
          where: { productId_warehouseId: { productId, warehouseId } },
          create: { tenantId, productId, warehouseId, minThreshold: threshold },
          update: { minThreshold: threshold },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: productId,
          summary: `Stock threshold set to ${threshold}`,
        });
      });

      return ok("Threshold stok diperbarui.");
    },
    PATHS,
  );
}

export async function saveWarehouse(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const name = requiredString(formData, "name", "Nama gudang");
      const isDefault = booleanField(formData, "isDefault");

      await prisma.$transaction(async (tx) => {
        if (isDefault) {
          await tx.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } });
        }

        const existing = await tx.warehouse.findFirst({ where: { tenantId, name } });
        if (existing) {
          await tx.warehouse.update({
            where: { id: existing.id },
            data: {
              code: optionalString(formData, "code") ?? existing.code,
              address: optionalString(formData, "address") ?? existing.address,
              isActive: true,
              isDefault: isDefault || existing.isDefault,
            },
          });
        } else {
          await tx.warehouse.create({
            data: {
              tenantId,
              name,
              code: optionalString(formData, "code"),
              address: optionalString(formData, "address"),
              isDefault,
            },
          });
        }

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "CREATE",
          entityType: AttachmentEntity.OTHER,
          entityId: tenantId,
          entityLabel: name,
          summary: `Warehouse ${name} saved`,
        });
      });

      return ok("Gudang disimpan.");
    },
    ["/inventory", "/settings/workflow"],
  );
}

/** Enable/disable the inventory module for tenants that only do pure sourcing. */
export async function toggleInventoryModule(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const enabled = booleanField(formData, "enabled");

      await prisma.tenantModule.upsert({
        where: { tenantId_key: { tenantId, key: "INVENTORY" } },
        create: { tenantId, key: "INVENTORY", enabled },
        update: { enabled },
      });

      await logActivity(prisma, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "UPDATE",
        entityType: AttachmentEntity.OTHER,
        entityId: tenantId,
        summary: `Inventory module ${enabled ? "enabled" : "disabled"}`,
      });

      return ok(`Inventory module ${enabled ? "diaktifkan" : "dimatikan"}.`);
    },
    ["/inventory", "/settings/workflow"],
  );
}

/** Reservation for confirmed orders (Power tier) — kept separate from delivery stock-out. */
export async function reserveStockForProduct(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("inventory", "manage");
      const tenantId = auth.user.tenantId;
      const productId = requiredString(formData, "productId", "Produk");
      const quantity = numberField(formData, "quantity");
      if (quantity === 0) return fail("Qty reservasi tidak boleh 0.");

      await prisma.$transaction(async (tx) => {
        if (!(await inventoryEnabled(tx, tenantId))) {
          throw new Error("Modul Inventory belum aktif untuk tenant ini.");
        }

        const warehouseId = await resolveWarehouse(tx, tenantId, optionalString(formData, "warehouseId"));
        if (!warehouseId) throw new Error("Belum ada gudang aktif.");

        const level = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId } },
        });
        if (!level) throw new Error("Produk ini belum punya stok tercatat di gudang tersebut.");

        const nextReserved = Math.max(0, num(level.reserved) + quantity);
        const available = num(level.onHand) - nextReserved;
        if (available < 0) throw new Error("Reservasi melebihi stok tersedia.");

        await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: nextReserved } });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCT,
          entityId: productId,
          summary: `Reserved ${quantity} (available ${available})`,
        });
      });

      return ok("Reservasi stok diperbarui.");
    },
    PATHS,
  );
}
