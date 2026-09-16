import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { SubcontractStatus } from "@/generated/prisma/enums";
import { approveSubcontract, closeSubcontract, updateSubcontract } from "@/lib/actions/fulfillment-actions";
import { requireAuth } from "@/lib/auth";
import { money, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDate, formatDateTime } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Subcontract" };

export default async function SubcontractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const subcontract = await prisma.subcontract.findFirst({
    where: { id, tenantId },
    include: {
      order: { include: { customer: { select: { companyName: true } } } },
      supplier: { select: { id: true, name: true, phone: true, whatsappNumber: true } },
    },
  });
  if (!subcontract) notFound();

  const activity = await prisma.activityLog.findMany({
    where: { tenantId, entityType: "SUBCONTRACT", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  const canEdit = canManage(auth.user.role, "fulfillment");
  const approverName = subcontract.approvedById
    ? (await prisma.user.findUnique({ where: { id: subcontract.approvedById }, select: { name: true } }))?.name
    : null;

  return (
    <>
      <PageHeader
        title={`Subcontract ${subcontract.number}`}
        breadcrumbs={[{ label: "Fulfillment", href: "/fulfillment" }, { label: subcontract.number }]}
        meta={
          <>
            <StatusBadge value={subcontract.status} />
            <Link href={`/orders/${subcontract.orderId}`} className="text-xs text-indigo-600 hover:underline">
              Order {subcontract.order.number}
            </Link>
            <Link href={`/suppliers/${subcontract.supplier.id}`} className="text-xs text-slate-500 hover:underline">
              {subcontract.supplier.name}
            </Link>
            <span className="text-xs text-slate-500">{money(subcontract.value)}</span>
          </>
        }
        actions={
          <>
            {canEdit && subcontract.status !== SubcontractStatus.APPROVED && subcontract.status !== SubcontractStatus.COMPLETED ? (
              <ActionForm action={approveSubcontract.bind(null, subcontract.id)}>
                <SubmitButton pendingLabel="…">Approve for handover</SubmitButton>
              </ActionForm>
            ) : null}
            {canEdit && subcontract.status === SubcontractStatus.APPROVED ? (
              <ActionForm action={closeSubcontract.bind(null, subcontract.id)}>
                <SubmitButton pendingLabel="…">Mark completed</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Progress"
              description="Persentase penyelesaian dan hasil inspeksi."
              actions={<span className="text-sm font-medium text-slate-700">{num(subcontract.progressPercent)}%</span>}
            />
            <div className="px-5 pt-4">
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${num(subcontract.progressPercent)}%` }} />
              </div>
            </div>
            <CardBody className="text-sm text-slate-600">
              <p className="whitespace-pre-line">{subcontract.description ?? "Tidak ada deskripsi tambahan."}</p>
              {subcontract.inspectionResult ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Hasil inspeksi: {subcontract.inspectionResult}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {subcontract.approvalNote ? (
            <Card>
              <CardHeader title="Internal approval" description={`Disetujui ${approverName ?? "—"} pada ${formatDateTime(subcontract.approvedAt)}`} />
              <CardBody className="text-sm text-slate-700">{subcontract.approvalNote}</CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {canEdit ? (
            <Card>
              <CardHeader title="Update progress" />
              <CardBody>
                <FormShell action={updateSubcontract.bind(null, subcontract.id)} submitLabel="Save" size="sm">
                  <div className="space-y-3">
                    <Field label="Status">
                      <Select name="status" defaultValue={subcontract.status}>
                        {Object.values(SubcontractStatus).map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Progress (%)">
                      <Input name="progressPercent" type="number" step="1" defaultValue={num(subcontract.progressPercent)} />
                    </Field>
                    <Field label="Inspection result">
                      <Textarea name="inspectionResult" defaultValue={subcontract.inspectionResult ?? ""} />
                    </Field>
                  </div>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Subcontract details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Scope", value: subcontract.scope },
                  { label: "Subcontractor", value: subcontract.supplier.name },
                  { label: "Value", value: money(subcontract.value) },
                  { label: "Scheduled", value: `${formatDate(subcontract.scheduledStart)} → ${formatDate(subcontract.scheduledEnd)}` },
                  { label: "Approved by", value: approverName ?? "—" },
                  { label: "Completed", value: subcontract.completedAt ? formatDateTime(subcontract.completedAt) : "—" },
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
