"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/lib/actions/helpers";

/**
 * For one-click mutations (status changes, deletes, conversions). Accepts both
 * fully-bound actions and actions that still expect the FormData.
 */
export function ActionForm({
  action,
  children,
  className,
  showError = true,
}: {
  action: (formData: FormData) => Promise<ActionResult | void>;
  children: React.ReactNode;
  className?: string;
  showError?: boolean;
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await action(formData);
    return result ?? null;
  }, null);

  return (
    <form action={formAction} className={className}>
      {children}
      {showError && state && !state.ok ? (
        <p className="mt-1 max-w-xs text-[11px] text-rose-600">{state.error}</p>
      ) : null}
    </form>
  );
}
