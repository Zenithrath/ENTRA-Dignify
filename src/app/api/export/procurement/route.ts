import { NextResponse } from "next/server";

import { WorkStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildProcurementWorkbook } from "@/lib/tracker";
import { num } from "@/lib/money";

// Export Sheet 2 — kolom sama persis dengan list view Procurement Tracker.
export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const customerId = url.searchParams.get("customer")?.trim() ?? "";
  const statusParam = url.searchParams.get("status")?.trim() ?? "";

  const statuses = statusParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => (Object.values(WorkStatus) as string[]).includes(value)) as WorkStatus[];

  const items = await prisma.quotationItem.findMany({
    where: {
      quotation: {
        tenantId: auth.user.tenantId,
        ...(customerId ? { customerId } : {}),
      },
      ...(statuses.length > 0 ? { workStatus: { in: statuses } } : {}),
      ...(q
        ? {
            OR: [
              { description: { contains: q, mode: "insensitive" } },
              { vendor: { contains: q, mode: "insensitive" } },
              { quotation: { number: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ quotation: { quotationDate: "desc" } }, { sortOrder: "asc" }],
    include: {
      quotation: { select: { number: true, customer: { select: { companyName: true } } } },
    },
  });

  const buffer = await buildProcurementWorkbook(
    items.map((item) => ({
      quotationNumber: item.quotation.number,
      customerName: item.quotation.customer.companyName,
      itemName: item.description,
      qty: num(item.quantity),
      unit: item.unit,
      vendor: item.vendor,
      deliveryMethod: item.deliveryMethod,
      workStatus: item.workStatus,
    })),
  );

  const body = new Uint8Array(buffer);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="procurement-tracker-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
