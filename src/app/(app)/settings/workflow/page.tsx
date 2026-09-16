import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import {
  deleteApprovalRule,
  deleteWorkflowStage,
  reorderWorkflowStage,
  saveApprovalRule,
  saveWorkflowStage,
  setModuleEnabled,
} from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { money } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { DocType, ModuleKey, Role, WorkflowScope } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Workflow & modules" };

const MODULES: { key: ModuleKey; label: string; description: string }[] = [
  { key: ModuleKey.INVENTORY, label: "Inventory", description: "Lacak stok barang; matikan untuk bisnis pure sourcing." },
  { key: ModuleKey.MULTI_WAREHOUSE, label: "Multi warehouse", description: "Transfer stok antar gudang." },
  { key: ModuleKey.PRODUCTION, label: "Production", description: "Jalur produksi dengan tahap & QC." },
  { key: ModuleKey.SUBCONTRACT, label: "Subcontract", description: "Serahkan pekerjaan ke subcontractor." },
  { key: ModuleKey.CUSTOMER_PRICING, label: "Customer pricing", description: "Harga khusus per customer per produk." },
  { key: ModuleKey.APPROVAL_WORKFLOW, label: "Approval workflow", description: "Wajibkan approval untuk dokumen di atas threshold." },
  { key: ModuleKey.WHATSAPP, label: "WhatsApp notifications", description: "Reminder & dokumen via WhatsApp." },
  { key: ModuleKey.PDF_EXPORT, label: "PDF export", description: "Cetak quotation, invoice, DO, dan sales order." },
];

const APPROVAL_DOC_TYPES = [DocType.QUOTATION, DocType.PURCHASE_ORDER, DocType.INVOICE];

const SCOPES = Object.values(WorkflowScope);

export default async function SettingsWorkflowPage() {
  const auth = await requireAuth();
  const canEdit = canManage(auth.user.role, "settings");
  const tenantId = auth.user.tenantId;

  const [modules, stages, rules] = await Promise.all([
    prisma.tenantModule.findMany({ where: { tenantId } }),
    prisma.workflowStage.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ scope: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.approvalRule.findMany({ where: { tenantId }, orderBy: { docType: "asc" } }),
  ]);
  const moduleMap = new Map(modules.map((module) => [module.key, module.enabled]));

  return (
    <>
      <PageHeader
        title="Workflow & modules"
        description="Aktifkan/nonaktifkan modul, atur tahap alur kerja, dan threshold approval dokumen."
      />
      <SettingsTabs active="workflow" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Modul" description="Modul yang dimatikan menghilangkan fitur terkait untuk seluruh tenant." />
          <CardBody className="space-y-3">
            {MODULES.map((module) => {
              const enabled = moduleMap.get(module.key) ?? false;
              return (
                <div key={module.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{module.label}</p>
                    <p className="text-xs text-slate-500">{module.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
                    {canEdit ? (
                      <ActionForm action={setModuleEnabled}>
                        <input type="hidden" name="key" value={module.key} />
                        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                          {enabled ? "Matikan" : "Aktifkan"}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tahap workflow" description="Urutan tahap untuk produksi, work order, dan subcontract." />
          <div className="space-y-4">
            {SCOPES.map((scope) => {
              const scopeStages = stages.filter((stage) => stage.scope === scope);
              return (
                <div key={scope} className="px-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{scope}</p>
                  {scopeStages.length === 0 ? (
                    <p className="text-xs text-slate-500">Belum ada tahap.</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {scopeStages.map((stage, index) => (
                        <li key={stage.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                          <span className="text-sm text-slate-700">
                            {index + 1}. {stage.name}
                          </span>
                          {canEdit ? (
                            <span className="flex items-center gap-1">
                              <ActionForm action={reorderWorkflowStage.bind(null, stage.id)} showError={false}>
                                <input type="hidden" name="delta" value="-1" />
                                <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                                  ↑
                                </SubmitButton>
                              </ActionForm>
                              <ActionForm action={reorderWorkflowStage.bind(null, stage.id)} showError={false}>
                                <input type="hidden" name="delta" value="1" />
                                <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                                  ↓
                                </SubmitButton>
                              </ActionForm>
                              <ActionForm action={deleteWorkflowStage.bind(null, stage.id)} showError={false}>
                                <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                                  ✕
                                </SubmitButton>
                              </ActionForm>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
            {canEdit ? (
              <CardBody className="border-t border-slate-100">
                <FormShell action={saveWorkflowStage} submitLabel="Tambah tahap" size="sm">
                  <FormGrid columns={3}>
                    <Field label="Scope">
                      <Select name="scope" defaultValue={WorkflowScope.PRODUCTION}>
                        {SCOPES.map((scope) => (
                          <option key={scope} value={scope}>
                            {scope}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Nama tahap" required>
                      <Input name="name" placeholder="Finishing" required />
                    </Field>
                    <Field label="Urutan">
                      <Input name="sortOrder" type="number" min={0} defaultValue={0} />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aturan approval" description="Dokumen dengan nominal di atas threshold wajib disetujui sebelum dikirim." />
          <div className="space-y-2 px-5 py-4">
            {rules.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada aturan — semua dokumen lolos tanpa approval internal.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{rule.docType}</p>
                    <p className="text-xs text-slate-500">
                      ≥ {money(rule.thresholdAmount)} · approver: {rule.approverRole}
                    </p>
                  </div>
                  {canEdit ? (
                    <ActionForm action={deleteApprovalRule.bind(null, rule.id)}>
                      <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                        Hapus
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {canEdit ? (
            <CardBody className="border-t border-slate-100">
              <FormShell action={saveApprovalRule} submitLabel="Simpan aturan" size="sm">
                <FormGrid columns={3}>
                  <Field label="Jenis dokumen" required>
                    <Select name="docType" required>
                      {APPROVAL_DOC_TYPES.map((docType) => (
                        <option key={docType} value={docType}>
                          {docType}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Threshold (Rp)" required>
                    <Input name="thresholdAmount" type="number" min={0} step="1" required />
                  </Field>
                  <Field label="Approver role">
                    <Select name="approverRole" defaultValue={Role.MANAGER}>
                      <option value={Role.MANAGER}>Manager</option>
                      <option value={Role.OWNER}>Owner</option>
                    </Select>
                  </Field>
                </FormGrid>
              </FormShell>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Catatan" />
          <CardBody className="space-y-2 text-xs text-slate-500">
            <p>Mematikan Inventory menyembunyikan stok, receiving, dan adjustment — histori transaksi tetap tersimpan.</p>
            <p>Approval workflow hanya aktif bila modul APPROVAL_WORKFLOW nyala; menyimpan aturan akan mengaktifkannya otomatis.</p>
            <p>Tahap workflow dipakai halaman Production order sebagai urutan progres kerja.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
