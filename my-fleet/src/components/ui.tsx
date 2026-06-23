import Link from "next/link";

export function SearchBar({
  action = "/",
  defaultValue = "",
  placeholder = "Search machines — e.g. CAT 299D3",
}: {
  action?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <form action={action} method="get" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
      <button
        type="submit"
        className="rounded-lg bg-amber-500 px-5 py-3 font-medium text-zinc-950 transition hover:bg-amber-400"
      >
        Search
      </button>
    </form>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-zinc-500">—</span>;
  const tone =
    status === "active" || status === "active_v1" || status === "Verified"
      ? "bg-emerald-950 text-emerald-300 ring-emerald-800"
      : status === "quarantine"
        ? "bg-red-950 text-red-300 ring-red-800"
        : status === "reference"
          ? "bg-sky-950 text-sky-300 ring-sky-800"
          : status === "review" || status.includes("Review")
            ? "bg-amber-950 text-amber-300 ring-amber-800"
            : "bg-zinc-800 text-zinc-300 ring-zinc-700";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${tone}`}>
      {status}
    </span>
  );
}

export function ReviewWarnings({
  warnings,
}: {
  warnings: { queue: string; summary: string; detail?: string }[];
}) {
  if (warnings.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-400">
        Review warnings
      </h2>
      <ul className="space-y-2">
        {warnings.map((w, i) => (
          <li key={i} className="rounded-lg bg-zinc-900/60 px-3 py-2 text-sm">
            <span className="font-mono text-xs text-amber-500">{w.queue}</span>
            <p className="text-zinc-200">{w.summary}</p>
            {w.detail && <p className="mt-1 text-xs text-zinc-500">{w.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-zinc-900/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-top text-zinc-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold text-zinc-50">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
    </div>
  );
}

export function MachineLink({
  machineId,
  brand,
  model,
}: {
  machineId: string;
  brand: string;
  model: string;
}) {
  return (
    <Link
      href={`/machines/${machineId}`}
      className="font-medium text-amber-400 hover:text-amber-300"
    >
      {brand} {model}
    </Link>
  );
}

export function SkuLink({ sku }: { sku: string }) {
  return (
    <Link href={`/products/${encodeURIComponent(sku)}`} className="font-mono text-amber-400 hover:text-amber-300">
      {sku}
    </Link>
  );
}

export function TrackSizeLink({
  trackSizeId,
  label,
}: {
  trackSizeId: string;
  label: string;
}) {
  return (
    <Link
      href={`/track-sizes/${trackSizeId}`}
      className="font-mono text-amber-400 hover:text-amber-300"
    >
      {label}
    </Link>
  );
}
