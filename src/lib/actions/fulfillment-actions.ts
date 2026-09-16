"use server";

import {
  AttachmentEntity,
  OrderStatus,
  ProductionStatus,
  QcResult,
  StageStatus,
  SubcontractStatus,
  WorkOrderStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { num } from "@/lib/money";
import { queueNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  dateField,
  fail,
  numberField,
  ok,
  optionalString,
  runAction,
  type ActionResult,
} from "@/lib/actions/helpers";

const PATHS = ["/fulfillment", "/dashboard"];

type Db = Prisma.TransactionClient;

/**
 * An order is fulfilled once every line is delivered and every work order is closed.
 * Delivery itself flips the last line, so this runs from both paths.
 */
async function syncOrderFulfillment(db: Db, orderId: string, actor: { id: string; name: string }): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, workOrders: true, productionOrders: true },
  });
  if (!order) return;
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) return;

  const itemsDelivered = order.items.every((item) => num(item.deliveredQty) >= num(item.quantity));
  const workOrdersClosed = order.workOrders.every((workOrder) => workOrder.status === WorkOrderStatus.COMPLETED);
  const productionClosed = order.productionOrders.every(
    (production) => production.status === ProductionStatus.COMPLETED || production.status === ProductionStatus.CANCELLED,
  );

  if (itemsDelivered && workOrdersClosed && productionClosed) {
    await db.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLED },
    });
    await logActivity(db, {
      tenantId: order.tenantId,
      actor,
      action: "STATUS_CHANGE",
      entityType: AttachmentEntity.ORDER,
      entityId: order.id,
      entityLabel: order.number,
      summary: `Order ${order.number} fulfilled — semua item terkirim dan pekerjaan selesai`,
    });
  }
}

export async function updateWorkOrder(workOrderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const before = await tx.workOrder.findFirstOrThrow({
          where: { id: workOrderId, tenantId: auth.user.tenantId },
        });

        const status = String(formData.get("status") ?? before.status);
        const progress = numberField(formData, "progressPercent", num(before.progressPercent));

        const updated = await tx.workOrder.update({
          where: { id: before.id },
          data: {
            status: Object.values(WorkOrderStatus).includes(status as WorkOrderStatus)
              ? (status as WorkOrderStatus)
              : before.status,
            progressPercent: Math.max(0, Math.min(100, progress)),
            assigneeId: optionalString(formData, "assigneeId") ?? before.assigneeId,
            teamName: optionalString(formData, "teamName") ?? before.teamName,
            scheduledStart: dateField(formData, "scheduledStart", before.scheduledStart),
            scheduledEnd: dateField(formData, "scheduledEnd", before.scheduledEnd),
            startedAt: status === WorkOrderStatus.IN_PROGRESS && !before.startedAt ? new Date() : before.startedAt,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.WORK_ORDER,
          entityId: updated.id,
          entityLabel: updated.number,
          summary: `Work order ${updated.number} updated (${progress}%)`,
          changes: {
            status: { from: before.status, to: updated.status },
            progressPercent: { from: num(before.progressPercent), to: progress },
          },
        });
      });

      return ok("Work order diperbarui.");
    },
    [...PATHS, `/fulfillment/work-orders/${workOrderId}`, "/orders"],
  );
}

export async function toggleWorkOrderTask(workOrderId: string, taskId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const task = await tx.workOrderTask.findFirstOrThrow({
          where: { id: taskId, workOrderId, workOrder: { tenantId: auth.user.tenantId } },
        });

        await tx.workOrderTask.update({
          where: { id: task.id },
          data: { isCompleted: !task.isCompleted, completedAt: task.isCompleted ? null : new Date() },
        });

        const tasks = await tx.workOrderTask.findMany({ where: { workOrderId } });
        const completed = tasks.filter((item) => item.isCompleted).length;
        const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

        await tx.workOrder.update({ where: { id: workOrderId }, data: { progressPercent: progress } });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.WORK_ORDER,
          entityId: workOrderId,
          summary: `Task "${task.name}" ${task.isCompleted ? "reopened" : "completed"}`,
        });
      });

      return ok("Task diperbarui.");
    },
    [`/fulfillment/work-orders/${workOrderId}`],
  );
}

export async function addWorkOrderLog(workOrderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");
      const note = optionalString(formData, "note");
      if (!note) return fail("Isi catatan harian.");

      await prisma.workOrderLog.create({
        data: {
          workOrderId,
          logDate: dateField(formData, "logDate", new Date()) ?? new Date(),
          note,
          hoursSpent: numberField(formData, "hoursSpent", 0) || null,
          createdById: auth.user.id,
        },
      });

      return ok("Log harian ditambahkan.");
    },
    [`/fulfillment/work-orders/${workOrderId}`],
  );
}

export async function completeWorkOrder(workOrderId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const workOrder = await tx.workOrder.findFirstOrThrow({
          where: { id: workOrderId, tenantId: auth.user.tenantId },
        });

        await tx.workOrder.update({
          where: { id: workOrder.id },
          data: {
            status: WorkOrderStatus.COMPLETED,
            progressPercent: 100,
            completedAt: new Date(),
            handoverNote: optionalString(formData, "handoverNote"),
            handoverUrl: optionalString(formData, "handoverUrl"),
          },
        });

        await tx.workOrderTask.updateMany({ where: { workOrderId }, data: { isCompleted: true, completedAt: new Date() } });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "STATUS_CHANGE",
          entityType: AttachmentEntity.WORK_ORDER,
          entityId: workOrder.id,
          entityLabel: workOrder.number,
          summary: `Work order ${workOrder.number} completed with handover document`,
          changes: { status: { from: workOrder.status, to: WorkOrderStatus.COMPLETED } },
        });

        await queueNotification({
          tenantId: auth.user.tenantId,
          event: "DELIVERY_COMPLETED",
          channel: "IN_APP",
          recipient: null,
          subject: `Work order ${workOrder.number} selesai`,
          body: `Pekerjaan ${workOrder.title} sudah selesai. Handover document siap dikirim ke customer.`,
          entityType: "WORK_ORDER",
          entityId: workOrder.id,
          entityLabel: workOrder.number,
        });

        await syncOrderFulfillment(tx, workOrder.orderId, { id: auth.user.id, name: auth.user.name });
      });

      return ok("Work order selesai.");
    },
    [...PATHS, `/fulfillment/work-orders/${workOrderId}`, "/orders"],
  );
}

export async function advanceProductionStage(productionId: string, stageId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const production = await tx.productionOrder.findFirstOrThrow({
          where: { id: productionId, tenantId: auth.user.tenantId },
        });

        const stage = await tx.productionStageProgress.findFirstOrThrow({
          where: { id: stageId, productionOrderId: productionId },
        });

        const nextStatus =
          stage.status === StageStatus.PENDING
            ? StageStatus.IN_PROGRESS
            : stage.status === StageStatus.IN_PROGRESS
              ? StageStatus.DONE
              : StageStatus.PENDING;

        await tx.productionStageProgress.update({
          where: { id: stage.id },
          data: {
            status: nextStatus,
            startedAt: nextStatus === StageStatus.IN_PROGRESS ? new Date() : stage.startedAt,
            completedAt: nextStatus === StageStatus.DONE ? new Date() : null,
          },
        });

        const stages = await tx.productionStageProgress.findMany({
          where: { productionOrderId: productionId },
          orderBy: { sortOrder: "asc" },
        });

        const current = stages.find((item) => item.status === StageStatus.IN_PROGRESS) ?? stages.find((item) => item.status === StageStatus.PENDING);
        const allDone = stages.every((item) => item.status === StageStatus.DONE);

        await tx.productionOrder.update({
          where: { id: productionId },
          data: {
            currentStage: current?.name ?? null,
            status: allDone
              ? ProductionStatus.QC
              : production.status === ProductionStatus.DRAFT
                ? ProductionStatus.IN_PROGRESS
                : production.status,
            startedAt: production.startedAt ?? new Date(),
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.PRODUCTION_ORDER,
          entityId: production.id,
          entityLabel: production.number,
          summary: `Production ${production.number}: stage "${stage.name}" → ${nextStatus}`,
        });
      });

      return ok("Tahap produksi diperbarui.");
    },
    [...PATHS, `/fulfillment/production/${productionId}`],
  );
}

export async function recordQc(productionId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");
      const result = String(formData.get("result") ?? "");
      if (!Object.values(QcResult).includes(result as QcResult)) return fail("Pilih hasil QC.");

      await prisma.$transaction(async (tx) => {
        const production = await tx.productionOrder.findFirstOrThrow({
          where: { id: productionId, tenantId: auth.user.tenantId },
        });

        await tx.qcRecord.create({
          data: {
            productionOrderId: productionId,
            result: result as QcResult,
            note: optionalString(formData, "note"),
            inspectedById: auth.user.id,
          },
        });

        if (result === QcResult.PASS) {
          await tx.productionOrder.update({
            where: { id: productionId },
            data: { status: ProductionStatus.COMPLETED, completedAt: new Date() },
          });
        } else {
          // Failed QC sends the batch back to the last production stage.
          await tx.productionOrder.update({
            where: { id: productionId },
            data: { status: ProductionStatus.REWORK },
          });
          await tx.productionStageProgress.updateMany({
            where: { productionOrderId: productionId, status: StageStatus.DONE },
            data: { status: StageStatus.IN_PROGRESS, completedAt: null },
          });
        }

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: result === QcResult.PASS ? "APPROVE" : "REJECT",
          entityType: AttachmentEntity.PRODUCTION_ORDER,
          entityId: production.id,
          entityLabel: production.number,
          summary: `QC ${result} for production ${production.number}`,
        });

        if (result === QcResult.PASS) {
          await syncOrderFulfillment(tx, production.orderId, { id: auth.user.id, name: auth.user.name });
        }
      });

      return ok(
        result === QcResult.PASS ? "QC lolos — produksi selesai." : "QC gagal — produksi dikembalikan ke tahap sebelumnya.",
      );
    },
    [...PATHS, `/fulfillment/production/${productionId}`, "/orders"],
  );
}

export async function updateSubcontract(subcontractId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const before = await tx.subcontract.findFirstOrThrow({
          where: { id: subcontractId, tenantId: auth.user.tenantId },
        });

        const status = String(formData.get("status") ?? before.status);
        const progress = numberField(formData, "progressPercent", num(before.progressPercent));

        const updated = await tx.subcontract.update({
          where: { id: before.id },
          data: {
            status: Object.values(SubcontractStatus).includes(status as SubcontractStatus)
              ? (status as SubcontractStatus)
              : before.status,
            progressPercent: Math.max(0, Math.min(100, progress)),
            inspectionResult: optionalString(formData, "inspectionResult") ?? before.inspectionResult,
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "UPDATE",
          entityType: AttachmentEntity.SUBCONTRACT,
          entityId: updated.id,
          entityLabel: updated.number,
          summary: `Subcontract ${updated.number} updated (${progress}%)`,
          changes: {
            status: { from: before.status, to: updated.status },
            progressPercent: { from: num(before.progressPercent), to: progress },
          },
        });
      });

      return ok("Subcontract diperbarui.");
    },
    [...PATHS, `/fulfillment/subcontracts/${subcontractId}`],
  );
}

export async function approveSubcontract(subcontractId: string, formData: FormData): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const subcontract = await tx.subcontract.findFirstOrThrow({
          where: { id: subcontractId, tenantId: auth.user.tenantId },
        });

        await tx.subcontract.update({
          where: { id: subcontract.id },
          data: {
            status: SubcontractStatus.APPROVED,
            approvedById: auth.user.id,
            approvedAt: new Date(),
            approvalNote: optionalString(formData, "approvalNote"),
          },
        });

        await logActivity(tx, {
          tenantId: auth.user.tenantId,
          actor: { id: auth.user.id, name: auth.user.name },
          action: "APPROVE",
          entityType: AttachmentEntity.SUBCONTRACT,
          entityId: subcontract.id,
          entityLabel: subcontract.number,
          summary: `Subcontract ${subcontract.number} approved for handover`,
        });
      });

      return ok("Subcontract approved.");
    },
    [...PATHS, `/fulfillment/subcontracts/${subcontractId}`],
  );
}

export async function closeSubcontract(subcontractId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("fulfillment", "manage");

      await prisma.$transaction(async (tx) => {
        const subcontract = await tx.subcontract.findFirstOrThrow({
          where: { id: subcontractId, tenantId: auth.user.tenantId },
        });

        await tx.subcontract.update({
          where: { id: subcontract.id },
          data: { status: SubcontractStatus.COMPLETED, progressPercent: 100, completedAt: new Date() },
        });

        await syncOrderFulfillment(tx, subcontract.orderId, { id: auth.user.id, name: auth.user.name });
      });

      return ok("Subcontract selesai.");
    },
    [...PATHS, `/fulfillment/subcontracts/${subcontractId}`, "/orders"],
  );
}
