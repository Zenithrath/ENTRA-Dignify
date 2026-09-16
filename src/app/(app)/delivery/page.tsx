import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DeliveryStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { enumOptions } from "@/lib/status";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Delivery" };

export default async function DeliveryPage({
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
    .filter((value) => Object.values(DeliveryStatus).includes(value as DeliveryStatus)) as DeliveryStatus[];

  const where = {
    tenantId,
    ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    ...(params.customer ? { customerId: params.customer } : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { trackingNumber: { contains: params.q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
            { order: { number: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, deliveries, customers] = await Promise.all([
    prisma.deliveryOrder.count({ where }),
    prisma.deliveryOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true } },
        order: { select: { id: true, number: true } },
        items: { select: { quantity: true } },
      },
    }),
    customerOptions(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Delivery & handover"
        description="Surat jalan, pengiriman sebagian, bukti terima, dan handover jasa."
        actions={
          canManage(auth.user.role, "delivery") ? (
            <Link href="/delivery/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New delivery order
            </Link>
          ) : null
        }
      />

      <Card>
        <FilterBar action="/delivery">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="DO number, tracking" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-48">
              <option value="">All statuses</option>
              <option value="NOT_READY,READY_TO_SHIP,IN_DELIVERY">In progress</option>
              {enumOptions(DeliveryStatus).map((option) => (
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
          rows={deliveries}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "DO",
              render: (row) => (
                <div>
                  <Link href={`/delivery/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">{formatDate(row.createdAt)}</p>
                </div>
              ),
            },
            {
              key: "order",
              header: "Order",
              render: (row) => (
                <div>
                  <Link href={`/orders/${row.order.id}`} className="text-sm text-indigo-600 hover:underline">
                    {row.order.number}
                  </Link>
                  <p className="text-xs text-slate-500">{row.customer.companyName}</p>
                </div>
              ),
            },
            {
              key: "items",
              header: "Items",
              render: (row) => (
                <span className="text-xs text-slate-600">
                  {row.items.length} baris · total {qty(row.items.reduce((sum, item) => sum + num(item.quantity), 0))} qty
                </span>
              ),
            },
            {
              key: "shipping",
              header: "Shipping",
              render: (row) => (
                <span className="text-xs text-slate-600">
                  {row.shipMethod ?? "—"}
                  {row.driverName ? ` · ${row.driverName}` : row.courierName ? ` · ${row.courierName}` : ""}
                  {row.trackingNumber ? ` · ${row.trackingNumber}` : ""}
                </span>
              ),
            },
            { key: "ship", header: "Ship date", render: (row) => <span className="text-sm">{formatDate(row.shipDate)}</span> },
            { key: "delivered", header: "Delivered", render: (row) => <span className="text-sm">{formatDate(row.deliveredDate)}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            {
              key: "print",
              header: "",
              render: (row) => (
                <Link href={`/print/delivery/${row.id}`} className={buttonClass("ghost", "sm")} target="_blank">
                  Print
                </Link>
              ),
            },
          ]}
        />

        <Pagination path="/delivery" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
