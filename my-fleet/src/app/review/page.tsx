import Link from "next/link";
import { DataTable, PageHeader, SearchBar } from "@/components/ui";
import { getReviewQueueRows, getReviewQueueStats } from "@/lib/review-queues";

const QUEUES = [
  {
    file: "machine_missing_fields_review_queue.csv",
    label: "Machine missing fields",
    columns: ["machine_id", "brand", "model", "missing_fields"],
  },
  {
    file: "track_size_review_queue.csv",
    label: "Track size review",
    columns: ["raw_track_size", "source", "context", "review_reason"],
  },
  {
    file: "merge_conflicts_review_queue.csv",
    label: "Merge conflicts",
    columns: ["conflict_type", "entity", "brand", "value", "action"],
  },
  {
    file: "product_review_queue.csv",
    label: "Product review",
    columns: ["sku", "issue", "action"],
  },
  {
    file: "track_size_observations_crosswalk.csv",
    label: "Track size crosswalk",
    columns: ["raw_track_size", "canonical_size", "source"],
  },
] as const;

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; q?: string }>;
}) {
  const { queue, q } = await searchParams;
  const stats = getReviewQueueStats();
  const activeQueue = queue ?? QUEUES[0].file;
  const meta = QUEUES.find((c) => c.file === activeQueue) ?? QUEUES[0];
  const rows = getReviewQueueRows(activeQueue, q, 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Queue Viewer"
        subtitle="Read-only CSV triage from 03_review_queues — not imported to DB"
      />

      <div className="flex flex-wrap gap-2">
        {stats.map((s) => (
          <Link
            key={s.file}
            href={`/review?queue=${s.file}`}
            className={`rounded-full px-3 py-1 text-xs ring-1 ${
              s.file === activeQueue
                ? "bg-amber-950 text-amber-300 ring-amber-800"
                : "bg-zinc-900 text-zinc-400 ring-zinc-700 hover:text-zinc-200"
            }`}
          >
            {s.label} ({s.count.toLocaleString()})
          </Link>
        ))}
      </div>

      <SearchBar
        action={`/review?queue=${activeQueue}`}
        defaultValue={q}
        placeholder={`Search ${meta.label}…`}
      />

      <p className="text-sm text-zinc-500">
        Showing {rows.length} rows from {meta.file}
        {q ? ` matching "${q}"` : ""}
      </p>

      <DataTable
        headers={[...meta.columns]}
        rows={rows.map((row) =>
          meta.columns.map((col) => {
            const val = row[col] ?? "—";
            if (col === "machine_id" && val !== "—") {
              return (
                <Link
                  key={col}
                  href={`/machines/${val}`}
                  className="font-mono text-xs text-amber-400"
                >
                  {val}
                </Link>
              );
            }
            if (col === "sku" && val !== "—") {
              return (
                <Link
                  key={col}
                  href={`/products/${encodeURIComponent(val)}`}
                  className="font-mono text-xs text-amber-400"
                >
                  {val}
                </Link>
              );
            }
            return (
              <span key={col} className="max-w-xs truncate text-xs">
                {val}
              </span>
            );
          }),
        )}
      />
    </div>
  );
}
