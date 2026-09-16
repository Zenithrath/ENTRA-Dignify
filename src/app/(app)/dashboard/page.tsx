import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { AgingBadge, TrackerStat } from "@/components/tracker/tracker-ui";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TrackerStatus, WorkStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";
import { AGING_THRESHOLD_DAYS, WORK_STATUS_LABEL, calcAgingDays } from "@/lib/tracker";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;

  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - AGING_THRESHOLD_DAYS);

  const [waitingCount, overdueCount, receivedCount, workCounts, followUps, activeItems] =
    await Promise.all([
      prisma.quotation.count({ where: { tenantId, trackerStatus: TrackerStatus.WAITING_PO } }),
      prisma.quotation.count({
        where: { tenantId, trackerStatus: TrackerStatus.WAITING_PO, quotationDate: { lt: thresholdDate } },
      }),
      prisma.quotation.count({ where: { tenantId, trackerStatus: TrackerStatus.PO_RECEIVED } }),
      prisma.quotationItem.groupBy({
        by: ["workStatus"],
        where: { quotation: { tenantId } },
        _count: true,
      }),
      prisma.quotation.findMany({
        where: { tenantId, trackerStatus: TrackerStatus.WAITING_PO },
        orderBy: { quotationDate: "asc" },
        take: 8,
        include: { customer: { select: { companyName: true } } },
      }),
      prisma.quotationItem.findMany({
        where: {
          quotation: { tenantId },
          workStatus: { in: [WorkStatus.TO_SOURCE, WorkStatus.ORDERED] },
        },
        orderBy: { quotation: { quotationDate: "desc" } },
        take: 8,
        include: {
          quotation: { select: { id: true, number: true, customer: { select: { companyName: true } } } },
        },
      }),
    ]);

  const workCountOf = (status: WorkStatus) =>
    workCounts.find((row) => row.workStatus === status)?._count ?? 0;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Ringkasan {auth.tenant.name} — yang perlu difollow-up hari ini.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TrackerStat label="Waiting PO" value={String(waitingCount)} hint="Menunggu PO customer" tone="warning" />
        <TrackerStat
          label={`Overdue >${AGING_THRESHOLD_DAYS} hari`}
          value={String(overdueCount)}
          hint="Segera follow-up"
          tone={overdueCount > 0 ? "danger" : "neutral"}
          dark={overdueCount > 0}
        />
        <TrackerStat label="PO Received" value={String(receivedCount)} hint="PO sudah diterima" tone="success" />
        <TrackerStat
          label="To Source"
          value={String(workCountOf(WorkStatus.TO_SOURCE))}
          hint="Barang belum disourcing"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Perlu follow-up"
            description={`Waiting PO terlama (threshold ${AGING_THRESHOLD_DAYS} hari)`}
            actions={
              <Link href="/quotations" className="text-xs font-semibold text-rose-600 hover:underline">
                Lihat semua
              </Link>
            }
          />
          {followUps.length === 0 ? (
            <EmptyState title="Tidak ada waiting PO" description="Semua quotation sudah ada kepastian." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {followUps.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/quotations/${row.id}`}
                      className="block truncate text-sm font-medium text-rose-600 hover:underline"
                    >
                      {row.number}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {row.customer.companyName} · {formatDate(row.quotationDate)}
                    </p>
                  </div>
                  <AgingBadge days={calcAgingDays(row.quotationDate, row.trackerStatus, row.customerPoDate)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Pekerjaan berjalan"
            description="Barang yang belum selesai disourcing"
            actions={
              <Link href="/procurement" className="text-xs font-semibold text-rose-600 hover:underline">
                Lihat semua
              </Link>
            }
          />
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
            {(Object.values(WorkStatus) as WorkStatus[]).map((status) => (
              <Link
                key={status}
                href={`/procurement?status=${status}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600"
              >
                {WORK_STATUS_LABEL[status]}
                <span className="font-bold">{workCountOf(status)}</span>
              </Link>
            ))}
          </div>
          {activeItems.length === 0 ? (
            <EmptyState title="Tidak ada pekerjaan berjalan" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.description}{" "}
                      <span className="font-normal text-slate-500">
                        · {qty(item.quantity)} {item.unit}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {item.vendor ?? "Vendor belum diisi"} ·{" "}
                      <Link
                        href={`/quotations/${item.quotation.id}`}
                        className="text-rose-600 hover:underline"
                      >
                        {item.quotation.number}
                      </Link>{" "}
                      · {item.quotation.customer.companyName}
                    </p>
                  </div>
                  <StatusBadge value={item.workStatus} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
