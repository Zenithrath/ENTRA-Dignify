import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormShell } from "@/components/form-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { createDeliveryOrder } from "@/lib/actions/delivery-actions";
import { requirePermission } from "@/lib/auth";
import { num, qty } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/queries/common";

export const metadata: Metadata = { title: "New delivery order" };

export default async function NewDeliveryOrderPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const auth = await requirePermission("delivery", "manage");
  const { orderId } = await searchParams;
  const tenantId = auth.user.tenantId;

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ["CONFIRMED", "IN_PROGRESS", "FULFILLED"] },
      items: { some: { deliveredQty: { lt: prisma.orderItem.fields.quantity } } },
    },
    orderBy: { orderDate: "desc" },
    take: 30,
    include: {
      customer: { select: { companyName: true, address: true, city: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  const selected = orderId ? orders.find((order) => order.id === orderId) : undefined;
  if (orderId && !selected) notFound();

  const pendingItems = selected?.items.filter((item) => num(item.deliveredQty) < num(item.quantity)) ?? [];
  const address = selected
    ? [selected.customer.address, selected.customer.city].filter(Boolean).join(", ")
    : "";

  return (
    <>
      <PageHeader
        title="New delivery order"
        breadcrumbs={[
          { label: "Delivery", href: "/delivery" },
          { label: "New" },
        ]}
        description="Pilih order, tentukan qty per item untuk pengiriman penuh atau sebagian."
        actions={
          <Link href="/delivery" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />

      <FormShell action={createDeliveryOrder} submitLabel="Create delivery order" className="max-w-4xl space-y-5">
        <Card>
          <CardHeader title="Order & shipping details" />
          <CardBody>
            <div className="space-y-4">
              <Field label="Order" required>
                <Select name="orderId" defaultValue={selected?.id ?? ""} required>
                  <option value="">Select order…</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.number} — {order.customer.companyName} ({formatDate(order.orderDate)})
                    </option>
                  ))}
                </Select>
              </Field>

              {selected ? (
                <>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="mb-3 text-xs font-medium text-slate-600">
                      Item yang belum terkirim — {selected.number}
                    </p>
                    <div className="space-y-2">
                      {pendingItems.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-end gap-3">
                          <div className="min-w-[220px] flex-1">
                            <p className="text-sm text-slate-800">{item.description}</p>
                            <p className="text-xs text-slate-500">
                              Sisa {qty(num(item.quantity) - num(item.deliveredQty))} {item.unit} dari {qty(item.quantity)}
                            </p>
                          </div>
                          <Field label="Qty kirim">
                            <Input
                              name={`quantity[${item.id}]`}
                              type="number"
                              step="0.01"
                              max={num(item.quantity) - num(item.deliveredQty)}
                              defaultValue={num(item.quantity) - num(item.deliveredQty)}
                              className="h-9 w-28"
                            />
                          </Field>
                          <Field label="Note">
                            <Input name={`note[${item.id}]`} className="h-9 w-44" />
                          </Field>
                        </div>
                      ))}
                    </div>
                  </div>

                  <FormGrid columns={3}>
                    <Field label="Ship method">
                      <Input name="shipMethod" placeholder="cth. Truk sendiri / Ekspedisi" />
                    </Field>
                    <Field label="Driver">
                      <Input name="driverName" />
                    </Field>
                    <Field label="Kurir">
                      <Input name="courierName" />
                    </Field>
                    <Field label="Vehicle number">
                      <Input name="vehicleNumber" />
                    </Field>
                    <Field label="Tracking number">
                      <Input name="trackingNumber" />
                    </Field>
                    <Field label="Ship date">
                      <Input type="date" name="shipDate" defaultValue={new Date().toISOString().slice(0, 10)} />
                    </Field>
                    <Field label="Delivery address" className="sm:col-span-3">
                      <Textarea name="deliveryAddress" defaultValue={address} />
                    </Field>
                    <Field label="Notes" className="sm:col-span-3">
                      <Textarea name="notes" />
                    </Field>
                  </FormGrid>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Pilih order dulu untuk melihat item yang siap dikirim. Order dengan item yang perlu disourcing belum bisa
                  dikirim.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </FormShell>
    </>
  );
}
