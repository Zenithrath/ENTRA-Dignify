import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { ProductionStatus, SubcontractStatus, WorkOrderStatus } from "@/generated/prisma/enums";
import { requireAuth } from "@/lib/auth";
import { num } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatDate, relativeDays, tenantModules } from "@/lib/queries/common";

export const metadata: Metadata = { title: "Fulfillment" };

const OPEN_WO = [WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS];
const OPEN_SUB = [
  SubcontractStatus.DRAFT,
  SubcontractStatus.ASSIGNED,
  SubcontractStatus.IN_PROGRESS,
  SubcontractStatus.INSPECTION,
  SubcontractStatus.PENDING_APPROVAL,
];

export default async function FulfillmentPage() {
  const auth = await requireAuth();
  const tenantId = auth.user.tenantId;

  const [workOrders, productionOrders, subcontracts, readyToShip, deliveryQueue, modules] = await Promise.all([
    prisma.workOrder.findMany({
      where: { tenantId, status: { in: OPEN_WO } },
      orderBy: [{ scheduledStart: "asc" }],
      include: { order: { include: { customer: { select: { companyName: true } } } }, _count: { select: { tasks: true, logs: true } } },
    }),
    prisma.productionOrder.findMany({
      where: { tenantId, status: { notIn: [ProductionStatus.COMPLETED, ProductionStatus.CANCELLED] } },
      orderBy: { scheduledEnd: "asc" },
      include: { order: { include: { customer: { select: { companyName: true } } } }, stages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.subcontract.findMany({
      where: { tenantId, status: { in: OPEN_SUB } },
      orderBy: { scheduledEnd: "asc" },
      include: { order: { include: { customer: { select: { companyName: true } } } }, supplier: { select: { name: true } } },
    }),
    prisma.orderItem.findMany({
      where: {
        sourcingStatus: "SOURCED",
        deliveredQty: { lt: prisma.orderItem.fields.quantity },
        order: { tenantId, status: { in: ["CONFIRMED", "IN_PROGRESS", "FULFILLED"] } },
      },
      include: { order: { include: { customer: { select: { companyName: true } } } } },
      take: 15,
    }),
    prisma.deliveryOrder.findMany({
      where: { tenantId, status: { in: ["NOT_READY", "READY_TO_SHIP", "IN_DELIVERY"] } },
      include: { customer: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    tenantModules(tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Fulfillment"
        description="Empat jalur pemenuhan: barang, jasa (work order), produksi, dan subcontract."
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Jalur barang — siap dikirim"
            description="Item yang sudah tersourcing dan stoknya siap, menunggu dibuatkan delivery order."
            actions={
              <Link href="/delivery/new" className="text-xs font-medium text-indigo-600 hover:underline">
                Create delivery order →
              </Link>
            }
          />
          {readyToShip.length === 0 ? (
            <EmptyState title="Tidak ada item menunggu pengiriman" />
          ) : (
            <DataTable
              rows={readyToShip}
              rowKey={(row) => row.id}
              columns={[
                { key: "item", header: "Item", render: (row) => <span className="text-sm">{row.description}</span> },
                {
                  key: "order",
                  header: "Order",
                  render: (row) => (
                    <Link href={`/orders/${row.orderId}?tab=delivery`} className="text-sm text-indigo-600 hover:underline">
                      {row.order.number}
                    </Link>
                  ),
                },
                { key: "customer", header: "Customer", render: (row) => <span className="text-sm">{row.order.customer.companyName}</span> },
                {
                  key: "progress",
                  header: "Delivered",
                  render: (row) => (
                    <span className="text-sm text-slate-600">
                      {num(row.deliveredQty)} / {num(row.quantity)} {row.unit}
                    </span>
                  ),
                },
                { key: "eta", header: "Est. fulfillment", render: (row) => <span className="text-sm">{formatDate(row.order.estimatedFulfillmentDate)}</span> },
              ]}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Jalur jasa — work orders" description="Pekerjaan yang dikerjakan tim internal." />
          {workOrders.length === 0 ? (
            <EmptyState title="Belum ada work order aktif" description="Buat dari detail order pada tab Fulfillment." />
          ) : (
            <DataTable
              rows={workOrders}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "number",
                  header: "WO",
                  render: (row) => (
                    <Link href={`/fulfillment/work-orders/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                      {row.number}
                    </Link>
                  ),
                },
                { key: "title", header: "Scope", render: (row) => <span className="text-sm">{row.title}</span> },
                {
                  key: "order",
                  header: "Order",
                  render: (row) => (
                    <Link href={`/orders/${row.orderId}`} className="text-sm text-indigo-600 hover:underline">
                      {row.order.number}
                    </Link>
                  ),
                },
                { key: "team", header: "Team", render: (row) => <span className="text-sm">{row.teamName ?? "—"}</span> },
                {
                  key: "progress",
                  header: "Progress",
                  render: (row) => (
                    <div className="min-w-[100px]">
                      <p className="text-xs text-slate-600">
                        {num(row.progressPercent)}% · {row._count.tasks} task · {row._count.logs} log
                      </p>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${num(row.progressPercent)}%` }} />
                      </div>
                    </div>
                  ),
                },
                {
                  key: "schedule",
                  header: "Schedule",
                  render: (row) => (
                    <span className="text-xs text-slate-600">
                      {formatDate(row.scheduledStart)} → {formatDate(row.scheduledEnd)}
                    </span>
                  ),
                },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
              ]}
            />
          )}
        </Card>

        {modules.get("PRODUCTION") ? (
          <Card>
            <CardHeader title="Jalur produksi" description="Tracking tahap produksi dan QC." />
            {productionOrders.length === 0 ? (
              <EmptyState title="Belum ada production order aktif" />
            ) : (
              <DataTable
                rows={productionOrders}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "number",
                    header: "Production",
                    render: (row) => (
                      <Link href={`/fulfillment/production/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  { key: "desc", header: "Product", render: (row) => <span className="text-sm">{row.description ?? "—"}</span> },
                  {
                    key: "stage",
                    header: "Current stage",
                    render: (row) => (
                      <span className="text-sm">
                        {row.currentStage ?? "—"}
                        <span className="ml-1 text-xs text-slate-500">
                          ({row.stages.filter((stage) => stage.status === "DONE").length}/{row.stages.length})
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "order",
                    header: "Order",
                    render: (row) => (
                      <Link href={`/orders/${row.orderId}`} className="text-sm text-indigo-600 hover:underline">
                        {row.order.number}
                      </Link>
                    ),
                  },
                  { key: "due", header: "Target selesai", render: (row) => <span className="text-sm">{formatDate(row.scheduledEnd)}</span> },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                ]}
              />
            )}
          </Card>
        ) : null}

        {modules.get("SUBCONTRACT") ? (
          <Card>
            <CardHeader title="Jalur subcontract" description="Pekerjaan yang dialihkan ke subcontractor terdaftar." />
            {subcontracts.length === 0 ? (
              <EmptyState title="Belum ada subcontract aktif" />
            ) : (
              <DataTable
                rows={subcontracts}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "number",
                    header: "Subcontract",
                    render: (row) => (
                      <Link href={`/fulfillment/subcontracts/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {row.number}
                      </Link>
                    ),
                  },
                  { key: "scope", header: "Scope", render: (row) => <span className="text-sm">{row.scope}</span> },
                  { key: "supplier", header: "Subcontractor", render: (row) => <span className="text-sm">{row.supplier.name}</span> },
                  {
                    key: "progress",
                    header: "Progress",
                    render: (row) => <span className="text-sm">{num(row.progressPercent)}%</span>,
                  },
                  { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
                ]}
              />
            )}
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Delivery queue" description="Surat jalan yang belum selesai." />
          {deliveryQueue.length === 0 ? (
            <EmptyState title="Tidak ada pengiriman berjalan" />
          ) : (
            <DataTable
              rows={deliveryQueue}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "number",
                  header: "DO",
                  render: (row) => (
                    <Link href={`/delivery/${row.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                      {row.number}
                    </Link>
                  ),
                },
                { key: "customer", header: "Customer", render: (row) => <span className="text-sm">{row.customer.companyName}</span> },
                { key: "ship", header: "Ship date", render: (row) => <span className="text-sm">{formatDate(row.shipDate)}</span> },
                {
                  key: "age",
                  header: "Age",
                  render: (row) => {
                    const days = relativeDays(row.createdAt) ?? 0;
                    return <span className={`text-sm ${days > 3 ? "text-amber-700" : "text-slate-600"}`}>{days} hari</span>;
                  },
                },
                { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  );
}
