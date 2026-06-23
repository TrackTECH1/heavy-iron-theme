"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/content-studio", label: "Overview" },
  { href: "/content-studio/generate", label: "Post Generator" },
  { href: "/content-studio/drafts", label: "Draft Library" },
  { href: "/content-studio/approval", label: "Approval Queue" },
  { href: "/content-studio/connections", label: "Social Connections" },
  { href: "/content-studio/export", label: "Export CSV" },
];

export function ContentStudioNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-8 flex flex-wrap gap-2 border-b border-zinc-800 pb-4">
      {LINKS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-700"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
