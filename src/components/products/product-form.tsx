import { FormShell } from "@/components/form-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { LineType } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/actions/helpers";
import { enumOptions } from "@/lib/status";

export type ProductDefaults = {
  sku?: string;
  name?: string;
  description?: string | null;
  type?: LineType;
  category?: string | null;
  unit?: string;
  costPrice?: number;
  sellingPrice?: number;
  taxRate?: number;
  defaultSupplierId?: string | null;
  isInventoryTracked?: boolean;
  reorderPoint?: number;
};

export function ProductForm({
  action,
  suppliers,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  suppliers: { id: string; name: string }[];
  defaults?: ProductDefaults;
  submitLabel: string;
}) {
  const type = defaults?.type ?? LineType.PRODUCT;

  return (
    <FormShell action={action} submitLabel={submitLabel} className="space-y-5">
      <Card>
        <CardHeader title="Identitas" description="Nama, SKU, kategori, dan tipe item." />
        <CardBody>
          <FormGrid>
            <Field label="Nama produk / jasa" required>
              <Input name="name" defaultValue={defaults?.name ?? ""} required />
            </Field>
            <Field label="SKU" required hint="Unik per tenant">
              <Input name="sku" defaultValue={defaults?.sku ?? ""} required />
            </Field>
            <Field label="Tipe">
              <Select name="type" defaultValue={type}>
                {enumOptions(LineType).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kategori">
              <Input name="category" defaultValue={defaults?.category ?? ""} placeholder="cth. Chemical, Hardware, Jasa" />
            </Field>
            <Field label="Satuan dasar">
              <Input name="unit" defaultValue={defaults?.unit ?? "pcs"} />
            </Field>
            <Field label="Supplier default">
              <Select name="defaultSupplierId" defaultValue={defaults?.defaultSupplierId ?? ""}>
                <option value="">Tanpa supplier default</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <Textarea name="description" defaultValue={defaults?.description ?? ""} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Harga & pajak" description="Dipakai sebagai default saat membuat quotation dan PO." />
        <CardBody>
          <FormGrid columns={3}>
            <Field label="Harga beli (cost)">
              <Input name="costPrice" type="number" step="0.01" defaultValue={defaults?.costPrice ?? 0} />
            </Field>
            <Field label="Harga jual default">
              <Input name="sellingPrice" type="number" step="0.01" defaultValue={defaults?.sellingPrice ?? 0} />
            </Field>
            <Field label="Pajak (%)">
              <Input name="taxRate" type="number" step="0.01" defaultValue={defaults?.taxRate ?? 11} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Inventory" description="Hanya untuk barang fisik — jasa dan labor tidak perlu pelacakan stok." />
        <CardBody>
          <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="isInventoryTracked"
              defaultChecked={defaults?.isInventoryTracked ?? true}
              className="h-4 w-4 rounded border-slate-300"
            />
            Lacak stok untuk produk ini
          </label>
          <FormGrid columns={3}>
            <Field label="Reorder point" hint="Alert low stock muncul saat available ≤ nilai ini">
              <Input name="reorderPoint" type="number" step="0.01" defaultValue={defaults?.reorderPoint ?? 0} />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>
    </FormShell>
  );
}
