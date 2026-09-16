import { revalidatePath } from "next/cache";

/** Every mutation returns this shape so forms can surface errors without throwing. */
export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

export const OK: ActionResult = { ok: true };

export function ok(message?: string, id?: string): ActionResult {
  return { ok: true, message, id };
}

export function fail(error: string): ActionResult {
  return { ok: false, error };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** redirect()/notFound() signal through control-flow errors that must not be swallowed. */
function isFrameworkControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** Runs a mutation, converts thrown errors into form-displayable results. */
export async function runAction(
  fn: () => Promise<ActionResult>,
  revalidate: string[] = [],
): Promise<ActionResult> {
  try {
    const result = await fn();
    if (result.ok) {
      for (const path of revalidate) revalidatePath(path);
    }
    return result;
  } catch (error) {
    if (isFrameworkControlFlow(error)) throw error;
    return fail(errorMessage(error));
  }
}

// ---------------------------------------------------------------- form parsing

export function requiredString(formData: FormData, key: string, label = key): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

export function optionalString(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

export function numberField(formData: FormData, key: string, fallback = 0): number {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return fallback;
  // Tolerate "1.500.000", "1,5" and "1500000" from hand-typed IDR amounts.
  const normalised = raw.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const value = Number(normalised);
  return Number.isFinite(value) ? value : fallback;
}

export function optionalNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  return numberField(formData, key);
}

export function dateField(formData: FormData, key: string, fallback: Date | null = null): Date | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function booleanField(formData: FormData, key: string): boolean {
  const raw = String(formData.get(key) ?? "").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

export function selectField<T extends string>(formData: FormData, key: string, allowed: Record<string, T>, fallback?: T): T {
  const raw = String(formData.get(key) ?? "").trim();
  const values = Object.values(allowed);
  if (values.includes(raw as T)) return raw as T;
  if (fallback !== undefined) return fallback;
  throw new Error(`${key} is not a valid value.`);
}

export type RequestItemInput = {
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  targetPrice: number | null;
  note: string | null;
};

/** Parses the repeatable line fields emitted by the request form. */
export function parseRequestItems(formData: FormData): RequestItemInput[] {
  const rows: RequestItemInput[] = [];
  let index = 0;

  while (formData.has(`items[${index}][description]`)) {
    const description = String(formData.get(`items[${index}][description]`) ?? "").trim();
    if (description) {
      rows.push({
        productId: optionalString(formData, `items[${index}][productId]`),
        description,
        quantity: numberField(formData, `items[${index}][quantity]`, 1),
        unit: String(formData.get(`items[${index}][unit]`) ?? "pcs"),
        targetPrice: optionalNumber(formData, `items[${index}][targetPrice]`),
        note: optionalString(formData, `items[${index}][note]`),
      });
    }
    index += 1;
  }

  return rows;
}

/** Parses the repeatable line-item fields emitted by the quotation/order editors. */
export function parseLineItems(formData: FormData): {
  productId: string | null;
  lineType: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  costPrice: number;
  discountPercent: number;
  taxRate: number;
  supplierId: string | null;
  supplierLeadTimeDays: number | null;
}[] {
  const rows: ReturnType<typeof parseLineItems> = [];
  let index = 0;

  while (formData.has(`items[${index}][description]`)) {
    const description = String(formData.get(`items[${index}][description]`) ?? "").trim();
    if (description) {
      rows.push({
        productId: optionalString(formData, `items[${index}][productId]`),
        lineType: String(formData.get(`items[${index}][lineType]`) ?? "PRODUCT"),
        description,
        quantity: numberField(formData, `items[${index}][quantity]`, 1),
        unit: String(formData.get(`items[${index}][unit]`) ?? "pcs"),
        unitPrice: numberField(formData, `items[${index}][unitPrice]`),
        costPrice: numberField(formData, `items[${index}][costPrice]`),
        discountPercent: numberField(formData, `items[${index}][discountPercent]`),
        taxRate: numberField(formData, `items[${index}][taxRate]`, 11),
        supplierId: optionalString(formData, `items[${index}][supplierId]`),
        supplierLeadTimeDays: optionalNumber(formData, `items[${index}][supplierLeadTimeDays]`),
      });
    }
    index += 1;
  }

  return rows;
}
