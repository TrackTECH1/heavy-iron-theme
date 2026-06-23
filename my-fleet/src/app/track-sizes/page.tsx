import Link from "next/link";
import { DataTable, PageHeader, SearchBar } from "@/components/ui";
import { getTrackSizes } from "@/lib/queries";

export default async function TrackSizesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const sizes = await getTrackSizes(q);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Track Sizes"
        subtitle="Track size v2 spine · 128 active sizes · core.v_track_size_spine_v2"
      />
      <SearchBar action="/track-sizes" defaultValue={q} placeholder="Filter canonical size…" />
      <DataTable
        headers={["Canonical size", "Products", "Machines", "Fitments", ""]}
        rows={sizes.map((ts) => [
          <span key="size" className="font-mono font-medium text-zinc-100">
            {ts.canonical_size}
          </span>,
          ts.product_count.toLocaleString(),
          ts.machine_count.toLocaleString(),
          ts.fitment_count.toLocaleString(),
          <Link
            key="link"
            href={`/track-sizes/${ts.track_size_id}`}
            className="text-sm text-amber-400"
          >
            Detail →
          </Link>,
        ])}
      />
    </div>
  );
}
