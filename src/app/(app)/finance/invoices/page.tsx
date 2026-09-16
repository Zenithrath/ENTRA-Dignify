import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DataTable } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { InvoiceStatus, InvoiceType } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { money } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage, canView } from "@/lib/rbac";
import { enumOptions, titleize } from "@/lib/status";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";
import { daysOverdue, OPEN_INVOICE_STATUSES, outstandingOf, receivablesSummary } from "@/lib/queries/finance";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canView(auth.user.role, "finance")) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-600">Role Anda tidak punya akses ke modul Finance.</CardBody>
      </Card>
    );
  }

  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["q", "status", "customer", "aging", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const statusList = (params.status ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => Object.values(InvoiceStatus).includes(value as InvoiceStatus)) as InvoiceStatus[];

  const where = {
    tenantId,
    ...(statusList.length > 0 ? { status: { in: statusList } } : {}),
    ...(params.customer ? { customerId: params.customer } : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
            { order: { number: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(params.aging
      ? params.aging === "CURRENT"
        ? { status: { in: statusList.length > 0 ? statusList : OPEN_INVOICE_STATUSES }, dueDate: { gte: new Date() } }
        : params.aging === "OVERDUE"
          ? {
              status: { in: statusList.length > 0 ? statusList : OPEN_INVOICE_STATUSES },
              dueDate: { lt: new Date() },
            }
          : {}
      : {}),
  };

  const [total, invoices, customers, summary] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true } },
        order: { select: { id: true, number: true } },
        _count: { select: { payments: true } },
      },
    }),
    customerOptions(tenantId),
    receivablesSummary(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Full, partial, progress, dan milestone billing — lengkap dengan aging piutang."
        actions={
          canManage(auth.user.role, "finance") ? (
            <Link href="/finance/invoices/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" />
              New invoice
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Outstanding"
          value={money(summary.outstanding)}
          hint={`${summary.openCount} invoice belum lunas`}
          tone="info"
          href="/finance/invoices?aging=OPEN"
        />
        <MetricCard
          label="Overdue"
          value={money(summary.overdue)}
          hint={`${summary.overdueCount} invoice melewati jatuh tempo`}
          tone={summary.overdue > 0 ? "danger" : "success"}
          href="/finance/invoices?aging=OVERDUE"
        />
        <MetricCard
          label="Collected this month"
          value={money(summary.collectedThisMonth)}
          hint="Total pembayaran diterima bulan ini"
          tone="success"
        />
        <MetricCard
          label="Open invoices"
          value={summary.openCount}
          hint="Status Sent / Partially Paid / Overdue"
          href="/finance/invoices?status=SENT,PARTIALLY_PAID,OVERDUE"
        />
      </div>

      <Card>
        <CardHeader title="Aging piutang" description="Distribusi outstanding berdasarkan hari keterlambatan." />
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {summary.aging.map((bucket) => (
            <div key={bucket.label} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">{bucket.label}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{money(bucket.amount)}</p>
              <p className="text-[11px] text-slate-500">{bucket.count} invoice</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Tabs
        items={[
          { id: "invoices", label: "Invoices", href: "/finance/invoices" },
          { id: "payments", label: "Payments", href: "/finance/payments" },
        ]}
        active="invoices"
      />

      <Card>
        <FilterBar action="/finance/invoices">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Invoice, order, customer" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-52">
              <option value="">All statuses</option>
              <option value="SENT,PARTIALLY_PAID,OVERDUE">Belum lunas</option>
              <option value="DRAFT,PENDING_APPROVAL">Belum dikirim</option>
              {enumOptions(InvoiceStatus).map((option) => (
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
          <FilterField label="Jatuh tempo">
            <Select name="aging" defaultValue={params.aging ?? ""} className="h-9 w-44">
              <option value="">Semua</option>
              <option value="CURRENT">Belum jatuh tempo</option>
              <option value="OVERDUE">Overdue</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={invoices}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "number",
              header: "Invoice",
              render: (row) => (
                <div>
                  <Link href={`/finance/invoices/${row.id}`} className="font-medium text-indigo-600 hover:underline">
                    {row.number}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDate(row.invoiceDate)} · {titleize(row.type)}
                  </p>
                </div>
              ),
            },
            {
              key: "customer",
              header: "Customer",
              render: (row) => (
                <div>
                  <p className="text-sm text-slate-800">{row.customer.companyName}</p>
                  {row.order ? (
                    <Link href={`/orders/${row.order.id}`} className="text-xs text-indigo-600 hover:underline">
                      {row.order.number}
                    </Link>
                  ) : (
                    <p className="text-xs text-slate-500">Tanpa order</p>
                  )}
                </div>
              ),
            },
            {
              key: "due",
              header: "Jatuh tempo",
              render: (row) => {
                const late = daysOverdue(row.dueDate);
                const open = outstandingOf(row) > 0;
                return (
                  <div>
                    <p className="text-sm">{formatDate(row.dueDate)}</p>
                    {open && late > 0 ? (
                      <p className="text-xs font-medium text-rose-600">Terlambat {late} hari</p>
                    ) : open ? (
                      <p className="text-xs text-slate-500">{-late} hari lagi</p>
                    ) : null}
                  </div>
                );
              },
            },
            {
              key: "total",
              header: "Total",
              render: (row) => <span className="text-sm tabular-nums">{money(row.grandTotal)}</span>,
            },
            {
              key: "paid",
              header: "Dibayar",
              render: (row) => (
                <div>
                  <p className="text-sm tabular-nums">{money(row.amountPaid)}</p>
                  <p className="text-xs text-slate-500">{row._count.payments} pembayaran</p>
                </div>
              ),
            },
            {
              key: "outstanding",
              header: "Sisa",
              render: (row) => {
                const outstanding = outstandingOf(row);
                return (
                  <span className={outstanding > 0 ? "text-sm font-medium tabular-nums text-rose-700" : "text-sm tabular-nums text-emerald-700"}>
                    {money(outstanding)}
                  </span>
                );
              },
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Link href={`/finance/invoices/${row.id}`} className={buttonClass("ghost", "sm")}>
                    Detail
                  </Link>
                  <Link href={`/print/invoices/${row.id}`} className={buttonClass("ghost", "sm")} target="_blank">
                    PDF
                  </Link>
                </div>
              ),
            },
          ]}
        />

        <Pagination path="/finance/invoices" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
