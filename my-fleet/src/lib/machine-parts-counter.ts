import {
  dedupeParts,
  filterByIntent,
  rowToPart,
} from "@/lib/qa-categories";
import {
  getMachine,
  getMachineQaParts,
  getMachineTrackSizeOptions,
  loadMediaContext,
} from "@/lib/queries";
import { applyMediaToParts } from "@/lib/media-resolver";
import type { FleetMachine } from "@/lib/types";
import { finalizeMachineTrackSizeOptions } from "@/lib/track-size-options";
import { normalizeTrackSizeKey } from "@/lib/track-size-normalize";
import { buildPartsCounterView, type PartsCounterView } from "@/lib/parts-counter-results";
import type { QaIntent, QaPart } from "@/lib/qa-types";
import type { MachineTrackSizeOption } from "@/lib/track-size-options";

function toCounterMachine(machine: FleetMachine) {
  return {
    machine_id: machine.machine_id,
    brand: machine.brand,
    model: machine.model,
    machine_type: machine.machine_type,
    primary_track_size: machine.primary_track_size,
  };
}

export async function loadMachinePartsCounter(
  machineId: string,
  intent: QaIntent = "general",
): Promise<
  | (PartsCounterView & {
      allParts: QaPart[];
      trackParts: QaPart[];
      options: MachineTrackSizeOption[];
    })
  | null
> {
  const machine = await getMachine(machineId);
  if (!machine) return null;

  const [qaRows, dbOptions] = await Promise.all([
    getMachineQaParts(machineId),
    getMachineTrackSizeOptions(machineId),
  ]);

  const rows = dedupeParts(qaRows);
  const machineTrackSizeOptions = finalizeMachineTrackSizeOptions(dbOptions);

  const trackSizeIds = [
    ...new Set(dbOptions.map((o) => o.track_size_id).filter(Boolean) as string[]),
  ];
  const skus = rows.map((r) => r.sku);
  const media = await loadMediaContext(machineId, trackSizeIds, skus);

  const filtered = filterByIntent(rows, intent);
  let allParts = filtered.map((r) => rowToPart(r, machine.primary_track_size));
  allParts = applyMediaToParts(
    allParts,
    media,
    new Map(
      dbOptions
        .filter((o) => o.track_size_id)
        .map((o) => [normalizeTrackSizeKey(o.canonical_size), o.track_size_id!]),
    ),
  );
  const trackParts = allParts.filter((p) => p.category === "Rubber Tracks");

  return {
    ...buildPartsCounterView(
      toCounterMachine(machine),
      trackParts,
      allParts,
      machineTrackSizeOptions,
      { intent, media, machineHeroUrl: media.machineHeroUrl },
    ),
    allParts,
    trackParts,
    options: machineTrackSizeOptions,
  };
}
