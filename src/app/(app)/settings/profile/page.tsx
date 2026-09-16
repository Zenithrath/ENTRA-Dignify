import type { Metadata } from "next";

import { FormShell } from "@/components/form-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { updateProfile } from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/queries/common";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "My profile" };

export default async function SettingsProfilePage() {
  const auth = await requireAuth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });

  return (
    <>
      <PageHeader title="My profile" description="Data akun Anda dan keamanan login." />
      <SettingsTabs active="profile" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Profil" description="Perubahan nama & kontak langsung berlaku." />
            <CardBody>
              <FormShell action={updateProfile} submitLabel="Simpan profil">
                <FormGrid>
                  <Field label="Nama" required>
                    <Input name="name" defaultValue={user.name} required />
                  </Field>
                  <Field label="Phone">
                    <Input name="phone" defaultValue={user.phone ?? ""} />
                  </Field>
                  <Field label="Job title">
                    <Input name="jobTitle" defaultValue={user.jobTitle ?? ""} />
                  </Field>
                </FormGrid>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="mb-3 text-sm font-medium text-slate-900">Ganti password</p>
                  <FormGrid>
                    <Field label="Password saat ini" hint="Wajib jika mengganti password">
                      <Input name="currentPassword" type="password" autoComplete="current-password" />
                    </Field>
                    <Field label="Password baru" hint="Minimal 8 karakter">
                      <Input name="newPassword" type="password" minLength={8} autoComplete="new-password" />
                    </Field>
                  </FormGrid>
                </div>
              </FormShell>
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Info akun" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Email", value: user.email },
                  { label: "Role", value: user.role },
                  { label: "Tenant", value: auth.tenant.name },
                  { label: "Login terakhir", value: formatDateTime(user.lastLoginAt) },
                  { label: "Dibuat", value: formatDateTime(user.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
