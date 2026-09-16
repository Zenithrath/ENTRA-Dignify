import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Field, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { QcResult } from "@/generated/prisma/enums";
import { advanceProductionStage, recordQc } from "@/lib/actions/fulfillment-actions";
import { requireAuth } from "@/lib/auth";
import { num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate, formatDateTime, relativeDays } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Production order" };

export default async function ProductionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const production = await prisma.productionOrder.findFirst({
    where: { id, tenantId },
    include: {
      order: { include: { customer: { select: { companyName: true } } } },
      stages: { orderBy: { sortOrder: "asc" } },
      qcRecords: { orderBy: { inspectedAt: "desc" } },
    },
  });
  if (!production) notFound();

  const [users, activity] = await Promise.all([
    prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: "PRODUCTION_ORDER", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  const inspectorName = new Map(users.map((user) => [user.id, user.name]));
  const canEdit = canManage(auth.user.role, "fulfillment");
  const doneStages = production.stages.filter((stage) => stage.status === "DONE").length;

  return (
    <>
      <PageHeader
        title={`Production ${production.number}`}
        breadcrumbs={[{ label: "Fulfillment", href: "/fulfillment" }, { label: production.number }]}
        meta={
          <>
            <StatusBadge value={production.status} />
            <Link href={`/orders/${production.orderId}`} className="text-xs text-indigo-600 hover:underline">
              Order {production.order.number}
            </Link>
            <span className="text-xs text-slate-500">{production.order.customer.companyName}</span>
            <span className="text-xs text-slate-500">
              Tahap {doneStages}/{production.stages.length} selesai
            </span>
            {production.scheduledEnd ? (
              <span className={`text-xs ${production.scheduledEnd < new Date() && production.status !== "COMPLETED" ? "text-rose-600" : "text-slate-500"}`}>
                Target selesai {formatDate(production.scheduledEnd)}
              </span>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Production stages"
              description="Klik tahap untuk memajukan status (tahap mengikuti Workflow Builder di Settings)."
            />
            <ol className="divide-y divide-slate-100">
              {production.stages.map((stage, index) => (
                <li key={stage.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        stage.status === "DONE"
                          ? "bg-emerald-100 text-emerald-700"
                          : stage.status === "IN_PROGRESS"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{stage.name}</p>
                      <p className="text-xs text-slate-500">
                        {stage.completedAt
                          ? `Selesai ${formatDateTime(stage.completedAt)}`
                          : stage.startedAt
                            ? `Mulai ${formatDate(stage.startedAt)}`
                            : "Belum mulai"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={stage.status} />
                    {canEdit ? (
                      <ActionForm action={advanceProductionStage.bind(null, production.id, stage.id)}>
                        <SubmitButton variant="secondary" size="sm" pendingLabel="…">
                          Advance
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="QC records" description="Pass melanjutkan ke delivery, fail kembali ke tahap produksi." />
            {production.qcRecords.length === 0 ? (
              <CardBody className="text-xs text-slate-500">Belum ada inspeksi QC.</CardBody>
            ) : (
              <DataTable
                rows={production.qcRecords}
                rowKey={(row) => row.id}
                columns={[
                  { key: "date", header: "Inspected", render: (row) => <span className="text-sm">{formatDateTime(row.inspectedAt)}</span> },
                  { key: "result", header: "Result", render: (row) => <StatusBadge value={row.result} /> },
                  { key: "note", header: "Note", render: (row) => <span className="text-sm">{row.note ?? "—"}</span> },
                  {
                    key: "by",
                    header: "Inspector",
                    render: (row) => <span className="text-sm">{row.inspectedById ? (inspectorName.get(row.inspectedById) ?? "—") : "—"}</span>,
                  },
                ]}
              />
            )}
            {canEdit ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={recordQc.bind(null, production.id)} submitLabel="Record QC" size="sm">
                  <div className="space-y-3">
                    <Field label="Result" required>
                      <Select name="result" defaultValue={QcResult.PASS}>
                        {Object.values(QcResult).map((result) => (
                          <option key={result} value={result}>
                            {result}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Note">
                      <Textarea name="note" placeholder="Temuan inspeksi, dimensi, atau catatan rework" />
                    </Field>
                  </div>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Production details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Description", value: production.description ?? "—" },
                  {
                    label: "Quantity",
                    value: `${qty(production.quantity)} ${production.unit}`,
                  },
                  { label: "Current stage", value: production.currentStage ?? "—" },
                  { label: "Scheduled", value: `${formatDate(production.scheduledStart)} → ${formatDate(production.scheduledEnd)}` },
                  { label: "Started", value: production.startedAt ? formatDateTime(production.startedAt) : "—" },
                  { label: "Completed", value: production.completedAt ? formatDateTime(production.completedAt) : "—" },
                  { label: "Age", value: `${relativeDays(production.createdAt) ?? 0} hari` },
                ]}
              />
            </CardBody>
          </Card>

          {activity.length > 0 ? (
            <Card>
              <CardHeader title="Activity" />
              <ul className="divide-y divide-slate-100">
                {activity.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-sm text-slate-800">{entry.summary ?? entry.action}</p>
                    <p className="text-xs text-slate-500">
                      {entry.userName ?? "System"} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Link href="/fulfillment" className={buttonClass("ghost", "sm")} prefetch={false}>
            ← Back to fulfillment
          </Link>
        </div>
      </div>
    </>
  );
}
