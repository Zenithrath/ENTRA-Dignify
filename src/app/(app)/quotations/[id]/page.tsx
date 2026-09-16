import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { AgingBadge } from "@/components/tracker/tracker-ui";
import { TrackerQuotationForm } from "@/components/tracker/tracker-quotation-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { TrackerStatus } from "@/generated/prisma/enums";
import { deleteTrackerQuotation, saveTrackerQuotation } from "@/lib/actions/tracker-actions";
import { requireAuth } from "@/lib/auth";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { customerOptions, formatDate, toDateInput } from "@/lib/queries/common";
import { calcAgingDays } from "@/lib/tracker";

export const metadata: Metadata = { title: "Quotation" };

export default async function TrackerQuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const tenantId = auth.user.tenantId;

  const [quotation, customers] = await Promise.all([
    prisma.quotation.findFirst({
      where: { id, tenantId },
      include: {
        customer: { select: { id: true, companyName: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
    }),
    customerOptions(tenantId),
  ]);
  if (!quotation) notFound();

  const frozen = quotation.trackerStatus !== TrackerStatus.WAITING_PO;
  const aging = calcAgingDays(quotation.quotationDate, quotation.trackerStatus, quotation.customerPoDate);

  return (
    <>
      <PageHeader
        title={quotation.number}
        breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: quotation.number }]}
        description={`${quotation.customer.companyName} · ${formatDate(quotation.quotationDate)}`}
        meta={
          <>
            <StatusBadge value={quotation.trackerStatus} />
            <AgingBadge days={aging} frozen={frozen} />
            {quotation.customerPoNumber ? (
              <span className="text-xs font-medium text-slate-600">PO: {quotation.customerPoNumber}</span>
            ) : null}
          </>
        }
        actions={
          <ActionForm action={deleteTrackerQuotation.bind(null, quotation.id)}>
            <SubmitButton variant="danger" size="sm" pendingLabel="Menghapus…">
              Delete
            </SubmitButton>
          </ActionForm>
        }
      />

      <TrackerQuotationForm
        action={saveTrackerQuotation}
        customers={customers}
        submitLabel="Save changes"
        numberHint="Nomor manual mengikuti format lama."
        defaults={{
          quotationId: quotation.id,
          quotationNumber: quotation.number,
          customerId: quotation.customer.id,
          quotationDate: toDateInput(quotation.quotationDate),
          trackerStatus: quotation.trackerStatus,
          customerPoNumber: quotation.customerPoNumber ?? "",
          customerPoDate: toDateInput(quotation.customerPoDate),
          notes: quotation.notes ?? "",
          items: quotation.items.map((item) => ({
            name: item.description,
            qty: String(num(item.quantity)),
            unit: item.unit,
            vendor: item.vendor ?? "",
            deliveryMethod: item.deliveryMethod ?? "",
            workStatus: item.workStatus,
          })),
        }}
      />

      <p className="mt-4 text-xs text-slate-400">
        Lihat barang ini di{" "}
        <Link href={`/procurement?q=${encodeURIComponent(quotation.number)}`} className="font-medium text-rose-600 hover:underline">
          Procurement Tracker
        </Link>
        .
      </p>
    </>
  );
}
