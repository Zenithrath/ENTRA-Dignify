import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { AttachmentPanel } from "@/components/attachment-panel";
import { NotePanel } from "@/components/note-panel";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { FormShell } from "@/components/form-shell";
import { AttachmentEntity, LostReason, RequestStatus } from "@/generated/prisma/enums";
import { assignRequest, closeRequest, createQuotationFromRequest } from "@/lib/actions/request-actions";
import { requireAuth } from "@/lib/auth";
import { money, num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { enumOptions, statusMeta } from "@/lib/status";
import { actorName, formatDate, formatDateTime, relativeDays, tenantUsers } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Request" };

const OPEN_STATUSES: RequestStatus[] = [
  RequestStatus.NEW,
  RequestStatus.PREPARING_QUOTATION,
  RequestStatus.QUOTATION_SENT,
  RequestStatus.WAITING_RESPONSE,
];

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const request = await prisma.request.findFirst({
    where: { id, tenantId },
    include: {
      customer: { select: { id: true, companyName: true, paymentTerms: true, email: true, whatsappNumber: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { product: { select: { id: true, name: true, sku: true } } } },
      quotations: { orderBy: { quotationDate: "desc" } },
    },
  });
  if (!request) notFound();

  const [users, comments, attachments, activity] = await Promise.all([
    tenantUsers(tenantId),
    prisma.comment.findMany({
      where: { tenantId, entityType: AttachmentEntity.REQUEST, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attachment.findMany({
      where: { tenantId, entityType: AttachmentEntity.REQUEST, entityId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { tenantId, entityType: AttachmentEntity.REQUEST, entityId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const canEdit = canManage(auth.user.role, "requests");
  const canQuote = canManage(auth.user.role, "quotations");
  const aging = relativeDays(request.requestDate) ?? 0;
  const isOpen = OPEN_STATUSES.includes(request.status);
  const targetValue = request.items.reduce((total, item) => total + num(item.targetPrice) * num(item.quantity), 0);

  return (
    <>
      <PageHeader
        title={`Request ${request.number}`}
        breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: request.number }]}
        meta={
          <>
            <StatusBadge value={request.status} />
            <Link href={`/customers/${request.customer.id}`} className="text-xs text-indigo-600 hover:underline">
              {request.customer.companyName}
            </Link>
            <span className="text-xs text-slate-500">Source: {statusMeta(request.source).label}</span>
            <span className={`text-xs ${isOpen && aging > 3 ? "font-medium text-rose-600" : "text-slate-500"}`}>
              Aging {aging} hari
            </span>
            <span className="text-xs text-slate-500">Assigned: {actorName(users, request.assignedToId)}</span>
          </>
        }
        actions={
          canQuote && isOpen ? (
            <ActionForm action={createQuotationFromRequest.bind(null, request.id)}>
              <SubmitButton pendingLabel="Preparing…">Create quotation</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Requested items"
              description="Item dan target harga dari customer"
              actions={<span className="text-xs text-slate-500">Est. value {money(targetValue)}</span>}
            />
            <DataTable
              rows={request.items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  render: (row) => (
                    <div>
                      <p className="text-sm text-slate-900">{row.description}</p>
                      {row.product ? (
                        <Link href={`/products/${row.product.id}`} className="text-xs text-indigo-600 hover:underline">
                          {row.product.sku}
                        </Link>
                      ) : null}
                      {row.note ? <p className="text-xs text-slate-500">{row.note}</p> : null}
                    </div>
                  ),
                },
                {
                  key: "qty",
                  header: "Qty",
                  render: (row) => (
                    <span className="text-sm">
                      {num(row.quantity)} {row.unit}
                    </span>
                  ),
                },
                {
                  key: "target",
                  header: "Target price",
                  render: (row) => <span className="text-sm">{row.targetPrice ? money(row.targetPrice) : "—"}</span>,
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Quotations for this request" />
            {request.quotations.length === 0 ? (
              <EmptyState
                title="Belum ada quotation"
                description="Gunakan tombol Create quotation untuk menyalin item request tanpa input ulang."
              />
            ) : (
              <DataTable
                rows={request.quotations}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "number",
                    header: "Quotation",
                    render: (row) => (
                      <Link href={`/quotations/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {row.number} <span className="text-xs text-slate-500">v{row.version}</span>
                      </Link>
                    ),
                  },
                  { key: "date", header: "Date", render: (row) => <span className="text-sm">{formatDate(row.quotationDate)}</span> },
                  { key: "total", header: "Grand total", render: (row) => <span className="text-sm font-medium">{money(row.grandTotal)}</span> },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                ]}
              />
            )}
          </Card>

          <NotePanel entityType={AttachmentEntity.REQUEST} entityId={request.id} notes={comments} canEdit={canEdit} />

          <AttachmentPanel
            entityType={AttachmentEntity.REQUEST}
            entityId={request.id}
            attachments={attachments}
            canEdit={canEdit}
          />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Request details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Number", value: request.number },
                  { label: "Customer", value: request.customer.companyName },
                  { label: "Received", value: formatDate(request.requestDate) },
                  { label: "Source", value: statusMeta(request.source).label },
                  { label: "Payment terms", value: request.customer.paymentTerms ?? "—" },
                  { label: "Reference", value: request.customerRef ?? "—" },
                  { label: "Closed at", value: request.closedAt ? formatDateTime(request.closedAt) : "—" },
                  { label: "Lost reason", value: request.lostReason ? statusMeta(request.lostReason).label : "—" },
                  { label: "Notes", value: request.notes ?? "—", wide: true },
                  { label: "Lost note", value: request.lostNote ?? "—", wide: true },
                ]}
              />
            </CardBody>
          </Card>

          {canEdit ? (
            <Card>
              <CardHeader title="Assign owner" description="Sales rep yang bertanggung jawab atas request ini." />
              <CardBody>
                <FormShell action={assignRequest.bind(null, request.id)} submitLabel="Save assignment" size="sm">
                  <Field label="Assigned to">
                    <Select name="assignedToId" defaultValue={request.assignedToId ?? ""}>
                      <option value="">Unassigned</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({user.role})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          {canEdit && isOpen ? (
            <Card>
              <CardHeader title="Close request" description="Wajib isi alasan kalau tidak deal." />
              <CardBody className="space-y-5">
                <FormShell action={closeRequest.bind(null, request.id)} submitLabel="Close as won" size="sm" hidden={{ outcome: "won" }}>
                  <p className="text-xs text-slate-500">Tandai request berhasil menjadi order.</p>
                </FormShell>

                <FormShell
                  action={closeRequest.bind(null, request.id)}
                  submitLabel="Close as lost"
                  size="sm"
                  variant="danger"
                  hidden={{ outcome: "lost" }}
                >
                  <div className="space-y-3">
                    <Field label="Lost reason" required>
                      <Select name="lostReason" defaultValue={LostReason.PRICE_TOO_HIGH}>
                        {enumOptions(LostReason).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Note">
                      <Textarea name="lostNote" placeholder="Detail kenapa kalah / dibatalkan" />
                    </Field>
                  </div>
                </FormShell>
              </CardBody>
            </Card>
          ) : null}

          {activity.length > 0 ? (
            <Card>
              <CardHeader title="Activity" description="Read-only audit trail" />
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

          <Link href="/requests" className={buttonClass("ghost", "sm")} prefetch={false}>
            ← Back to requests
          </Link>
        </div>
      </div>
    </>
  );
}
