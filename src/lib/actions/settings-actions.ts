"use server";

import bcrypt from "bcryptjs";

import { AttachmentEntity, DocType, ModuleKey, Role, WorkflowScope } from "@/generated/prisma/enums";
import { logActivity } from "@/lib/activity";
import { hashPassword, requireAuth, requirePermission } from "@/lib/auth";
import { DEFAULT_PATTERN, DEFAULT_PREFIX } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { fail, ok, optionalString, requiredString, runAction, type ActionResult } from "@/lib/actions/helpers";

const SETTINGS_PATHS = [
  "/settings",
  "/settings/company",
  "/settings/users",
  "/settings/numbering",
  "/settings/templates",
  "/settings/workflow",
  "/settings/approvals",
  "/settings/profile",
];

function asDocType(value: string): DocType {
  if (!Object.values(DocType).includes(value as DocType)) throw new Error("Jenis dokumen tidak dikenal.");
  return value as DocType;
}

function asRole(value: string): Role {
  if (!Object.values(Role).includes(value as Role)) throw new Error("Role tidak dikenal.");
  return value as Role;
}

// ------------------------------------------------------------------ company

export async function updateCompany(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");

      await prisma.$transaction(async (tx) => {
        const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.user.tenantId } });

        const updated = await tx.tenant.update({
          where: { id: before.id },
          data: {
            name: requiredString(formData, "name", "Nama perusahaan"),
            legalName: optionalString(formData, "legalName"),
            address: optionalString(formData, "address"),
            city: optionalString(formData, "city"),
            country: optionalString(formData, "country") ?? before.country,
            phone: optionalString(formData, "phone"),
            email: optionalString(formData, "email"),
            website: optionalString(formData, "website"),
            logoUrl: optionalString(formData, "logoUrl"),
            taxNumber: optionalString(formData, "taxNumber"),
            currency: optionalString(formData, "currency") ?? before.currency,
            timezone: optionalString(formData, "timezone") ?? before.timezone,
          },
        });

        await logActivity(tx, {
          tenantId: before.id,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.OTHER,
          entityId: updated.id,
          entityLabel: updated.name,
          summary: `Company profile updated`,
        });
      });

      return ok("Profil perusahaan disimpan.");
    },
    SETTINGS_PATHS,
  );
}

// -------------------------------------------------------------------- users

export async function inviteUser(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const name = requiredString(formData, "name", "Nama");
      const email = requiredString(formData, "email", "Email").toLowerCase();
      const password = requiredString(formData, "password", "Password");
      const role = asRole(String(formData.get("role") ?? Role.SALES));

      if (password.length < 8) return fail("Password minimal 8 karakter.");

      const existing = await prisma.user.findFirst({ where: { tenantId, email } });
      if (existing) return fail("Email ini sudah dipakai user lain di tenant Anda.");

      const user = await prisma.user.create({
        data: {
          tenantId,
          name,
          email,
          phone: optionalString(formData, "phone"),
          jobTitle: optionalString(formData, "jobTitle"),
          role,
          passwordHash: await hashPassword(password),
        },
      });

      await logActivity(prisma, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "CREATE",
        entityType: AttachmentEntity.OTHER,
        entityId: user.id,
        entityLabel: user.email,
        summary: `User ${user.email} invited as ${role}`,
      });

      return ok(`User ${user.email} dibuat dengan role ${role}.`);
    },
    SETTINGS_PATHS,
  );
}

export async function updateUser(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;

      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirstOrThrow({ where: { id: userId, tenantId } });
        const role = asRole(String(formData.get("role") ?? user.role));

        if (user.id === auth.user.id && role !== user.role) {
          throw new Error("Anda tidak bisa mengubah role akun Anda sendiri.");
        }
        if (user.role === Role.OWNER && role !== Role.OWNER) {
          const owners = await tx.user.count({ where: { tenantId, role: Role.OWNER, isActive: true } });
          if (owners <= 1) throw new Error("Tenant harus punya minimal satu Owner aktif.");
        }

        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            name: requiredString(formData, "name", "Nama"),
            phone: optionalString(formData, "phone"),
            jobTitle: optionalString(formData, "jobTitle"),
            role,
          },
        });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.OTHER,
          entityId: updated.id,
          entityLabel: updated.email,
          summary: `User ${updated.email} updated`,
          changes: { role: { from: user.role, to: updated.role } },
        });
      });

      return ok("User diperbarui.");
    },
    SETTINGS_PATHS,
  );
}

export async function toggleUserActive(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const isActive = String(formData.get("isActive") ?? "true") === "true";

      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirstOrThrow({ where: { id: userId, tenantId } });

        if (user.id === auth.user.id) throw new Error("Anda tidak bisa menonaktifkan akun Anda sendiri.");
        if (!isActive && user.role === Role.OWNER) {
          const owners = await tx.user.count({ where: { tenantId, role: Role.OWNER, isActive: true } });
          if (owners <= 1) throw new Error("Tenant harus punya minimal satu Owner aktif.");
        }

        await tx.user.update({ where: { id: user.id }, data: { isActive } });
        if (!isActive) await tx.session.deleteMany({ where: { userId: user.id } });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.OTHER,
          entityId: user.id,
          entityLabel: user.email,
          summary: `User ${user.email} ${isActive ? "reactivated" : "deactivated"}`,
        });
      });

      return ok(isActive ? "User diaktifkan." : "User dinonaktifkan dan sesi aktifnya diputus.");
    },
    SETTINGS_PATHS,
  );
}

export async function resetUserPassword(userId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const password = requiredString(formData, "password", "Password");
      if (password.length < 8) return fail("Password minimal 8 karakter.");

      const user = await prisma.user.findFirstOrThrow({ where: { id: userId, tenantId } });

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
        await tx.session.deleteMany({ where: { userId: user.id } });

        await logActivity(tx, {
          tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.OTHER,
          entityId: user.id,
          entityLabel: user.email,
          summary: `Password reset for ${user.email}`,
        });
      });

      return ok("Password direset. Semua sesi user tersebut diputus.");
    },
    SETTINGS_PATHS,
  );
}

// ----------------------------------------------------------------- profile

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requireAuth();
    const currentPassword = optionalString(formData, "currentPassword");
    const newPassword = optionalString(formData, "newPassword");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });

    let passwordHash = user.passwordHash;
    if (newPassword) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return fail("Password saat ini salah.");
      }
      if (newPassword.length < 8) return fail("Password baru minimal 8 karakter.");
      passwordHash = await hashPassword(newPassword);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: requiredString(formData, "name", "Nama"),
        phone: optionalString(formData, "phone"),
        jobTitle: optionalString(formData, "jobTitle"),
        passwordHash,
      },
    });

    if (newPassword) {
      // Keep the current cookie alive, drop the other devices.
      await prisma.session.deleteMany({ where: { userId: user.id, id: { not: "" } } });
    }

    return ok(newPassword ? "Profil dan password diperbarui. Login ulang di perangkat lain." : "Profil diperbarui.");
  }, ["/settings/profile", "/dashboard"]);
}

// ---------------------------------------------------------------- numbering

export async function saveDocumentNumber(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const docType = asDocType(String(formData.get("docType") ?? ""));
      const prefix = requiredString(formData, "prefix", "Prefix");
      const pattern = requiredString(formData, "pattern", "Format");
      const padLength = Math.max(1, Math.min(10, Number(formData.get("padLength") ?? 4) || 4));
      const resetYearly = String(formData.get("resetYearly") ?? "") === "on" || String(formData.get("resetYearly")) === "true";
      const nextNumber = Math.max(1, Number(formData.get("nextNumber") ?? 1) || 1);

      if (!pattern.includes("{seq}")) return fail("Format wajib memuat {seq}.");

      await prisma.documentSequence.upsert({
        where: { tenantId_docType: { tenantId, docType } },
        create: { tenantId, docType, prefix, pattern, padLength, resetYearly, nextNumber },
        update: { prefix, pattern, padLength, resetYearly, nextNumber },
      });

      await logActivity(prisma, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "UPDATE",
        entityType: AttachmentEntity.OTHER,
        entityId: docType,
        entityLabel: docType,
        summary: `Document numbering for ${docType} set to ${pattern}`,
      });

      return ok(`Format nomor ${docType} disimpan.`);
    },
    SETTINGS_PATHS,
  );
}

export async function resetDocumentNumber(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const docType = asDocType(String(formData.get("docType") ?? ""));

      await prisma.documentSequence.upsert({
        where: { tenantId_docType: { tenantId: auth.user.tenantId, docType } },
        create: {
          tenantId: auth.user.tenantId,
          docType,
          prefix: DEFAULT_PREFIX[docType],
          pattern: DEFAULT_PATTERN,
          nextNumber: 1,
        },
        update: { prefix: DEFAULT_PREFIX[docType], pattern: DEFAULT_PATTERN, nextNumber: 1, currentYear: null },
      });

      return ok(`Penomoran ${docType} dikembalikan ke default.`);
    },
    SETTINGS_PATHS,
  );
}

// ---------------------------------------------------------------- templates

export async function saveTemplate(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const docType = asDocType(String(formData.get("docType") ?? ""));
      const name = requiredString(formData, "name", "Nama template");

      const existing = await prisma.documentTemplate.findFirst({ where: { tenantId, docType, name } });
      const data = {
        logoUrl: optionalString(formData, "logoUrl"),
        footer: optionalString(formData, "footer"),
        layout: {
          headerAlign: String(formData.get("headerAlign") ?? "left"),
          accentColor: String(formData.get("accentColor") ?? "#4f46e5"),
          showTax: String(formData.get("showTax") ?? "") === "on" || String(formData.get("showTax")) === "true",
          notes: optionalString(formData, "templateNotes"),
        },
      };

      if (existing) {
        await prisma.documentTemplate.update({ where: { id: existing.id }, data });
      } else {
        await prisma.documentTemplate.create({ data: { tenantId, docType, name, ...data } });
      }

      await logActivity(prisma, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: existing ? "UPDATE" : "CREATE",
        entityType: AttachmentEntity.OTHER,
        entityId: docType,
        entityLabel: name,
        summary: `Template ${name} saved for ${docType}`,
      });

      return ok("Template disimpan.");
    },
    SETTINGS_PATHS,
  );
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");

      const template = await prisma.documentTemplate.findFirstOrThrow({
        where: { id: templateId, tenantId: auth.user.tenantId },
      });
      await prisma.documentTemplate.delete({ where: { id: template.id } });

      return ok("Template dihapus.");
    },
    SETTINGS_PATHS,
  );
}

// ------------------------------------------------------------------ modules

export async function setModuleEnabled(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const key = String(formData.get("key") ?? "");
      if (!Object.values(ModuleKey).includes(key as ModuleKey)) return fail("Modul tidak dikenal.");
      const enabled = String(formData.get("enabled") ?? "") === "true";

      await prisma.tenantModule.upsert({
        where: { tenantId_key: { tenantId, key: key as ModuleKey } },
        create: { tenantId, key: key as ModuleKey, enabled },
        update: { enabled },
      });

      await logActivity(prisma, {
        tenantId,
        actor: { id: auth.user.id, name: auth.user.name },
        action: "UPDATE",
        entityType: AttachmentEntity.OTHER,
        entityId: key,
        entityLabel: key,
        summary: `Module ${key} ${enabled ? "enabled" : "disabled"}`,
      });

      return ok(`Modul ${key} ${enabled ? "diaktifkan" : "dimatikan"}.`);
    },
    [...SETTINGS_PATHS, "/inventory"],
  );
}

// ----------------------------------------------------------------- workflow

export async function saveWorkflowStage(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const scopeRaw = String(formData.get("scope") ?? WorkflowScope.PRODUCTION);
      const scope = Object.values(WorkflowScope).includes(scopeRaw as WorkflowScope)
        ? (scopeRaw as WorkflowScope)
        : WorkflowScope.PRODUCTION;
      const name = requiredString(formData, "name", "Nama tahap");
      const sortOrder = Number(formData.get("sortOrder") ?? 0) || 0;

      await prisma.workflowStage.upsert({
        where: { tenantId_scope_name: { tenantId, scope, name } },
        create: { tenantId, scope, name, sortOrder },
        update: { sortOrder, isActive: true },
      });

      return ok(`Tahap "${name}" disimpan untuk alur ${scope}.`);
    },
    SETTINGS_PATHS,
  );
}

export async function deleteWorkflowStage(stageId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");

      const stage = await prisma.workflowStage.findFirstOrThrow({
        where: { id: stageId, tenantId: auth.user.tenantId },
      });
      await prisma.workflowStage.update({ where: { id: stage.id }, data: { isActive: false } });

      return ok(`Tahap "${stage.name}" dinonaktifkan.`);
    },
    SETTINGS_PATHS,
  );
}

export async function reorderWorkflowStage(stageId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const delta = Number(formData.get("delta") ?? 0) || 0;

      const stage = await prisma.workflowStage.findFirstOrThrow({
        where: { id: stageId, tenantId: auth.user.tenantId },
      });
      const next = Math.max(0, stage.sortOrder + delta);

      await prisma.workflowStage.update({ where: { id: stage.id }, data: { sortOrder: next } });

      return ok("Urutan tahap diperbarui.");
    },
    SETTINGS_PATHS,
  );
}

// ---------------------------------------------------------------- approvals

export async function saveApprovalRule(formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");
      const tenantId = auth.user.tenantId;
      const docType = asDocType(String(formData.get("docType") ?? ""));
      const thresholdAmount = Math.max(0, Number(formData.get("thresholdAmount") ?? 0) || 0);
      const approverRole = asRole(String(formData.get("approverRole") ?? Role.MANAGER));

      const existing = await prisma.approvalRule.findFirst({ where: { tenantId, docType } });
      if (existing) {
        await prisma.approvalRule.update({
          where: { id: existing.id },
          data: { thresholdAmount, approverRole, isActive: true },
        });
      } else {
        await prisma.approvalRule.create({ data: { tenantId, docType, thresholdAmount, approverRole } });
      }

      // Threshold only bites when the module is on — switch it on for the user.
      await prisma.tenantModule.upsert({
        where: { tenantId_key: { tenantId, key: ModuleKey.APPROVAL_WORKFLOW } },
        create: { tenantId, key: ModuleKey.APPROVAL_WORKFLOW, enabled: true },
        update: { enabled: true },
      });

      return ok(`Approval untuk ${docType} disimpan.`);
    },
    SETTINGS_PATHS,
  );
}

export async function deleteApprovalRule(ruleId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("settings", "manage");

      const rule = await prisma.approvalRule.findFirstOrThrow({
        where: { id: ruleId, tenantId: auth.user.tenantId },
      });
      await prisma.approvalRule.delete({ where: { id: rule.id } });

      return ok("Aturan approval dihapus.");
    },
    SETTINGS_PATHS,
  );
}
