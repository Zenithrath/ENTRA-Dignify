import { FormShell } from "@/components/form-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions/helpers";
import type { Actor } from "@/lib/queries/common";

export type CustomerDefaults = {
  companyName?: string;
  industry?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  whatsappNumber?: string | null;
  paymentTerms?: string | null;
  creditLimit?: number | null;
  salesOwnerId?: string | null;
  notes?: string | null;
};

export function CustomerForm({
  action,
  users,
  defaults,
  submitLabel,
  withContact = false,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  users: Actor[];
  defaults?: CustomerDefaults;
  submitLabel: string;
  withContact?: boolean;
}) {
  return (
    <FormShell action={action} submitLabel={submitLabel} className="space-y-5">
      <Card>
        <CardHeader title="Company" description="Identitas dan data pajak customer." />
        <CardBody>
          <FormGrid>
            <Field label="Company name" required>
              <Input name="companyName" defaultValue={defaults?.companyName ?? ""} required />
            </Field>
            <Field label="Industry">
              <Input name="industry" defaultValue={defaults?.industry ?? ""} placeholder="e.g. Water Utility" />
            </Field>
            <Field label="NPWP / Tax number">
              <Input name="taxNumber" defaultValue={defaults?.taxNumber ?? ""} />
            </Field>
            <Field label="Payment terms">
              <Input name="paymentTerms" defaultValue={defaults?.paymentTerms ?? ""} placeholder="e.g. 30 hari" />
            </Field>
            <Field label="Credit limit (IDR)">
              <Input name="creditLimit" type="number" step="1000" defaultValue={defaults?.creditLimit ?? ""} />
            </Field>
            <Field label="Sales owner">
              <Select name="salesOwnerId" defaultValue={defaults?.salesOwnerId ?? ""}>
                <option value="">Unassigned</option>
                {users
                  .filter((user) => user.role === "SALES" || user.role === "MANAGER" || user.role === "OWNER")
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </option>
                  ))}
              </Select>
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact details" />
        <CardBody>
          <FormGrid>
            <Field label="Phone">
              <Input name="phone" defaultValue={defaults?.phone ?? ""} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
            </Field>
            <Field label="WhatsApp number" hint="Dipakai untuk kirim quotation & reminder">
              <Input name="whatsappNumber" defaultValue={defaults?.whatsappNumber ?? ""} placeholder="+62812…" />
            </Field>
            <Field label="Website">
              <Input name="website" defaultValue={defaults?.website ?? ""} />
            </Field>
            <Field label="City">
              <Input name="city" defaultValue={defaults?.city ?? ""} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea name="address" defaultValue={defaults?.address ?? ""} />
            </Field>
            <Field label="Internal notes" className="sm:col-span-2">
              <Textarea name="notes" defaultValue={defaults?.notes ?? ""} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      {withContact ? (
        <Card>
          <CardHeader title="PIC" description="Kontak utama customer." />
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
