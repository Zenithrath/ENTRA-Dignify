import "server-only";

import type { AttachmentEntity, NotificationChannel, NotificationEvent } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type NotificationInput = {
  tenantId: string;
  event: NotificationEvent;
  channel?: NotificationChannel;
  recipient?: string | null;
  recipientName?: string | null;
  subject?: string | null;
  body: string;
  entityType?: AttachmentEntity | null;
  entityId?: string | null;
  entityLabel?: string | null;
};

const GRAPH_VERSION = "v21.0";

function whatsappCredentials(): { phoneNumberId: string; accessToken: string } | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

async function sendViaWhatsApp(recipient: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const credentials = whatsappCredentials();
  if (!credentials) {
    return {
      ok: false,
      error: "Queued only — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to deliver automatically.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient.replace(/[^0-9]/g, ""),
        type: "text",
        text: { body },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, error: `WhatsApp API ${response.status}: ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown WhatsApp error" };
  }
}

/**
 * Single entry point for outbound messages. WhatsApp is attempted immediately when
 * credentials exist; otherwise the message stays queued so the team can see and
 * resend it from the notifications page.
 */
export async function queueNotification(input: NotificationInput) {
  const channel = input.channel ?? "WHATSAPP";
  const recipient = input.recipient ?? null;

  const notification = await prisma.notification.create({
    data: {
      tenantId: input.tenantId,
      event: input.event,
      channel,
      recipient,
      recipientName: input.recipientName ?? null,
      subject: input.subject ?? null,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      status: "PENDING",
    },
  });

  if (channel === "WHATSAPP" && recipient) {
    const result = await sendViaWhatsApp(recipient, input.body);
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: result.ok ? "SENT" : "PENDING",
        sentAt: result.ok ? new Date() : null,
        attempts: 1,
        error: result.error ?? null,
      },
    });
  } else if (channel === "IN_APP") {
    await prisma.notification.update({ where: { id: notification.id }, data: { status: "PENDING" } });
  }

  return notification;
}

export async function resendNotification(notificationId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) throw new Error("Notification not found.");

  if (notification.channel === "WHATSAPP" && notification.recipient) {
    const result = await sendViaWhatsApp(notification.recipient, notification.body);
    return prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: result.ok ? "SENT" : "FAILED",
        sentAt: result.ok ? new Date() : notification.sentAt,
        attempts: { increment: 1 },
        error: result.error ?? null,
      },
    });
  }

  return prisma.notification.update({
    where: { id: notification.id },
    data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
  });
}

export function whatsappEnabled(): boolean {
  return whatsappCredentials() !== null;
}

export function waLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
