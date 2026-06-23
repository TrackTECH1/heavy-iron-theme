import Link from "next/link";
import { DataTable, MachineLink, PageHeader, SearchBar, SkuLink } from "@/components/ui";
import { getFitments, getMachine } from "@/lib/queries";

export default async function FitmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    model?: string;
    sku?: string;
    machine?: string;
    trackSize?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? "0") || 0;

  let brand = sp.brand;
  let model = sp.model;
  if (sp.machine) {
    const m = await getMachine(sp.machine);
    if (m) {
      brand = m.brand;
      model = m.model;
    }
  }

  const { rows, total } = await getFitments({
    brand,
    model,
    sku: sp.sku,
    machineId: sp.machine,
    page,
  });

  const filtered =
    sp.trackSize
      ? rows.filter(
          (f) =>
            f.machine_track_size === sp.trackSize ||
            f.product_track_size === sp.trackSize,
        )
      : rows;

  const filterLabel = [
    brand && `brand=${brand}`,
    model && `model=${model}`,
    sp.sku && `sku=${sp.sku}`,
    sp.machine && `machine=${sp.machine}`,
    sp.trackSize && `trackSize=${sp.trackSize}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fitment Explorer"
        subtitle={`${total.toLocaleString()} fitments · core.v_fitment_godlist`}
      />
      <form action="/fitments" method="get" className="grid gap-2 sm:grid-cols-4">
        <input
          name="brand"
          defaultValue={brand}
          placeholder="Brand"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <input
          name="model"
          defaultValue={model}
          placeholder="Model"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <input
          name="sku"
          defaultValue={sp.sku}
          placeholder="SKU"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950"
        >
          Filter
        </button>
      </form>
      {filterLabel && (
        <p className="text-sm text-zinc-500">
          Active filters: {filterLabel}{" "}
          <Link href="/fitments" className="text-amber-400">
            Clear
          </Link>
        </p>
      )}
      <DataTable
        headers={["Machine", "SKU", "Machine size", "Product size", "Type", "Confidence"]}
        rows={filtered.map((f) => [
          <MachineLink
            key="m"
            machineId={f.machine_id}
            brand={f.brand}
            model={f.model}
          />,
          <SkuLink key="sku" sku={f.sku} />,
          <span key="mts" className="font-mono text-xs">
            {f.machine_track_size ?? "—"}
          </span>,
          <span key="pts" className="font-mono text-xs">
            {f.product_track_size ?? "—"}
          </span>,
          f.fitment_type ?? "—",
          f.confidence ?? "—",
        ])}
      />
    </div>
  );
}
