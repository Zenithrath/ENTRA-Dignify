"use client";

import { useState } from "react";

import { updateItemWorkStatus } from "@/lib/actions/tracker-actions";
import { WORK_STATUS_LABEL, WORK_STATUSES } from "@/lib/tracker";
import type { WorkStatus } from "@/generated/prisma/enums";

/** Ubah status pekerjaan langsung dari baris tabel Procurement Tracker. */
export function WorkStatusPicker({ itemId, value }: { itemId: string; value: WorkStatus }) {
  const [saving, setSaving] = useState(false);

  return (
    <form
      action={async (formData: FormData) => {
        setSaving(true);
        try {
          await updateItemWorkStatus(itemId, formData);
        } finally {
          setSaving(false);
        }
      }}
    >
      <select
        name="workStatus"
        defaultValue={value}
        disabled={saving}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="Status pekerjaan"
        className="h-8 rounded-full border-0 bg-slate-100 pl-3 pr-7 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:opacity-60"
      >
        {WORK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {WORK_STATUS_LABEL[status]}
          </option>
        ))}
      </select>
    </form>
  );
}
