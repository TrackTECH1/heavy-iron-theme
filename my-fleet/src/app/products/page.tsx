import Link from "next/link";
import { DataTable, PageHeader, SearchBar } from "@/components/ui";
import { getProducts } from "@/lib/queries";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; trackSize?: string; page?: string }>;
}) {
  const { q, trackSize, page: pageStr } = await searchParams;
  const page = Number(pageStr ?? "0") || 0;
  const { rows, total } = await getProducts({ search: q, trackSizeId: trackSize, page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products / SKUs"
        subtitle={`${total.toLocaleString()} products · core.product`}
      />
      <SearchBar action="/products" defaultValue={q} placeholder="Search SKU or title…" />
      <DataTable
        headers={["SKU", "Title", "Type", "Track size", "Qty", ""]}
        rows={rows.map((p) => [
          <span key="sku" className="font-mono text-sm font-medium">
            {p.sku}
          </span>,
          <span key="title" className="max-w-xs truncate text-xs">
            {p.title ?? "—"}
          </span>,
          p.product_type ?? "—",
          <span key="ts" className="font-mono text-xs">
            {p.track_size ?? "—"}
          </span>,
          p.qty_available ?? "—",
          <Link
            key="link"
            href={`/products/${encodeURIComponent(p.sku)}`}
            className="text-sm text-amber-400"
          >
            Detail →
          </Link>,
        ])}
      />
    </div>
  );
}
