import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { FormShell } from "@/components/form-shell";
import { MetricCard } from "@/components/metric-card";
import { ProductForm } from "@/components/products/product-form";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { AttachmentEntity } from "@/generated/prisma/enums";
import {
  archiveProduct,
  deleteCustomerPrice,
  deleteProductUnit,
  saveCustomerPrice,
  saveProductUnit,
  updateProduct,
} from "@/lib/actions/product-actions";
import { recordManualMovement, recordStockAdjustment, transferStock } from "@/lib/actions/inventory-actions";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import { titleize } from "@/lib/status";
import { customerOptions, formatDateTime, supplierOptions, warehouseOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Product" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "products")) notFound();

  const tenantId = auth.user.tenantId;
  const { id } = await params;

  const product = await prisma.product.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      defaultSupplier: { select: { id: true, name: true } },
      units: { orderBy: { unitName: "asc" } },
      customerPrices: { include: { customer: { select: { id: true, companyName: true } } }, orderBy: { minQty: "asc" } },
      stockLevels: { include: { warehouse: { select: { id: true, name: true } } }, orderBy: { warehouseId: "asc" } },
    },
  });
  if (!product) notFound();

  const [suppliers, customers, warehouses, attachments, movements, totals] = await Promise.all([
    supplierOptions(tenantId),
    customerOptions(tenantId),
    warehouseOptions(tenantId),
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.PRODUCT, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stockMovement.findMany({
      where: { tenantId, productId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { warehouse: { select: { name: true } } },
    }),
    prisma.stockMovement.groupBy({
      by: ["type"],
      where: { tenantId, productId: id },
      _sum: { quantity: true },
    }),
  ]);

  const canEdit = canManage(auth.user.role, "products");
  const canStock = canManage(auth.user.role, "inventory");
  const onHand = product.stockLevels.reduce((sum, level) => sum + num(level.onHand), 0);
  const reserved = product.stockLevels.reduce((sum, level) => sum + num(level.reserved), 0);
  const threshold = Math.max(num(product.reorderPoint), ...product.stockLevels.map((level) => num(level.minThreshold)), 0);
  const stockValue = onHand * num(product.costPrice);
  const totalIn = num(totals.find((row) => row.type === "IN")?._sum.quantity);
  const totalOut = num(totals.find((row) => row.type === "OUT")?._sum.quantity);
  const margin = num(product.sellingPrice) > 0 ? ((num(product.sellingPrice) - num(product.costPrice)) / num(product.sellingPrice)) * 100 : 0;

  const update = updateProduct.bind(null, product.id);
  const archive = archiveProduct.bind(null, product.id);
  const saveCustomerPriceAction = saveCustomerPrice.bind(null, product.id);
  const saveUnit = saveProductUnit.bind(null, product.id);

  return (
    <>
      <PageHeader
        title={`${product.name} — ${product.sku}`}
        breadcrumbs={[{ label: "Products", href: "/products" }, { label: product.sku }]}
        description={`${titleize(product.type)}${product.category ? ` · ${product.category}` : ""}${
          product.defaultSupplier ? ` · default supplier ${product.defaultSupplier.name}` : ""
        }`}
        actions={
          <>
            <StatusBadge value={product.isActive ? "ACTIVE" : "ARCHIVED"} className="mr-2" />
            {canEdit ? (
              <ActionForm action={archive} className="inline-block">
                <input type="hidden" name="restore" value={product.isActive ? "false" : "true"} />
                <SubmitButton variant="secondary">{product.isActive ? "Archive" : "Restore"}</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Harga jual" value={money(product.sellingPrice)} hint={`Margin ${margin.toFixed(1)}%`} tone="accent" />
        <MetricCard label="Harga beli" value={money(product.costPrice)} hint={`Pajak ${num(product.taxRate)}%`} />
        <MetricCard
          label="On hand"
          value={`${qty(onHand)} ${product.unit}`}
          hint={`Available ${qty(onHand - reserved)} · reserved ${qty(reserved)}`}
          tone={threshold > 0 && onHand - reserved <= threshold ? "danger" : "success"}
        />
        <MetricCard label="Nilai stok" value={money(stockValue)} hint={`Reorder point ${qty(threshold)}`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {canEdit ? (
            <ProductForm
              action={update}
              suppliers={suppliers}
              submitLabel="Save changes"
              defaults={{
                sku: product.sku,
                name: product.name,
                description: product.description,
                type: product.type,
                category: product.category,
                unit: product.unit,
                costPrice: num(product.costPrice),
                sellingPrice: num(product.sellingPrice),
                taxRate: num(product.taxRate),
                defaultSupplierId: product.defaultSupplierId,
                isInventoryTracked: product.isInventoryTracked,
                reorderPoint: num(product.reorderPoint),
              }}
            />
          ) : (
            <Card>
              <CardHeader title="Detail produk" />
              <CardBody className="space-y-1 text-sm text-slate-700">
                <p>{product.description ?? "Tanpa deskripsi."}</p>
                <p className="text-xs text-slate-500">
                  Satuan dasar {product.unit} · {product.isInventoryTracked ? "stok dilacak" : "stok tidak dilacak"}
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Stok per gudang" description="On hand, reserved, dan threshold per lokasi." />
            <DataTable
              rows={product.stockLevels}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="Belum ada stok tercatat"
                  description="Stok bertambah otomatis dari penerimaan PO, atau lewat stock adjustment."
                />
              }
              columns={[
                { key: "warehouse", header: "Gudang", render: (row) => <span className="text-sm">{row.warehouse.name}</span> },
                { key: "onHand", header: "On hand", render: (row) => <span className="text-sm tabular-nums">{qty(row.onHand)}</span> },
                { key: "reserved", header: "Reserved", render: (row) => <span className="text-sm tabular-nums">{qty(row.reserved)}</span> },
                {
                  key: "available",
                  header: "Available",
                  render: (row) => {
                    const available = num(row.onHand) - num(row.reserved);
                    const low = num(row.minThreshold) > 0 && available <= num(row.minThreshold);
                    return (
                      <span className={low ? "text-sm font-medium tabular-nums text-rose-600" : "text-sm tabular-nums"}>
                        {qty(available)}
                      </span>
                    );
                  },
                },
                { key: "min", header: "Threshold", render: (row) => <span className="text-sm tabular-nums">{qty(row.minThreshold)}</span> },
                { key: "updated", header: "Update", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.updatedAt)}</span> },
              ]}
            />

            {canStock ? (
              <CardBody className="space-y-5 border-t border-slate-100">
                <div>
                  <p className="mb-3 text-xs font-medium text-slate-600">Stock adjustment (hasil hitung fisik)</p>
                  <FormShell action={recordStockAdjustment} submitLabel="Simpan adjustment" size="sm">
                    <input type="hidden" name="productId" value={product.id} />
                    <FormGrid columns={3}>
                      <Field label="Gudang">
                        <Select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                          {warehouses.map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Qty hasil hitung">
                        <Input name="countedQuantity" type="number" step="0.01" defaultValue={onHand} required />
                      </Field>
                      <Field label="Catatan">
                        <Input name="note" placeholder="cth. selisih opname" />
                      </Field>
                    </FormGrid>
                  </FormShell>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-3 text-xs font-medium text-slate-600">Stock in / out manual</p>
                  <FormShell action={recordManualMovement} submitLabel="Catat pergerakan" size="sm" variant="secondary">
                    <input type="hidden" name="productId" value={product.id} />
                    <FormGrid columns={4}>
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
                      <Field label="Catatan">
                        <Input name="note" placeholder="cth. sample / rusak di gudang" />
                      </Field>
                    </FormGrid>
                  </FormShell>
                </div>

                {warehouses.length > 1 ? (
                  <div className="border-t border-slate-100 pt-4">
                    <p className="mb-3 text-xs font-medium text-slate-600">Transfer antar gudang</p>
                    <FormShell action={transferStock} submitLabel="Transfer stok" size="sm" variant="secondary">
                      <input type="hidden" name="productId" value={product.id} />
                      <FormGrid columns={4}>
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
                        <Field label="Catatan">
                          <Input name="note" />
                        </Field>
                      </FormGrid>
                    </FormShell>
                  </div>
                ) : null}
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Kartu stok" description="25 pergerakan terakhir." />
            <DataTable
              rows={movements}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada pergerakan stok" />}
              columns={[
                { key: "date", header: "Waktu", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</span> },
                { key: "type", header: "Tipe", render: (row) => <span className="text-sm">{row.type}</span> },
                { key: "warehouse", header: "Gudang", render: (row) => <span className="text-sm">{row.warehouse.name}</span> },
                { key: "qty", header: "Qty", render: (row) => <span className="text-sm tabular-nums">{qty(row.quantity)}</span> },
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
                { key: "note", header: "Catatan", render: (row) => <span className="text-xs text-slate-500">{row.note ?? "—"}</span> },
              ]}
            />
            <CardBody className="border-t border-slate-100 text-xs text-slate-500">
              Total masuk {qty(totalIn)} · total keluar {qty(totalOut)} {product.unit}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Harga khusus customer"
              description="Dipakai otomatis saat membuat quotation untuk customer tersebut."
            />
            <DataTable
              rows={product.customerPrices}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada harga khusus" description="Harga default produk berlaku untuk semua customer." />}
              columns={[
                {
                  key: "customer",
                  header: "Customer",
                  render: (row) => (
                    <Link href={`/customers/${row.customer.id}`} className="text-sm text-indigo-600 hover:underline">
                      {row.customer.companyName}
                    </Link>
                  ),
                },
                { key: "minQty", header: "Min qty", render: (row) => <span className="text-sm tabular-nums">{qty(row.minQty)}</span> },
                { key: "price", header: "Harga", render: (row) => <span className="text-sm tabular-nums">{money(row.price)}</span> },
                {
                  key: "actions",
                  header: "",
                  render: (row) =>
                    canEdit ? (
                      <ActionForm action={deleteCustomerPrice.bind(null, row.id, product.id)}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          Hapus
                        </SubmitButton>
                      </ActionForm>
                    ) : null,
                },
              ]}
            />
            {canEdit ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={saveCustomerPriceAction} submitLabel="Simpan harga" size="sm">
                  <FormGrid columns={4}>
                    <Field label="Customer">
                      <Select name="customerId" defaultValue="">
                        <option value="">Pilih customer…</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.companyName}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Min qty">
                      <Input name="minQuantity" type="number" step="0.01" defaultValue="1" />
                    </Field>
                    <Field label="Harga">
                      <Input name="price" type="number" step="0.01" required />
                    </Field>
                    <Field label="Catatan">
                      <Input name="note" />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>

          <AttachmentPanel
            entityType={AttachmentEntity.PRODUCT}
            entityId={product.id}
            attachments={attachments}
            canEdit={canEdit}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Multi-satuan" description="Beli per dus, jual per pcs — konversi otomatis." />
            <DataTable
              rows={product.units}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Hanya satuan dasar" description={`Satuan dasar produk ini: ${product.unit}`} />}
              columns={[
                { key: "unit", header: "Satuan", render: (row) => <span className="text-sm">{row.unitName}</span> },
                { key: "factor", header: "Konversi", render: (row) => <span className="text-sm tabular-nums">×{qty(row.conversionFactor)}</span> },
                {
                  key: "price",
                  header: "Harga jual",
                  render: (row) => <span className="text-sm tabular-nums">{row.sellingPrice ? money(row.sellingPrice) : "—"}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  render: (row) =>
                    canEdit ? (
                      <ActionForm action={deleteProductUnit.bind(null, row.id, product.id)}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          Hapus
                        </SubmitButton>
                      </ActionForm>
                    ) : null,
                },
              ]}
            />
            {canEdit ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={saveUnit} submitLabel="Tambah satuan" size="sm" variant="secondary">
                  <FormGrid columns={2}>
                    <Field label="Nama satuan">
                      <Input name="name" placeholder="cth. dus" required />
                    </Field>
                    <Field label="Isi per satuan">
                      <Input name="conversionFactor" type="number" step="0.01" defaultValue="12" required />
                    </Field>
                    <Field label="Harga jual (opsional)">
                      <Input name="price" type="number" step="0.01" />
                    </Field>
                    <Field label="Harga beli (opsional)">
                      <Input name="costPrice" type="number" step="0.01" />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Ringkasan" />
            <CardBody className="space-y-3 text-sm text-slate-700">
              <p>
                Supplier default:{" "}
                {product.defaultSupplier ? (
                  <Link href={`/suppliers/${product.defaultSupplier.id}`} className="text-indigo-600 hover:underline">
                    {product.defaultSupplier.name}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <p>Dibuat: {formatDateTime(product.createdAt)}</p>
              <p>Update terakhir: {formatDateTime(product.updatedAt)}</p>
              <p className="text-xs text-slate-500">
                Ubah harga jual di sini hanya memengaruhi dokumen baru; quotation dan order lama tetap memakai harga saat
                dibuat.
              </p>
              <Link href={`/inventory?q=${product.sku}`} className={buttonClass("ghost", "sm")}>
                Buka di Inventory
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
