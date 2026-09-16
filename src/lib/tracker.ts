import ExcelJS from "exceljs";

import type { TrackerStatus, WorkStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Layer 1 tracker — logika pengganti 2 Google Sheets.
// Satu-satunya tempat threshold aging diubah (tidak perlu UI setting).
// ---------------------------------------------------------------------------

/** Tandai merah kalau quotation masih Waiting PO lebih lama dari ini (hari). */
export const AGING_THRESHOLD_DAYS = 10;

export const TRACKER_STATUSES: TrackerStatus[] = ["WAITING_PO", "PO_RECEIVED", "LOST"];

export const TRACKER_STATUS_LABEL: Record<TrackerStatus, string> = {
  WAITING_PO: "Waiting PO",
  PO_RECEIVED: "PO Received",
  LOST: "Lost",
};

export const WORK_STATUSES: WorkStatus[] = ["TO_SOURCE", "ORDERED", "READY_TO_SHIP", "DELIVERED"];

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  TO_SOURCE: "To Source",
  ORDERED: "Ordered",
  READY_TO_SHIP: "Ready to Ship",
  DELIVERED: "Delivered",
};

/**
 * Aging = selisih hari kalender tanggal quotation → hari ini selama status
 * masih Waiting PO. Begitu PO diterima, aging berhenti di tanggal PO
 * (tanggal PO kosong → pakai hari ini supaya tidak minus).
 * Selalu >= 0 dan dihitung saat tampil, tidak disimpan.
 */
export function calcAgingDays(
  quotationDate: Date,
  trackerStatus: TrackerStatus | string,
  customerPoDate?: Date | null,
  now: Date = new Date(),
): number {
  const start = dayKey(quotationDate);
  const end =
    trackerStatus === "PO_RECEIVED" ? dayKey(customerPoDate ?? now) : dayKey(now);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function isAgingOverdue(
  quotationDate: Date,
  trackerStatus: TrackerStatus | string,
  customerPoDate?: Date | null,
  now?: Date,
): boolean {
  return (
    trackerStatus === "WAITING_PO" &&
    calcAgingDays(quotationDate, trackerStatus, customerPoDate, now) > AGING_THRESHOLD_DAYS
  );
}

function dayKey(value: Date): number {
  const date = new Date(value);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

// ---------------------------------------------------------------------------
// Nomor quotation ala sheet lama: QTTP-XXXX/CUSTOMER/MM/YYYY
// (boleh diketik manual; auto-generate hanya mengisi usulan awal).
// ---------------------------------------------------------------------------

export function customerCode(companyName: string): string {
  const withoutPrefix = companyName.replace(/^(pt|cv|ud|tbk|persero)\.?[\s.]+/i, "").trim();
  const firstWord = withoutPrefix.split(/\s+/)[0] ?? "";
  const cleaned = firstWord.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 12) || "CUST";
}

export function buildQuotationNumber(seq: number, companyName: string, date: Date): string {
  const padded = String(seq).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `QTTP-${padded}/${customerCode(companyName)}/${month}/${date.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Export Excel — kolom semirip mungkin dengan sheet asli.
// ---------------------------------------------------------------------------

export type QuotationExportRow = {
  number: string;
  quotationDate: Date;
  customerName: string;
  agingDays: number;
  customerPoNumber: string | null;
};

export type ProcurementExportRow = {
  quotationNumber: string;
  customerName: string;
  itemName: string;
  qty: number;
  unit: string | null;
  vendor: string | null;
  deliveryMethod: string | null;
  workStatus: WorkStatus | string;
};

function styleHeader(worksheet: ExcelJS.Worksheet): void {
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE11D48" } };
  header.alignment = { vertical: "middle" };
}

export async function buildQuotationsWorkbook(rows: QuotationExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Quotation Tracker");
  sheet.columns = [
    { header: "Nomor Quotation", key: "number", width: 32 },
    { header: "Tanggal Quotation", key: "date", width: 18 },
    { header: "Customer", key: "customer", width: 30 },
    { header: "Aging (hari)", key: "aging", width: 13 },
    { header: "PO Customer", key: "po", width: 24 },
  ];
  for (const row of rows) {
    sheet.addRow({
      number: row.number,
      date: row.quotationDate,
      customer: row.customerName,
      aging: row.agingDays,
      po: row.customerPoNumber ?? "",
    });
  }
  sheet.getColumn("date").numFmt = "dd-mmm-yyyy";
  styleHeader(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildProcurementWorkbook(rows: ProcurementExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Procurement Tracker");
  sheet.columns = [
    { header: "Quotation", key: "quotation", width: 30 },
    { header: "Customer", key: "customer", width: 26 },
    { header: "Barang", key: "item", width: 34 },
    { header: "Jumlah", key: "qty", width: 10 },
    { header: "Satuan", key: "unit", width: 10 },
    { header: "Toko/Vendor", key: "vendor", width: 26 },
    { header: "Metode Kirim", key: "delivery", width: 20 },
    { header: "Status Pekerjaan", key: "status", width: 18 },
  ];
  for (const row of rows) {
    sheet.addRow({
      quotation: row.quotationNumber,
      customer: row.customerName,
      item: row.itemName,
      qty: row.qty,
      unit: row.unit ?? "",
      vendor: row.vendor ?? "",
      delivery: row.deliveryMethod ?? "",
      status:
        WORK_STATUS_LABEL[row.workStatus as WorkStatus] ?? String(row.workStatus),
    });
  }
  styleHeader(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
