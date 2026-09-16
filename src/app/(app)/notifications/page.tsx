import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { NotificationStatus } from "@/generated/prisma/enums";
import { cancelNotification, markNotificationRead, retryNotification } from "@/lib/actions/notification-actions";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whatsappEnabled } from "@/lib/notifications";
import { enumOptions, titleize } from "@/lib/status";
import { formatDateTime, pagination, readParams } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;
  const params = readParams(await searchParams, ["status", "channel", "page"]);
  const { page, skip, take, totalPages } = pagination(params);

  const status = Object.values(NotificationStatus).includes(params.status as NotificationStatus)
    ? (params.status as NotificationStatus)
    : undefined;

  const where = { tenantId, ...(status ? { status } : {}), ...(params.channel ? { channel: params.channel as never } : {}) };

  const [total, notifications, counts] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
  ]);

  const countOf = (value: NotificationStatus) => counts.find((row) => row.status === value)?._count._all ?? 0;
  const pending = countOf(NotificationStatus.PENDING);
  const sent = countOf(NotificationStatus.SENT);
  const failed = countOf(NotificationStatus.FAILED);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Antrean notifikasi WhatsApp / email / in-app beserta status pengirimannya."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Pending" value={pending} hint="Belum terkirim" tone={pending > 0 ? "warning" : "success"} href="/notifications?status=PENDING" />
        <MetricCard label="Sent" value={sent} hint="Sudah terkirim" tone="success" />
        <MetricCard
          label="Failed"
          value={failed}
          hint={whatsappEnabled() ? "WhatsApp API aktif" : "Kredensial WhatsApp belum diset"}
          tone={failed > 0 ? "danger" : "neutral"}
          href="/notifications?status=FAILED"
        />
      </div>

      {!whatsappEnabled() ? (
        <Card>
          <CardBody className="text-xs text-slate-600">
            Pengiriman WhatsApp otomatis butuh env <code className="rounded bg-slate-100 px-1">WHATSAPP_PHONE_NUMBER_ID</code> dan{" "}
            <code className="rounded bg-slate-100 px-1">WHATSAPP_ACCESS_TOKEN</code>. Tanpa itu, semua pesan tetap tersimpan
            di antrean ini dan bisa dikirim ulang manual.
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Antrean" />
        <FilterBar action="/notifications">
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status ?? ""} className="h-9 w-40">
              <option value="">Semua status</option>
              {enumOptions(NotificationStatus).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Channel">
            <Select name="channel" defaultValue={params.channel ?? ""} className="h-9 w-40">
              <option value="">Semua channel</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="IN_APP">In-app</option>
            </Select>
          </FilterField>
        </FilterBar>

        <DataTable
          rows={notifications}
          rowKey={(row) => row.id}
          empty={<EmptyState title="Belum ada notifikasi" description="Notifikasi dibuat otomatis saat dokumen berubah status." />}
          columns={[
            {
              key: "message",
              header: "Notifikasi",
              render: (row) => (
                <div className="max-w-md">
                  <p className="text-sm font-medium text-slate-800">{row.subject ?? titleize(row.event)}</p>
                  <p className="text-xs text-slate-500">{row.body}</p>
                  {row.error ? <p className="mt-1 text-[11px] text-rose-600">{row.error}</p> : null}
                </div>
              ),
            },
            {
              key: "recipient",
              header: "Penerima",
              render: (row) => (
                <div>
                  <p className="text-sm">{row.recipientName ?? "Tim internal"}</p>
                  <p className="text-xs text-slate-500">{row.recipient ?? "—"}</p>
                </div>
              ),
            },
            { key: "channel", header: "Channel", render: (row) => <span className="text-sm">{titleize(row.channel)}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            {
              key: "attempts",
              header: "Attempts",
              render: (row) => (
                <span className="text-sm tabular-nums">
                  {row.attempts}
                  {row.sentAt ? <span className="block text-xs text-slate-500">{formatDateTime(row.sentAt)}</span> : null}
                </span>
              ),
            },
            { key: "created", header: "Dibuat", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</span> },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <div className="flex flex-col items-end gap-1">
                  {row.entityId && row.entityType ? (
                    <Link href={entityHref(row.entityType, row.entityId)} className={buttonClass("ghost", "sm")}>
                      Buka record
                    </Link>
                  ) : null}
                  {row.status !== "SENT" && row.status !== "CANCELLED" ? (
                    <ActionForm action={retryNotification.bind(null, row.id)} showError>
                      <SubmitButton variant="secondary" size="sm" pendingLabel="…">
                        Kirim ulang
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {row.channel === "IN_APP" && row.status === "PENDING" ? (
                    <ActionForm action={markNotificationRead.bind(null, row.id)}>
                      <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                        Tandai selesai
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                  {row.status === "PENDING" ? (
                    <ActionForm action={cancelNotification.bind(null, row.id)}>
                      <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                        Batalkan
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              ),
            },
          ]}
        />

        <Pagination path="/notifications" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </Card>
    </>
  );
}

function entityHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case "QUOTATION":
      return `/quotations/${entityId}`;
    case "ORDER":
      return `/orders/${entityId}`;
    case "PURCHASE_ORDER":
      return `/procurement/purchase-orders/${entityId}`;
    case "INVOICE":
      return `/finance/invoices/${entityId}`;
    case "DELIVERY_ORDER":
      return `/delivery/${entityId}`;
    case "WORK_ORDER":
      return `/fulfillment/work-orders/${entityId}`;
    case "PRODUCTION_ORDER":
      return `/fulfillment/production/${entityId}`;
    case "SUBCONTRACT":
      return `/fulfillment/subcontracts/${entityId}`;
    case "CUSTOMER":
      return `/customers/${entityId}`;
    case "SUPPLIER":
      return `/suppliers/${entityId}`;
    case "PRODUCT":
      return `/products/${entityId}`;
    case "REQUEST":
      return `/requests/${entityId}`;
    default:
      return "/dashboard";
  }
}
