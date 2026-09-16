import { cache } from "react";

import { prisma } from "@/lib/prisma";

export const PER_PAGE = 25;

export function readParams(
  searchParams: Record<string, string | string[] | undefined>,
  keys: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams[key];
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }
  return result;
}

export function pagination(searchParams: Record<string, string | undefined>) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  return {
    page,
    perPage: PER_PAGE,
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
    totalPages: (total: number) => Math.max(1, Math.ceil(total / PER_PAGE)),
  };
}

export type Actor = { id: string; name: string; role: string; email: string };

/** Tenant users are few, so one cached fetch per request is cheaper than joins everywhere. */
export const tenantUsers = cache(async (tenantId: string): Promise<Actor[]> => {
  const users = await prisma.user.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, email: true },
  });
  return users;
});

export function actorName(users: Actor[], id: string | null | undefined): string {
  if (!id) return "—";
  return users.find((user) => user.id === id)?.name ?? "—";
}

export function actorMap(users: Actor[]): Map<string, string> {
  return new Map(users.map((user) => [user.id, user.name]));
}

export const customerOptions = cache(async (tenantId: string) =>
  prisma.customer.findMany({
    where: { tenantId, deletedAt: null, status: "ACTIVE" },
    orderBy: { companyName: "asc" },
    select: { id: true, companyName: true, paymentTerms: true },
  }),
);

export const supplierOptions = cache(async (tenantId: string) =>
  prisma.supplier.findMany({
    where: { tenantId, deletedAt: null, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true, leadTimeDays: true },
  }),
);

export const productOptions = cache(async (tenantId: string) =>
  prisma.product.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      unit: true,
      type: true,
      costPrice: true,
      sellingPrice: true,
      taxRate: true,
      defaultSupplierId: true,
    },
  }),
);

export const warehouseOptions = cache(async (tenantId: string) =>
  prisma.warehouse.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  }),
);

export function tenantModuleEnabled(tenantId: string, key: string): Promise<boolean> {
  return prisma.tenantModule
    .findUnique({ where: { tenantId_key: { tenantId, key: key as never } } })
    .then((module) => module?.enabled ?? false);
}

export async function tenantModules(tenantId: string) {
  const modules = await prisma.tenantModule.findMany({ where: { tenantId } });
  return new Map(modules.map((module) => [module.key, module.enabled]));
}

export function formatDate(value: Date | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  return value.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return value.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDays(value: Date | null | undefined): number | null {
  if (!value) return null;
  return Math.floor((Date.now() - value.getTime()) / 86_400_000);
}

export function toDateInput(value: Date | null | undefined): string {
  if (!value) return "";
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
