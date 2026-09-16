import { Letterhead, PrintFooter } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { money, percent } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canView } from "@/lib/rbac";
import { formatDate } from "@/lib/queries/common";
import {
  financeReport,
  operationsReport,
  parseRange,
  procurementReport,
  salesReport,
} from "@/lib/queries/reports";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ head, body }: { head: string[]; body: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wide text-slate-500">
          {head.map((cell) => (
            <th key={cell} className="py-1.5">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, index) => (
          <tr key={index} className="border-b border-slate-100">
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className={cellIndex === 0 ? "py-1.5 text-slate-800" : "py-1.5 text-right tabular-nums text-slate-700"}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PrintReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const auth = await requireAuth();
  const { from, to } = await searchParams;
  const tenantId = auth.user.tenantId;
  const range = parseRange(from, to);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const includeFinance = canView(auth.user.role, "finance");
  const [sales, procurement, finance, operations] = await Promise.all([
    salesReport(tenantId, range),
    procurementReport(tenantId, range),
    includeFinance ? financeReport(tenantId, range) : null,
    operationsReport(tenantId),
  ]);

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Business Report"
        docNumber={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        meta={[
          { label: "Dicetak", value: formatDate(new Date()) },
          { label: "Role", value: auth.user.role },
        ]}
      />

      <Section title="Ringkasan Sales">
        <div className="grid grid-cols-4 gap-3 text-xs">
          <p>
            Nilai order <span className="block text-sm font-semibold text-slate-900">{money(sales.orderValue)}</span>
          </p>
          <p>
            Jumlah order <span className="block text-sm font-semibold text-slate-900">{sales.orderCount}</span>
          </p>
          <p>
            Conversion rate <span className="block text-sm font-semibold text-slate-900">{percent(sales.conversionRate)}</span>
          </p>
          <p>
            AOV <span className="block text-sm font-semibold text-slate-900">{money(sales.averageOrderValue)}</span>
          </p>
        </div>
        <Rows
          head={["Customer", "Order", "Nilai"]}
          body={sales.byCustomer.map((row) => [row.name, row.orders, money(row.value)])}
        />
      </Section>

      <Section title="Procurement">
        <Rows
          head={["Supplier", "PO", "Diterima", "Nilai", "On-time", "Lead time"]}
          body={procurement.bySupplier.map((row) => [
            row.name,
            row.pos,
            row.received,
            money(row.value),
            row.onTimePercent === null ? "—" : `${row.onTimePercent}%`,
            row.averageLeadTimeDays === null ? "—" : `${row.averageLeadTimeDays} hr`,
          ])}
        />
        <p className="mt-2 text-xs text-slate-600">
          Outstanding PO: {procurement.outstandingCount} PO · {money(procurement.outstandingValue)}
        </p>
      </Section>

      {finance ? (
        <Section title="Finance">
          <div className="grid grid-cols-5 gap-3 text-xs">
            <p>
              Invoiced <span className="block text-sm font-semibold text-slate-900">{money(finance.invoiced)}</span>
            </p>
            <p>
              Collected <span className="block text-sm font-semibold text-slate-900">{money(finance.collected)}</span>
            </p>
            <p>
              Outstanding <span className="block text-sm font-semibold text-slate-900">{money(finance.outstanding)}</span>
            </p>
            <p>
              Overdue <span className="block text-sm font-semibold text-slate-900">{money(finance.overdue)}</span>
            </p>
            <p>
              Profit <span className="block text-sm font-semibold text-slate-900">{money(finance.profit)}</span>
            </p>
          </div>
          <Rows
            head={["Invoice", "Customer", "Jatuh tempo", "Terlambat", "Outstanding"]}
            body={finance.overdueInvoices.map((row) => [
              row.number,
              row.customer,
              formatDate(row.dueDate),
              `${row.daysLate} hr`,
              money(row.outstanding),
            ])}
          />
        </Section>
      ) : null}

      <Section title="Operations">
        <div className="grid grid-cols-4 gap-3 text-xs">
          <p>
            Open orders <span className="block text-sm font-semibold text-slate-900">{operations.openOrders}</span>
          </p>
          <p>
            Delayed <span className="block text-sm font-semibold text-slate-900">{operations.delayedOrders}</span>
          </p>
          <p>
            Pekerjaan berjalan{" "}
            <span className="block text-sm font-semibold text-slate-900">
              {operations.openWorkOrders + operations.openProduction + operations.openSubcontracts}
            </span>
          </p>
          <p>
            Pengiriman berjalan <span className="block text-sm font-semibold text-slate-900">{operations.openDeliveries}</span>
          </p>
        </div>
        <Rows
          head={["Order", "Customer", "Estimasi", "Terlambat"]}
          body={operations.delayedList.map((row) => [
            row.number,
            row.customer,
            row.expected ? formatDate(row.expected) : "—",
            `${row.daysLate} hr`,
          ])}
        />
      </Section>

      <PrintFooter tenant={tenant} note={`Laporan dibuat otomatis untuk periode ${formatDate(range.from)} – ${formatDate(range.to)}.`} />
    </>
  );
}
