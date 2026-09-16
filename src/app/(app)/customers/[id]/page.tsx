import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { AgingBadge } from "@/components/tracker/tracker-ui";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { TrackerStatus } from "@/generated/prisma/enums";
import {
  deleteTrackerCustomer,
  updateTrackerCustomer,
} from "@/lib/actions/tracker-actions";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";
import { calcAgingDays } from "@/lib/tracker";

export const metadata: Metadata = { title: "Customer" };

export default async function TrackerCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const customer = await prisma.customer.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      quotations: {
        orderBy: { quotationDate: "desc" },
        select: {
          id: true,
          number: true,
          quotationDate: true,
          trackerStatus: true,
          customerPoNumber: true,
          customerPoDate: true,
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!customer) notFound();

  return (
    <>
      <PageHeader
        title={customer.companyName}
        breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: customer.companyName }]}
        description={`${customer.quotations.length} quotation`}
        actions={
          <ActionForm action={deleteTrackerCustomer.bind(null, customer.id)}>
            <SubmitButton variant="danger" size="sm" pendingLabel="Menghapus…">
              Delete
            </SubmitButton>
          </ActionForm>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="Customer" />
          <CardBody>
            <ActionForm action={updateTrackerCustomer.bind(null, customer.id)} className="space-y-4">
              <Field label="Nama customer" required>
                <Input name="name" required defaultValue={customer.companyName} />
              </Field>
              <Field label="Kontak">
                <Input name="contact" defaultValue={customer.phone ?? ""} placeholder="Telepon / PIC / WhatsApp" />
              </Field>
              <SubmitButton size="sm" pendingLabel="Menyimpan…">
                Save changes
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Quotations"
            actions={
              <Link
                href="/quotations/new"
                className="text-xs font-semibold text-rose-600 hover:underline"
              >
                + New quotation
              </Link>
            }
          />
          <DataTable
            rows={customer.quotations}
            rowKey={(row) => row.id}
            empty={
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                Belum ada quotation untuk customer ini.
              </p>
            }
            columns={[
              {
                key: "number",
                header: "Nomor",
                render: (row) => (
                  <div>
                    <Link href={`/quotations/${row.id}`} className="text-sm font-medium text-rose-600 hover:underline">
                      {row.number}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {formatDate(row.quotationDate)} · {row._count.items} barang
                    </p>
                  </div>
                ),
              },
              {
                key: "aging",
                header: "Aging",
                render: (row) => (
                  <AgingBadge
                    days={calcAgingDays(row.quotationDate, row.trackerStatus, row.customerPoDate)}
                    frozen={row.trackerStatus !== TrackerStatus.WAITING_PO}
                  />
                ),
              },
              {
                key: "po",
                header: "PO",
                render: (row) => (
                  <span className="text-sm text-slate-600">{row.customerPoNumber ?? "—"}</span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => <StatusBadge value={row.trackerStatus} />,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
