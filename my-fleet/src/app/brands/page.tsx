import Link from "next/link";
import { DataTable, PageHeader } from "@/components/ui";
import { getBrands } from "@/lib/queries";

export default async function BrandsPage() {
  const brands = await getBrands();
  const activeBrands = brands.filter((b) => (b.active_model_count ?? 0) > 0);

  return (
    <div>
      <PageHeader
        title="Brands"
        subtitle={`${activeBrands.length} brands · track-finder v1 navigation`}
      />
      <DataTable
        headers={["Brand", "Active models", "Total (incl. hidden)", ""]}
        rows={activeBrands.map((b) => [
          <span key="brand" className="font-medium text-zinc-100">
            {b.brand}
          </span>,
          <span key="active" className="font-mono text-xs text-emerald-400">
            {b.active_model_count ?? 0}
          </span>,
          <span key="total" className="font-mono text-xs text-zinc-500">
            {b.total_model_count ?? 0}
          </span>,
          <Link
            key="link"
            href={`/models?brand=${b.brand_id}`}
            className="text-sm text-amber-400 hover:text-amber-300"
          >
            Active models →
          </Link>,
        ])}
      />
    </div>
  );
}
