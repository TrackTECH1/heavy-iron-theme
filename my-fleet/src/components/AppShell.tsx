import Link from "next/link";

const NAV = [
  { href: "/", label: "Search" },
  { href: "/qa", label: "Parts Q&A" },
  { href: "/brands", label: "Brands" },
  { href: "/models", label: "Models" },
  { href: "/track-sizes", label: "Track Sizes" },
  { href: "/products", label: "Products" },
  { href: "/fitments", label: "Fitments" },
  { href: "/enrichment", label: "Enrichment" },
  { href: "/review", label: "Review Queue" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <Link href="/" className="text-lg font-semibold tracking-tight text-amber-400">
              My Fleet
            </Link>
            <p className="text-xs text-zinc-500">TrackTECH · v2 spine · media inheritance</p>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
