import { PrintButton } from "@/components/print-button";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();

  return (
    <div className="min-h-screen bg-slate-100 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-4">
        <p className="text-xs text-slate-500">
          Gunakan tombol di kanan untuk menyimpan sebagai PDF (Save as PDF pada dialog print).
        </p>
        <PrintButton />
      </div>
      <div className="print-surface mx-auto max-w-[820px] bg-white px-10 py-9 shadow-sm">{children}</div>
    </div>
  );
}
