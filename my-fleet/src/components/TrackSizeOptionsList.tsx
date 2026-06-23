import type { MachineTrackSizeOption } from "@/lib/track-size-options";

const LABEL_STYLES: Record<string, string> = {
  wide: "bg-amber-950 text-amber-300",
  narrow: "bg-sky-950 text-sky-300",
  standard: "bg-emerald-950 text-emerald-300",
  alternate: "bg-zinc-800 text-zinc-400",
};

export function TrackSizeOptionsList({
  options,
  title = "Approved track sizes",
}: {
  options: MachineTrackSizeOption[];
  title?: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      <ul className="space-y-2">
        {options.map((o) => (
          <li
            key={`${o.machine_id}-${o.canonical_size}`}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${
                LABEL_STYLES[o.option_label] ?? LABEL_STYLES.alternate
              }`}
            >
              {o.option_label}
            </span>
            <span className="font-mono text-zinc-100">{o.canonical_size}</span>
            {o.is_default_recommended && (
              <span className="text-xs text-emerald-500">recommended first</span>
            )}
            <span className="text-xs text-zinc-600">({o.source})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
