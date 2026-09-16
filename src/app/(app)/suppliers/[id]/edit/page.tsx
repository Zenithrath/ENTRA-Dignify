import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SupplierForm } from "@/components/suppliers/supplier-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { updateSupplier } from "@/lib/actions/supplier-actions";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("suppliers", "manage");
  const { id } = await params;

  const supplier = await prisma.supplier.findFirst({ where: { id, tenantId: auth.user.tenantId } });
  if (!supplier) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${supplier.name}`}
        breadcrumbs={[
          { label: "Suppliers", href: "/suppliers" },
          { label: supplier.name, href: `/suppliers/${supplier.id}` },
          { label: "Edit" },
        ]}
        actions={
          <Link href={`/suppliers/${supplier.id}`} className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />
      <div className="max-w-4xl">
        <SupplierForm
          action={updateSupplier.bind(null, supplier.id)}
          submitLabel="Save changes"
          defaults={{
            name: supplier.name,
            category: supplier.category,
            taxNumber: supplier.taxNumber,
            address: supplier.address,
            city: supplier.city,
            phone: supplier.phone,
            email: supplier.email,
            whatsappNumber: supplier.whatsappNumber,
            paymentTerms: supplier.paymentTerms,
            leadTimeDays: supplier.leadTimeDays,
            notes: supplier.notes,
          }}
        />
      </div>
    </>
  );
}
