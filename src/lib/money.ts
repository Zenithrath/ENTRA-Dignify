import type { Prisma } from "@/generated/prisma/client";

/** Anything Prisma can hand back for a Decimal column. */
export type MoneyLike = Prisma.Decimal | number | string | null | undefined;

export function num(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const idrPrecise = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: MoneyLike, opts: { precise?: boolean } = {}): string {
  return opts.precise ? idrPrecise.format(num(value)) : idr.format(num(value));
}

/** Compact form for metric cards: 42,5 jt / 1,2 M. */
export function moneyShort(value: MoneyLike): string {
  const amount = num(value);
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp${(amount / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000) return `Rp${(amount / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (abs >= 1_000) return `Rp${(amount / 1_000).toFixed(0)} rb`;
  return `Rp${amount.toFixed(0)}`;
}

export function percent(value: MoneyLike, digits = 1): string {
  return `${num(value).toFixed(digits)}%`;
}

export function qty(value: MoneyLike): string {
  const amount = num(value);
  return Number.isInteger(amount) ? amount.toLocaleString("id-ID") : amount.toFixed(2);
}

export function decimal(value: number): string {
  return value.toFixed(2);
}

/** Rounds to 2 decimals the way money math needs, avoiding float drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
