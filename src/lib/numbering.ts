import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { DocType } from "@/generated/prisma/enums";

export const DEFAULT_PREFIX: Record<DocType, string> = {
  REQUEST: "REQ",
  QUOTATION: "QUO",
  SALES_ORDER: "SO",
  RFQ: "RFQ",
  PURCHASE_ORDER: "PO",
  GOODS_RECEIPT: "GRN",
  WORK_ORDER: "WO",
  PRODUCTION_ORDER: "PRD",
  SUBCONTRACT: "SUB",
  DELIVERY_ORDER: "DO",
  INVOICE: "INV",
  PAYMENT: "PAY",
};

export const DEFAULT_PATTERN = "{prefix}/{YYYY}/{seq}";

export function formatDocumentNumber(
  pattern: string,
  prefix: string,
  sequence: number,
  year: number,
  padLength: number,
): string {
  return pattern
    .replaceAll("{prefix}", prefix)
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{YY}", String(year).slice(-2))
    .replaceAll("{MM}", String(new Date().getMonth() + 1).padStart(2, "0"))
    .replaceAll("{seq}", String(sequence).padStart(padLength, "0"));
}

type SequenceRow = {
  nextNumber: number;
  prefix: string;
  pattern: string;
  padLength: number;
  resetYearly: boolean;
  currentYear: number | null;
};

/**
 * Allocates the next document number for a tenant, inside the caller's transaction.
 * The row is locked (FOR UPDATE) so two concurrent creates can never share a number.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  docType: DocType,
): Promise<string> {
  const year = new Date().getFullYear();

  await tx.$executeRaw`
    INSERT INTO "DocumentSequence"
      ("id", "tenantId", "docType", "prefix", "pattern", "padLength", "nextNumber", "resetYearly", "currentYear", "updatedAt")
    VALUES
      (${randomUUID()}, ${tenantId}, ${docType}::text::"DocType", ${DEFAULT_PREFIX[docType]}, ${DEFAULT_PATTERN}, 4, 1, true, ${year}, NOW())
    ON CONFLICT ("tenantId", "docType") DO NOTHING
  `;

  const rows = await tx.$queryRaw<SequenceRow[]>`
    SELECT "nextNumber", "prefix", "pattern", "padLength", "resetYearly", "currentYear"
    FROM "DocumentSequence"
    WHERE "tenantId" = ${tenantId} AND "docType" = ${docType}::text::"DocType"
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) throw new Error(`Could not allocate a ${docType} number for tenant ${tenantId}.`);

  const sequence = row.resetYearly && row.currentYear !== year ? 1 : row.nextNumber;

  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextNumber" = ${sequence + 1}, "currentYear" = ${year}, "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId} AND "docType" = ${docType}::text::"DocType"
  `;

  return formatDocumentNumber(row.pattern, row.prefix, sequence, year, row.padLength);
}
