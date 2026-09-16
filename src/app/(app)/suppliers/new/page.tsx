import type { Metadata } from "next";
import Link from "next/link";

import { SupplierForm } from "@/components/suppliers/supplier-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { createSupplier } from "@/lib/actions/supplier-actions";
import { requirePermission } from "@/lib/auth";

export const metadata: Metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requirePermission("suppliers", "manage");

  return (
    <>
      <PageHeader
        title="New supplier"
        breadcrumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: "New" }]}
        actions={
          <Link href="/suppliers" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />
      <div className="max-w-4xl">
        <SupplierForm action={createSupplier} submitLabel="Create supplier" withContact />
      </div>
    </>
  );
}
