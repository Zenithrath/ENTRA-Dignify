import { NextResponse } from "next/server";

import { TrackerStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildQuotationsWorkbook, calcAgingDays } from "@/lib/tracker";

// Export Sheet 1 — kolom sama persis dengan list view Quotation Tracker.
export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const customerId = url.searchParams.get("customer")?.trim() ?? "";
  const statusParam = url.searchParams.get("status")?.trim() ?? "";

  const statuses = statusParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => (Object.values(TrackerStatus) as string[]).includes(value)) as TrackerStatus[];

  const quotations = await prisma.quotation.findMany({
    where: {
      tenantId: auth.user.tenantId,
      ...(statuses.length > 0 ? { trackerStatus: { in: statuses } } : {}),
      ...(customerId ? { customerId } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { customer: { companyName: { contains: q, mode: "insensitive" } } },
              { customerPoNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { quotationDate: "desc" },
    include: { customer: { select: { companyName: true } } },
  });

  const buffer = await buildQuotationsWorkbook(
    quotations.map((row) => ({
      number: row.number,
      quotationDate: row.quotationDate,
      customerName: row.customer.companyName,
      agingDays: calcAgingDays(row.quotationDate, row.trackerStatus, row.customerPoDate),
      customerPoNumber: row.customerPoNumber,
    })),
  );

  const body = new Uint8Array(buffer);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="quotation-tracker-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
