"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { QaIntent, QaPart } from "@/lib/qa-types";
import type { MachineTrackSizeOption } from "@/lib/track-size-options";
import type { PartsCounterMachine, PartsCounterTrackGroup } from "@/lib/parts-counter-results";
import {
  FITMENT_TABS,
  buildCategoryTabRows,
  buildOemRefsTab,
  buildTracksTab,
  type FitmentTabId,
  type FitmentProductRow,
} from "@/lib/machine-fitment-tabs";
import { SkuLink } from "./ui";

function fmtPrice(n: number | null) {
  if (n == null) return "Quote";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function intentToDefaultTab(intent: QaIntent): FitmentTabId {
  if (intent === "sprockets") return "sprockets";
  if (intent === "idlers") return "front-idlers";
  if (intent === "rollers") return "rollers";
  if (intent === "attachments") return "attachments";
  if (intent === "tracks" || intent === "tread_options") return "tracks";
  return "tracks";
}

function TrackGroupCard({ group }: { group: PartsCounterTrackGroup }) {
  const heroUrl = group.imageUrl ?? group.variants.find((v) => v.imageUrl)?.imageUrl ?? null;
  return (
    <div className="border-b border-zinc-200 last:border-b-0">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-400">
          {heroUrl ? (
            <Image src={heroUrl} alt="" fill className="object-cover" unoptimized />
          ) : (
            "▬"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-900">
              {group.title}
            </h3>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {group.variants.length} variant{group.variants.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-zinc-100">
            {group.variants.map((v) => (
              <li key={v.sku} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800">{v.detailLine}</p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500">
                    <SkuLink sku={v.sku} />
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-zinc-900">{fmtPrice(v.price)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProductRow({ row }: { row: FitmentProductRow }) {
  if (row.status === "oem_reference_only") {
    return (
      <div className="flex items-center gap-4 border-b border-zinc-200 px-5 py-4 last:border-b-0">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-400">
          OEM
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-900">
            {row.oemNumber ? `OEM ${row.oemNumber}` : row.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">OEM reference only / quote required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 border-b border-zinc-200 px-5 py-4 last:border-b-0">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100">
        {row.imageUrl ? (
          <Image src={row.imageUrl} alt="" fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">—</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900">{row.title}</p>
        <dl className="mt-2 grid gap-1 text-xs text-zinc-600 sm:grid-cols-2">
          <div>
            <span className="text-zinc-400">SKU </span>
            <SkuLink sku={row.sku!} />
          </div>
          {row.oemNumber && (
            <div>
              <span className="text-zinc-400">OEM </span>
              <span className="font-mono">{row.oemNumber}</span>
            </div>
          )}
          <div>
            <span className="text-zinc-400">Supplier </span>
            {row.supplier ?? "—"}
          </div>
          <div>
            <span className="text-zinc-400">Qty </span>
            <span className={(row.qtyAvailable ?? 0) > 0 ? "text-emerald-700" : "text-red-600"}>
              {row.qtyAvailable ?? "—"}
            </span>
          </div>
        </dl>
      </div>
      <p className="shrink-0 text-sm font-bold text-zinc-900">{fmtPrice(row.price)}</p>
    </div>
  );
}

function OemRefsPanel({
  machine,
  specs,
  allParts,
}: {
  machine: PartsCounterMachine;
  specs: Parameters<typeof buildOemRefsTab>[1];
  allParts: QaPart[];
}) {
  const { specs: specRows, refs } = useMemo(
    () => buildOemRefsTab(machine, specs, allParts),
    [machine, specs, allParts],
  );

  return (
    <div className="divide-y divide-zinc-200">
      {specRows.length > 0 && (
        <div className="px-5 py-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
            Machine specs
          </h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            {specRows.map((s) => (
              <div
                key={s.label}
                className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm"
              >
                <dt className="text-zinc-500">{s.label}</dt>
                <dd className="font-medium text-zinc-900">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="px-5 py-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
          OEM reference parts
        </h3>
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-100 text-xs font-bold uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-4 py-2.5">Component</th>
                <th className="px-4 py-2.5">OEM P/N</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              {refs.map((ref) => (
                <tr key={ref.label}>
                  <td className="px-4 py-3 font-medium text-zinc-900">{ref.label}</td>
                  <td className="px-4 py-3 font-mono text-zinc-700">{ref.oemNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {ref.status === "carried" && ref.linkedSku && (
                      <span className="text-emerald-700">
                        In catalog · <SkuLink sku={ref.linkedSku} />
                      </span>
                    )}
                    {ref.status === "reference_only" && (
                      <span className="text-amber-800">OEM reference only / quote required</span>
                    )}
                    {ref.status === "none" && (
                      <span className="text-zinc-400">No confirmed fitment yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900">
                    {ref.status === "carried" ? fmtPrice(ref.price) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="px-5 py-12 text-center text-sm text-zinc-500">{message}</div>
  );
}

export function MachineFitmentTabs({
  machine,
  trackParts,
  allParts,
  options,
  intent = "general",
  alternateMatches,
  machineHeroUrl = null,
}: {
  machine: PartsCounterMachine;
  trackParts: QaPart[];
  allParts: QaPart[];
  options: MachineTrackSizeOption[];
  intent?: QaIntent;
  alternateMatches?: { machine_id: string; brand: string; model: string }[];
  machineHeroUrl?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<FitmentTabId>(intentToDefaultTab(intent));
  const [showSecondary, setShowSecondary] = useState(false);
  const [showUnapproved, setShowUnapproved] = useState(false);

  const specs = useMemo(
    () => ({
      machine_type: machine.machine_type,
      primary_track_size: machine.primary_track_size,
      horsepower: machine.horsepower ?? null,
      operating_weight_lbs: machine.operating_weight_lbs ?? null,
      std_gpm: machine.std_gpm ?? null,
      std_psi: machine.std_psi ?? null,
      lift_type: machine.lift_type ?? null,
      mount_type: machine.mount_type ?? null,
    }),
    [machine],
  );

  const trackGroups = useMemo(
    () =>
      buildTracksTab(machine, trackParts, allParts, options, showSecondary, showUnapproved),
    [machine, trackParts, allParts, options, showSecondary, showUnapproved],
  );

  const categoryRows = useMemo(() => {
    if (activeTab === "tracks" || activeTab === "oem-refs") return [];
    return buildCategoryTabRows(activeTab, allParts, showSecondary);
  }, [activeTab, allParts, showSecondary]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
            {machineHeroUrl ? (
              <Image
                src={machineHeroUrl}
                alt={`${machine.brand} ${machine.model}`}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                No hero
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Machine match</p>
        <p className="mt-1 text-2xl font-bold uppercase tracking-tight text-white">
          <Link href={`/machines/${machine.machine_id}`} className="hover:text-amber-400">
            {machine.brand} {machine.model}
          </Link>
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {machine.machine_type ?? "Machine"}
          {machine.primary_track_size ? ` · OEM track ${machine.primary_track_size}` : ""}
        </p>
        {alternateMatches && alternateMatches.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Also matched:{" "}
            {alternateMatches.map((m, i) => (
              <span key={m.machine_id}>
                {i > 0 ? ", " : ""}
                <Link
                  href={`/?q=${encodeURIComponent(`${m.brand} ${m.model}`)}`}
                  className="text-amber-500 hover:text-amber-400"
                >
                  {m.brand} {m.model}
                </Link>
              </span>
            ))}
          </p>
        )}
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50 shadow-sm">
        <div className="flex flex-wrap gap-0 border-b border-zinc-300 bg-white px-2 pt-2">
          {FITMENT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wide transition ${
                activeTab === tab.id
                  ? "border-red-600 text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "tracks" && (
          <div className="flex flex-wrap items-center gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={showSecondary}
                onChange={(e) => setShowSecondary(e.target.checked)}
                className="rounded border-zinc-400"
              />
              Show BS &amp; legacy TT
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={showUnapproved}
                onChange={(e) => setShowUnapproved(e.target.checked)}
                className="rounded border-zinc-400"
              />
              Show unapproved sizes
            </label>
          </div>
        )}

        {activeTab !== "tracks" && activeTab !== "oem-refs" && (
          <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={showSecondary}
                onChange={(e) => setShowSecondary(e.target.checked)}
                className="rounded border-zinc-400"
              />
              Show Bridgestone (BS) &amp; legacy Shopify (TT)
            </label>
          </div>
        )}

        <div className="bg-white">
          {activeTab === "tracks" &&
            (trackGroups.length === 0 ? (
              <EmptyTab message="No confirmed track fitment yet. Try enabling secondary SKUs or unapproved sizes." />
            ) : (
              trackGroups.map((group) => (
                <TrackGroupCard key={`${group.trackSize}-${group.widthLabel}`} group={group} />
              ))
            ))}

          {activeTab !== "tracks" &&
            activeTab !== "oem-refs" &&
            (categoryRows.length === 0 ? (
              <EmptyTab message="No confirmed fitment yet." />
            ) : (
              categoryRows.map((row) => (
                <ProductRow key={`${row.sku ?? row.oemNumber}-${row.title}`} row={row} />
              ))
            ))}

          {activeTab === "oem-refs" && (
            <OemRefsPanel machine={machine} specs={specs} allParts={allParts} />
          )}
        </div>

        <div className="border-t border-zinc-300 bg-zinc-100 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-700">
            Can&apos;t find it? Call{" "}
            <a href="tel:+18508167898" className="text-red-700 hover:underline">
              (850) 816-7898
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
