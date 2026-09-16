import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  ApprovalStatus,
  DocType,
  Role,
  type AttachmentEntity,
} from "@/generated/prisma/enums";
import { num } from "@/lib/money";
import { isApprovalRequired } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient;

/** Both a transaction client and the root client satisfy this. */
type RuleDb = Pick<Prisma.TransactionClient, "approvalRule" | "tenantModule">;

export type ApprovalRuleInfo = {
  thresholdAmount: number;
  approverRole: Role;
};

/**
 * Reads the tenant's configured threshold for a document type. With no rule (or the
 * module switched off) documents flow without an internal gate.
 */
export async function approvalRuleFor(db: RuleDb, tenantId: string, docType: DocType): Promise<ApprovalRuleInfo | null> {
  const [rule, module] = await Promise.all([
    db.approvalRule.findFirst({
      where: { tenantId, docType, isActive: true },
      orderBy: { thresholdAmount: "asc" },
    }),
    db.tenantModule.findUnique({ where: { tenantId_key: { tenantId, key: "APPROVAL_WORKFLOW" } } }),
  ]);

  if (!rule) return null;
  if (module && !module.enabled) return null;

  return { thresholdAmount: num(rule.thresholdAmount), approverRole: rule.approverRole };
}

export function requiresApproval(total: number, rule: ApprovalRuleInfo | null): boolean {
  if (!rule) return false;
  return isApprovalRequired(total, rule.thresholdAmount);
}

export async function openApproval(
  db: Db,
  params: {
    tenantId: string;
    docType: DocType;
    recordId: string;
    recordNumber: string;
    amount: number;
    requestedById: string;
    approverRole: Role;
  },
): Promise<void> {
  await db.approval.create({
    data: {
      tenantId: params.tenantId,
      docType: params.docType,
      recordId: params.recordId,
      recordNumber: params.recordNumber,
      amount: params.amount,
      status: ApprovalStatus.PENDING,
      requestedById: params.requestedById,
      approverRole: params.approverRole,
    },
  });
}

export async function decideApproval(
  db: Db,
  params: {
    tenantId: string;
    docType: DocType;
    recordId: string;
    decidedById: string;
    status: typeof ApprovalStatus.APPROVED | typeof ApprovalStatus.REJECTED;
    note?: string | null;
  },
): Promise<void> {
  await db.approval.updateMany({
    where: {
      tenantId: params.tenantId,
      docType: params.docType,
      recordId: params.recordId,
      status: ApprovalStatus.PENDING,
    },
    data: {
      status: params.status,
      decidedById: params.decidedById,
      note: params.note ?? null,
      decidedAt: new Date(),
    },
  });
}

export type PendingApproval = {
  id: string;
  docType: DocType;
  recordId: string;
  recordNumber: string | null;
  amount: unknown;
  approverRole: Role;
  createdAt: Date;
  href: string;
  entityType: AttachmentEntity;
};

/** Approvals waiting on the signed-in role, with the deep link to the document. */
export async function pendingApprovalsFor(tenantId: string, role: Role): Promise<PendingApproval[]> {
  const approvals = await prisma.approval.findMany({
    where: {
      tenantId,
      status: ApprovalStatus.PENDING,
      ...(role === Role.OWNER ? {} : { approverRole: role }),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return approvals.map((approval) => ({
    id: approval.id,
    docType: approval.docType,
    recordId: approval.recordId,
    recordNumber: approval.recordNumber,
    amount: approval.amount,
    approverRole: approval.approverRole,
    createdAt: approval.createdAt,
    href:
      approval.docType === DocType.QUOTATION
        ? `/quotations/${approval.recordId}`
        : approval.docType === DocType.PURCHASE_ORDER
          ? `/procurement/purchase-orders/${approval.recordId}`
          : "/dashboard",
    entityType: approval.docType === DocType.QUOTATION ? "QUOTATION" : "PURCHASE_ORDER",
  }));
}
