import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { DraftActions } from "@/components/content-studio/DraftActions";
import { DataTable, PageHeader } from "@/components/ui";
import { listDrafts } from "@/lib/content-studio/queries";

export default async function ApprovalQueuePage() {
  const drafts = await listDrafts(undefined, 200);
  const pending = drafts.filter((d) => d.status === "draft" || d.status === "pending_approval");
  const approved = drafts.filter((d) => d.status === "approved");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Approval Queue"
        subtitle="Review drafts before publishing — no auto-post without approval"
      />
      <ContentStudioNav />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-400">
          Awaiting approval ({pending.length})
        </h2>
        <DataTable
          headers={["Entity", "Caption", "Shopify URL", "Actions"]}
          rows={pending.map((d) => [
            `${d.entity_type}: ${d.entity_label ?? d.entity_id}`,
            <p key="c" className="max-w-lg text-sm">{d.caption}</p>,
            d.shopify_url ?? "—",
            <DraftActions key="a" draft={d} />,
          ])}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-400">
          Approved — ready to publish ({approved.length})
        </h2>
        <DataTable
          headers={["Entity", "Caption", "Actions"]}
          rows={approved.map((d) => [
            `${d.entity_type}: ${d.entity_label ?? d.entity_id}`,
            <p key="c" className="max-w-lg text-sm">{d.caption}</p>,
            <DraftActions key="a" draft={d} />,
          ])}
        />
      </section>
    </div>
  );
}
