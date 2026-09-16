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
import { SupplierStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate, pagination, readParams } from "@/lib/queries/common";
import { supplierPerformance } from "@/lib/queries/supplier-performance";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "category", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const where = {
    tenantId,
    deletedAt: null,
    ...(params.status === "ACTIVE" || params.status === "BLACKLISTED"
      ? { status: params.status as SupplierStatus }
      : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" as const } },
            { email: { contains: params.q, mode: "insensitive" as const } },
            { phone: { contains: params.q } },
            { code: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, suppliers, categories] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy: { name: "asc" }, skip, take }),
    prisma.supplier.groupBy({ by: ["category"], where: { tenantId, deletedAt: null }, _count: true }),
  ]);

  const performance = new Map(
    await Promise.all(
      suppliers.map(async (supplier) => [supplier.id, await supplierPerformance(tenantId, supplier.id)] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Vendor, kategorisasi, lead time, dan performa berdasarkan histori PO."
        actions={
          canManage(auth.user.role, "suppliers") ? (
            <Link href="/suppliers/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New supplier
            </Link>
          ) : null
        }
      />

      <Card>
        <FilterBar action="/suppliers">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Name, email, code" className="h-9 w-64" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-40">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="BLACKLISTED">Blacklisted</option>
            </Select>
          </FilterField>
          <FilterField label="Category">
            <Select name="category" defaultValue={params.category ?? ""} className="h-9 w-44">
              <option value="">All categories</option>
              {categories
                .filter((row) => row.category)
                .map((row) => (
                  <option key={row.category} value={row.category ?? ""}>
                    {row.category} ({row._count})
                  </option>
                ))}
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={suppliers}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "name",
              header: "Supplier",
              render: (row) => (
                <div>
                  <Link href={`/suppliers/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {[row.code, row.city].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              ),
            },
            { key: "category", header: "Category", render: (row) => <span className="text-sm">{row.category ?? "—"}</span> },
            {
              key: "leadTime",
              header: "Lead time",
              render: (row) => (
                <span className="text-sm">
                  {performance.get(row.id)?.averageLeadTimeDays ?? row.leadTimeDays ?? "—"}
                  {performance.get(row.id)?.averageLeadTimeDays !== null || row.leadTimeDays ? " hari" : ""}
                </span>
              ),
            },
            {
              key: "onTime",
              header: "On-time",
              render: (row) => {
                const value = performance.get(row.id)?.onTimePercent;
                return <span className="text-sm">{value === null || value === undefined ? "—" : `${value}%`}</span>;
              },
            },
            {
              key: "score",
              header: "Score",
              render: (row) => {
                const score = performance.get(row.id)?.score;
                if (score === null || score === undefined) return <span className="text-sm text-slate-400">—</span>;
                return (
                  <span className={`text-sm font-medium ${score >= 75 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-rose-700"}`}>
                    {score.toFixed(1)}
                  </span>
                );
              },
            },
            {
              key: "pos",
              header: "POs",
              render: (row) => {
                const info = performance.get(row.id);
                return (
                  <span className="text-xs text-slate-600">
                    {info?.receivedPos ?? 0}/{info?.totalPos ?? 0} received
                    {row.rating ? ` · rating ${num(row.rating).toFixed(1)}` : ""}
                  </span>
                );
              },
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            {
              key: "lastPo",
              header: "Last PO",
              render: (row) => (
                <span className="text-xs text-slate-500">{formatDate(performance.get(row.id)?.lastPoDate ?? null)}</span>
              ),
            },
          ]}
        />

        <Pagination path="/suppliers" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
