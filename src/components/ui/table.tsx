import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/empty-state";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function TH({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-rose-100 bg-[#FDF2F4] px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-b border-slate-100 px-4 py-3 align-middle text-slate-700", className)}>{children}</td>;
}

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  className?: string;
  render: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }

  return (
    <Table>
      <thead>
        <tr>
          {columns.map((column) => (
            <TH key={column.key} className={column.className}>
              {column.header}
            </TH>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="transition-colors hover:bg-slate-50/70">
            {columns.map((column) => (
              <TD key={column.key} className={column.className}>
                {column.render(row)}
              </TD>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
