import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationStatus } from "@/generated/prisma/enums";

// Layer 1: every page in this group reads the session and live tracker data.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();

  const pendingNotifications = await prisma.notification.count({
    where: {
      tenantId: auth.user.tenantId,
      status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
    },
  });

  return (
    <AppShell
      user={{ name: auth.user.name, email: auth.user.email, role: auth.user.role }}
      tenant={{ name: auth.tenant.name, slug: auth.tenant.slug }}
      notificationCount={pendingNotifications}
    >
      {children}
    </AppShell>
  );
}
