import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, MachineLink, PageHeader, SkuLink } from "@/components/ui";
import { getFitments, getModels, getProducts, getTrackSize } from "@/lib/queries";

export default async function TrackSizeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trackSize = await getTrackSize(id);
  if (!trackSize) notFound();

  const { rows: products } = await getProducts({ trackSizeId: id, page: 0 });
  const { rows: linkedMachines } = await getModels({ trackSizeId: id, page: 0 });
  const sampleSku = products[0]?.sku;
  const { rows: sizeFitments } = sampleSku
    ? await getFitments({ sku: sampleSku, page: 0 })
    : { rows: [] };

  return (
    <div className="space-y-8">
      <PageHeader
        title={trackSize.canonical_size}
        subtitle={`${trackSize.track_size_id} · size spine hub`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Products", trackSize.product_count],
          ["Machines", trackSize.machine_count],
          ["Fitments", trackSize.fitment_count],
        ].map(([label, count]) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-center"
          >
            <p className="text-2xl font-semibold text-amber-400">
              {Number(count).toLocaleString()}
            </p>
            <p className="text-sm text-zinc-400">{label}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-4 text-lg font-medium">Products at this size</h2>
        <DataTable
          headers={["SKU", "Title", "Type", "Qty"]}
          rows={products.slice(0, 50).map((p) => [
            <SkuLink key="sku" sku={p.sku} />,
            <span key="title" className="max-w-md truncate text-xs">
              {p.title ?? "—"}
            </span>,
            p.product_type ?? "—",
            p.qty_available ?? "—",
          ])}
        />
        <Link
          href={`/products?trackSize=${id}`}
          className="mt-2 inline-block text-sm text-amber-400"
        >
          All products →
        </Link>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-medium">Machines with this primary track size</h2>
        <DataTable
          headers={["Machine", "Type"]}
          rows={linkedMachines.slice(0, 50).map((m) => [
            <MachineLink
              key="m"
              machineId={m.machine_id}
              brand={m.brand}
              model={m.model}
            />,
            m.machine_type ?? "—",
          ])}
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-medium">Sample fitments</h2>
        <DataTable
          headers={["Machine", "SKU", "Confidence"]}
          rows={sizeFitments.slice(0, 25).map((f) => [
            <MachineLink
              key="m"
              machineId={f.machine_id}
              brand={f.brand}
              model={f.model}
            />,
            <SkuLink key="sku" sku={f.sku} />,
            f.confidence ?? "—",
          ])}
        />
        <Link
          href={`/fitments?trackSize=${encodeURIComponent(trackSize.canonical_size)}`}
          className="mt-2 inline-block text-sm text-amber-400"
        >
          Fitment explorer →
        </Link>
      </section>
    </div>
  );
}
