import Link from "next/link";
import { Download } from "lucide-react";

import { cn } from "@/lib/cn";
import { AGING_THRESHOLD_DAYS } from "@/lib/tracker";

/** Kolom aging Sheet 1 — merah hanya kalau masih Waiting PO dan lewat threshold. */
export function AgingBadge({
  days,
  frozen,
  className,
}: {
  days: number;
  frozen?: boolean;
  className?: string;
}) {
  const overdue = !frozen && days > AGING_THRESHOLD_DAYS;
  return (
    <span
      title={
        frozen
          ? "Aging berhenti saat PO diterima"
          : overdue
            ? `Lewat threshold ${AGING_THRESHOLD_DAYS} hari`
            : `${AGING_THRESHOLD_DAYS - days} hari menuju threshold`
      }
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        overdue
          ? "bg-rose-600 text-white"
          : frozen
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
            : "bg-slate-100 text-slate-600",
        className,
      )}
    >
      {days} hari
    </span>
  );
}

/** Kartu angka ringkas ala kartu TotSal — tanpa chart. */
export function TrackerStat({
  label,
  value,
  hint,
  tone = "neutral",
  dark,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger" | "success" | "warning";
  dark?: boolean;
}) {
  const dot =
    tone === "danger"
      ? "bg-rose-500"
      : tone === "success"
        ? "bg-emerald-500"
        : tone === "warning"
          ? "bg-amber-500"
          : "bg-slate-300";
  return (
    <div
      className={cn(
        "rounded-2xl p-4 shadow-sm",
        dark ? "bg-slate-900 text-white" : "bg-white text-slate-900",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        <span className={dark ? "text-slate-300" : "text-slate-500"}>{label}</span>
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {hint ? (
        <p className={cn("mt-0.5 text-xs", dark ? "text-slate-400" : "text-slate-500")}>{hint}</p>
      ) : null}
    </div>
  );
}

export function ExportButton({ href, label = "Export Excel" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 hover:text-rose-600 hover:ring-rose-200"
    >
      <Download className="h-4 w-4" />
      {label}
    </Link>
  );
}
