import { money, num, qty, type MoneyLike } from "@/lib/money";
import { formatDate } from "@/lib/queries/common";

export type PrintTenant = {
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  logoUrl: string | null;
};

export function Letterhead({ tenant, docTitle, docNumber, meta }: {
  tenant: PrintTenant;
  docTitle: string;
  docNumber: string;
  meta: { label: string; value: string }[];
}) {
  return (
    <header className="mb-8 flex items-start justify-between gap-8 border-b border-slate-200 pb-6">
      <div>
        <p className="text-lg font-semibold text-slate-900">{tenant.legalName ?? tenant.name}</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-600">
          {[tenant.address, tenant.city].filter(Boolean).join(", ")}
          {tenant.phone ? <br /> : null}
          {tenant.phone}
          {tenant.email ? ` · ${tenant.email}` : ""}
          {tenant.taxNumber ? <br /> : null}
          {tenant.taxNumber ? `NPWP ${tenant.taxNumber}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xl font-semibold uppercase tracking-wide text-slate-900">{docTitle}</p>
        <p className="mt-1 font-mono text-sm text-slate-700">{docNumber}</p>
        <dl className="mt-3 space-y-0.5 text-xs text-slate-600">
          {meta.map((item) => (
            <div key={item.label} className="flex justify-end gap-3">
              <dt className="text-slate-500">{item.label}</dt>
              <dd className="font-medium text-slate-800">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

export type PrintLine = {
  description: string;
  quantity: MoneyLike;
  unit: string;
  unitPrice: MoneyLike;
  discountPercent?: MoneyLike;
  taxRate?: MoneyLike;
  lineTotal: MoneyLike;
};

/** Pricing columns are dropped entirely for delivery notes, which only list quantities. */
export function PrintTable({ lines, showTax = true }: { lines: PrintLine[]; showTax?: boolean }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2">#</th>
          <th className="py-2">Description</th>
          <th className="py-2 text-right">Qty</th>
          {showTax ? <th className="py-2 text-right">Unit price</th> : null}
          {showTax ? <th className="py-2 text-right">Disc</th> : null}
          {showTax ? <th className="py-2 text-right">Tax</th> : null}
          {showTax ? <th className="py-2 text-right">Amount</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-slate-100">
            <td className="py-2 text-xs text-slate-500">{index + 1}</td>
            <td className="py-2 text-slate-800">{line.description}</td>
            <td className="py-2 text-right text-slate-700">
              {qty(line.quantity)} {line.unit}
            </td>
            {showTax ? <td className="py-2 text-right text-slate-700">{money(line.unitPrice)}</td> : null}
            {showTax ? (
              <td className="py-2 text-right text-slate-700">
                {num(line.discountPercent) > 0 ? `${num(line.discountPercent)}%` : "—"}
              </td>
            ) : null}
            {showTax ? <td className="py-2 text-right text-slate-700">{num(line.taxRate)}%</td> : null}
            {showTax ? <td className="py-2 text-right font-medium text-slate-900">{money(line.lineTotal)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PrintTotals({
  rows,
  highlight,
}: {
  rows: { label: string; value: MoneyLike; show?: boolean }[];
  highlight?: { label: string; value: MoneyLike };
}) {
  return (
    <div className="mt-6 ml-auto w-full max-w-xs text-sm">
      {rows
        .filter((row) => row.show !== false)
        .map((row) => (
          <div key={row.label} className="flex items-center justify-between border-b border-slate-100 py-1.5">
            <span className="text-slate-600">{row.label}</span>
            <span className="text-slate-800">{money(row.value)}</span>
          </div>
        ))}
      {highlight ? (
        <div className="mt-2 flex items-center justify-between border-t-2 border-slate-800 pt-2 text-base">
          <span className="font-semibold text-slate-900">{highlight.label}</span>
          <span className="font-semibold text-slate-900">{money(highlight.value)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SignatureBlocks({
  left,
  right,
}: {
  left: { title: string; name?: string | null };
  right: { title: string; name?: string | null };
}) {
  return (
    <div className="mt-14 grid grid-cols-2 gap-10 text-center text-xs text-slate-600">
      {[left, right].map((block) => (
        <div key={block.title}>
          <p>{block.title}</p>
          <div className="mt-12 border-t border-slate-400 pt-1">
            <p className="font-medium text-slate-800">{block.name ?? "_____________________"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PrintFooter({ tenant, note }: { tenant: PrintTenant; note?: string | null }) {
  return (
    <footer className="mt-10 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500">
      {note ? <p className="mb-1 text-slate-600">{note}</p> : null}
      <p>
        Dokumen ini dibuat oleh sistem {tenant.name}. Diterbitkan {formatDate(new Date())}.
      </p>
    </footer>
  );
}
