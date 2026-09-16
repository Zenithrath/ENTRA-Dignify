import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/queries/common";
import { money, num } from "@/lib/money";
import { canApprove } from "@/lib/rbac";
import { pendingApprovalsFor } from "@/lib/approvals";
import { DocType, Role } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Approvals" };

const TABS = [
  { id: "approvals", label: "Pending approvals", href: "/settings/approvals" },
  { id: "workflow", label: "Rules & thresholds", href: "/settings/workflow" },
];

const DOC_LABEL: Partial<Record<DocType, string>> = {
  [DocType.QUOTATION]: "Quotation",
  [DocType.PURCHASE_ORDER]: "Purchase order",
  [DocType.INVOICE]: "Invoice",
};

export default async function SettingsApprovalsPage() {
  const auth = await requireAuth();
  const pending = await pendingApprovalsFor(auth.user.tenantId, auth.user.role);
  const isApprover = canApprove(auth.user.role);

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Dokumen yang menunggu persetujuan internal sebelum bisa dikirim."
        actions={
          <Link href="/settings/workflow" className={buttonClass("secondary", "md")}>
            Atur threshold
          </Link>
        }
      />
      <Tabs items={TABS} active="approvals" />

      <Card>
        <CardHeader
          title={`Menunggu persetujuan (${pending.length})`}
          description={
            isApprover
              ? auth.user.role === Role.OWNER
                ? "Owner melihat seluruh antrean approval."
                : "Ditampilkan sesuai role approver Anda."
              : "Role Anda tidak termasuk approver — hubungi Owner/Manager."
          }
        />
        {pending.length === 0 ? (
          <EmptyState title="Tidak ada approval tertunda" description="Semua dokumen sudah diputuskan." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.recordNumber ?? item.recordId}
                    </p>
                    <Badge tone="warning">{DOC_LABEL[item.docType] ?? item.docType}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {money(num(String(item.amount)))} · diminta {formatDateTime(item.createdAt)} · approver: {item.approverRole}
                  </p>
                </div>
                <Link href={item.href} className={buttonClass("secondary", "sm")} prefetch={false}>
                  Buka dokumen
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
