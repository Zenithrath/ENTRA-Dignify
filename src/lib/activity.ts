import type { Prisma } from "@/generated/prisma/client";
import type { ActivityAction, AttachmentEntity } from "@/generated/prisma/enums";

type Db = Prisma.TransactionClient;

export type Actor = { id: string; name: string } | null | undefined;

export type ChangeSet = Record<string, { from: unknown; to: unknown }>;

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "toString" in value && !Array.isArray(value)) {
    // Prisma Decimal and similar wrapper types.
    const ctor = (value as object).constructor?.name;
    if (ctor === "Decimal") return Number(value);
  }
  return value;
}

export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): ChangeSet | null {
  const changes: ChangeSet = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = jsonSafe(before[field]);
    const to = jsonSafe(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[String(field)] = { from, to };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Audit trail. Written from the same transaction as the change it describes so the
 * log can never drift from the data — and never updated or deleted afterwards.
 */
export async function logActivity(
  db: Db,
  params: {
    tenantId: string;
    actor?: Actor;
    action: ActivityAction;
    entityType: AttachmentEntity;
    entityId: string;
    entityLabel?: string | null;
    summary?: string | null;
    changes?: ChangeSet | null;
    ipAddress?: string | null;
  },
): Promise<void> {
  await db.activityLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.actor?.id ?? null,
      userName: params.actor?.name ?? "System",
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      entityLabel: params.entityLabel ?? null,
      summary: params.summary ?? null,
      changes: (params.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: params.ipAddress ?? null,
    },
  });
}

export function humanizeField(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}
