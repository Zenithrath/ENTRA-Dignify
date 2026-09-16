import Link from "next/link";

import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/status";

const ACCENTS: Record<Tone, string> = {
  neutral: "text-slate-900",
  info: "text-blue-700",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
  accent: "text-indigo-700",
};

export function MetricCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", ACCENTS[tone])}>{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        {body}
      </Link>
    );
  }

  return body;
}
