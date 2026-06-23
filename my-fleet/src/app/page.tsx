import Link from "next/link";
import { loadMachinePartsCounter } from "@/lib/machine-parts-counter";
import { PartsCounterResults } from "@/components/PartsCounterResults";
import { PageHeader, SearchBar } from "@/components/ui";
import { searchMachines } from "@/lib/queries";

const QUICK_SEARCHES = ["svl75-2", "bobcat t730", "john deere 323e", "cat 299d3"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = q ? await searchMachines(q, 5) : [];
  const topMatch = results[0] ?? null;
  const alternateMatches = results.slice(1).map((m) => ({
    machine_id: m.machine_id,
    brand: m.brand,
    model: m.model,
  }));

  const counter = topMatch ? await loadMachinePartsCounter(topMatch.machine_id) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="My Fleet"
        subtitle="Intelligent enrichment viewer — v2 sizes, media inheritance, review tasks"
      />

      <div className="space-y-3">
        <SearchBar
          defaultValue={q}
          placeholder="Search machines — e.g. svl75-2, bobcat t730"
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_SEARCHES.map((chip) => (
            <Link
              key={chip}
              href={`/?q=${encodeURIComponent(chip)}`}
              className={`rounded-full px-3 py-1 text-xs ring-1 transition ${
                q?.toLowerCase() === chip
                  ? "bg-amber-950 text-amber-300 ring-amber-800"
                  : "bg-zinc-900 text-zinc-400 ring-zinc-800 hover:text-amber-400"
              }`}
            >
              {chip}
            </Link>
          ))}
        </div>
      </div>

      {q && counter && (
        <PartsCounterResults
          machine={counter.machine}
          trackParts={counter.trackParts}
          allParts={counter.allParts}
          options={counter.options}
          machineHeroUrl={counter.machineHeroUrl}
          alternateMatches={alternateMatches}
        />
      )}

      {q && !topMatch && (
        <p className="rounded-xl border border-zinc-800 px-4 py-8 text-center text-zinc-400">
          No machines matched &ldquo;{q}&rdquo;. Try svl75-2, bobcat t730, or CAT 299D3.
        </p>
      )}

      {!q && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/brands", label: "Brands", desc: "Track-finder v1 catalog" },
            { href: "/models", label: "Models", desc: "Active machines" },
            { href: "/track-sizes", label: "Track sizes", desc: "128 v2 spine" },
            { href: "/products", label: "Products", desc: "TNT + v2 linked SKUs" },
            { href: "/fitments", label: "Fitments", desc: "Machine ↔ product" },
            { href: "/enrichment", label: "Enrichment", desc: "Review tasks (suggestions)" },
            { href: "/qa", label: "Parts Q&A", desc: "Natural-language counter" },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-amber-800 hover:bg-zinc-900"
            >
              <p className="font-medium text-amber-400">{card.label}</p>
              <p className="mt-1 text-sm text-zinc-400">{card.desc}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
