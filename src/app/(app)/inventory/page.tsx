import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { MetricCard } from "@/components/metric-card";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import {
  recordManualMovement,
  recordStockAdjustment,
  reserveStockForProduct,
  saveWarehouse,
  toggleInventoryModule,
  transferStock,
} from "@/lib/actions/inventory-actions";
import { formatDateTime, productOptions, readParams, tenantModules, warehouseOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "inventory")) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-600">Role Anda tidak punya akses ke modul Inventory.</CardBody>
      </Card>
    );
  }

  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "warehouse", "low"]);
  const modules = await tenantModules(tenantId);
  const enabled = modules.get("INVENTORY") ?? false;
  const canStock = canManage(auth.user.role, "inventory");
  const canConfigure = canManage(auth.user.role, "settings");

  const [warehouses, products] = await Promise.all([warehouseOptions(tenantId), productOptions(tenantId)]);

  const where = {
    tenantId,
    product: { deletedAt: null, ...(params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" as const } }, { sku: { contains: params.q, mode: "insensitive" as const } }] } : {}) },
    ...(params.warehouse ? { warehouseId: params.warehouse } : {}),
  };

  const [levels, movements] = await Promise.all([
    prisma.stockLevel.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, costPrice: true, reorderPoint: true, isInventoryTracked: true } },
        warehouse: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { tenantId, ...(params.warehouse ? { warehouseId: params.warehouse } : {}) },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { name: true } },
      },
    }),
  ]);

  const rows = params.low === "yes"
    ? levels.filter((level) => {
        const threshold = Math.max(num(level.minThreshold), num(level.product.reorderPoint));
        return threshold > 0 && num(level.onHand) - num(level.reserved) <= threshold;
      })
    : levels;

  const stockValue = levels.reduce((sum, level) => sum + num(level.onHand) * num(level.product.costPrice), 0);
  const lowCount = levels.filter((level) => {
    const threshold = Math.max(num(level.minThreshold), num(level.product.reorderPoint));
    return threshold > 0 && num(level.onHand) - num(level.reserved) <= threshold;
  }).length;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stok per gudang, pergerakan, adjustment, dan alert low stock."
        actions={
          <Link href="/products" className={buttonClass("secondary")}>
            Master produk
          </Link>
        }
      />

      {!enabled ? (
        <Card>
          <CardHeader
            title="Modul Inventory belum aktif"
            description="Tenant pure sourcing tanpa stok bisa membiarkan modul ini mati. Aktifkan untuk mulai melacak stok."
          />
          <CardBody>
            {canConfigure ? (
              <ActionForm action={toggleInventoryModule}>
                <input type="hidden" name="enabled" value="true" />
                <SubmitButton>Aktifkan inventory</SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-xs text-slate-500">Hanya Owner yang bisa mengaktifkan modul ini dari Settings → Workflow.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Nilai stok (cost)" value={money(stockValue)} hint={`${levels.length} baris stok`} tone="accent" />
        <MetricCard
          label="Low stock"
          value={lowCount}
          hint="Available ≤ threshold"
          tone={lowCount > 0 ? "danger" : "success"}
          href="/inventory?low=yes"
        />
        <MetricCard label="Gudang aktif" value={warehouses.length} hint="Termasuk gudang default" />
        <MetricCard label="Produk terlacak" value={products.filter((product) => product.type === "PRODUCT").length} hint="Tipe Product" />
      </div>

      <Card>
        <CardHeader title="Stok per produk & gudang" description="Available = on hand − reserved." />
        <FilterBar action="/inventory">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Nama atau SKU" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Gudang">
            <Select name="warehouse" defaultValue={params.warehouse ?? ""} className="h-9 w-48">
              <option value="">Semua gudang</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Filter">
            <Select name="low" defaultValue={params.low ?? ""} className="h-9 w-40">
              <option value="">Semua stok</option>
              <option value="yes">Hanya low stock</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={<EmptyState title="Belum ada stok" description="Stok bertambah dari penerimaan PO atau stock adjustment." />}
          columns={[
            {
              key: "product",
              header: "Produk",
              render: (row) => (
                <div>
                  <Link href={`/products/${row.product.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.product.name}
                  </Link>
                  <p className="text-xs text-slate-500">{row.product.sku}</p>
                </div>
              ),
            },
            { key: "warehouse", header: "Gudang", render: (row) => <span className="text-sm">{row.warehouse.name}</span> },
            { key: "onHand", header: "On hand", render: (row) => <span className="text-sm tabular-nums">{qty(row.onHand)}</span> },
            { key: "reserved", header: "Reserved", render: (row) => <span className="text-sm tabular-nums">{qty(row.reserved)}</span> },
            {
              key: "available",
              header: "Available",
              render: (row) => {
                const available = num(row.onHand) - num(row.reserved);
                const threshold = Math.max(num(row.minThreshold), num(row.product.reorderPoint));
                const low = threshold > 0 && available <= threshold;
                return (
                  <span className={low ? "text-sm font-medium tabular-nums text-rose-600" : "text-sm tabular-nums"}>
                    {qty(available)} {row.product.unit}
                    {low ? <span className="ml-2 text-[11px] uppercase">low</span> : null}
                  </span>
                );
              },
            },
            {
              key: "threshold",
              header: "Threshold",
              render: (row) => (
                <span className="text-sm tabular-nums">{qty(Math.max(num(row.minThreshold), num(row.product.reorderPoint)))}</span>
              ),
            },
            {
              key: "value",
              header: "Nilai",
              render: (row) => <span className="text-sm tabular-nums">{money(num(row.onHand) * num(row.product.costPrice))}</span>,
            },
            { key: "updated", header: "Update", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.updatedAt)}</span> },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Pergerakan stok terbaru" description="25 pergerakan terakhir." />
            <DataTable
              rows={movements}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada pergerakan" />}
              columns={[
                { key: "date", header: "Waktu", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</span> },
                {
                  key: "product",
                  header: "Produk",
                  render: (row) => (
                    <Link href={`/products/${row.product.id}`} className="text-sm text-indigo-600 hover:underline">
                      {row.product.name}
                    </Link>
                  ),
                },
                { key: "type", header: "Tipe", render: (row) => <span className="text-sm">{row.type}</span> },
                { key: "warehouse", header: "Gudang", render: (row) => <span className="text-sm">{row.warehouse.name}</span> },
                {
                  key: "qty",
                  header: "Qty",
                  render: (row) => (
                    <span className="text-sm tabular-nums">
                      {qty(row.quantity)} {row.product.unit}
                    </span>
                  ),
                },
                { key: "balance", header: "Saldo", render: (row) => <span className="text-sm tabular-nums">{qty(row.balanceAfter)}</span> },
                {
                  key: "ref",
                  header: "Referensi",
                  render: (row) => (
                    <span className="text-xs text-slate-500">
                      {row.referenceType ?? "—"}
                      {row.referenceId ? ` · ${row.referenceId}` : ""}
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          {canStock && warehouses.length > 0 && products.length > 0 ? (
            <Card>
              <CardHeader title="Cepat: adjustment & pergerakan" description="Tanpa membuka halaman produk." />
              <CardBody className="space-y-5">
                <FormShell action={recordStockAdjustment} submitLabel="Simpan adjustment" size="sm">
                  <FormGrid columns={4}>
                    <Field label="Produk">
                      <Select name="productId" defaultValue="">
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} — {product.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Gudang">
                      <Select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Qty hitung fisik">
                      <Input name="countedQuantity" type="number" step="0.01" required />
                    </Field>
                    <Field label="Catatan">
                      <Input name="note" />
                    </Field>
                  </FormGrid>
                </FormShell>

                <div className="border-t border-slate-100 pt-4">
                  <FormShell action={recordManualMovement} submitLabel="Catat pergerakan" size="sm" variant="secondary">
                    <FormGrid columns={4}>
                      <Field label="Produk">
                        <Select name="productId" defaultValue="">
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.sku} — {product.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Gudang">
                        <Select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                          {warehouses.map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Arah">
                        <Select name="direction" defaultValue="IN">
                          <option value="IN">Masuk</option>
                          <option value="OUT">Keluar</option>
                        </Select>
                      </Field>
                      <Field label="Qty">
                        <Input name="quantity" type="number" step="0.01" required />
                      </Field>
                    </FormGrid>
                  </FormShell>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Reservasi stok (tier Power)</p>
                  <FormShell action={reserveStockForProduct} submitLabel="Simpan reservasi" size="sm" variant="secondary">
                    <FormGrid columns={4}>
                      <Field label="Produk">
                        <Select name="productId" defaultValue="">
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.sku} — {product.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Gudang">
                        <Select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                          {warehouses.map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Qty" hint="Minus untuk melepas reservasi">
                        <Input name="quantity" type="number" step="0.01" required />
                      </Field>
                    </FormGrid>
                  </FormShell>
                </div>

                {warehouses.length > 1 ? (
                  <div className="border-t border-slate-100 pt-4">
                    <FormShell action={transferStock} submitLabel="Transfer" size="sm" variant="secondary">
                      <FormGrid columns={4}>
                        <Field label="Produk">
                          <Select name="productId" defaultValue="">
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.sku} — {product.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Dari">
                          <Select name="fromWarehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Ke">
                          <Select name="toWarehouseId" defaultValue={warehouses[1]?.id ?? ""}>
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Qty">
                          <Input name="quantity" type="number" step="0.01" required />
                        </Field>
                      </FormGrid>
                    </FormShell>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Gudang" description="Lokasi penyimpanan dan gudang default." />
            <DataTable
              rows={warehouses}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada gudang" description="Tambahkan minimal satu gudang untuk melacak stok." />}
              columns={[
                {
                  key: "name",
                  header: "Gudang",
                  render: (row) => (
                    <span className="text-sm">
                      {row.name}
                      {row.isDefault ? <span className="ml-2 text-[11px] uppercase text-indigo-600">default</span> : null}
                    </span>
                  ),
                },
              ]}
            />
            {canConfigure ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={saveWarehouse} submitLabel="Simpan gudang" size="sm">
                  <FormGrid columns={2}>
                    <Field label="Nama gudang" required>
                      <Input name="name" required />
                    </Field>
                    <Field label="Kode">
                      <Input name="code" />
                    </Field>
                    <Field label="Alamat" className="sm:col-span-2">
                      <Input name="address" />
                    </Field>
                  </FormGrid>
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="isDefault" className="h-4 w-4 rounded border-slate-300" />
                    Jadikan gudang default
                  </label>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>

          {canConfigure && enabled ? (
            <Card>
              <CardHeader title="Modul inventory" description="Matikan bila bisnis tidak menyimpan stok." />
              <CardBody>
                <ActionForm action={toggleInventoryModule}>
                  <input type="hidden" name="enabled" value="false" />
                  <SubmitButton variant="ghost">Matikan inventory</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
