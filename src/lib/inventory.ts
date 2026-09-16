import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ModuleKey, StockMoveType } from "@/generated/prisma/enums";
import { num, type MoneyLike } from "@/lib/money";

type Db = Prisma.TransactionClient;

export async function inventoryEnabled(db: Db, tenantId: string): Promise<boolean> {
  const module = await db.tenantModule.findUnique({
    where: { tenantId_key: { tenantId, key: ModuleKey.INVENTORY } },
  });
  return module?.enabled ?? false;
}

/** Picks the warehouse a movement should hit: explicit choice, else the default one. */
export async function resolveWarehouse(db: Db, tenantId: string, warehouseId?: string | null): Promise<string | null> {
  if (warehouseId) return warehouseId;
  const warehouse = await db.warehouse.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true },
  });
  return warehouse?.id ?? null;
}

async function applyLevelChange(
  db: Db,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    type: StockMoveType;
    quantity: number;
    balanceAfter?: number;
    referenceType: string;
    referenceId?: string | null;
    note?: string | null;
    createdById?: string | null;
    reserveDelta?: number;
  },
): Promise<number> {
  const level = await db.stockLevel.findUnique({
    where: { productId_warehouseId: { productId: params.productId, warehouseId: params.warehouseId } },
  });

  const onHandBase = level ? num(level.onHand) : 0;
  const nextOnHand =
    params.type === StockMoveType.IN || params.type === StockMoveType.TRANSFER_IN
      ? onHandBase + params.quantity
      : params.type === StockMoveType.OUT || params.type === StockMoveType.TRANSFER_OUT
        ? onHandBase - params.quantity
        : params.quantity;

  const reservedBase = level ? num(level.reserved) : 0;
  const nextReserved = level
    ? Math.max(0, reservedBase + (params.reserveDelta ?? 0))
    : Math.max(0, params.reserveDelta ?? 0);

  await db.stockLevel.upsert({
    where: { productId_warehouseId: { productId: params.productId, warehouseId: params.warehouseId } },
    create: {
      tenantId: params.tenantId,
      productId: params.productId,
      warehouseId: params.warehouseId,
      onHand: nextOnHand,
      reserved: nextReserved,
    },
    update: { onHand: nextOnHand, reserved: nextReserved },
  });

  await db.stockMovement.create({
    data: {
      tenantId: params.tenantId,
      productId: params.productId,
      warehouseId: params.warehouseId,
      type: params.type,
      quantity: params.quantity,
      balanceAfter: params.balanceAfter ?? nextOnHand,
      referenceType: params.referenceType,
      referenceId: params.referenceId ?? null,
      note: params.note ?? null,
      createdById: params.createdById ?? null,
    },
  });

  return nextOnHand;
}

export async function recordStockIn(
  db: Db,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    quantity: number;
    referenceType: string;
    referenceId?: string | null;
    note?: string | null;
    createdById?: string | null;
  },
): Promise<void> {
  await applyLevelChange(db, { ...params, type: StockMoveType.IN });
}

export async function recordStockOut(
  db: Db,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    quantity: number;
    referenceType: string;
    referenceId?: string | null;
    note?: string | null;
    createdById?: string | null;
  },
): Promise<void> {
  await applyLevelChange(db, { ...params, type: StockMoveType.OUT });
}

export async function adjustStock(
  db: Db,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    countedQuantity: number;
    note?: string | null;
    createdById?: string | null;
  },
): Promise<{ previous: number; counted: number }> {
  const level = await db.stockLevel.findUnique({
    where: { productId_warehouseId: { productId: params.productId, warehouseId: params.warehouseId } },
  });
  const previous = level ? num(level.onHand) : 0;

  await applyLevelChange(db, {
    tenantId: params.tenantId,
    productId: params.productId,
    warehouseId: params.warehouseId,
    type: StockMoveType.ADJUSTMENT,
    quantity: params.countedQuantity,
    balanceAfter: params.countedQuantity,
    referenceType: "ADJUSTMENT",
    note: params.note ?? "Stock adjustment",
    createdById: params.createdById,
  });

  return { previous, counted: params.countedQuantity };
}

/** Reserves stock for each order line so confirmed orders cannot be double-sold. */
export async function reserveStockForOrder(
  db: Db,
  params: {
    tenantId: string;
    warehouseId: string | null;
    items: { productId: string | null; quantity: MoneyLike }[];
  },
): Promise<void> {
  if (!params.warehouseId) return;

  for (const item of params.items) {
    if (!item.productId) continue;
    const level = await db.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: params.warehouseId } },
    });
    if (!level) continue;

    await db.stockLevel.update({
      where: { id: level.id },
      data: { reserved: { increment: num(item.quantity) } },
    });
  }
}
