import { getEnrichmentTasks } from "@/lib/queries";
import { DataTable, PageHeader } from "@/components/ui";

export default async function EnrichmentPage() {
  const tasks = await getEnrichmentTasks(200);
  const byType = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.task_type] = (acc[t.task_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enrichment Queue"
        subtitle="Rule-based suggestions — approve before publish (no auto-guessing)"
      />

      <div className="flex flex-wrap gap-3">
        {Object.entries(byType).map(([type, count]) => (
          <span
            key={type}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-700"
          >
            {type}: {count}
          </span>
        ))}
      </div>

      <p className="text-sm text-zinc-400">
        Tasks are deterministic suggestions from <code className="text-zinc-300">fleet_enrichment_tasks</code>.
        Human approval required before any publish to Shopify.
      </p>

      <DataTable
        headers={["Task", "Entity", "Detail", "Suggested action"]}
        rows={tasks.map((t) => [
          <span key="type" className="font-mono text-xs text-amber-500">
            {t.task_type}
          </span>,
          <span key="label" className="text-sm">
            {t.entity_label}
            <span className="mt-0.5 block font-mono text-xs text-zinc-500">{t.entity_id}</span>
          </span>,
          t.detail,
          <span key="action" className="text-xs text-zinc-400">
            {t.suggested_action}
          </span>,
        ])}
      />
    </div>
  );
}
