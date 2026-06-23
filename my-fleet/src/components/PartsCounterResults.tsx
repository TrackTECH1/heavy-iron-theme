"use client";

import type { QaIntent, QaPart } from "@/lib/qa-types";
import type { MachineTrackSizeOption } from "@/lib/track-size-options";
import type { PartsCounterMachine } from "@/lib/parts-counter-results";
import { MachineFitmentTabs } from "./MachineFitmentTabs";

export function PartsCounterResults({
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
  return (
    <MachineFitmentTabs
      machine={machine}
      trackParts={trackParts}
      allParts={allParts}
      options={options}
      intent={intent}
      alternateMatches={alternateMatches}
      machineHeroUrl={machineHeroUrl}
    />
  );
}
