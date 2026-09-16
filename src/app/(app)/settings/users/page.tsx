import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { FormShell } from "@/components/form-shell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable } from "@/components/ui/table";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { inviteUser, resetUserPassword, toggleUserActive, updateUser } from "@/lib/actions/settings-actions";
import { requireAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/queries/common";
import { prisma } from "@/lib/prisma";
import { canManage } from "@/lib/rbac";
import { Role } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Users & roles" };

const ROLE_OPTIONS = Object.values(Role);

export default async function SettingsUsersPage() {
  const auth = await requireAuth();
  const canEdit = canManage(auth.user.role, "settings");

  const users = await prisma.user.findMany({
    where: { tenantId: auth.user.tenantId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Undang anggota tim, atur role, dan nonaktifkan akses."
      />
      <SettingsTabs active="users" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Tim" description={`${users.filter((user) => user.isActive).length} user aktif.`} />
            <DataTable
              rows={users}
              rowKey={(row) => row.id}
              empty={<EmptyState title="Belum ada user" />}
              columns={[
                {
                  key: "name",
                  header: "Nama",
                  render: (row) => (
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {row.name}
                        {row.id === auth.user.id ? <span className="ml-2 text-[11px] text-slate-400">(Anda)</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">{row.email}</p>
                    </div>
                  ),
                },
                {
                  key: "role",
                  header: "Role",
                  render: (row) => <Badge tone="accent">{row.role}</Badge>,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) =>
                    row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>,
                },
                {
                  key: "lastLogin",
                  header: "Login terakhir",
                  render: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.lastLoginAt)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (row) =>
                    canEdit && row.id !== auth.user.id ? (
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <ActionForm action={toggleUserActive.bind(null, row.id)}>
                          <input type="hidden" name="isActive" value={row.isActive ? "false" : "true"} />
                          <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                            {row.isActive ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </ActionForm>
                        <details className="relative">
                          <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none")}>Edit</summary>
                          <div className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                            <FormShell action={updateUser.bind(null, row.id)} submitLabel="Save" size="sm">
                              <Field label="Nama">
                                <Input name="name" defaultValue={row.name} />
                              </Field>
                              <Field label="Role" className="mt-2">
                                <Select name="role" defaultValue={row.role}>
                                  {ROLE_OPTIONS.map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            </FormShell>
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <FormShell action={resetUserPassword.bind(null, row.id)} submitLabel="Reset password" size="sm" variant="secondary">
                                <Field label="Password baru">
                                  <Input name="password" type="password" minLength={8} required />
                                </Field>
                              </FormShell>
                            </div>
                          </div>
                        </details>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>
        </div>

        <div>
          {canEdit ? (
            <Card>
              <CardHeader title="Undang user baru" description="User langsung dibuat dengan password awal." />
              <CardBody>
                <FormShell action={inviteUser} submitLabel="Undang user">
                  <FormGrid>
                    <Field label="Nama" required>
                      <Input name="name" required />
                    </Field>
                    <Field label="Email" required>
                      <Input name="email" type="email" required />
                    </Field>
                    <Field label="Phone">
                      <Input name="phone" />
                    </Field>
                    <Field label="Job title">
                      <Input name="jobTitle" />
                    </Field>
                    <Field label="Role" required>
                      <Select name="role" defaultValue={Role.SALES}>
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Password awal" hint="Minimal 8 karakter" required>
                      <Input name="password" type="password" minLength={8} required />
                    </Field>
                  </FormGrid>
                </FormShell>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="text-sm text-slate-600">
                Hanya Owner yang dapat mengelola user. Hubungi Owner tenant Anda untuk perubahan akses.
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
