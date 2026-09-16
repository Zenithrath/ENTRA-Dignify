import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { canView } from "@/lib/rbac";
import {
  financeReport,
  operationsReport,
  parseRange,
  procurementReport,
  salesReport,
  type DateRange,
} from "@/lib/queries/reports";

type Cell = string | number | null | undefined;
type Sheet = { name: string; rows: Cell[][] };

function toCsv(sheets: Sheet[]): string {
  const escape = (value: Cell) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // CSV consumers get the first sheet; extra sheets only exist for XLSX output.
  return sheets[0].rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

/** Builds a real .xlsx (multi-sheet) with the same data the CSV path uses. */
async function toXlsx(sheets: Sheet[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "B2B Operations OS";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    for (const row of sheet.rows) worksheet.addRow(row.map((cell) => (cell === undefined ? null : cell)));
    if (worksheet.rowCount > 0) {
      worksheet.getRow(1).font = { bold: true };
      worksheet.columns.forEach((column) => {
        column.width = 22;
      });
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "sales";
  const format = url.searchParams.get("format") ?? "csv";
  const range: DateRange = parseRange(
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const tenantId = auth.user.tenantId;

  let sheets: Sheet[];
  const filenameBase = `entra-${report}-${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;

  if (report === "sales") {
    if (!canView(auth.user.role, "reports")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const data = await salesReport(tenantId, range);
    sheets = [
      {
        name: "Per customer",
        rows: [
          ["Customer", "Orders", "Order value"],
          ...data.byCustomer.map((row) => [row.name, row.orders, row.value]),
          [],
          ["Total", data.orderCount, data.orderValue],
          [],
          ["Metrik", "Nilai"],
          ["Quotation dibuat", data.quotationCount],
          ["Quotation won", data.wonQuotations],
          ["Conversion rate (%)", data.conversionRate],
          ["Average order value", data.averageOrderValue],
        ],
      },
      {
        name: "Per produk",
        rows: [
          ["Item", "Qty", "Nilai", "Margin"],
          ...data.byProduct.map((row) => [row.description, row.quantity, row.value, row.margin]),
        ],
      },
      {
        name: "Per bulan",
        rows: [
          ["Periode", "Order", "Nilai"],
          ...data.byMonth.map((row) => [row.label, row.orders, row.value]),
        ],
      },
    ];
  } else if (report === "procurement") {
    if (!canView(auth.user.role, "procurement") && !canView(auth.user.role, "reports")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const data = await procurementReport(tenantId, range);
    sheets = [
      {
        name: "Per supplier",
        rows: [
          ["Supplier", "PO count", "PO value", "Received PO", "On-time (%)", "Avg lead time (days)"],
          ...data.bySupplier.map((row) => [
            row.name,
            row.pos,
            row.value,
            row.received,
            row.onTimePercent ?? "",
            row.averageLeadTimeDays ?? "",
          ]),
          [],
          ["Outstanding PO", data.outstandingCount, data.outstandingValue],
        ],
      },
    ];
  } else if (report === "finance") {
    if (!canView(auth.user.role, "finance")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const data = await financeReport(tenantId, range);
    sheets = [
      {
        name: "Invoice overdue",
        rows: [
          ["Invoice", "Customer", "Jatuh tempo", "Outstanding", "Hari terlambat"],
          ...data.overdueInvoices.map((row) => [
            row.number,
            row.customer,
            row.dueDate.toISOString().slice(0, 10),
            row.outstanding,
            row.daysLate,
          ]),
          [],
          ["Invoiced", data.invoiced],
          ["Collected", data.collected],
          ["Outstanding", data.outstanding],
          ["Overdue", data.overdue],
          ["Profit", data.profit],
          ["Margin (%)", data.marginPercent],
        ],
      },
      {
        name: "Per bulan",
        rows: [
          ["Periode", "Invoiced", "Collected"],
          ...data.byMonth.map((row) => [row.label, row.invoiced, row.collected]),
        ],
      },
    ];
  } else {
    if (!canView(auth.user.role, "reports") && !canView(auth.user.role, "orders")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const data = await operationsReport(tenantId);
    sheets = [
      {
        name: "Order terlambat",
        rows: [
          ["Order", "Customer", "Estimasi", "Hari terlambat"],
          ...data.delayedList.map((row) => [
            row.number,
            row.customer,
            row.expected ? row.expected.toISOString().slice(0, 10) : "",
            row.daysLate,
          ]),
          [],
          ["Open orders", data.openOrders],
          ["Delayed orders", data.delayedOrders],
          ["Open work orders", data.openWorkOrders],
          ["Open production", data.openProduction],
          ["Open subcontracts", data.openSubcontracts],
          ["Open deliveries", data.openDeliveries],
        ],
      },
      {
        name: "Status order",
        rows: [
          ["Status", "Jumlah"],
          ...data.statusBreakdown.map((row) => [row.status, row.count]),
        ],
      },
    ];
  }

  const extension = format === "xlsx" ? "xlsx" : "csv";
  const filename = `${filenameBase}.${extension}`;

  if (format === "xlsx") {
    const buffer = await toXlsx(sheets);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(toCsv(sheets), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
