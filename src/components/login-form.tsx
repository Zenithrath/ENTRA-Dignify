"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "@/lib/actions/auth-actions";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

const INITIAL: LoginState = {};

export function LoginForm({ next, defaults }: { next?: string; defaults?: { email: string; password: string } }) {
  const [state, formAction] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <Field label="Work email" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={defaults?.email}
          placeholder="you@company.co.id"
        />
      </Field>
      <Field label="Password" required>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          defaultValue={defaults?.password}
        />
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
          {state.error}
        </p>
      ) : null}

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
