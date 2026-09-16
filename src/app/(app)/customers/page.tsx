import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TrackerStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pagination, readParams } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const where = {
    tenantId,
    deletedAt: null,
    ...(params.q
      ? {
          OR: [
            { companyName: { contains: params.q, mode: "insensitive" as const } },
            { phone: { contains: params.q } },
          ],
        }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { companyName: "asc" },
      skip,
      take,
      include: {
        _count: { select: { quotations: true } },
        quotations: {
          where: { trackerStatus: TrackerStatus.WAITING_PO },
          select: { id: true },
        },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Daftar nama customer — supaya tidak ketik ulang tiap buat quotation."
        actions={
          <Link href="/customers/new" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            New customer
          </Link>
        }
      />

      <Card>
        <FilterBar action="/customers">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Nama atau kontak" className="h-9 w-64" />
          </FilterField>
        </FilterBar>

        <DataTable
          rows={customers}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "name",
              header: "Nama",
              render: (row) => (
                <Link href={`/customers/${row.id}`} className="font-medium text-rose-600 hover:underline">
                  {row.companyName}
                </Link>
              ),
            },
            {
              key: "contact",
              header: "Kontak",
              render: (row) =>
                row.phone ? (
                  <span className="text-sm text-slate-700">{row.phone}</span>
                ) : (
                  <span className="text-sm text-slate-300">—</span>
                ),
            },
            {
              key: "quotations",
              header: "Quotation",
              render: (row) => (
                <span className="text-sm text-slate-600">
                  {row._count.quotations} total
                  {row.quotations.length > 0 ? ` · ${row.quotations.length} waiting PO` : ""}
                </span>
              ),
            },
          ]}
        />

        <Pagination path="/customers" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
