import { cn } from "@/lib/cn";

export type DescriptionItem = {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
};

export function DescriptionList({ items, columns = 2 }: { items: DescriptionItem[]; columns?: 2 | 3 }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-4", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((item) => (
        <div key={item.label} className={cn(item.wide && "sm:col-span-full")}>
          <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
