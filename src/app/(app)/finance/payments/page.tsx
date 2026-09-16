import type { Metadata } from "next";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DataTable } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { PaymentMethod } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { money } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canView } from "@/lib/rbac";
import { enumOptions, titleize } from "@/lib/status";
import { customerOptions, formatDate, pagination, readParams } from "@/lib/queries/common";
import { receivablesSummary } from "@/lib/queries/finance";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
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
  const params = readParams(await searchParams, ["q", "method", "customer", "from", "to", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const method = Object.values(PaymentMethod).includes(params.method as PaymentMethod)
    ? (params.method as PaymentMethod)
    : undefined;

  const where = {
    tenantId,
    ...(method ? { method } : {}),
    ...(params.customer ? { customerId: params.customer } : {}),
    ...(params.from || params.to
      ? {
          paymentDate: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
          },
        }
      : {}),
    ...(params.q
      ? {
          OR: [
            { number: { contains: params.q, mode: "insensitive" as const } },
            { referenceNumber: { contains: params.q, mode: "insensitive" as const } },
            { invoice: { number: { contains: params.q, mode: "insensitive" as const } } },
            { customer: { companyName: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, payments, sum, customers, summary] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true } },
        invoice: { select: { id: true, number: true, dueDate: true, grandTotal: true, amountPaid: true } },
      },
    }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
    customerOptions(tenantId),
    receivablesSummary(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Ledger pembayaran per invoice maupun per customer."
        actions={
          <Link href="/finance/invoices" className={buttonClass("secondary")}>
            Ke invoices
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Total (filter aktif)" value={money(sum._sum.amount)} hint={`${total} transaksi`} tone="info" />
        <MetricCard label="Collected this month" value={money(summary.collectedThisMonth)} tone="success" />
        <MetricCard
          label="Outstanding piutang"
          value={money(summary.outstanding)}
          hint={`${summary.overdueCount} invoice overdue`}
          tone={summary.overdue > 0 ? "warning" : "success"}
        />
      </div>

      <Tabs
        items={[
          { id: "invoices", label: "Invoices", href: "/finance/invoices" },
          { id: "payments", label: "Payments", href: "/finance/payments" },
        ]}
        active="payments"
      />

      <Card>
        <FilterBar action="/finance/payments">
          <FilterField label="Search">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="No. pembayaran, invoice, referensi" className="h-9 w-56" />
          </FilterField>
          <FilterField label="Metode">
            <Select name="method" defaultValue={params.method ?? ""} className="h-9 w-36">
              <option value="">Semua</option>
              {enumOptions(PaymentMethod).map((option) => (
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
          <FilterField label="Dari">
            <Input type="date" name="from" defaultValue={params.from ?? ""} className="h-9 w-40" />
          </FilterField>
          <FilterField label="Sampai">
            <Input type="date" name="to" defaultValue={params.to ?? ""} className="h-9 w-40" />
          </FilterField>
        </FilterBar>

        <DataTable
          rows={payments}
          rowKey={(row) => row.id}
          empty={<p className="px-5 py-6 text-sm text-slate-500">Belum ada pembayaran pada filter ini.</p>}
          columns={[
            { key: "number", header: "No.", render: (row) => <span className="text-sm font-medium">{row.number}</span> },
            { key: "date", header: "Tanggal", render: (row) => <span className="text-sm">{formatDate(row.paymentDate)}</span> },
            {
              key: "customer",
              header: "Customer",
              render: (row) => (
                <Link href={`/customers/${row.customer.id}`} className="text-sm text-indigo-600 hover:underline">
                  {row.customer.companyName}
                </Link>
              ),
            },
            {
              key: "invoice",
              header: "Invoice",
              render: (row) => (
                <div>
                  <Link href={`/finance/invoices/${row.invoice.id}`} className="text-sm text-indigo-600 hover:underline">
                    {row.invoice.number}
                  </Link>
                  <p className="text-xs text-slate-500">Jatuh tempo {formatDate(row.invoice.dueDate)}</p>
                </div>
              ),
            },
            { key: "method", header: "Metode", render: (row) => <span className="text-sm">{titleize(row.method)}</span> },
            { key: "ref", header: "Referensi", render: (row) => <span className="text-sm">{row.referenceNumber ?? "—"}</span> },
            {
              key: "amount",
              header: "Jumlah",
              render: (row) => <span className="text-sm font-medium tabular-nums text-emerald-700">{money(row.amount)}</span>,
            },
          ]}
        />

        <Pagination path="/finance/payments" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}
