import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DataTable,
  MachineLink,
  PageHeader,
  ReviewWarnings,
  TrackSizeLink,
} from "@/components/ui";
import { getFitments, getProductBySku } from "@/lib/queries";
import { getProductReviewWarnings } from "@/lib/review-queues";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku);
  const product = await getProductBySku(sku);
  if (!product) notFound();

  const { rows: fitments, total } = await getFitments({ sku, page: 0 });
  const warnings = getProductReviewWarnings(sku);

  return (
    <div className="space-y-8">
      <PageHeader title={product.sku} subtitle={product.title ?? "Product detail"} />
      <ReviewWarnings warnings={warnings} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm">
          <h2 className="mb-4 font-semibold uppercase tracking-wide text-zinc-400">
            Product
          </h2>
          <dl className="space-y-2">
            {[
              ["Product ID", product.product_id],
              ["Type", product.product_type],
              ["Pattern", product.pattern],
              ["Track size", product.track_size],
              ["Cost", product.cost != null ? `$${product.cost}` : null],
              ["Price", product.price != null ? `$${product.price}` : null],
              ["Qty available", product.qty_available],
              ["Weight (lbs)", product.weight_lbs],
              ["Supplier SKU", product.supplier_sku],
              ["Shopify SKU", product.shopify_sku],
              ["Sources", product.source_systems],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-zinc-500">{label}</dt>
                <dd className="text-right text-zinc-200">
                  {label === "Track size" && product.track_size_id && product.track_size ? (
                    <TrackSizeLink
                      trackSizeId={product.track_size_id}
                      label={product.track_size}
                    />
                  ) : (
                    (value ?? "—")
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-4 font-semibold uppercase tracking-wide text-zinc-400">
            Fitment count
          </h2>
          <p className="text-3xl font-semibold text-amber-400">
            {total.toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-zinc-400">machines linked via core.fitment</p>
          <Link
            href={`/fitments?sku=${encodeURIComponent(sku)}`}
            className="mt-4 inline-block text-sm text-amber-400"
          >
            Open fitment explorer →
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-medium">Fitments (sample)</h2>
        <DataTable
          headers={["Machine", "Type", "Fitment", "Confidence"]}
          rows={fitments.slice(0, 30).map((f) => [
            <MachineLink
              key="m"
              machineId={f.machine_id}
              brand={f.brand}
              model={f.model}
            />,
            f.machine_type ?? "—",
            f.fitment_type ?? "—",
            f.confidence ?? "—",
          ])}
        />
      </section>
    </div>
  );
}
