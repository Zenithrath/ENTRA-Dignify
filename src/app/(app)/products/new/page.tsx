import type { Metadata } from "next";
import Link from "next/link";

import { ProductForm } from "@/components/products/product-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { createProduct } from "@/lib/actions/product-actions";
import { requirePermission } from "@/lib/auth";
import { supplierOptions } from "@/lib/queries/common";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const auth = await requirePermission("products", "manage");
  const suppliers = await supplierOptions(auth.user.tenantId);

  return (
    <>
      <PageHeader
        title="New product"
        breadcrumbs={[{ label: "Products", href: "/products" }, { label: "New" }]}
        description="Barang, jasa, labor, atau paket beserta harga dan aturan stoknya."
        actions={
          <Link href="/products" className={buttonClass("secondary")} prefetch={false}>
            Cancel
          </Link>
        }
      />
      <div className="max-w-4xl">
        <ProductForm
          action={createProduct}
          suppliers={suppliers}
          submitLabel="Create product"
          defaults={{ isInventoryTracked: true, taxRate: 11, unit: "pcs" }}
        />
      </div>
    </>
  );
}
