import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { FormShell } from "@/components/form-shell";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { AttachmentEntity, WorkOrderStatus } from "@/generated/prisma/enums";
import { addWorkOrderLog, completeWorkOrder, toggleWorkOrderTask, updateWorkOrder } from "@/lib/actions/fulfillment-actions";
import { requireAuth } from "@/lib/auth";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate, formatDateTime, toDateInput, tenantUsers } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Work order" };

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id, tenantId },
    include: {
      order: { include: { customer: { select: { id: true, companyName: true } } } },
      tasks: { orderBy: { sortOrder: "asc" } },
      logs: { orderBy: { logDate: "desc" } },
    },
  });
  if (!workOrder) notFound();

  const [users, attachments, activity] = await Promise.all([
    tenantUsers(tenantId),
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.WORK_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: AttachmentEntity.WORK_ORDER, entityId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  const canEdit = canManage(auth.user.role, "fulfillment");
  const assignee = users.find((user) => user.id === workOrder.assigneeId);
  const completedTasks = workOrder.tasks.filter((task) => task.isCompleted).length;

  return (
    <>
      <PageHeader
        title={`Work order ${workOrder.number}`}
        breadcrumbs={[{ label: "Fulfillment", href: "/fulfillment" }, { label: workOrder.number }]}
        meta={
          <>
            <StatusBadge value={workOrder.status} />
            <Link href={`/orders/${workOrder.orderId}`} className="text-xs text-indigo-600 hover:underline">
              Order {workOrder.order.number}
            </Link>
            <span className="text-xs text-slate-500">{workOrder.order.customer.companyName}</span>
            <span className="text-xs text-slate-500">
              {completedTasks}/{workOrder.tasks.length} task selesai
            </span>
          </>
        }
        actions={
          canEdit && workOrder.status !== WorkOrderStatus.COMPLETED ? (
            <FormShell action={completeWorkOrder.bind(null, workOrder.id)} submitLabel="Complete + handover" size="md">
              <div className="space-y-3">
                <Field label="Handover note">
                  <Input name="handoverNote" placeholder="cth. serah terima ditandatangani customer" />
                </Field>
                <Field label="Link handover document">
                  <Input name="handoverUrl" placeholder="https://…" />
                </Field>
              </div>
            </FormShell>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Execution checklist"
              description="Progress dihitung otomatis dari checklist ini."
              actions={<span className="text-sm font-medium text-slate-700">{num(workOrder.progressPercent)}%</span>}
            />
            <div className="px-5 pt-4">
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${num(workOrder.progressPercent)}%` }} />
              </div>
            </div>
            {workOrder.tasks.length === 0 ? (
              <CardBody className="text-xs text-slate-500">Belum ada checklist.</CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {workOrder.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                          task.isCompleted ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {task.isCompleted ? "✓" : "•"}
                      </span>
                      <div>
                        <p className={`text-sm ${task.isCompleted ? "text-slate-500 line-through" : "text-slate-800"}`}>
                          {task.name}
                        </p>
                        {task.completedAt ? (
                          <p className="text-xs text-slate-500">Selesai {formatDateTime(task.completedAt)}</p>
                        ) : null}
                      </div>
                    </div>
                    {canEdit ? (
                      <ActionForm action={toggleWorkOrderTask.bind(null, workOrder.id, task.id)}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          {task.isCompleted ? "Reopen" : "Mark done"}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Daily execution log" description="Catatan harian dan foto/dokumen selama pengerjaan." />
            {workOrder.logs.length === 0 ? (
              <CardBody className="text-xs text-slate-500">Belum ada log harian.</CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {workOrder.logs.map((log) => (
                  <li key={log.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-800">{log.note}</p>
                      <span className="text-xs text-slate-500">
                        {formatDate(log.logDate)}
                        {log.hoursSpent ? ` · ${num(log.hoursSpent)} jam` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={addWorkOrderLog.bind(null, workOrder.id)} submitLabel="Add log" size="sm">
                  <FormGrid columns={3}>
                    <Field label="Date">
                      <Input type="date" name="logDate" defaultValue={new Date().toISOString().slice(0, 10)} />
                    </Field>
                    <Field label="Hours">
                      <Input name="hoursSpent" type="number" step="0.5" />
                    </Field>
                    <Field label="Note" required className="sm:col-span-3">
                      <Textarea name="note" required placeholder="Apa yang dikerjakan hari ini" />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          {canEdit ? (
            <Card>
              <CardHeader title="Update work order" />
              <CardBody>
                <FormShell action={updateWorkOrder.bind(null, workOrder.id)} submitLabel="Save" size="sm">
                  <div className="space-y-3">
                    <Field label="Status">
                      <Select name="status" defaultValue={workOrder.status}>
                        {Object.values(WorkOrderStatus).map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Progress (%)">
                      <Input name="progressPercent" type="number" step="1" defaultValue={num(workOrder.progressPercent)} />
                    </Field>
                    <Field label="Assignee">
                      <Select name="assigneeId" defaultValue={workOrder.assigneeId ?? ""}>
                        <option value="">Unassigned</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Team">
                      <Input name="teamName" defaultValue={workOrder.teamName ?? ""} />
                    </Field>
                    <FormGrid>
                      <Field label="Start">
                        <Input type="date" name="scheduledStart" defaultValue={toDateInput(workOrder.scheduledStart)} />
                      </Field>
                      <Field label="End">
                        <Input type="date" name="scheduledEnd" defaultValue={toDateInput(workOrder.scheduledEnd)} />
                      </Field>
                    </FormGrid>
                  </div>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Work order details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Title", value: workOrder.title },
                  { label: "Assignee", value: assignee?.name ?? "—" },
                  { label: "Team", value: workOrder.teamName ?? "—" },
                  { label: "Scheduled", value: `${formatDate(workOrder.scheduledStart)} → ${formatDate(workOrder.scheduledEnd)}` },
                  { label: "Started", value: workOrder.startedAt ? formatDateTime(workOrder.startedAt) : "—" },
                  { label: "Completed", value: workOrder.completedAt ? formatDateTime(workOrder.completedAt) : "—" },
                  { label: "Handover note", value: workOrder.handoverNote ?? "—", wide: true },
                  {
                    label: "Handover document",
                    value: workOrder.handoverUrl ? (
                      <a href={workOrder.handoverUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                        {workOrder.handoverUrl}
                      </a>
                    ) : (
                      "—"
                    ),
                    wide: true,
                  },
                  { label: "Scope", value: workOrder.description ?? "—", wide: true },
                ]}
              />
            </CardBody>
          </Card>

          <AttachmentPanel
            entityType={AttachmentEntity.WORK_ORDER}
            entityId={workOrder.id}
            attachments={attachments}
            canEdit={canEdit}
          />

          {activity.length > 0 ? (
            <Card>
              <CardHeader title="Activity" />
              <ul className="divide-y divide-slate-100">
                {activity.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-sm text-slate-800">{entry.summary ?? entry.action}</p>
                    <p className="text-xs text-slate-500">{entry.userName ?? "System"}</p>
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
