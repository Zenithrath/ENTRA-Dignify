import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { AgingBadge, ExportButton, TrackerStat } from "@/components/tracker/tracker-ui";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TrackerStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";
import { AGING_THRESHOLD_DAYS, calcAgingDays, TRACKER_STATUS_LABEL } from "@/lib/tracker";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "customer", "sort", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusFilter = (Object.values(TrackerStatus) as string[]).includes(params.status ?? "")
    ? (params.status as TrackerStatus)
    : "";

  const where = {
    tenantId,
    ...(statusFilter ? { trackerStatus: statusFilter } : {}),
    ...(params.customer ? { customerId: params.customer } : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
            { customerPoNumber: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy =
    params.sort === "oldest"
      ? { quotationDate: "asc" as const }
      : params.sort === "customer"
        ? { customer: { companyName: "asc" as const } }
        : { quotationDate: "desc" as const };

  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - AGING_THRESHOLD_DAYS);

  const [total, quotations, customers, waitingCount, overdueCount, receivedCount, lostCount] =
    await Promise.all([
      prisma.quotation.count({ where }),
      prisma.quotation.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          customer: { select: { id: true, companyName: true } },
          _count: { select: { items: true } },
        },
      }),
      customerOptions(tenantId),
      prisma.quotation.count({ where: { tenantId, trackerStatus: TrackerStatus.WAITING_PO } }),
      prisma.quotation.count({
        where: { tenantId, trackerStatus: TrackerStatus.WAITING_PO, quotationDate: { lt: thresholdDate } },
      }),
      prisma.quotation.count({ where: { tenantId, trackerStatus: TrackerStatus.PO_RECEIVED } }),
      prisma.quotation.count({ where: { tenantId, trackerStatus: TrackerStatus.LOST } }),
    ]);

  const exportQuery = new URLSearchParams();
  if (params.q) exportQuery.set("q", params.q);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (params.customer) exportQuery.set("customer", params.customer);

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Pengganti Sheet 1 — Quotation Tracker. Aging terhitung otomatis dari tanggal quotation."
        actions={
          <>
            <ExportButton href={`/api/export/quotations?${exportQuery.toString()}`} />
            <Link href="/quotations/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New quotation
            </Link>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TrackerStat label="Waiting PO" value={String(waitingCount)} hint="Menunggu PO customer" tone="warning" />
        <TrackerStat
          label={`Overdue >${AGING_THRESHOLD_DAYS} hari`}
          value={String(overdueCount)}
          hint="Perlu follow-up"
          tone={overdueCount > 0 ? "danger" : "neutral"}
          dark={overdueCount > 0}
        />
        <TrackerStat label="PO Received" value={String(receivedCount)} hint="PO sudah diterima" tone="success" />
        <TrackerStat label="Lost" value={String(lostCount)} hint="Tidak lanjut" />
      </div>

      <Card>
        <FilterBar action="/quotations">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Nomor, customer, PO" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={statusFilter} className="h-9 w-44">
              <option value="">Semua status</option>
              {(Object.values(TrackerStatus) as TrackerStatus[]).map((status) => (
                <option key={status} value={status}>
                  {TRACKER_STATUS_LABEL[status]}
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
              <option value="">Terbaru</option>
              <option value="oldest">Terlama</option>
              <option value="customer">Customer A–Z</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={quotations}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "Nomor Quotation",
              render: (row) => (
                <div>
                  <Link href={`/quotations/${row.id}`} className="font-medium text-rose-600 hover:underline">
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">{row._count.items} barang</p>
                </div>
              ),
            },
            {
              key: "date",
              header: "Tanggal",
              render: (row) => <span className="text-sm">{formatDate(row.quotationDate)}</span>,
            },
            {
              key: "customer",
              header: "Customer",
              render: (row) => <span className="text-sm">{row.customer.companyName}</span>,
            },
            {
              key: "aging",
              header: "Aging",
              render: (row) => {
                const frozen = row.trackerStatus !== TrackerStatus.WAITING_PO;
                const days = calcAgingDays(row.quotationDate, row.trackerStatus, row.customerPoDate);
                return <AgingBadge days={days} frozen={frozen} />;
              },
            },
            {
              key: "po",
              header: "PO Customer",
              render: (row) =>
                row.customerPoNumber ? (
                  <span className="text-sm font-medium text-slate-800">{row.customerPoNumber}</span>
                ) : (
                  <span className="text-sm text-slate-300">—</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => <StatusBadge value={row.trackerStatus} />,
            },
          ]}
        />

        <Pagination path="/quotations" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
