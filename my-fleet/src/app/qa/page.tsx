import { QaAnswerPanel } from "@/components/QaAnswerPanel";
import { QaContextSync, QaSearchForm } from "@/components/QaSearchForm";
import { PageHeader } from "@/components/ui";
import { answerPartsQuestion } from "@/lib/qa-engine";

const EXAMPLES = [
  "What tracks fit John Deere 323E?",
  "What tread options are available for John Deere 323E?",
  "Tracks for Ditch Witch SK1550",
  "450x86x60 track options",
  "Do you carry undercarriage parts for John Deere 323E?",
  "Sprockets for it",
];

export default async function QaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ctx?: string }>;
}) {
  const { q, ctx } = await searchParams;
  const answer = q ? await answerPartsQuestion(q, ctx ?? null) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Parts Q&A"
        subtitle="Ask parts-counter questions — tracks, treads, undercarriage, sprockets, rollers, idlers"
      />

      <QaSearchForm defaultQuestion={q} defaultCtx={ctx} />

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <a
            key={ex}
            href={`/qa?q=${encodeURIComponent(ex)}${ctx ? `&ctx=${ctx}` : ""}`}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-400 ring-1 ring-zinc-800 hover:text-amber-400"
          >
            {ex}
          </a>
        ))}
      </div>

      {answer && (
        <>
          <QaContextSync machineId={answer.contextMachineId} />
          <QaAnswerPanel answer={answer} />
        </>
      )}

      {!q && (
        <p className="text-sm text-zinc-500">
          Try &ldquo;What tracks fit John Deere 323E?&rdquo; then ask follow-ups like
          &ldquo;Sprockets for it&rdquo; — context carries for 24 hours.
        </p>
      )}
    </div>
  );
}
