"use client";

import { useMemo, useState } from "react";
import type { QaPart } from "@/lib/qa-types";
import type { MachineTrackSizeOption } from "@/lib/track-size-options";
import { buildTrackGroups } from "@/lib/track-grouping";
import { SkuLink } from "./ui";
import { TrackSizeOptionsList } from "./TrackSizeOptionsList";

function fmtPrice(n: number | null) {
  if (n == null) return "—";
  return `$${n.toLocaleString()}`;
}

function PartsTable({ parts }: { parts: QaPart[] }) {
  if (parts.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
          <tr>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Part</th>
            <th className="px-4 py-3">Track size</th>
            <th className="px-4 py-3">Tread</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Qty</th>
            <th className="px-4 py-3">Supplier</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {parts.map((p) => (
            <tr key={p.sku} className="hover:bg-zinc-900/50">
              <td className="px-4 py-3">
                <SkuLink sku={p.sku} />
              </td>
              <td className="max-w-xs px-4 py-3 text-xs text-zinc-400">{p.title ?? p.partType}</td>
              <td className="px-4 py-3 font-mono text-xs">{p.trackSize ?? "—"}</td>
              <td className="px-4 py-3 text-xs">{p.treadLabel ?? "—"}</td>
              <td className="px-4 py-3">{fmtPrice(p.price)}</td>
              <td className="px-4 py-3">
                <span className={(p.qtyAvailable ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}>
                  {p.qtyAvailable ?? "—"}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-zinc-500">{p.supplier ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupedTrackProducts({
  options,
  trackParts,
  optionsTitle,
}: {
  options: MachineTrackSizeOption[];
  trackParts: QaPart[];
  optionsTitle?: string;
}) {
  const [showSecondary, setShowSecondary] = useState(false);
  const [showUnapproved, setShowUnapproved] = useState(false);

  const groups = useMemo(
    () =>
      buildTrackGroups(trackParts, options, {
        includeSecondary: showSecondary,
        includeUnapproved: showUnapproved,
      }),
    [trackParts, options, showSecondary, showUnapproved],
  );

  if (options.length === 0 && groups.length === 0) return null;

  return (
    <section className="space-y-6">
      <TrackSizeOptionsList options={options} title={optionsTitle} />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={showSecondary}
            onChange={(e) => setShowSecondary(e.target.checked)}
            className="rounded border-zinc-600"
          />
          Show Bridgestone (BS) &amp; legacy Shopify (TT)
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={showUnapproved}
            onChange={(e) => setShowUnapproved(e.target.checked)}
            className="rounded border-zinc-600"
          />
          Show unapproved / review sizes
        </label>
      </div>

      {groups.map((group) => (
        <div key={group.name}>
          <h2 className="mb-1 text-lg font-medium">
            {group.name}
            {group.trackSizeLabel && (
              <span className="ml-2 font-mono text-sm font-normal text-amber-400">
                {group.trackSizeLabel}
              </span>
            )}
            <span className="ml-2 text-sm font-normal text-zinc-500">({group.parts.length})</span>
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            {group.name === "Wide Tracks" && "TNT wide-option SKUs shown first by default."}
            {group.name === "Alternate Tracks" && "Approved mid-width option (e.g. 380 after 400)."}
            {group.name === "Narrow Tracks" && "OEM primary / narrow approved size."}
            {group.name === "Other / Review" && "Unapproved sizes, legacy SKUs, or review items."}
          </p>
          <PartsTable parts={group.parts} />
        </div>
      ))}
    </section>
  );
}
