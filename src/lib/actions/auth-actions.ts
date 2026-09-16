"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authenticate, createSession, destroySession } from "@/lib/auth";

export type LoginState = { error?: string };

function safeRedirectTarget(value: unknown): string {
  const target = typeof value === "string" ? value : "";
  // Only same-origin paths — never an absolute URL handed to us by the form.
  if (!target.startsWith("/") || target.startsWith("//")) return "/dashboard";
  return target;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await authenticate(email, password);
  if (!user) {
    return { error: "Those credentials do not match an active account." };
  }

  const headerList = await headers();
  await createSession(user.id, {
    userAgent: headerList.get("user-agent"),
    ipAddress: headerList.get("x-forwarded-for"),
  });

  redirect(safeRedirectTarget(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
