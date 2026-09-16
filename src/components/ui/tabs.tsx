import Link from "next/link";

import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
};

export function Tabs({ items, active }: { items: TabItem[]; active: string }) {
  return (
    <div className="no-print flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            prefetch={false}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
