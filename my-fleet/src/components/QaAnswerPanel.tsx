import Link from "next/link";
import type { QaAnswer } from "@/lib/qa-types";
import { PartsCounterResults } from "./PartsCounterResults";
import { ReviewWarnings } from "./ui";

function FollowUpLink({
  q,
  ctx,
  label,
}: {
  q: string;
  ctx: string | null;
  label: string;
}) {
  const params = new URLSearchParams({ q });
  if (ctx) params.set("ctx", ctx);
  return (
    <Link
      href={`/qa?${params.toString()}`}
      className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-700 hover:text-amber-400"
    >
      {label}
    </Link>
  );
}

export function QaAnswerPanel({ answer }: { answer: QaAnswer }) {
  const ctx = answer.contextMachineId;
  const reviewWarnings = answer.warnings.map((w) => ({
    queue: "qa",
    summary: w,
  }));

  const nonTrackParts = answer.categories.flatMap((c) => c.parts);
  const showPartsCounter = answer.machine != null;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Question</p>
        <p className="mt-1 text-lg text-zinc-100">&ldquo;{answer.question}&rdquo;</p>
        <p className="mt-2 text-sm text-amber-400">{answer.intentLabel}</p>
      </section>

      {answer.trackSize && !answer.machine && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Track size
          </h2>
          <p className="mt-2 font-mono text-xl text-amber-400">
            {answer.trackSize.canonical_size}
          </p>
        </section>
      )}

      <ReviewWarnings warnings={reviewWarnings} />

      {showPartsCounter && answer.machine && (
        <>
          <PartsCounterResults
            machine={{
              machine_id: answer.machine.machine_id,
              brand: answer.machine.brand,
              model: answer.machine.model,
              machine_type: answer.machine.machine_type,
              primary_track_size: answer.machine.primary_track_size,
              horsepower: answer.machine.horsepower,
              operating_weight_lbs: answer.machine.operating_weight_lbs,
              std_gpm: answer.machine.std_gpm,
              std_psi: answer.machine.std_psi,
              lift_type: answer.machine.lift_type,
              mount_type: answer.machine.mount_type,
            }}
            trackParts={answer.trackParts}
            allParts={[...answer.trackParts, ...nonTrackParts]}
            options={answer.machineTrackSizeOptions}
            intent={answer.intent}
          />

          {ctx && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
              <span className="self-center text-xs text-zinc-500">Follow-ups:</span>
              <FollowUpLink
                q="What tread options are available for it?"
                ctx={ctx}
                label="Tread options"
              />
              <FollowUpLink
                q="Do you carry undercarriage parts for it?"
                ctx={ctx}
                label="Undercarriage"
              />
              <FollowUpLink q="Sprockets for it" ctx={ctx} label="Sprockets" />
              <FollowUpLink q="Rollers for it" ctx={ctx} label="Rollers" />
              <FollowUpLink q="Idlers for it" ctx={ctx} label="Idlers" />
            </div>
          )}
        </>
      )}

      {!showPartsCounter &&
        answer.categories.length === 0 &&
        answer.warnings.length > 0 && (
          <p className="text-zinc-400">No parts found for this question.</p>
        )}

      {!showPartsCounter && answer.categories.length > 0 && (
        <p className="text-sm text-zinc-500">
          Search a machine (e.g. &ldquo;bobcat t730&rdquo;) for grouped parts-counter results.
        </p>
      )}

      {answer.sources.length > 0 && (
        <section className="border-t border-zinc-800 pt-6">
          <p className="text-xs uppercase tracking-wide text-zinc-600">Data sources</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{answer.sources.join(" · ")}</p>
        </section>
      )}
    </div>
  );
}
