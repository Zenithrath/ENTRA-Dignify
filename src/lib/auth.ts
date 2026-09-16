import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { canManage, canView, type ModuleId } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";

const SESSION_COOKIE = "entra_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
};

export type AuthContext = {
  user: SessionUser;
  tenant: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    logoUrl: string | null;
  };
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque random token in the cookie; only its hash is persisted, so the DB stays safe. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { tenant: true } } },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive || session.user.deletedAt) return null;

  return {
    user: {
      id: session.user.id,
      tenantId: session.user.tenantId,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    tenant: {
      id: session.user.tenant.id,
      name: session.user.tenant.name,
      slug: session.user.tenant.slug,
      currency: session.user.tenant.currency,
      logoUrl: session.user.tenant.logoUrl,
    },
  };
});

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/**
 * Every server action re-checks this: server functions are reachable by direct POST,
 * so hiding UI is never enough.
 */
export async function requirePermission(moduleId: ModuleId, level: "view" | "manage" = "view"): Promise<AuthContext> {
  const auth = await requireAuth();
  const allowed = level === "manage" ? canManage(auth.user.role, moduleId) : canView(auth.user.role, moduleId);
  if (!allowed) {
    throw new Error(`Your role (${auth.user.role}) cannot ${level} ${moduleId}.`);
  }
  return auth;
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  // Email is unique per tenant, so the same address may exist in several tenants.
  const candidates = await prisma.user.findMany({
    where: { email: email.trim().toLowerCase(), isActive: true, deletedAt: null },
    include: { tenant: true },
  });

  for (const candidate of candidates) {
    if (candidate.tenant.deletedAt) continue;
    const ok = await bcrypt.compare(password, candidate.passwordHash);
    if (!ok) continue;

    await prisma.user.update({ where: { id: candidate.id }, data: { lastLoginAt: new Date() } });
    return {
      id: candidate.id,
      tenantId: candidate.tenantId,
      name: candidate.name,
      email: candidate.email,
      role: candidate.role,
    };
  }

  // Constant-ish work on a miss so missing accounts and wrong passwords look alike.
  await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  return null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
