import Link from "next/link";

import { buttonClass } from "@/components/ui/button";

export function FilterBar({
  action,
  children,
  extra,
}: {
  action: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="no-print flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {extra}
        <button type="submit" className={buttonClass("secondary", "sm")}>
          Apply
        </button>
        <Link href={action} className={buttonClass("ghost", "sm")} prefetch={false}>
          Reset
        </Link>
      </div>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
