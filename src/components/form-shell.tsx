"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/lib/actions/helpers";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";

export function FormShell({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  size = "md",
  submitClassName,
  actions,
  className,
  hidden,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  submitClassName?: string;
  actions?: React.ReactNode;
  className?: string;
  hidden?: Record<string, string | undefined>;
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult | null, formData: FormData) => action(formData), null);

  return (
    <form action={formAction} className={className}>
      {hidden
        ? Object.entries(hidden).map(([key, value]) =>
            value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />,
          )
        : null}

      {state && !state.ok ? (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
          {state.error}
        </p>
      ) : null}
      {state && state.ok && state.message ? (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {state.message}
        </p>
      ) : null}

      {children}

      <div className="mt-5 flex items-center gap-2">
        <SubmitButton variant={variant} size={size} className={submitClassName} pendingLabel={pendingLabel ?? "Saving…"}>
          {submitLabel}
        </SubmitButton>
        {actions}
      </div>
    </form>
  );
}
