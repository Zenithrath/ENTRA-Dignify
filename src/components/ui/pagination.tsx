import Link from "next/link";

import { buttonClass } from "@/components/ui/button";

export function buildQuery(params: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function Pagination({
  path,
  params,
  page,
  totalPages,
  total,
}: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  total: number;
}) {
  if (total === 0) return null;

  return (
    <div className="no-print flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
      <span>
        Page {page} of {Math.max(totalPages, 1)} — {total.toLocaleString("id-ID")} records
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={`${path}${buildQuery(params, { page: String(page - 1) })}`} className={buttonClass("secondary", "sm")}>
            Previous
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-40")}>Previous</span>
        )}
        {page < totalPages ? (
          <Link href={`${path}${buildQuery(params, { page: String(page + 1) })}`} className={buttonClass("secondary", "sm")}>
            Next
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-40")}>Next</span>
        )}
      </div>
    </div>
  );
}
