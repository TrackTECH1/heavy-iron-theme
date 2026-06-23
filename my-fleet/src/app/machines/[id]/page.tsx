import {
  getFitments,
  getMachine,
} from "@/lib/queries";
import { loadMachinePartsCounter } from "@/lib/machine-parts-counter";
import { MachineFitmentTabs } from "@/components/MachineFitmentTabs";
import {
  PageHeader,
  ReviewWarnings,
  StatusBadge,
  TrackSizeLink,
} from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachineReviewWarnings } from "@/lib/review-queues";

export default async function MachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const machine = await getMachine(id);
  if (!machine) notFound();

  const [{ total }, counter] = await Promise.all([
    getFitments({ machineId: id, page: 0 }),
    loadMachinePartsCounter(id),
  ]);

  const warnings = getMachineReviewWarnings(machine);
  if (!counter) notFound();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={`${machine.brand} ${machine.model}`}
          subtitle={`${machine.machine_id} · ${machine.machine_type}`}
        />
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={machine.machine_status} />
          <StatusBadge status={machine.validation_status} />
        </div>
      </div>

      <ReviewWarnings warnings={warnings} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs uppercase text-zinc-500">Brand</p>
          <Link href={`/models?brand=${machine.brand_id}`} className="font-medium text-amber-400">
            {machine.brand}
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs uppercase text-zinc-500">Machine type</p>
          <p className="font-medium">{machine.machine_type ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs uppercase text-zinc-500">Primary track size</p>
          {machine.track_size_id && machine.primary_track_size ? (
            <TrackSizeLink trackSizeId={machine.track_size_id} label={machine.primary_track_size} />
          ) : (
            "—"
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs uppercase text-zinc-500">Shopify page</p>
          {machine.shopify_url ? (
            <a href={machine.shopify_url} className="font-medium text-sky-400 hover:text-sky-300">
              {machine.shopify_handle ?? machine.shopify_url}
            </a>
          ) : (
            "—"
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <p className="text-xs uppercase text-zinc-500">Fitments</p>
          <Link href={`/fitments?machine=${id}`} className="font-medium text-amber-400">
            {total.toLocaleString()} linked
          </Link>
        </div>
      </section>

      <MachineFitmentTabs
        machine={counter.machine}
        trackParts={counter.trackParts}
        allParts={counter.allParts}
        options={counter.options}
        machineHeroUrl={counter.machineHeroUrl}
      />
    </div>
  );
}
