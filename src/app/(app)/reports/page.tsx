import type { Metadata } from "next";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { requireAuth } from "@/lib/auth";
import { money, num, percent, qty } from "@/lib/money";
import { canView } from "@/lib/rbac";
import { statusMeta } from "@/lib/status";
import { formatDate, tenantModules, toDateInput } from "@/lib/queries/common";
import {
  financeReport,
  operationsReport,
  parseRange,
  procurementReport,
  salesReport,
} from "@/lib/queries/reports";

export const metadata: Metadata = { title: "Reports" };

const TABS = [
  { id: "sales", label: "Sales" },
  { id: "procurement", label: "Procurement" },
  { id: "finance", label: "Finance" },
  { id: "operations", label: "Operations" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAuth();
  const { report = "sales", from, to } = await searchParams;
  const role = auth.user.role;
  const tenantId = auth.user.tenantId;
  const range = parseRange(from, to);
  const active = TABS.some((tab) => tab.id === report) ? report : "sales";
  const rangeQuery = `from=${toDateInput(range.from)}&to=${toDateInput(range.to)}`;
  const exportHref = `/api/reports/export?report=${active}&${rangeQuery}`;
  const modules = await tenantModules(tenantId);
  const pdfExportEnabled = modules.get("PDF_EXPORT") ?? false;

  const sales = active === "sales" ? await salesReport(tenantId, range) : null;
  const procurement = active === "procurement" ? await procurementReport(tenantId, range) : null;
  const finance = active === "finance" && canView(role, "finance") ? await financeReport(tenantId, range) : null;
  const operations = active === "operations" ? await operationsReport(tenantId) : null;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Penjualan, pengadaan, keuangan, dan operasional — siap diekspor."
        actions={
          <>
            {pdfExportEnabled ? (
              <Link
                href={`/print/reports?${rangeQuery}`}
                target="_blank"
                className={buttonClass("secondary")}
                prefetch={false}
              >
                Export PDF
              </Link>
            ) : null}
            <Link href={`${exportHref}&format=xlsx`} className={buttonClass("secondary")} prefetch={false}>
              Export Excel
            </Link>
            <Link href={exportHref} className={buttonClass("secondary")} prefetch={false}>
              Export CSV
            </Link>
          </>
        }
      />

      <Card>
        <CardBody>
          <form action="/reports" method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="report" value={active} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Dari tanggal</span>
              <Input type="date" name="from" defaultValue={toDateInput(range.from)} className="h-9 w-44" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Sampai tanggal</span>
              <Input type="date" name="to" defaultValue={toDateInput(range.to)} className="h-9 w-44" />
            </label>
            <button type="submit" className={buttonClass("primary", "md")}>
              Terapkan
            </button>
            <span className="text-xs text-slate-500">
              Rentang aktif: {formatDate(range.from)} – {formatDate(range.to)}
              {active === "operations" ? " (operasional memakai data berjalan)" : ""}
            </span>
          </form>
        </CardBody>
      </Card>

      <Tabs
        items={TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: `/reports?report=${tab.id}&from=${toDateInput(range.from)}&to=${toDateInput(range.to)}`,
        }))}
        active={active}
      />

      {active === "sales" && sales ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Nilai order" value={money(sales.orderValue)} hint={`${sales.orderCount} order`} tone="accent" />
            <MetricCard label="Average order value" value={money(sales.averageOrderValue)} hint="Per order periode ini" />
            <MetricCard
              label="Conversion rate"
              value={percent(sales.conversionRate)}
              hint={`${sales.wonQuotations} dari ${sales.quotationCount} quotation`}
              tone="success"
            />
            <MetricCard label="Quotation dibuat" value={sales.quotationCount} hint="Termasuk yang masih draft" />
          </div>

          <Card>
            <CardHeader title="Penjualan per bulan" />
            <DataTable
              rows={sales.byMonth}
              rowKey={(row) => row.label}
              empty={<EmptyState title="Belum ada order pada rentang ini" />}
              columns={[
                { key: "month", header: "Periode", render: (row) => <span className="text-sm">{row.label}</span> },
                { key: "orders", header: "Order", render: (row) => <span className="text-sm tabular-nums">{row.orders}</span> },
                { key: "value", header: "Nilai", render: (row) => <span className="text-sm tabular-nums">{money(row.value)}</span> },
              ]}
            />
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top customer" description="Berdasarkan nilai order." />
              <DataTable
                rows={sales.byCustomer}
                rowKey={(row) => row.id}
                empty={<EmptyState title="Tidak ada data" />}
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <Link href={`/customers/${row.id}`} className="text-sm text-indigo-600 hover:underline">
                        {row.name}
                      </Link>
                    ),
                  },
                  { key: "orders", header: "Order", render: (row) => <span className="text-sm tabular-nums">{row.orders}</span> },
                  { key: "value", header: "Nilai", render: (row) => <span className="text-sm tabular-nums">{money(row.value)}</span> },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title="Top produk" description="Qty, nilai, dan margin kontribusi." />
              <DataTable
                rows={sales.byProduct}
                rowKey={(row) => row.description}
                empty={<EmptyState title="Tidak ada data" />}
                columns={[
                  { key: "item", header: "Item", render: (row) => <span className="text-sm">{row.description}</span> },
                  { key: "qty", header: "Qty", render: (row) => <span className="text-sm tabular-nums">{qty(row.quantity)}</span> },
                  { key: "value", header: "Nilai", render: (row) => <span className="text-sm tabular-nums">{money(row.value)}</span> },
                  {
                    key: "margin",
                    header: "Margin",
                    render: (row) => (
                      <span className={num(row.margin) < 0 ? "text-sm tabular-nums text-rose-600" : "text-sm tabular-nums text-emerald-700"}>
                        {money(row.margin)}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}

      {active === "procurement" && procurement ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard label="Nilai PO" value={money(procurement.poValue)} hint={`${procurement.poCount} PO periode ini`} tone="accent" />
            <MetricCard
              label="Outstanding PO"
              value={money(procurement.outstandingValue)}
              hint={`${procurement.outstandingCount} PO belum selesai`}
              tone="info"
            />
            <MetricCard label="Supplier aktif" value={procurement.bySupplier.length} hint="Punya PO pada rentang ini" />
          </div>

          <Card>
            <CardHeader title="Pembelian per supplier" description="Termasuk on-time % dan rata-rata lead time." />
            <DataTable
              rows={procurement.bySupplier}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada PO pada rentang ini" />}
              columns={[
                {
                  key: "supplier",
                  header: "Supplier",
                  render: (row) => (
                    <Link href={`/suppliers/${row.id}`} className="text-sm text-indigo-600 hover:underline">
                      {row.name}
                    </Link>
                  ),
                },
                { key: "pos", header: "PO", render: (row) => <span className="text-sm tabular-nums">{row.pos}</span> },
                { key: "received", header: "Diterima", render: (row) => <span className="text-sm tabular-nums">{row.received}</span> },
                { key: "value", header: "Nilai", render: (row) => <span className="text-sm tabular-nums">{money(row.value)}</span> },
                {
                  key: "ontime",
                  header: "On-time",
                  render: (row) =>
                    row.onTimePercent === null ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <span
                        className={
                          row.onTimePercent < 70
                            ? "text-sm tabular-nums text-rose-600"
                            : "text-sm tabular-nums text-emerald-700"
                        }
                      >
                        {row.onTimePercent}%
                      </span>
                    ),
                },
                {
                  key: "lead",
                  header: "Lead time",
                  render: (row) =>
                    row.averageLeadTimeDays === null ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <span className="text-sm tabular-nums">{row.averageLeadTimeDays} hari</span>
                    ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {active === "finance" ? (
        finance ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Invoiced" value={money(finance.invoiced)} tone="info" />
              <MetricCard label="Collected" value={money(finance.collected)} tone="success" />
              <MetricCard
                label="Outstanding"
                value={money(finance.outstanding)}
                hint={`Overdue ${money(finance.overdue)}`}
                tone={finance.overdue > 0 ? "danger" : "neutral"}
              />
              <MetricCard label="Profit (estimasi)" value={money(finance.profit)} hint={`Margin ${percent(finance.marginPercent)}`} tone="accent" />
            </div>

            <Card>
              <CardHeader title="Arus invoice & pembayaran per bulan" />
              <DataTable
                rows={finance.byMonth}
                rowKey={(row) => row.label}
                empty={<EmptyState title="Belum ada invoice pada rentang ini" />}
                columns={[
                  { key: "month", header: "Periode", render: (row) => <span className="text-sm">{row.label}</span> },
                  { key: "invoiced", header: "Invoiced", render: (row) => <span className="text-sm tabular-nums">{money(row.invoiced)}</span> },
                  { key: "collected", header: "Collected", render: (row) => <span className="text-sm tabular-nums">{money(row.collected)}</span> },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title="Invoice overdue" description="Diurutkan dari yang paling lama." />
              <DataTable
                rows={finance.overdueInvoices}
                rowKey={(row) => row.id}
                empty={<EmptyState title="Tidak ada invoice overdue" description="Semua tagihan pada rentang ini masih dalam termin." />}
                columns={[
                  {
                    key: "number",
                    header: "Invoice",
                    render: (row) => (
                      <Link href={`/finance/invoices/${row.id}`} className="text-sm text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  { key: "customer", header: "Customer", render: (row) => <span className="text-sm">{row.customer}</span> },
                  { key: "due", header: "Jatuh tempo", render: (row) => <span className="text-sm">{formatDate(row.dueDate)}</span> },
                  {
                    key: "late",
                    header: "Terlambat",
                    render: (row) => <span className="text-sm tabular-nums text-rose-600">{row.daysLate} hari</span>,
                  },
                  {
                    key: "outstanding",
                    header: "Outstanding",
                    render: (row) => <span className="text-sm tabular-nums">{money(row.outstanding)}</span>,
                  },
                ]}
              />
            </Card>
          </>
        ) : (
          <Card>
            <CardBody className="text-sm text-slate-600">Role Anda tidak punya akses ke laporan Finance.</CardBody>
          </Card>
        )
      ) : null}

      {active === "operations" && operations ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Open orders" value={operations.openOrders} hint="Confirmed / In progress / Fulfilled" tone="info" />
            <MetricCard
              label="Delayed orders"
              value={operations.delayedOrders}
              hint="Melewati estimasi fulfillment"
              tone={operations.delayedOrders > 0 ? "danger" : "success"}
            />
            <MetricCard
              label="Pekerjaan berjalan"
              value={operations.openWorkOrders + operations.openProduction + operations.openSubcontracts}
              hint={`WO ${operations.openWorkOrders} · PRD ${operations.openProduction} · SUB ${operations.openSubcontracts}`}
            />
            <MetricCard label="Pengiriman berjalan" value={operations.openDeliveries} hint="Belum delivered" tone="warning" />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Breakdown status order" />
              <DataTable
                rows={operations.statusBreakdown}
                rowKey={(row) => row.status}
                empty={<EmptyState title="Belum ada order" />}
                columns={[
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                  { key: "count", header: "Jumlah", render: (row) => <span className="text-sm tabular-nums">{row.count}</span> },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title="Order terlambat" description="Melewati estimated fulfillment date." />
              <DataTable
                rows={operations.delayedList}
                rowKey={(row) => row.id}
                empty={<EmptyState title="Tidak ada order terlambat" description="Semua pekerjaan sesuai jadwal." />}
                columns={[
                  {
                    key: "order",
                    header: "Order",
                    render: (row) => (
                      <Link href={`/orders/${row.id}`} className="text-sm text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  { key: "customer", header: "Customer", render: (row) => <span className="text-sm">{row.customer}</span> },
                  { key: "expected", header: "Estimasi", render: (row) => <span className="text-sm">{formatDate(row.expected)}</span> },
                  {
                    key: "late",
                    header: "Terlambat",
                    render: (row) => <span className="text-sm tabular-nums text-rose-600">{row.daysLate} hari</span>,
                  },
                ]}
              />
            </Card>
          </div>

          <Card>
            <CardBody className="text-xs text-slate-500">
              Status order yang dihitung open: {["CONFIRMED", "IN_PROGRESS", "FULFILLED"].map((status) => statusMeta(status).label).join(", ")}.
              Order Completed dan Cancelled tidak masuk hitungan.
            </CardBody>
          </Card>
        </>
      ) : null}
    </>
  );
}
