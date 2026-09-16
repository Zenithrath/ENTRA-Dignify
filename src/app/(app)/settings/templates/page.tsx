import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { deleteTemplate, saveTemplate } from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/queries/common";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { DocType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Document templates" };

const DOC_TYPES = [DocType.QUOTATION, DocType.INVOICE, DocType.DELIVERY_ORDER, DocType.SALES_ORDER, DocType.PURCHASE_ORDER];

type TemplateLayout = {
  headerAlign?: string;
  accentColor?: string;
  showTax?: boolean;
  notes?: string | null;
};

function asLayout(value: unknown): TemplateLayout {
  return typeof value === "object" && value !== null ? (value as TemplateLayout) : {};
}

export default async function SettingsTemplatesPage() {
  const auth = await requireAuth();
  const canEdit = canManage(auth.user.role, "settings");

  const templates = await prisma.documentTemplate.findMany({
    where: { tenantId: auth.user.tenantId },
    orderBy: [{ docType: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="Templates"
        description="Kustomisasi logo, warna aksen, dan footer dokumen PDF (quotation, invoice, delivery note)."
      />
      <SettingsTabs active="templates" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Template tersimpan" />
            <DataTable
              rows={templates}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada template" description="Dokumen PDF memakai layout bawaan sampai Anda menyimpan template." />}
              columns={[
                { key: "docType", header: "Dokumen", render: (row) => <span className="text-sm font-medium text-slate-900">{row.docType}</span> },
                { key: "name", header: "Nama", render: (row) => <span className="text-sm">{row.name}</span> },
                {
                  key: "layout",
                  header: "Layout",
                  render: (row) => {
                    const layout = asLayout(row.layout);
                    return (
                      <span className="text-xs text-slate-500">
                        {layout.accentColor ?? "#4f46e5"} · {layout.headerAlign ?? "left"}
                        {layout.showTax ? " · pajak tampil" : ""}
                      </span>
                    );
                  },
                },
                { key: "footer", header: "Footer", render: (row) => <span className="max-w-[16rem] truncate text-xs text-slate-500">{row.footer ?? "—"}</span> },
                { key: "updated", header: "Update", render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.updatedAt)}</span> },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (row) =>
                    canEdit ? (
                      <ActionForm action={deleteTemplate.bind(null, row.id)}>
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          Hapus
                        </SubmitButton>
                      </ActionForm>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>

        <div>
          {canEdit ? (
            <Card>
              <CardHeader title="Simpan template" description="Nama sama berarti template lama diperbarui." />
              <CardBody>
                <FormShell action={saveTemplate} submitLabel="Simpan template">
                  <FormGrid>
                    <Field label="Jenis dokumen" required>
                      <Select name="docType" required>
                        {DOC_TYPES.map((docType) => (
                          <option key={docType} value={docType}>
                            {docType}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Nama template" required>
                      <Input name="name" placeholder="Default" required />
                    </Field>
                    <Field label="Logo URL" className="sm:col-span-2">
                      <Input name="logoUrl" placeholder="https://…" />
                    </Field>
                    <Field label="Aksen warna">
                      <Input name="accentColor" type="color" defaultValue="#4f46e5" className="h-9 p-1" />
                    </Field>
                    <Field label="Align header">
                      <Select name="headerAlign" defaultValue="left">
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </Select>
                    </Field>
                  </FormGrid>
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="showTax" className="h-4 w-4 rounded border-slate-300" defaultChecked />
                    Tampilkan rincian pajak di PDF
                  </label>
                  <div className="mt-3">
                    <Field label="Footer dokumen">
                      <Textarea name="footer" placeholder="Terima kasih atas kepercayaan Anda…" />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Catatan template (T&C singkat)">
                      <Textarea name="templateNotes" />
                    </Field>
                  </div>
                </FormShell>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="text-sm text-slate-600">Hanya Owner yang dapat mengubah template dokumen.</CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
