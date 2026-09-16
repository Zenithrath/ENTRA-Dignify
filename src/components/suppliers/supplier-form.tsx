import { FormShell } from "@/components/form-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions/helpers";

export type SupplierDefaults = {
  name?: string;
  category?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsappNumber?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
};

export function SupplierForm({
  action,
  defaults,
  submitLabel,
  withContact = false,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: SupplierDefaults;
  submitLabel: string;
  withContact?: boolean;
}) {
  return (
    <FormShell action={action} submitLabel={submitLabel} className="space-y-5">
      <Card>
        <CardHeader title="Supplier" description="Kategori dipakai untuk filter saat sourcing." />
        <CardBody>
          <FormGrid>
            <Field label="Supplier name" required>
              <Input name="name" defaultValue={defaults?.name ?? ""} required />
            </Field>
            <Field label="Category" hint="chemical, hardware, jasa, fabrikasi…">
              <Input name="category" defaultValue={defaults?.category ?? ""} />
            </Field>
            <Field label="NPWP">
              <Input name="taxNumber" defaultValue={defaults?.taxNumber ?? ""} />
            </Field>
            <Field label="Payment terms">
              <Input name="paymentTerms" defaultValue={defaults?.paymentTerms ?? ""} />
            </Field>
            <Field label="Standard lead time (hari)">
              <Input name="leadTimeDays" type="number" step="1" defaultValue={defaults?.leadTimeDays ?? ""} />
            </Field>
            <Field label="City">
              <Input name="city" defaultValue={defaults?.city ?? ""} />
            </Field>
            <Field label="Phone">
              <Input name="phone" defaultValue={defaults?.phone ?? ""} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
            </Field>
            <Field label="WhatsApp" hint="Dipakai untuk follow up PO otomatis">
              <Input name="whatsappNumber" defaultValue={defaults?.whatsappNumber ?? ""} placeholder="+62812…" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea name="address" defaultValue={defaults?.address ?? ""} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea name="notes" defaultValue={defaults?.notes ?? ""} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      {withContact ? (
        <Card>
          <CardHeader title="PIC" description="Kontak utama supplier." />
          <CardBody>
            <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="addPrimaryContact" defaultChecked className="h-4 w-4 rounded border-slate-300" />
              Tambahkan PIC utama sekarang
            </label>
            <FormGrid>
              <Field label="Name">
                <Input name="contactName" />
              </Field>
              <Field label="Job title">
                <Input name="contactJobTitle" />
              </Field>
              <Field label="Phone">
                <Input name="contactPhone" />
              </Field>
              <Field label="Email">
                <Input name="contactEmail" type="email" />
              </Field>
              <Field label="WhatsApp">
                <Input name="contactWhatsapp" />
              </Field>
            </FormGrid>
          </CardBody>
        </Card>
      ) : null}
    </FormShell>
  );
}
