import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { ExportButton, TrackerStat } from "@/components/tracker/tracker-ui";
import { WorkStatusPicker } from "@/components/tracker/work-status-picker";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { WorkStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";
import { WORK_STATUS_LABEL } from "@/lib/tracker";

export const metadata: Metadata = { title: "Procurement" };

export default async function ProcurementTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "customer", "sort", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusFilter = (Object.values(WorkStatus) as string[]).includes(params.status ?? "")
    ? (params.status as WorkStatus)
    : "";

  const where = {
    quotation: {
      tenantId,
      ...(params.customer ? { customerId: params.customer } : {}),
    },
    ...(statusFilter ? { workStatus: statusFilter } : {}),
    ...(params.q
      ? {
          OR: [
            { description: { contains: params.q, mode: "insensitive" as const } },
            { vendor: { contains: params.q, mode: "insensitive" as const } },
            { quotation: { number: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const orderBy =
    params.sort === "oldest"
      ? [{ quotation: { quotationDate: "asc" as const } }, { sortOrder: "asc" as const }]
      : [{ quotation: { quotationDate: "desc" as const } }, { sortOrder: "asc" as const }];

  const [total, items, customers, counts] = await Promise.all([
    prisma.quotationItem.count({ where }),
    prisma.quotationItem.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        quotation: {
          select: {
            id: true,
            number: true,
            quotationDate: true,
            customer: { select: { companyName: true } },
          },
        },
      },
    }),
    customerOptions(tenantId),
    prisma.quotationItem.groupBy({
      by: ["workStatus"],
      where: { quotation: { tenantId } },
      _count: true,
    }),
  ]);

  const countOf = (status: WorkStatus) => counts.find((row) => row.workStatus === status)?._count ?? 0;

  const exportQuery = new URLSearchParams();
  if (params.q) exportQuery.set("q", params.q);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (params.customer) exportQuery.set("customer", params.customer);

  return (
    <>
      <PageHeader
        title="Procurement"
        description="Pengganti Sheet 2 — semua barang lintas quotation, lengkap dengan asal quotation-nya."
        actions={<ExportButton href={`/api/export/procurement?${exportQuery.toString()}`} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TrackerStat label="To Source" value={String(countOf(WorkStatus.TO_SOURCE))} hint="Belum disourcing" />
        <TrackerStat label="Ordered" value={String(countOf(WorkStatus.ORDERED))} hint="Sudah dipesan" tone="warning" />
        <TrackerStat
          label="Ready to Ship"
          value={String(countOf(WorkStatus.READY_TO_SHIP))}
          hint="Siap dikirim"
          tone="success"
        />
        <TrackerStat label="Delivered" value={String(countOf(WorkStatus.DELIVERED))} hint="Sudah diterima customer" tone="success" dark />
      </div>

      <Card>
        <FilterBar action="/procurement">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Barang, vendor, quotation" className="h-9 w-60" />
          </FilterField>
          <FilterField label="Status pekerjaan">
            <Select name="status" defaultValue={statusFilter} className="h-9 w-48">
              <option value="">Semua status</option>
              {(Object.values(WorkStatus) as WorkStatus[]).map((status) => (
                <option key={status} value={status}>
                  {WORK_STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Customer">
            <Select name="customer" defaultValue={params.customer ?? ""} className="h-9 w-52">
              <option value="">Semua customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.companyName}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Urutkan">
            <Select name="sort" defaultValue={params.sort ?? ""} className="h-9 w-44">
              <option value="">Quotation terbaru</option>
              <option value="oldest">Quotation terlama</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "item",
              header: "Barang",
              render: (row) => (
                <div>
                  <p className="text-sm font-medium text-slate-900">{row.description}</p>
                  <p className="text-xs text-slate-500">
                    {qty(row.quantity)} {row.unit}
                  </p>
                </div>
              ),
            },
            {
              key: "vendor",
              header: "Toko/Vendor",
              render: (row) =>
                row.vendor ? (
                  <span className="text-sm text-slate-800">{row.vendor}</span>
                ) : (
                  <span className="text-sm text-slate-300">—</span>
                ),
            },
            {
              key: "delivery",
              header: "Metode Kirim",
              render: (row) =>
                row.deliveryMethod ? (
                  <span className="text-sm text-slate-700">{row.deliveryMethod}</span>
                ) : (
                  <span className="text-sm text-slate-300">—</span>
                ),
            },
            {
              key: "status",
              header: "Status Pekerjaan",
              render: (row) => (
                <div className="flex items-center gap-2">
                  <WorkStatusPicker itemId={row.id} value={row.workStatus} />
                </div>
              ),
            },
            {
              key: "quotation",
              header: "Asal Quotation",
              render: (row) => (
                <div>
                  <Link href={`/quotations/${row.quotation.id}`} className="text-sm font-medium text-rose-600 hover:underline">
                    {row.quotation.number}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {row.quotation.customer.companyName} · {formatDate(row.quotation.quotationDate)}
                  </p>
                </div>
              ),
            },
            {
              key: "badge",
              header: "",
              render: (row) => <StatusBadge value={row.workStatus} />,
            },
          ]}
        />

        <Pagination path="/procurement" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
