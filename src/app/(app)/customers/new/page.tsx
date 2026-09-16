import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTrackerCustomer } from "@/lib/actions/tracker-actions";
import { requireAuth } from "@/lib/auth";

export const metadata: Metadata = { title: "New customer" };

export default async function NewTrackerCustomerPage() {
  await requireAuth();

  return (
    <>
      <PageHeader
        title="New customer"
        breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: "New" }]}
        description="Cukup nama dan kontak — dipakai sebagai pilihan saat buat quotation."
        actions={
          <Link href="/customers" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />
      <Card className="max-w-xl">
        <CardHeader title="Customer" />
        <CardBody>
          <ActionForm action={createTrackerCustomer} className="space-y-4">
            <Field label="Nama customer" required>
              <Input name="name" required placeholder="cth. PT Trakindo Utama" />
            </Field>
            <Field label="Kontak" hint="Opsional — telepon, PIC, atau WhatsApp.">
              <Input name="contact" placeholder="cth. 0812-3456-7890 (Bpk. Andi)" />
            </Field>
            <SubmitButton pendingLabel="Menyimpan…">Save customer</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
