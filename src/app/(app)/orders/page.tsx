import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { OrderStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { money, num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { enumOptions } from "@/lib/status";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "customer", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusList = (params.status ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => Object.values(OrderStatus).includes(value as OrderStatus)) as OrderStatus[];

  const where = {
    tenantId,
    ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    ...(params.customer ? { customerId: params.customer } : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { customerPoNumber: { contains: params.q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, orders, customers] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true } },
        items: { select: { quantity: true, deliveredQty: true, fulfilledQty: true } },
        _count: { select: { purchaseOrders: true, invoices: true, deliveryOrders: true } },
      },
    }),
    customerOptions(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Order customer dengan status sourcing, procurement, delivery, dan finance."
      />

      <Card>
        <FilterBar action="/orders">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Order number, PO customer" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-48">
              <option value="">All statuses</option>
              <option value="CONFIRMED,IN_PROGRESS">Active orders</option>
              {enumOptions(OrderStatus).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Customer">
            <Select name="customer" defaultValue={params.customer ?? ""} className="h-9 w-52">
              <option value="">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.companyName}
                </option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={orders}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "Order",
              render: (row) => (
                <div>
                  <Link href={`/orders/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">{formatDate(row.orderDate)}</p>
                </div>
              ),
            },
            {
              key: "customer",
              header: "Customer",
              render: (row) => (
                <div>
                  <Link href={`/customers/${row.customer.id}`} className="text-sm hover:underline">
                    {row.customer.companyName}
                  </Link>
                  <p className="text-xs text-slate-500">PO {row.customerPoNumber ?? "—"}</p>
                </div>
              ),
            },
            {
              key: "fulfillment",
              header: "Fulfillment",
              render: (row) => {
                const lines = row.items.length;
                const delivered = row.items.filter((item) => num(item.deliveredQty) >= num(item.quantity)).length;
                const percent = lines > 0 ? Math.round((delivered / lines) * 100) : 0;
                return (
                  <div className="min-w-[120px]">
                    <p className="text-xs text-slate-600">
                      {delivered} dari {lines} baris terkirim
                    </p>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              },
            },
            {
              key: "links",
              header: "Related",
              render: (row) => (
                <span className="text-xs text-slate-600">
                  {row._count.purchaseOrders} PO · {row._count.deliveryOrders} DO · {row._count.invoices} invoice
                </span>
              ),
            },
            {
              key: "value",
              header: "Value",
              render: (row) => (
                <div>
                  <p className="text-sm font-medium text-slate-900">{money(row.grandTotal)}</p>
                  <p className="text-xs text-slate-500">
                    {qty(row.items.reduce((total, item) => total + num(item.quantity), 0))} qty total
                  </p>
                </div>
              ),
            },
            {
              key: "eta",
              header: "Est. fulfillment",
              render: (row) => {
                const late =
                  row.estimatedFulfillmentDate &&
                  row.estimatedFulfillmentDate < new Date() &&
                  !["FULFILLED", "COMPLETED", "CANCELLED"].includes(row.status);
                return (
                  <span className={`text-sm ${late ? "font-medium text-rose-600" : "text-slate-600"}`}>
                    {formatDate(row.estimatedFulfillmentDate)}
                  </span>
                );
              },
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          ]}
        />

        <Pagination path="/orders" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
