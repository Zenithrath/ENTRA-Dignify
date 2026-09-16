import type { Metadata } from "next";

import { FormShell } from "@/components/form-shell";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { resetDocumentNumber, saveDocumentNumber } from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { DEFAULT_PATTERN, DEFAULT_PREFIX, formatDocumentNumber } from "@/lib/numbering";
import { DocType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Document numbers" };

const DOC_TYPES = Object.values(DocType);

export default async function SettingsNumberingPage() {
  const auth = await requireAuth();
  const canEdit = canManage(auth.user.role, "settings");
  const tenantId = auth.user.tenantId;
  const year = new Date().getFullYear();

  const [sequences, counts] = await Promise.all([
    prisma.documentSequence.findMany({ where: { tenantId }, orderBy: { docType: "asc" } }),
    Promise.all(
      DOC_TYPES.map(async (docType) => {
        const count = await countDocs(tenantId, docType);
        return [docType, count] as const;
      }),
    ),
  ]);
  const countMap = new Map(counts);

  const rows = DOC_TYPES.map((docType) => {
    const sequence = sequences.find((row) => row.docType === docType);
    return {
      docType,
      prefix: sequence?.prefix ?? DEFAULT_PREFIX[docType],
      pattern: sequence?.pattern ?? DEFAULT_PATTERN,
      padLength: sequence?.padLength ?? 4,
      nextNumber: sequence?.nextNumber ?? 1,
      resetYearly: sequence?.resetYearly ?? true,
      configured: Boolean(sequence),
    };
  });

  return (
    <>
      <PageHeader
        title="Document numbers"
        description="Format penomoran otomatis per jenis dokumen. {prefix}, {YYYY}, {YY}, {MM}, dan {seq} tersedia."
      />
      <SettingsTabs active="numbering" />

      <Card>
        <CardHeader title="Format penomoran" description="Contoh hasil ikut ter-update saat form diubah (preview statis dengan nomor berikutnya)." />
        <DataTable
          rows={rows}
          rowKey={(row) => row.docType}
          empty={<EmptyState title="Tidak ada jenis dokumen" />}
          columns={[
            { key: "docType", header: "Dokumen", render: (row) => <span className="text-sm font-medium text-slate-900">{row.docType}</span> },
            {
              key: "preview",
              header: "Contoh nomor",
              render: (row) => (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                  {formatDocumentNumber(row.pattern, row.prefix, row.nextNumber, year, row.padLength)}
                </code>
              ),
            },
            { key: "next", header: "Nomor berikutnya", render: (row) => <span className="text-sm tabular-nums">{row.nextNumber}</span> },
            { key: "count", header: "Terbit", render: (row) => <span className="text-sm tabular-nums">{countMap.get(row.docType) ?? 0}</span> },
            {
              key: "yearly",
              header: "Reset tahunan",
              render: (row) => (row.resetYearly ? <span className="text-xs text-emerald-600">Ya</span> : <span className="text-xs text-slate-400">Tidak</span>),
            },
          ]}
        />
      </Card>

      {canEdit ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Ubah format" description="Pilih jenis dokumen, lalu isi formatnya." />
            <CardBody>
              <FormShell action={saveDocumentNumber} submitLabel="Simpan format">
                <FormGrid>
                  <Field label="Jenis dokumen" required>
                    <select name="docType" className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                      {DOC_TYPES.map((docType) => (
                        <option key={docType} value={docType}>
                          {docType}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prefix" required>
                    <Input name="prefix" placeholder="QUO" required />
                  </Field>
                  <Field label="Format" hint="Wajib memuat {seq}" required>
                    <Input name="pattern" defaultValue={DEFAULT_PATTERN} required />
                  </Field>
                  <Field label="Panjang nomor (pad)">
                    <Input name="padLength" type="number" min={1} max={10} defaultValue={4} />
                  </Field>
                  <Field label="Nomor berikutnya">
                    <Input name="nextNumber" type="number" min={1} defaultValue={1} />
                  </Field>
                </FormGrid>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="resetYearly" className="h-4 w-4 rounded border-slate-300" defaultChecked />
                  Reset nomor setiap tahun
                </label>
              </FormShell>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reset ke default" description="Kembalikan satu jenis dokumen ke prefix & format bawaan." />
            <CardBody>
              <ActionForm action={resetDocumentNumber} className="space-y-3">
                <Field label="Jenis dokumen" required>
                  <select name="docType" className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    {DOC_TYPES.map((docType) => (
                      <option key={docType} value={docType}>
                        {docType}
                      </option>
                    ))}
                  </select>
                </Field>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Resetting…">
                  Reset penomoran
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      ) : (
        <Card>
          <CardBody className="text-sm text-slate-600">Hanya Owner yang dapat mengubah penomoran dokumen.</CardBody>
        </Card>
      )}
    </>
  );
}

async function countDocs(tenantId: string, docType: DocType): Promise<number> {
  switch (docType) {
    case DocType.REQUEST:
      return prisma.request.count({ where: { tenantId } });
    case DocType.QUOTATION:
      return prisma.quotation.count({ where: { tenantId } });
    case DocType.SALES_ORDER:
      return prisma.order.count({ where: { tenantId } });
    case DocType.RFQ:
      return prisma.rfq.count({ where: { tenantId } });
    case DocType.PURCHASE_ORDER:
      return prisma.purchaseOrder.count({ where: { tenantId } });
    case DocType.GOODS_RECEIPT:
      return prisma.goodsReceipt.count({ where: { tenantId } });
    case DocType.WORK_ORDER:
      return prisma.workOrder.count({ where: { tenantId } });
    case DocType.PRODUCTION_ORDER:
      return prisma.productionOrder.count({ where: { tenantId } });
    case DocType.SUBCONTRACT:
      return prisma.subcontract.count({ where: { tenantId } });
    case DocType.DELIVERY_ORDER:
      return prisma.deliveryOrder.count({ where: { tenantId } });
    case DocType.INVOICE:
      return prisma.invoice.count({ where: { tenantId } });
    case DocType.PAYMENT:
      return prisma.payment.count({ where: { tenantId } });
    default:
      return 0;
  }
}
