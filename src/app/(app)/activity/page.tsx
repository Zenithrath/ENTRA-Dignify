import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DataTable } from "@/components/ui/table";
import { AttachmentEntity } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeAllActivity } from "@/lib/rbac";
import { statusMeta, titleize } from "@/lib/status";
import { actorMap, formatDateTime, pagination, readParams, tenantUsers } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["user", "entity", "action", "from", "to", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const users = await tenantUsers(tenantId);
  const names = actorMap(users);
  // Non-manager roles only see their own trail; Owner/Manager see the whole tenant.
  const scopedToSelf = !canSeeAllActivity(auth.user.role);

  const where = {
    tenantId,
    ...(scopedToSelf ? { userId: auth.user.id } : {}),
    ...(params.user ? { userId: params.user } : {}),
    ...(params.entity && Object.values(AttachmentEntity).includes(params.entity as AttachmentEntity)
      ? { entityType: params.entity as AttachmentEntity }
      : {}),
    ...(params.action ? { action: params.action as never } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Jejak audit read-only: siapa mengubah apa, kapan, dan nilai lama → baru."
      />

      <Card>
        <CardHeader
          title="Audit trail"
          description={scopedToSelf ? "Menampilkan aktivitas Anda saja." : "Seluruh aktivitas tenant, tidak bisa diedit siapa pun."}
        />
        <FilterBar action="/activity">
          {!scopedToSelf ? (
            <FilterField label="User">
              <Select name="user" defaultValue={params.user ?? ""} className="h-9 w-44">
                <option value="">Semua user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          ) : null}
          <FilterField label="Entity">
            <Select name="entity" defaultValue={params.entity ?? ""} className="h-9 w-44">
              <option value="">Semua entity</option>
              {Object.values(AttachmentEntity).map((entity) => (
                <option key={entity} value={entity}>
                  {titleize(entity)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Action">
            <Select name="action" defaultValue={params.action ?? ""} className="h-9 w-40">
              <option value="">Semua aksi</option>
              {["CREATE", "UPDATE", "DELETE", "ARCHIVE", "STATUS_CHANGE", "APPROVE", "REJECT", "SEND", "CONVERT", "LOGIN"].map(
                (action) => (
                  <option key={action} value={action}>
                    {titleize(action)}
                  </option>
                ),
              )}
            </Select>
          </FilterField>
          <FilterField label="Dari">
            <Input type="date" name="from" defaultValue={params.from ?? ""} className="h-9 w-40" />
          </FilterField>
          <FilterField label="Sampai">
            <Input type="date" name="to" defaultValue={params.to ?? ""} className="h-9 w-40" />
          </FilterField>
        </FilterBar>

        <DataTable
          rows={logs}
          rowKey={(row) => row.id}
          empty={<EmptyState title="Belum ada aktivitas" description="Semua perubahan penting akan tercatat di sini." />}
          columns={[
            { key: "when", header: "Waktu", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</span> },
            {
              key: "actor",
              header: "User",
              render: (row) => (
                <div>
                  <p className="text-sm">{row.userName ?? names.get(row.userId ?? "") ?? "System"}</p>
                  <p className="text-xs text-slate-500">{row.ipAddress ?? "—"}</p>
                </div>
              ),
            },
            { key: "action", header: "Aksi", render: (row) => <StatusBadge value={row.action} /> },
            {
              key: "entity",
              header: "Record",
              render: (row) => (
                <div>
                  <p className="text-sm">{row.entityLabel ?? row.entityId}</p>
                  <p className="text-xs text-slate-500">
                    {titleize(row.entityType)} · {statusMeta(row.entityType).label === row.entityType ? "" : ""}
                    <span className="font-mono">{row.entityId.slice(0, 8)}</span>
                  </p>
                </div>
              ),
            },
            { key: "summary", header: "Ringkasan", render: (row) => <span className="text-sm text-slate-700">{row.summary ?? "—"}</span> },
            {
              key: "changes",
              header: "Perubahan",
              render: (row) => {
                if (!row.changes || typeof row.changes !== "object") return <span className="text-xs text-slate-400">—</span>;
                return (
                  <ul className="space-y-0.5 text-[11px] text-slate-600">
                    {Object.entries(row.changes as Record<string, { from?: unknown; to?: unknown }>).map(([field, change]) => (
                      <li key={field}>
                        <span className="font-medium">{field}</span>: {String(change?.from ?? "—")} → {String(change?.to ?? "—")}
                      </li>
                    ))}
                  </ul>
                );
              },
            },
          ]}
        />

        <Pagination path="/activity" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>

      <Card>
        <CardBody className="text-xs text-slate-500">
          Log ini bersifat read-only untuk semua role, termasuk Owner. Untuk menelusuri satu record, buka detailnya lalu lihat
          tab Activity di halaman tersebut.{" "}
          <Link href="/notifications" className="text-indigo-600 hover:underline">
            Lihat antrean notifikasi
          </Link>
        </CardBody>
      </Card>
    </>
  );
}
