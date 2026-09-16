import type { Metadata } from "next";
import Link from "next/link";

import { TrackerQuotationForm } from "@/components/tracker/tracker-quotation-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { saveTrackerQuotation } from "@/lib/actions/tracker-actions";
import { requireAuth } from "@/lib/auth";
import { customerOptions, toDateInput } from "@/lib/queries/common";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewTrackerQuotationPage() {
  const auth = await requireAuth();
  const customers = await customerOptions(auth.user.tenantId);

  return (
    <>
      <PageHeader
        title="New quotation"
        breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: "New" }]}
        description="Isi seperti baris baru di spreadsheet — nomor bisa otomatis."
        actions={
          <Link href="/quotations" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />

      <TrackerQuotationForm
        action={saveTrackerQuotation}
        customers={customers}
        defaults={{ quotationDate: toDateInput(new Date()) }}
        submitLabel="Save quotation"
      />
    </>
  );
}
