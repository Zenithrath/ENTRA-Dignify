import type { Metadata } from "next";
import { Send } from "lucide-react";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const DEMO = [
  { role: "Owner", email: "owner@entra.co.id", password: "password123" },
  { role: "Sales", email: "sales@entra.co.id", password: "password123" },
  { role: "Procurement", email: "procurement@entra.co.id", password: "password123" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const prefill = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-rose-100 via-[#FFF7F4] to-emerald-100 p-4">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-8 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-white">
            <Send className="h-4 w-4" />
          </span>
          <p className="text-xl font-extrabold tracking-tight text-rose-600">Entra</p>
        </div>
        <h1 className="mt-6 text-lg font-bold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Quotation & procurement tracker tim.</p>

        <div className="mt-6">
          <LoginForm
            next={params.next}
            defaults={prefill ? { email: DEMO[0].email, password: DEMO[0].password } : undefined}
          />
        </div>

        {prefill ? (
          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-700">Demo accounts</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Password: <span className="font-mono">password123</span>
            </p>
            <ul className="mt-2 space-y-1">
              {DEMO.map((account) => (
                <li key={account.email} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-600">{account.role}</span>
                  <span className="font-mono text-[11px] text-slate-500">{account.email}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
