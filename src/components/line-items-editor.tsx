"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { money, num, type MoneyLike } from "@/lib/money";
import { priceLine, summarizeDocument } from "@/lib/pricing";

export type ProductOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  type: string;
  costPrice: MoneyLike;
  sellingPrice: MoneyLike;
  taxRate: MoneyLike;
  defaultSupplierId?: string | null;
};

type Row = {
  key: string;
  productId: string;
  lineType: string;
  description: string;
  quantity: string;
  unit: string;
  costPrice: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  targetPrice: string;
  note: string;
  supplierId: string;
  supplierLeadTimeDays: string;
};

const LINE_TYPES = ["PRODUCT", "SERVICE", "LABOR", "PACKAGE", "CUSTOM"] as const;

function emptyRow(mode: "request" | "quotation", defaultTaxRate: number): Row {
  return {
    key: Math.random().toString(36).slice(2),
    productId: "",
    lineType: "PRODUCT",
    description: "",
    quantity: "1",
    unit: "pcs",
    costPrice: "",
    unitPrice: "",
    discountPercent: "0",
    taxRate: mode === "quotation" ? String(defaultTaxRate) : "0",
    targetPrice: "",
    note: "",
    supplierId: "",
    supplierLeadTimeDays: "",
  };
}

export function LineItemsEditor({
  mode,
  products,
  suppliers = [],
  initialRows,
  shippingCost = 0,
}: {
  mode: "request" | "quotation";
  products: ProductOption[];
  suppliers?: { id: string; name: string; leadTimeDays: number | null }[];
  initialRows?: Partial<Row>[];
  shippingCost?: number;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    if (initialRows && initialRows.length > 0) {
      return initialRows.map((row) => ({ ...emptyRow(mode, 11), ...row, key: Math.random().toString(36).slice(2) }));
    }
    return [emptyRow(mode, 11)];
  });
  const [shipping, setShipping] = useState(String(shippingCost));

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function onProductChange(row: Row, productId: string) {
    const product = productById.get(productId);
    if (!product) {
      update(row.key, { productId: "" });
      return;
    }
    update(row.key, {
      productId,
      description: product.name,
      unit: product.unit,
      lineType: (product.type === "PRODUCT" || product.type === "PACKAGE" || product.type === "SERVICE" || product.type === "LABOR"
        ? product.type
        : "CUSTOM") as string,
      costPrice: String(num(product.costPrice)),
      unitPrice: mode === "quotation" ? String(num(product.sellingPrice)) : row.unitPrice,
      targetPrice: mode === "request" ? String(num(product.sellingPrice)) : row.targetPrice,
      taxRate: String(num(product.taxRate) || 11),
    });
  }

  const totals = summarizeDocument(
    rows.map((row) => ({
      quantity: Number(row.quantity) || 0,
      unitPrice: Number(mode === "request" ? row.targetPrice : row.unitPrice) || 0,
      discountPercent: Number(row.discountPercent) || 0,
      taxRate: Number(row.taxRate) || 0,
      costPrice: Number(row.costPrice) || 0,
    })),
    { shippingCost: Number(shipping) || 0 },
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-[22%] pb-2">Product</th>
              <th className="pb-2">Description</th>
              <th className="w-24 pb-2">Qty</th>
              <th className="w-24 pb-2">Unit</th>
              {mode === "quotation" ? (
                <>
                  <th className="w-28 pb-2">Type</th>
                  <th className="w-32 pb-2">Cost</th>
                  <th className="w-32 pb-2">Sell price</th>
                  <th className="w-20 pb-2">Disc %</th>
                  <th className="w-20 pb-2">Tax %</th>
                  <th className="w-44 pb-2">Sourcing supplier</th>
                  <th className="w-28 pb-2 text-right">Line total</th>
                </>
              ) : (
                <>
                  <th className="w-32 pb-2">Target price</th>
                  <th className="w-40 pb-2">Note</th>
                </>
              )}
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">
                  <Select
                    name={`items[${index}][productId]`}
                    value={row.productId}
                    onChange={(event) => onProductChange(row, event.target.value)}
                    className="h-9 text-xs"
                  >
                    <option value="">Custom item</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ({product.sku})
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    name={`items[${index}][description]`}
                    value={row.description}
                    onChange={(event) => update(row.key, { description: event.target.value })}
                    placeholder="Item description"
                    className="h-9 text-xs"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    name={`items[${index}][quantity]`}
                    type="number"
                    step="0.01"
                    value={row.quantity}
                    onChange={(event) => update(row.key, { quantity: event.target.value })}
                    className="h-9 text-xs"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    name={`items[${index}][unit]`}
                    value={row.unit}
                    onChange={(event) => update(row.key, { unit: event.target.value })}
                    className="h-9 text-xs"
                  />
                </td>

                {mode === "quotation" ? (
                  <>
                    <td className="py-1.5 pr-2">
                      <Select
                        name={`items[${index}][lineType]`}
                        value={row.lineType}
                        onChange={(event) => update(row.key, { lineType: event.target.value })}
                        className="h-9 text-xs"
                      >
                        {LINE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][costPrice]`}
                        type="number"
                        step="100"
                        value={row.costPrice}
                        onChange={(event) => update(row.key, { costPrice: event.target.value })}
                        className="h-9 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][unitPrice]`}
                        type="number"
                        step="100"
                        value={row.unitPrice}
                        onChange={(event) => update(row.key, { unitPrice: event.target.value })}
                        className="h-9 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][discountPercent]`}
                        type="number"
                        step="0.1"
                        value={row.discountPercent}
                        onChange={(event) => update(row.key, { discountPercent: event.target.value })}
                        className="h-9 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][taxRate]`}
                        type="number"
                        step="0.1"
                        value={row.taxRate}
                        onChange={(event) => update(row.key, { taxRate: event.target.value })}
                        className="h-9 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Select
                        name={`items[${index}][supplierId]`}
                        value={row.supplierId}
                        onChange={(event) => {
                          const supplier = suppliers.find((item) => item.id === event.target.value);
                          update(row.key, {
                            supplierId: event.target.value,
                            supplierLeadTimeDays: supplier?.leadTimeDays ? String(supplier.leadTimeDays) : "",
                          });
                        }}
                        className="h-9 text-xs"
                      >
                        <option value="">—</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                            {supplier.leadTimeDays ? ` · ${supplier.leadTimeDays}h` : ""}
                          </option>
                        ))}
                      </Select>
                      <input type="hidden" name={`items[${index}][supplierLeadTimeDays]`} value={row.supplierLeadTimeDays} />
                    </td>
                    <td className="py-1.5 pr-2 text-right text-xs font-medium text-slate-700">
                      {money(
                        priceLine({
                          quantity: Number(row.quantity) || 0,
                          unitPrice: Number(row.unitPrice) || 0,
                          discountPercent: Number(row.discountPercent) || 0,
                          taxRate: Number(row.taxRate) || 0,
                        }).net,
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][targetPrice]`}
                        type="number"
                        step="100"
                        value={row.targetPrice}
                        onChange={(event) => update(row.key, { targetPrice: event.target.value })}
                        className="h-9 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        name={`items[${index}][note]`}
                        value={row.note}
                        onChange={(event) => update(row.key, { note: event.target.value })}
                        placeholder="Catatan item"
                        className="h-9 text-xs"
                      />
                    </td>
                  </>
                )}

                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setRows((current) => (current.length > 1 ? current.filter((item) => item.key !== row.key) : current))}
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setRows((current) => [...current, emptyRow(mode, 11)])}
        className={buttonClass("secondary", "sm")}
      >
        <Plus className="h-3.5 w-3.5" />
        Add line
      </button>

      {mode === "quotation" ? (
        <div className="flex flex-wrap items-start justify-between gap-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600" htmlFor="shippingCost">
              Shipping / other (IDR)
            </label>
            <Input
              id="shippingCost"
              name="shippingCost"
              type="number"
              step="1000"
              value={shipping}
              onChange={(event) => setShipping(event.target.value)}
              className="h-9 w-36 text-xs"
            />
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
            <Summary label="Subtotal" value={money(totals.subtotal)} />
            <Summary label="Discount" value={money(totals.discountTotal)} />
            <Summary label="Tax" value={money(totals.taxTotal)} />
            <Summary label="Shipping" value={money(totals.shippingCost)} />
            <Summary label="Grand total" value={money(totals.grandTotal)} strong />
            <Summary label="Est. profit" value={money(totals.estimatedProfit)} />
            <Summary label="Margin" value={`${totals.marginPercent.toFixed(1)}%`} />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={strong ? "font-semibold text-slate-900" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
