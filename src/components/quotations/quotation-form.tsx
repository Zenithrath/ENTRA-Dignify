import { FormShell } from "@/components/form-shell";
import { LineItemsEditor, type ProductOption } from "@/components/line-items-editor";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions/helpers";
import { formatDate, toDateInput } from "@/lib/queries/common";

export type QuotationFormRequest = { id: string; number: string; customerId: string; companyName: string };

export function QuotationForm({
  action,
  customers,
  products,
  suppliers,
  requests,
  defaults,
  initialItems,
  submitLabel,
  quotationId,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  customers: { id: string; companyName: string; paymentTerms: string | null }[];
  products: ProductOption[];
  suppliers: { id: string; name: string; leadTimeDays: number | null }[];
  requests: QuotationFormRequest[];
  defaults?: {
    customerId?: string;
    requestId?: string | null;
    quotationDate?: Date;
    validUntil?: Date | null;
    paymentTerms?: string | null;
    deliveryTerms?: string | null;
    notes?: string | null;
    termsAndConditions?: string | null;
    shippingCost?: number;
  };
  initialItems?: Partial<{
    productId: string;
    lineType: string;
    description: string;
    quantity: string;
    unit: string;
    costPrice: string;
    unitPrice: string;
    discountPercent: string;
    taxRate: string;
    supplierId: string;
    supplierLeadTimeDays: string;
    note: string;
  }>[];
  submitLabel: string;
  quotationId?: string;
}) {
  return (
    <FormShell
      action={action}
      submitLabel={submitLabel}
      className="max-w-6xl space-y-5"
      hidden={{ quotationId }}
    >
      <Card>
        <CardHeader title="Quotation header" description="Nomor dibuat otomatis dari Settings → Document Number." />
        <CardBody>
          <FormGrid columns={3}>
            <Field label="Customer" required>
              <Select name="customerId" defaultValue={defaults?.customerId ?? ""} required>
                <option value="">Select customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From request" hint="Kosongkan untuk walk-in quotation">
              <Select name="requestId" defaultValue={defaults?.requestId ?? ""}>
                <option value="">Tanpa request</option>
                {requests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.number} — {request.companyName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quotation date">
              <Input type="date" name="quotationDate" defaultValue={toDateInput(defaults?.quotationDate ?? new Date())} />
            </Field>
            <Field label="Valid until">
              <Input type="date" name="validUntil" defaultValue={toDateInput(defaults?.validUntil ?? new Date(Date.now() + 14 * 86_400_000))} />
            </Field>
            <Field label="Payment terms">
              <Input name="paymentTerms" defaultValue={defaults?.paymentTerms ?? ""} placeholder="cth. 30 hari setelah invoice" />
            </Field>
            <Field label="Delivery terms">
              <Input name="deliveryTerms" defaultValue={defaults?.deliveryTerms ?? ""} placeholder="cth. Franco Jakarta, 7 hari kerja" />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea name="notes" defaultValue={defaults?.notes ?? ""} placeholder="Catatan internal / untuk customer" />
            </Field>
            <Field label="Terms & conditions" className="sm:col-span-3">
              <Textarea
                name="termsAndConditions"
                defaultValue={defaults?.termsAndConditions ?? ""}
                placeholder="Syarat pembayaran, garansi, force majeure…"
              />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Line items"
          description="Harga beli, harga jual, diskon, dan supplier sourcing per baris. Margin dihitung otomatis."
        />
        <CardBody>
          <LineItemsEditor
            mode="quotation"
            products={products}
            suppliers={suppliers}
            initialRows={initialItems}
            shippingCost={defaults?.shippingCost ?? 0}
          />
        </CardBody>
      </Card>

      {defaults?.requestId ? (
        <p className="text-xs text-slate-500">
          Item sudah tersalin dari request. Sesuaikan harga jual dan supplier sourcing sebelum dikirim.
        </p>
      ) : null}
    </FormShell>
  );
}

export function requestOptionLabel(companyName: string, requestDate: Date): string {
  return `${companyName} · ${formatDate(requestDate)}`;
}
