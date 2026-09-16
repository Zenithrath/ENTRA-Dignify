import type { Metadata } from "next";

import { FormShell } from "@/components/form-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { updateCompany } from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { formatDateTime } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Company settings" };

export default async function SettingsCompanyPage() {
  const auth = await requireAuth();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } });
  const canEdit = canManage(auth.user.role, "settings");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Identitas perusahaan, penomoran dokumen, template PDF, dan konfigurasi workflow."
      />
      <SettingsTabs active="company" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Profil perusahaan"
              description="Nama, alamat, logo, dan informasi pajak yang tercetak di dokumen."
            />
            <CardBody>
              {canEdit ? (
                <FormShell action={updateCompany} submitLabel="Save changes">
                  <FormGrid>
                    <Field label="Nama perusahaan" required>
                      <Input name="name" defaultValue={tenant.name} required />
                    </Field>
                    <Field label="Nama legal (PT/CV)">
                      <Input name="legalName" defaultValue={tenant.legalName ?? ""} />
                    </Field>
                    <Field label="NPWP / Tax number">
                      <Input name="taxNumber" defaultValue={tenant.taxNumber ?? ""} />
                    </Field>
                    <Field label="Mata uang">
                      <Input name="currency" defaultValue={tenant.currency} />
                    </Field>
                    <Field label="Phone">
                      <Input name="phone" defaultValue={tenant.phone ?? ""} />
                    </Field>
                    <Field label="Email">
                      <Input name="email" type="email" defaultValue={tenant.email ?? ""} />
                    </Field>
                    <Field label="Website">
                      <Input name="website" defaultValue={tenant.website ?? ""} />
                    </Field>
                    <Field label="Timezone">
                      <Input name="timezone" defaultValue={tenant.timezone} />
                    </Field>
                    <Field label="City">
                      <Input name="city" defaultValue={tenant.city ?? ""} />
                    </Field>
                    <Field label="Country">
                      <Input name="country" defaultValue={tenant.country} />
                    </Field>
                    <Field label="Logo URL" hint="Dipakai di sidebar dan header PDF" className="sm:col-span-2">
                      <Input name="logoUrl" defaultValue={tenant.logoUrl ?? ""} placeholder="https://…" />
                    </Field>
                    <Field label="Alamat" className="sm:col-span-2">
                      <Textarea name="address" defaultValue={tenant.address ?? ""} />
                    </Field>
                  </FormGrid>
                </FormShell>
              ) : (
                <DescriptionList
                  items={[
                    { label: "Nama", value: tenant.name },
                    { label: "Nama legal", value: tenant.legalName ?? "—" },
                    { label: "NPWP", value: tenant.taxNumber ?? "—" },
                    { label: "Mata uang", value: tenant.currency },
                    { label: "Phone", value: tenant.phone ?? "—" },
                    { label: "Email", value: tenant.email ?? "—" },
                    { label: "Alamat", value: tenant.address ?? "—", wide: true },
                  ]}
                />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Ringkasan tenant" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Slug", value: tenant.slug },
                  { label: "Dibuat", value: formatDateTime(tenant.createdAt) },
                  { label: "Role Anda", value: auth.user.role },
                  { label: "Akses settings", value: canEdit ? "Manage" : "View saja" },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Catatan" />
            <CardBody className="text-xs text-slate-500">
              Hanya Owner yang bisa mengubah pengaturan perusahaan, user, penomoran, template, dan workflow. Manager dapat
              melihat halaman ini untuk referensi.
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
