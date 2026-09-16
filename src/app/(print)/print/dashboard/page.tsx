import { Letterhead, PrintFooter } from "@/components/print-document";
import { requireAuth } from "@/lib/auth";
import { money, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime } from "@/lib/queries/common";
import { dashboardData, resolveRange, type RangeKey } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

export default async function PrintDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;
  const tenantId = auth.user.tenantId;

  const rangeKey = (["week", "month", "quarter"].includes(params.range ?? "") ? params.range : "month") as RangeKey;
  const range = resolveRange(rangeKey, params.from, params.to);
  const data = await dashboardData(tenantId, range, auth.user.role);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const rangeLabel = `${formatDate(range.from)} – ${formatDate(range.to)}`;

  return (
    <>
      <Letterhead
        tenant={tenant}
        docTitle="Dashboard Summary"
        docNumber={rangeLabel}
        meta={[
          { label: "Dicetak", value: formatDateTime(new Date()) },
          { label: "Role", value: auth.user.role },
        ]}
      />

      <section className="mt-4">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Metrik
        </h2>
        <div className="grid grid-cols-2 gap-x-8">
          {data.metrics.map((metric) => (
            <Row key={metric.id} label={`${metric.label}${metric.hint ? ` — ${metric.hint}` : ""}`} value={metric.value} />
          ))}
        </div>
      </section>

      {data.insights.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Insights
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
            {data.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Needs attention
        </h2>
        {data.attention.length === 0 ? (
          <p className="text-xs text-slate-600">Semua indikator dalam batas normal.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="py-1.5">Item</th>
                <th className="py-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.attention.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium text-slate-800">{item.title}</td>
                  <td className="py-1.5 text-slate-600">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.unbilledOrders.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Order selesai belum ditagih
          </h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="py-1.5">Order</th>
                <th className="py-1.5 text-right">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {data.unbilledOrders.map((order) => (
                <tr key={order.id} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-800">{order.number}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">{money(num(order.grandTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <PrintFooter tenant={tenant} note={`Ringkasan dashboard periode ${rangeLabel}.`} />
    </>
  );
}
