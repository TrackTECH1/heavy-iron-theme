"use client";

import type { QaAnswer } from "@/lib/qa-types";
import { GroupedTrackProducts } from "./GroupedTrackProducts";

export function QaTrackResults({ answer }: { answer: QaAnswer }) {
  return (
    <GroupedTrackProducts
      options={answer.machineTrackSizeOptions}
      trackParts={answer.trackParts}
    />
  );
}
