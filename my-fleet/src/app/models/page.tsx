import Link from "next/link";
import { DataTable, PageHeader, SearchBar, StatusBadge } from "@/components/ui";
import { getBrand, getMachineTypes, getModels } from "@/lib/queries";

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    type?: string;
    q?: string;
    page?: string;
    show?: string;
  }>;
}) {
  const { brand, type, q, page: pageStr, show } = await searchParams;
  const page = Number(pageStr ?? "0") || 0;
  const includeReference = show === "all";
  const [machineTypes, modelsResult, brandInfo] = await Promise.all([
    getMachineTypes(),
    getModels({
      brandId: brand,
      machineType: type,
      search: q,
      page,
      includeHidden: includeReference,
    }),
    brand ? getBrand(brand) : Promise.resolve(null),
  ]);
  const { rows, total } = modelsResult;

  const filterParams = (overrides: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    if (brand) params.set("brand", brand);
    if (type) params.set("type", type);
    if (q) params.set("q", q);
    if (includeReference && !("show" in overrides)) params.set("show", "all");
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={brandInfo ? `${brandInfo.brand} Models` : "Models"}
        subtitle={
          includeReference
            ? `${total.toLocaleString()} machines (reference + supplier noise)`
            : `${total.toLocaleString()} track-finder v1 machines`
        }
      />
      <SearchBar action="/models" defaultValue={q} placeholder="Filter by brand or model…" />
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/models${filterParams({ type: undefined })}`}
          className={`rounded-full px-3 py-1 text-xs ring-1 ${!type ? "bg-amber-500/20 text-amber-300 ring-amber-700" : "text-zinc-400 ring-zinc-700 hover:text-zinc-200"}`}
        >
          All types
        </Link>
        {machineTypes.map((machineType) => (
          <Link
            key={machineType}
            href={`/models${filterParams({ type: machineType })}`}
            className={`rounded-full px-3 py-1 text-xs ring-1 ${type === machineType ? "bg-amber-500/20 text-amber-300 ring-amber-700" : "text-zinc-400 ring-zinc-700 hover:text-zinc-200"}`}
          >
            {machineType}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {brand && (
          <Link href="/models" className="text-zinc-400 hover:text-zinc-200">
            ← All brands
          </Link>
        )}
        {includeReference ? (
          <Link
            href={`/models${filterParams({ show: undefined })}`}
            className="text-amber-400 hover:text-amber-300"
          >
            Track-finder catalog only
          </Link>
        ) : (
          <Link
            href={`/models${filterParams({ show: "all" })}`}
            className="text-zinc-500 hover:text-zinc-300"
          >
            Include reference / supplier noise
          </Link>
        )}
      </div>
      <DataTable
        headers={["Machine", "Type", "Track size", "Catalog", "Shopify", ""]}
        rows={rows.map((m) => [
          <span key="name" className="font-medium">
            {m.brand} {m.model}
          </span>,
          m.machine_type ?? "—",
          <span key="ts" className="font-mono text-xs">
            {m.primary_track_size ?? "—"}
          </span>,
          <StatusBadge key="status" status={m.machine_status ?? m.validation_status} />,
          m.shopify_url ? (
            <a key="shop" href={m.shopify_url} className="text-xs text-sky-400 hover:text-sky-300">
              {m.shopify_handle ?? "page"}
            </a>
          ) : (
            "—"
          ),
          <Link
            key="link"
            href={`/machines/${m.machine_id}`}
            className="text-sm text-amber-400"
          >
            Open →
          </Link>,
        ])}
      />
      {total > 50 && (
        <div className="flex gap-2">
          {page > 0 && (
            <Link
              href={`/models${filterParams({ page: String(page - 1) })}`}
              className="rounded border border-zinc-700 px-3 py-1 text-sm"
            >
              Previous
            </Link>
          )}
          {(page + 1) * 50 < total && (
            <Link
              href={`/models${filterParams({ page: String(page + 1) })}`}
              className="rounded border border-zinc-700 px-3 py-1 text-sm"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
