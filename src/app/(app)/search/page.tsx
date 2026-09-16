import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuth } from "@/lib/auth";
import { money } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { canView } from "@/lib/rbac";
import { formatDate } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Search" };

const LIMIT = 6;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const auth = await requireAuth();
  const { q = "" } = await searchParams;
  const term = q.trim();
  const tenantId = auth.user.tenantId;
  const role = auth.user.role;

  const contains = { contains: term, mode: "insensitive" as const };

  const [customers, suppliers, requests, quotations, orders, purchaseOrders, invoices, deliveries, products] =
    term.length >= 2
      ? await Promise.all([
          canView(role, "customers")
            ? prisma.customer.findMany({
                where: { tenantId, deletedAt: null, OR: [{ companyName: contains }, { email: contains }, { phone: contains }] },
                take: LIMIT,
                orderBy: { companyName: "asc" },
              })
            : [],
          canView(role, "suppliers")
            ? prisma.supplier.findMany({
                where: { tenantId, deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
                take: LIMIT,
                orderBy: { name: "asc" },
              })
            : [],
          canView(role, "requests")
            ? prisma.request.findMany({
                where: { tenantId, OR: [{ number: contains }, { customer: { companyName: contains } }] },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { customer: { select: { companyName: true } } },
              })
            : [],
          canView(role, "quotations")
            ? prisma.quotation.findMany({
                where: { tenantId, OR: [{ number: contains }, { customer: { companyName: contains } }] },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { customer: { select: { companyName: true } } },
              })
            : [],
          canView(role, "orders")
            ? prisma.order.findMany({
                where: {
                  tenantId,
                  OR: [{ number: contains }, { customerPoNumber: contains }, { customer: { companyName: contains } }],
                },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { customer: { select: { companyName: true } } },
              })
            : [],
          canView(role, "procurement")
            ? prisma.purchaseOrder.findMany({
                where: { tenantId, OR: [{ number: contains }, { supplier: { name: contains } }] },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { supplier: { select: { name: true } } },
              })
            : [],
          canView(role, "finance")
            ? prisma.invoice.findMany({
                where: { tenantId, OR: [{ number: contains }, { customer: { companyName: contains } }] },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { customer: { select: { companyName: true } } },
              })
            : [],
          canView(role, "delivery")
            ? prisma.deliveryOrder.findMany({
                where: { tenantId, OR: [{ number: contains }, { trackingNumber: contains }, { customer: { companyName: contains } }] },
                take: LIMIT,
                orderBy: { createdAt: "desc" },
                include: { customer: { select: { companyName: true } } },
              })
            : [],
          canView(role, "products")
            ? prisma.product.findMany({
                where: { tenantId, deletedAt: null, OR: [{ name: contains }, { sku: contains }] },
                take: LIMIT,
                orderBy: { name: "asc" },
              })
            : [],
        ])
      : [[], [], [], [], [], [], [], [], []];

  const groups = [
    {
      id: "customers",
      title: "Customers",
      href: "/customers",
      items: customers.map((customer) => ({
        id: customer.id,
        href: `/customers/${customer.id}`,
        title: customer.companyName,
        meta: `${customer.email ?? "—"} · ${customer.phone ?? "—"}`,
        badge: customer.status,
      })),
    },
    {
      id: "suppliers",
      title: "Suppliers",
      href: "/suppliers",
      items: suppliers.map((supplier) => ({
        id: supplier.id,
        href: `/suppliers/${supplier.id}`,
        title: supplier.name,
        meta: supplier.category ?? supplier.email ?? "—",
        badge: supplier.status,
      })),
    },
    {
      id: "requests",
      title: "Requests",
      href: "/requests",
      items: requests.map((request) => ({
        id: request.id,
        href: `/requests/${request.id}`,
        title: request.number,
        meta: request.customer.companyName,
        badge: request.status,
      })),
    },
    {
      id: "quotations",
      title: "Quotations",
      href: "/quotations",
      items: quotations.map((quotation) => ({
        id: quotation.id,
        href: `/quotations/${quotation.id}`,
        title: quotation.number,
        meta: `${quotation.customer.companyName} · ${money(quotation.grandTotal)}`,
        badge: quotation.status,
      })),
    },
    {
      id: "orders",
      title: "Orders",
      href: "/orders",
      items: orders.map((order) => ({
        id: order.id,
        href: `/orders/${order.id}`,
        title: order.number,
        meta: `${order.customer.companyName} · ${money(order.grandTotal)}`,
        badge: order.status,
      })),
    },
    {
      id: "purchase-orders",
      title: "Purchase orders",
      href: "/procurement/purchase-orders",
      items: purchaseOrders.map((po) => ({
        id: po.id,
        href: `/procurement/purchase-orders/${po.id}`,
        title: po.number,
        meta: `${po.supplier.name} · ${money(po.grandTotal)}`,
        badge: po.status,
      })),
    },
    {
      id: "invoices",
      title: "Invoices",
      href: "/finance/invoices",
      items: invoices.map((invoice) => ({
        id: invoice.id,
        href: `/finance/invoices/${invoice.id}`,
        title: invoice.number,
        meta: `${invoice.customer.companyName} · ${money(invoice.grandTotal)} · jatuh tempo ${formatDate(invoice.dueDate)}`,
        badge: invoice.status,
      })),
    },
    {
      id: "deliveries",
      title: "Delivery orders",
      href: "/delivery",
      items: deliveries.map((delivery) => ({
        id: delivery.id,
        href: `/delivery/${delivery.id}`,
        title: delivery.number,
        meta: `${delivery.customer.companyName}${delivery.trackingNumber ? ` · ${delivery.trackingNumber}` : ""}`,
        badge: delivery.status,
      })),
    },
    {
      id: "products",
      title: "Products",
      href: "/products",
      items: products.map((product) => ({
        id: product.id,
        href: `/products/${product.id}`,
        title: `${product.sku} — ${product.name}`,
        meta: `${money(product.sellingPrice)} / ${product.unit}`,
        badge: product.isActive ? "ACTIVE" : "ARCHIVED",
      })),
    },
  ];

  const totalResults = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <>
      <PageHeader
        title="Global search"
        description="Cari lintas customer, supplier, request, quotation, order, PO, invoice, DO, dan produk."
      />

      <Card>
        <CardBody>
          <form action="/search" method="get" className="flex gap-2">
            <Input name="q" defaultValue={term} placeholder="Minimal 2 karakter…" className="h-10 max-w-md" autoFocus />
            <button
              type="submit"
              className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Search
            </button>
          </form>
          {term.length >= 2 ? (
            <p className="mt-2 text-xs text-slate-500">
              {totalResults} hasil untuk “{term}”
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Masukkan minimal 2 karakter untuk mulai mencari.</p>
          )}
        </CardBody>
      </Card>

      {term.length >= 2 && totalResults === 0 ? (
        <Card>
          <EmptyState title="Tidak ada hasil" description={`Tidak ada record yang cocok dengan “${term}”.`} />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <Card key={group.id}>
              <CardHeader
                title={group.title}
                actions={
                  <Link href={group.href} className="text-xs text-indigo-600 hover:underline">
                    Lihat semua
                  </Link>
                }
              />
              <ul className="divide-y divide-slate-100">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={item.href} className="text-sm font-medium text-indigo-600 hover:underline">
                        {item.title}
                      </Link>
                      <p className="truncate text-xs text-slate-500">{item.meta}</p>
                    </div>
                    <StatusBadge value={item.badge} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
      </div>
    </>
  );
}
