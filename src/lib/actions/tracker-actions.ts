"use server";

import { redirect } from "next/navigation";

import { QuotationStatus, TrackerStatus, WorkStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { buildQuotationNumber } from "@/lib/tracker";
import { prisma } from "@/lib/prisma";
import {
  dateField,
  fail,
  numberField,
  ok,
  optionalString,
  requiredString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/quotations", "/procurement", "/dashboard", "/customers"];

// Satu jenis akun untuk seluruh tim — tidak ada cek role di Layer 1.

function trackerStatusOf(formData: FormData): TrackerStatus {
  const raw = String(formData.get("trackerStatus") ?? "WAITING_PO").trim();
  if ((Object.values(TrackerStatus) as string[]).includes(raw)) return raw as TrackerStatus;
  throw new Error("Status tidak dikenal.");
}

function workStatusOf(value: unknown, fallback: WorkStatus = WorkStatus.TO_SOURCE): WorkStatus {
  const raw = String(value ?? "").trim();
  if ((Object.values(WorkStatus) as string[]).includes(raw)) return raw as WorkStatus;
  return fallback;
}

/** Baris barang ala Sheet 2: nama, jumlah, vendor, metode kirim, status. */
function parseTrackerItems(formData: FormData) {
  const rows: {
    description: string;
    quantity: number;
    unit: string | null;
    vendor: string | null;
    deliveryMethod: string | null;
    workStatus: WorkStatus;
  }[] = [];
  let index = 0;

  while (formData.has(`items[${index}][name]`)) {
    const name = String(formData.get(`items[${index}][name]`) ?? "").trim();
    if (name) {
      rows.push({
        description: name,
        quantity: Math.max(0, numberField(formData, `items[${index}][qty]`, 1)),
        unit: optionalString(formData, `items[${index}][unit]`),
        vendor: optionalString(formData, `items[${index}][vendor]`),
        deliveryMethod: optionalString(formData, `items[${index}][deliveryMethod]`),
        workStatus: workStatusOf(formData.get(`items[${index}][workStatus]`)),
      });
    }
    index += 1;
  }

  return rows;
}

/** Status lama tetap disinkronkan supaya modul Layer 2 (approval/order) tidak rusak. */
function legacyStatusFor(trackerStatus: TrackerStatus): QuotationStatus {
  if (trackerStatus === TrackerStatus.PO_RECEIVED) return QuotationStatus.APPROVED;
  if (trackerStatus === TrackerStatus.LOST) return QuotationStatus.REJECTED;
  return QuotationStatus.SENT;
}

// ---------------------------------------------------------------------------
// Customers — nama + kontak saja, supaya tidak ketik ulang tiap quotation.
// ---------------------------------------------------------------------------

export async function createTrackerCustomer(formData: FormData): Promise<ActionResult> {
  let createdId = "";
  const result = await runAction(async () => {
    const auth = await requireAuth();
    const name = requiredString(formData, "name", "Nama customer");
    const contact = optionalString(formData, "contact");

    const created = await prisma.customer.create({
      data: {
        tenantId: auth.user.tenantId,
        companyName: name,
        phone: contact,
        status: "ACTIVE",
        createdById: auth.user.id,
      },
    });
    createdId = created.id;
    return ok("Customer ditambahkan.", created.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/customers/${createdId}`);
}

export async function updateTrackerCustomer(customerId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requireAuth();
    const name = requiredString(formData, "name", "Nama customer");

    await prisma.customer.updateMany({
      where: { id: customerId, tenantId: auth.user.tenantId },
      data: { companyName: name, phone: optionalString(formData, "contact") },
    });
    return ok("Customer diperbarui.");
  }, [...PATHS, `/customers/${customerId}`]);
}

export async function deleteTrackerCustomer(customerId: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const auth = await requireAuth();
    const quotations = await prisma.quotation.count({
      where: { customerId, tenantId: auth.user.tenantId },
    });
    if (quotations > 0) {
      return fail(`Tidak bisa dihapus: masih dipakai ${quotations} quotation.`);
    }
    await prisma.customer.updateMany({
      where: { id: customerId, tenantId: auth.user.tenantId },
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });
    return ok("Customer dihapus.");
  }, PATHS);

  if (!result.ok) return result;
  redirect("/customers");
}

// ---------------------------------------------------------------------------
// Quotations — CRUD Sheet 1 + item Sheet 2 dalam satu form.
// ---------------------------------------------------------------------------

export async function saveTrackerQuotation(formData: FormData): Promise<ActionResult> {
  let savedId = "";
  const result = await runAction(async () => {
    const auth = await requireAuth();
    const tenantId = auth.user.tenantId;
    const quotationId = optionalString(formData, "quotationId");

    const customerId = requiredString(formData, "customerId", "Customer");
    const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) return fail("Customer tidak ditemukan.");

    const items = parseTrackerItems(formData);
    if (items.length === 0) return fail("Tambahkan minimal satu barang.");

    const quotationDate = dateField(formData, "quotationDate", new Date()) ?? new Date();
    const trackerStatus = trackerStatusOf(formData);
    const customerPoNumber = optionalString(formData, "customerPoNumber");
    const customerPoDate =
      dateField(formData, "customerPoDate") ?? (trackerStatus === TrackerStatus.PO_RECEIVED ? new Date() : null);
    const notes = optionalString(formData, "notes");
    const legacy = legacyStatusFor(trackerStatus);

    const saved = await prisma.$transaction(async (tx) => {
      const manualNumber = optionalString(formData, "quotationNumber");
      let number = manualNumber;
      if (!number && !quotationId) {
        const count = await tx.quotation.count({ where: { tenantId } });
        number = buildQuotationNumber(count + 1, customer.companyName, quotationDate);
      }

      const header = {
        customerId,
        quotationDate,
        trackerStatus,
        customerPoNumber,
        customerPoDate,
        notes,
        status: legacy,
        sentAt: quotationDate,
        respondedAt: trackerStatus === TrackerStatus.WAITING_PO ? null : new Date(),
        approvedAt: trackerStatus === TrackerStatus.PO_RECEIVED ? new Date() : null,
      };

      if (quotationId) {
        const before = await tx.quotation.findFirstOrThrow({ where: { id: quotationId, tenantId } });
        await tx.quotationItem.deleteMany({ where: { quotationId: before.id } });
        return tx.quotation.update({
          where: { id: before.id },
          data: {
            ...header,
            ...(manualNumber ? { number: manualNumber } : {}),
            items: {
              create: items.map((item, index) => ({
                description: item.description,
                quantity: item.quantity,
                unit: item.unit ?? "pcs",
                vendor: item.vendor,
                deliveryMethod: item.deliveryMethod,
                workStatus: item.workStatus,
                sortOrder: index,
              })),
            },
          },
        });
      }

      return tx.quotation.create({
        data: {
          tenantId,
          number: number ?? buildQuotationNumber(1, customer.companyName, quotationDate),
          version: 1,
          ...header,
          createdById: auth.user.id,
          items: {
            create: items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.unit ?? "pcs",
              vendor: item.vendor,
              deliveryMethod: item.deliveryMethod,
              workStatus: item.workStatus,
              sortOrder: index,
            })),
          },
        },
      });
    });

    savedId = saved.id;
    return ok("Quotation tersimpan.", saved.id);
  }, PATHS);

  if (!result.ok) return result;
  redirect(`/quotations/${savedId}`);
}

export async function deleteTrackerQuotation(quotationId: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const auth = await requireAuth();
    await prisma.quotation.deleteMany({
      where: { id: quotationId, tenantId: auth.user.tenantId },
    });
    return ok("Quotation dihapus.");
  }, PATHS);

  if (!result.ok) return result;
  redirect("/quotations");
}

export async function setTrackerStatus(quotationId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requireAuth();
    const trackerStatus = trackerStatusOf(formData);
    const customerPoNumber = optionalString(formData, "customerPoNumber");
    const customerPoDate =
      dateField(formData, "customerPoDate") ?? (trackerStatus === TrackerStatus.PO_RECEIVED ? new Date() : null);

    await prisma.quotation.updateMany({
      where: { id: quotationId, tenantId: auth.user.tenantId },
      data: {
        trackerStatus,
        ...(customerPoNumber !== null || trackerStatus === TrackerStatus.PO_RECEIVED
          ? { customerPoNumber }
          : {}),
        ...(trackerStatus === TrackerStatus.PO_RECEIVED ? { customerPoDate } : {}),
        status: legacyStatusFor(trackerStatus),
        respondedAt: trackerStatus === TrackerStatus.WAITING_PO ? null : new Date(),
        approvedAt: trackerStatus === TrackerStatus.PO_RECEIVED ? new Date() : null,
      },
    });
    return ok("Status diperbarui.");
  }, [...PATHS, `/quotations/${quotationId}`]);
}

// ---------------------------------------------------------------------------
// Procurement — ubah status pekerjaan langsung dari tabel Sheet 2.
// ---------------------------------------------------------------------------

export async function updateItemWorkStatus(itemId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await requireAuth();
    const workStatus = workStatusOf(formData.get("workStatus"));

    await prisma.quotationItem.updateMany({
      where: { id: itemId, quotation: { tenantId: auth.user.tenantId } },
      data: { workStatus },
    });
    return ok("Status pekerjaan diperbarui.");
  }, ["/procurement", "/quotations", "/dashboard"]);
}
