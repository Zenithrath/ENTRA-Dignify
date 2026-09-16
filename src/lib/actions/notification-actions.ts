"use server";

import { NotificationStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth";
import { resendNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { fail, ok, runAction, type ActionResult } from "@/lib/actions/helpers";

const PATHS = ["/notifications", "/dashboard"];

export async function retryNotification(notificationId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("dashboard", "view");

      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, tenantId: auth.user.tenantId },
      });
      if (!notification) return fail("Notifikasi tidak ditemukan.");

      await resendNotification(notification.id);
      return ok("Notifikasi dikirim ulang.");
    },
    PATHS,
  );
}

/** In-app items have nothing to deliver, so acknowledging them is enough. */
export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("dashboard", "view");

      const result = await prisma.notification.updateMany({
        where: { id: notificationId, tenantId: auth.user.tenantId, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
      if (result.count === 0) return fail("Notifikasi ini sudah ditandai selesai.");

      return ok("Ditandai selesai.");
    },
    PATHS,
  );
}

export async function cancelNotification(notificationId: string): Promise<ActionResult> {
  return runAction(
    async () => {
      const auth = await requirePermission("dashboard", "view");

      await prisma.notification.updateMany({
        where: { id: notificationId, tenantId: auth.user.tenantId, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.CANCELLED },
      });

      return ok("Notifikasi dibatalkan.");
    },
    PATHS,
  );
}
