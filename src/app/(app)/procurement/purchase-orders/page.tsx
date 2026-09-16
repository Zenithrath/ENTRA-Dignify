import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { PoStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { enumOptions } from "@/lib/status";
import { formatDate, pagination, readParams, supplierOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "supplier", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusList = (params.status ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => Object.values(PoStatus).includes(value as PoStatus)) as PoStatus[];

  const where = {
    tenantId,
    ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    ...(params.supplier ? { supplierId: params.supplier } : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { supplier: { name: { contains: params.q, mode: "insensitive" as const } } },
            { order: { number: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, purchaseOrders, suppliers] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { poDate: "desc" },
      skip,
      take,
      include: {
        supplier: { select: { id: true, name: true } },
        order: { select: { id: true, number: true } },
        items: { select: { quantity: true, receivedQty: true } },
        _count: { select: { receipts: true } },
      },
    }),
    supplierOptions(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="PO ke supplier beserta status pengiriman, penerimaan, dan approval."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Purchase orders" }]}
      />

      <Card>
        <FilterBar action="/procurement/purchase-orders">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="PO, supplier, order" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-48">
              <option value="">All statuses</option>
              <option value="SENT,CONFIRMED,PARTIAL_RECEIVED">Open</option>
              <option value="PENDING_APPROVAL">Waiting approval</option>
              {enumOptions(PoStatus).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Supplier">
            <Select name="supplier" defaultValue={params.supplier ?? ""} className="h-9 w-52">
              <option value="">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={purchaseOrders}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "PO",
              render: (row) => (
                <div>
                  <Link
                    href={`/procurement/purchase-orders/${row.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">{formatDate(row.poDate)}</p>
                </div>
              ),
            },
            {
              key: "supplier",
              header: "Supplier",
              render: (row) => (
                <Link href={`/suppliers/${row.supplier.id}`} className="text-sm hover:underline">
                  {row.supplier.name}
                </Link>
              ),
            },
            {
              key: "order",
              header: "Order",
              render: (row) =>
                row.order ? (
                  <Link href={`/orders/${row.order.id}`} className="text-sm text-indigo-600 hover:underline">
                    {row.order.number}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                ),
            },
            {
              key: "receiving",
              header: "Receiving",
              render: (row) => {
                const totalQty = row.items.reduce((sum, item) => sum + num(item.quantity), 0);
                const received = row.items.reduce((sum, item) => sum + num(item.receivedQty), 0);
                const percent = totalQty > 0 ? Math.round((received / totalQty) * 100) : 0;
                return (
                  <div className="min-w-[110px]">
                    <p className="text-xs text-slate-600">
                      {qty(received)}/{qty(totalQty)} ({percent}%)
                    </p>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              },
            },
            {
              key: "expected",
              header: "Expected",
              render: (row) => {
                const late = row.expectedDate && row.expectedDate < new Date() && !["RECEIVED", "CANCELLED"].includes(row.status);
                return (
                  <span className={`text-sm ${late ? "font-medium text-rose-600" : "text-slate-600"}`}>
                    {formatDate(row.expectedDate)}
                  </span>
                );
              },
            },
            { key: "value", header: "Value", render: (row) => <span className="text-sm font-medium">{money(row.grandTotal)}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          ]}
        />

        <Pagination
          path="/procurement/purchase-orders"
          params={params}
          page={page}
          totalPages={totalPages(total)}
          total={total}
        />
      </Card>
    </>
  );
}
