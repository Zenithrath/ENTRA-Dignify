import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DataTable } from "@/components/ui/table";
import { LineType } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { money, num, percent } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import { enumOptions } from "@/lib/status";
import { pagination, readParams } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "products")) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-600">Role Anda tidak punya akses ke modul Products.</CardBody>
      </Card>
    );
  }

  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "type", "category", "archived", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const type = Object.values(LineType).includes(params.type as LineType) ? (params.type as LineType) : undefined;

  const where = {
    tenantId,
    deletedAt: null,
    ...(params.archived === "yes" ? {} : { isActive: true }),
    ...(type ? { type } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" as const } },
            { sku: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, products, categories, allProducts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      skip,
      take,
      include: {
        defaultSupplier: { select: { id: true, name: true } },
        units: { select: { id: true } },
        stockLevels: { select: { onHand: true, reserved: true, minThreshold: true } },
      },
    }),
    prisma.product.findMany({
      where: { tenantId, deletedAt: null, category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    prisma.product.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { isInventoryTracked: true, costPrice: true, sellingPrice: true, stockLevels: { select: { onHand: true } } },
    }),
  ]);

  const stockValueTotal = allProducts.reduce(
    (totalValue, product) =>
      totalValue + product.stockLevels.reduce((sum, level) => sum + num(level.onHand) * num(product.costPrice), 0),
    0,
  );
  const trackedCount = allProducts.filter((product) => product.isInventoryTracked).length;
  const avgMargin =
    allProducts.length > 0
      ? allProducts.reduce((sum, product) => {
          const cost = num(product.costPrice);
          const sell = num(product.sellingPrice);
          return sum + (sell > 0 ? ((sell - cost) / sell) * 100 : 0);
        }, 0) / allProducts.length
      : 0;

  return (
    <>
      <PageHeader
        title="Products & services"
        description="Master data barang, jasa, labor, dan paket beserta harga dan satuan."
        actions={
          canManage(auth.user.role, "products") ? (
            <Link href="/products/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New product
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Produk aktif" value={total} hint={`${categories.length} kategori`} tone="info" />
        <MetricCard label="Inventory-tracked" value={trackedCount} hint="Sisanya jasa/labor tanpa stok" />
        <MetricCard
          label="Nilai stok (cost)"
          value={money(stockValueTotal)}
          hint={`Rata-rata margin jual ${percent(avgMargin)}`}
          tone="accent"
        />
      </div>

      <Card>
        <FilterBar action="/products">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Nama atau SKU" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Tipe">
            <Select name="type" defaultValue={params.type ?? ""} className="h-9 w-40">
              <option value="">Semua tipe</option>
              {enumOptions(LineType).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Kategori">
            <Select name="category" defaultValue={params.category ?? ""} className="h-9 w-44">
              <option value="">Semua kategori</option>
              {categories.map((item) => (
                <option key={item.category} value={item.category ?? ""}>
                  {item.category}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Arsip">
            <Select name="archived" defaultValue={params.archived ?? ""} className="h-9 w-40">
              <option value="">Hanya aktif</option>
              <option value="yes">Termasuk arsip</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={products}
          rowKey={(row) => row.id}
          empty={<p className="px-5 py-6 text-sm text-slate-500">Belum ada produk pada filter ini.</p>}
          columns={[
            {
              key: "name",
              header: "Produk",
              render: (row) => (
                <div>
                  <Link href={`/products/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {row.sku}
                    {row.category ? ` · ${row.category}` : ""}
                    {row.units.length > 0 ? ` · ${row.units.length} satuan tambahan` : ""}
                  </p>
                </div>
              ),
            },
            { key: "type", header: "Tipe", render: (row) => <span className="text-sm">{row.type}</span> },
            {
              key: "supplier",
              header: "Supplier default",
              render: (row) =>
                row.defaultSupplier ? (
                  <Link href={`/suppliers/${row.defaultSupplier.id}`} className="text-sm text-indigo-600 hover:underline">
                    {row.defaultSupplier.name}
                  </Link>
                ) : (
                  <span className="text-sm text-slate-400">—</span>
                ),
            },
            { key: "cost", header: "Harga beli", render: (row) => <span className="text-sm tabular-nums">{money(row.costPrice)}</span> },
            { key: "sell", header: "Harga jual", render: (row) => <span className="text-sm tabular-nums">{money(row.sellingPrice)}</span> },
            {
              key: "margin",
              header: "Margin",
              render: (row) => {
                const cost = num(row.costPrice);
                const sell = num(row.sellingPrice);
                const margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0;
                return (
                  <span className={margin < 0 ? "text-sm tabular-nums text-rose-600" : "text-sm tabular-nums text-emerald-700"}>
                    {percent(margin)}
                  </span>
                );
              },
            },
            {
              key: "stock",
              header: "Stok",
              render: (row) => {
                if (!row.isInventoryTracked) return <span className="text-xs text-slate-400">tidak dilacak</span>;
                const onHand = row.stockLevels.reduce((sum, level) => sum + num(level.onHand), 0);
                const reserved = row.stockLevels.reduce((sum, level) => sum + num(level.reserved), 0);
                const threshold = Math.max(num(row.reorderPoint), ...row.stockLevels.map((level) => num(level.minThreshold)));
                const low = threshold > 0 && onHand - reserved <= threshold;

                return (
                  <div>
                    <p className={low ? "text-sm font-medium tabular-nums text-rose-600" : "text-sm tabular-nums"}>
                      {onHand} {row.unit}
                    </p>
                    <p className="text-xs text-slate-500">
                      available {(onHand - reserved).toFixed(2)} · min {threshold}
                    </p>
                  </div>
                );
              },
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.isActive ? "ACTIVE" : "ARCHIVED"} /> },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <Link href={`/products/${row.id}`} className={buttonClass("ghost", "sm")}>
                  Detail
                </Link>
              ),
            },
          ]}
        />

        <Pagination path="/products" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
