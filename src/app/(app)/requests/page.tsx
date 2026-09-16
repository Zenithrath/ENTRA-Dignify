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
import { RequestStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import { enumOptions } from "@/lib/status";
import { actorMap, formatDate, pagination, readParams, relativeDays, tenantUsers } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Requests" };

const OPEN_STATUSES: RequestStatus[] = [
  RequestStatus.NEW,
  RequestStatus.PREPARING_QUOTATION,
  RequestStatus.QUOTATION_SENT,
  RequestStatus.WAITING_RESPONSE,
];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "owner", "from", "to", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusFilter =
    params.status === "open"
      ? { status: { in: OPEN_STATUSES } }
      : params.status && Object.values(RequestStatus).includes(params.status as RequestStatus)
        ? { status: params.status as RequestStatus }
        : {};

  const where = {
    tenantId,
    ...statusFilter,
    ...(params.owner ? { assignedToId: params.owner } : {}),
    ...(params.from || params.to
      ? {
          requestDate: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(new Date(params.to).getTime() + 86_399_000) } : {}),
          },
        }
      : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { customerRef: { contains: params.q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, requests, users] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: { requestDate: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true } },
        _count: { select: { items: true, quotations: true } },
      },
    }),
    tenantUsers(tenantId),
  ]);
  const owners = actorMap(users);

  return (
    <>
      <PageHeader
        title="Requests / Inquiries"
        description="Semua permintaan masuk dari customer, lengkap dengan aging dan status tindak lanjut."
        actions={
          canManage(auth.user.role, "requests") ? (
            <Link href="/requests/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New request
            </Link>
          ) : null
        }
      />

      <Card>
        <FilterBar action="/requests">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Number, customer, ref" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-48">
              <option value="">All statuses</option>
              <option value="open">Open only</option>
              {enumOptions(RequestStatus).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Assigned to">
            <Select name="owner" defaultValue={params.owner ?? ""} className="h-9 w-40">
              <option value="">Anyone</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="From">
            <Input type="date" name="from" defaultValue={params.from ?? ""} className="h-9 w-40" />
          </FilterField>
          <FilterField label="To">
            <Input type="date" name="to" defaultValue={params.to ?? ""} className="h-9 w-40" />
          </FilterField>
        </FilterBar>

        <DataTable
          rows={requests}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "Request",
              render: (row) => (
                <div>
                  <Link href={`/requests/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {row.source}
                    {row.customerRef ? ` · ref ${row.customerRef}` : ""}
                  </p>
                </div>
              ),
            },
            {
              key: "customer",
              header: "Customer",
              render: (row) => (
                <Link href={`/customers/${row.customer.id}`} className="text-sm hover:underline">
                  {row.customer.companyName}
                </Link>
              ),
            },
            {
              key: "items",
              header: "Items",
              render: (row) => (
                <span className="text-xs text-slate-600">
                  {row._count.items} item · {row._count.quotations} quotation
                </span>
              ),
            },
            {
              key: "owner",
              header: "Assigned",
              render: (row) => <span className="text-sm">{owners.get(row.assignedToId ?? "") ?? "Unassigned"}</span>,
            },
            {
              key: "aging",
              header: "Aging",
              render: (row) => {
                const days = relativeDays(row.requestDate) ?? 0;
                const open = OPEN_STATUSES.includes(row.status);
                const overdue = open && days > 3;
                return (
                  <span className={`text-sm ${overdue ? "font-medium text-rose-600" : "text-slate-600"}`}>
                    {days} hari{overdue ? " ⚠" : ""}
                  </span>
                );
              },
            },
            { key: "date", header: "Received", render: (row) => <span className="text-xs text-slate-500">{formatDate(row.requestDate)}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          ]}
        />

        <Pagination path="/requests" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>

      {canView(auth.user.role, "quotations") ? (
        <p className="mt-3 text-xs text-slate-500">
          Tip: buka detail request untuk membuat quotation dengan item yang otomatis tersalin.
        </p>
      ) : null}
    </>
  );
}
