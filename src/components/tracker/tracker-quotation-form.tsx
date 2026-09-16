"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { TRACKER_STATUS_LABEL, TRACKER_STATUSES, WORK_STATUS_LABEL, WORK_STATUSES } from "@/lib/tracker";
import type { ActionResult } from "@/lib/actions/helpers";
import type { TrackerStatus, WorkStatus } from "@/generated/prisma/enums";

export type TrackerItemDraft = {
  name: string;
  qty: string;
  unit: string;
  vendor: string;
  deliveryMethod: string;
  workStatus: WorkStatus;
};

export type TrackerQuotationDefaults = {
  quotationId?: string;
  quotationNumber?: string;
  customerId?: string;
  quotationDate?: string;
  trackerStatus?: TrackerStatus;
  customerPoNumber?: string;
  customerPoDate?: string;
  notes?: string;
  items?: TrackerItemDraft[];
};

const EMPTY_ITEM: TrackerItemDraft = {
  name: "",
  qty: "1",
  unit: "pcs",
  vendor: "",
  deliveryMethod: "",
  workStatus: "TO_SOURCE",
};

export function TrackerQuotationForm({
  action,
  customers,
  defaults,
  submitLabel,
  numberHint,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  customers: { id: string; companyName: string }[];
  defaults?: TrackerQuotationDefaults;
  submitLabel: string;
  numberHint?: string;
}) {
  const [items, setItems] = useState<(TrackerItemDraft & { key: number })[]>(
    (defaults?.items && defaults.items.length > 0 ? defaults.items : [EMPTY_ITEM]).map((item, index) => ({
      ...item,
      key: index,
    })),
  );
  const [nextKey, setNextKey] = useState(items.length);
  const [state, formAction] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => action(formData),
    null,
  );

  function patch(key: number, field: keyof TrackerItemDraft, value: string) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  return (
    <form action={formAction} className="space-y-5">
      {state && !state.ok ? (
        <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {state.error}
        </p>
      ) : null}
      {defaults?.quotationId ? <input type="hidden" name="quotationId" value={defaults.quotationId} /> : null}

      <Card>
        <CardHeader title="Quotation" description="Sama seperti kolom-kolom Sheet 1." />
        <CardBody className="space-y-4">
          <FormGrid>
            <Field label="Nomor quotation" hint={numberHint ?? "Kosongkan untuk nomor otomatis, atau ketik manual."}>
              <Input name="quotationNumber" defaultValue={defaults?.quotationNumber ?? ""} placeholder="QTTP-0065/TRAKINDO/04/2026" />
            </Field>
            <Field label="Customer" required>
              <Select name="customerId" defaultValue={defaults?.customerId ?? ""} required>
                <option value="">— Pilih customer —</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <FormGrid columns={3}>
            <Field label="Tanggal quotation" required>
              <Input type="date" name="quotationDate" defaultValue={defaults?.quotationDate ?? ""} required />
            </Field>
            <Field label="Status" required>
              <Select name="trackerStatus" defaultValue={defaults?.trackerStatus ?? "WAITING_PO"}>
                {TRACKER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TRACKER_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end pb-0.5 text-xs text-slate-500">
              Belum ada di daftar?{" "}
              <Link href="/customers/new" className="ml-1 font-medium text-rose-600 hover:underline">
                Tambah customer
              </Link>
            </div>
          </FormGrid>
          <FormGrid>
            <Field label="PO customer" hint="Kosong kalau belum ada PO.">
              <Input name="customerPoNumber" defaultValue={defaults?.customerPoNumber ?? ""} placeholder="cth. PO/TBS/2026/0451" />
            </Field>
            <Field label="Tanggal PO diterima" hint="Aging berhenti dihitung di tanggal ini.">
              <Input type="date" name="customerPoDate" defaultValue={defaults?.customerPoDate ?? ""} />
            </Field>
          </FormGrid>
          <Field label="Catatan bebas">
            <Textarea name="notes" defaultValue={defaults?.notes ?? ""} placeholder="Catatan internal…" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Barang"
          description="Sama seperti kolom-kolom Sheet 2 — tersambung ke quotation ini."
          actions={
            <button
              type="button"
              onClick={() => {
                setItems((rows) => [...rows, { ...EMPTY_ITEM, key: nextKey }]);
                setNextKey((key) => key + 1);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-rose-50 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-100"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah barang
            </button>
          }
        />
        <div className="space-y-3 px-5 py-4">
          {items.map((item, index) => (
            <div key={item.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_0.5fr_0.5fr] sm:gap-2">
                <Field label={`Barang #${index + 1}`} required>
                  <Input
                    name={`items[${index}][name]`}
                    value={item.name}
                    onChange={(event) => patch(item.key, "name", event.target.value)}
                    placeholder="Nama barang"
                    required
                  />
                </Field>
                <Field label="Jumlah">
                  <Input
                    name={`items[${index}][qty]`}
                    value={item.qty}
                    onChange={(event) => patch(item.key, "qty", event.target.value)}
                    inputMode="decimal"
                    placeholder="1"
                  />
                </Field>
                <Field label="Satuan">
                  <Input
                    name={`items[${index}][unit]`}
                    value={item.unit}
                    onChange={(event) => patch(item.key, "unit", event.target.value)}
                    placeholder="pcs"
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:gap-2">
                <Field label="Toko/Vendor">
                  <Input
                    name={`items[${index}][vendor]`}
                    value={item.vendor}
                    onChange={(event) => patch(item.key, "vendor", event.target.value)}
                    placeholder="Nama toko"
                  />
                </Field>
                <Field label="Metode kirim">
                  <Input
                    name={`items[${index}][deliveryMethod]`}
                    value={item.deliveryMethod}
                    onChange={(event) => patch(item.key, "deliveryMethod", event.target.value)}
                    placeholder="cth. Gosend / Truk"
                  />
                </Field>
                <Field label="Status pekerjaan">
                  <Select
                    name={`items[${index}][workStatus]`}
                    value={item.workStatus}
                    onChange={(event) => patch(item.key, "workStatus", event.target.value)}
                  >
                    {WORK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {WORK_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => setItems((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== item.key) : rows))}
                    className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Hapus barang #${index + 1}`}
                    title="Hapus baris"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="no-print flex items-center gap-2">
        <SubmitButton pendingLabel="Menyimpan…">{submitLabel}</SubmitButton>
        <Link href="/quotations" className="text-sm font-medium text-slate-500 hover:text-slate-700">
          Batal
        </Link>
      </div>
    </form>
  );
}
