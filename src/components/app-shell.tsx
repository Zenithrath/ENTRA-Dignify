"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Send,
  ShoppingCart,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { logoutAction } from "@/lib/actions/auth-actions";

// Layer 1 — hanya menu pengganti spreadsheet. Modul Layer 2 tetap bisa dibuka
// lewat URL langsung, tapi disembunyikan supaya tidak membingungkan saat ACC.
const TRACKER_NAV = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { id: "quotations", label: "Quotations", href: "/quotations", icon: FileText },
  { id: "procurement", label: "Procurement", href: "/procurement", icon: ShoppingCart },
  { id: "customers", label: "Customers", href: "/customers", icon: Building2 },
];

export type ShellNavGroup = {
  group: string;
  items: { id: string; label: string; href: string; icon: string }[];
};

export function AppShell({
  user,
  tenant,
  notificationCount,
  children,
}: {
  user: { name: string; email: string; role: string };
  tenant: { name: string; slug: string };
  navGroups?: ShellNavGroup[];
  notificationCount: number;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-100 via-[#FFF7F4] to-emerald-100 p-2 sm:p-4">
      <div className="mx-auto grid min-h-[calc(100vh-1rem)] max-w-[1440px] overflow-hidden rounded-[28px] bg-white shadow-xl ring-1 ring-white/70 sm:min-h-[calc(100vh-2rem)] lg:grid-cols-[236px_1fr]">
        {/* ---- Sidebar ---- */}
        <aside
          className={cn(
            "no-print fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-white transition-transform lg:static lg:translate-x-0",
            drawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          )}
        >
          <div className="flex items-center gap-2 px-5 pb-2 pt-6">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-600 text-white">
              <Send className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-extrabold leading-none tracking-tight text-rose-600">Entra</p>
              <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{tenant.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {TRACKER_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-rose-50 font-semibold text-rose-600"
                      : "font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 p-3">
            <div className="flex items-center gap-2.5 rounded-2xl bg-slate-50 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-800">{user.name}</span>
                <span className="block truncate text-[11px] text-slate-400">{user.email}</span>
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </aside>

        {drawerOpen ? (
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}

        {/* ---- Main column ---- */}
        <div className="flex min-h-0 min-w-0 flex-col bg-[#FDF2F4]">
          <header className="no-print sticky top-0 z-20 flex items-center gap-2 px-4 pt-4 lg:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-xl bg-white p-2.5 text-slate-500 shadow-sm lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            <form action="/quotations" method="get" className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                name="q"
                placeholder="Search.."
                className="h-11 w-full rounded-full border-0 bg-white pl-11 pr-4 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-200"
              />
            </form>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/quotations/new"
                className="hidden h-11 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500 sm:inline-flex"
              >
                <Plus className="h-4 w-4" />
                Add quotation
              </Link>
              <Link
                href="/notifications"
                className="relative hidden rounded-full bg-white p-2.5 text-slate-500 shadow-sm hover:text-rose-600 sm:block"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {notificationCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                ) : null}
              </Link>
              <span className="hidden h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-sm font-bold text-white shadow-sm md:flex">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
