import type { Metadata } from "next";
import Link from "next/link";

import { FormShell } from "@/components/form-shell";
import { LineItemsEditor } from "@/components/line-items-editor";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { RequestSource } from "@/generated/prisma/enums";
import { createRequest } from "@/lib/actions/request-actions";
import { requirePermission } from "@/lib/auth";
import { customerOptions, productOptions, tenantUsers } from "@/lib/queries/common";
import { enumOptions } from "@/lib/status";

export const metadata: Metadata = { title: "New request" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const auth = await requirePermission("requests", "manage");
  const { customerId } = await searchParams;
  const tenantId = auth.user.tenantId;

  const [customers, products, users] = await Promise.all([
    customerOptions(tenantId),
    productOptions(tenantId),
    tenantUsers(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="New request"
        breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: "New" }]}
        description="Catat permintaan customer; item di sini akan tersalin otomatis ke quotation."
        actions={
          <Link href="/requests" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />

      <FormShell action={createRequest} submitLabel="Create request" className="max-w-5xl space-y-5">
        <Card>
          <CardHeader title="Request header" />
          <CardBody>
            <FormGrid columns={3}>
              <Field label="Customer" required>
                <Select name="customerId" defaultValue={customerId ?? ""} required>
                  <option value="">Select customer…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.companyName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Received date">
                <Input type="date" name="requestDate" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Source">
                <Select name="source" defaultValue={RequestSource.EMAIL}>
                  {enumOptions(RequestSource).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assign to">
                <Select name="assignedToId" defaultValue={auth.user.id}>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Customer reference" hint="Nomor RFQ/internal customer">
                <Input name="customerRef" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea name="notes" placeholder="Konteks permintaan, deadline, dsb." />
              </Field>
            </FormGrid>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Requested items" description="Multi item dengan qty, unit, dan target harga." />
          <CardBody>
            <LineItemsEditor mode="request" products={products} />
          </CardBody>
        </Card>
      </FormShell>
    </>
  );
}
