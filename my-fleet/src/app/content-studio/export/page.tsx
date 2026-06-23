import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { PageHeader } from "@/components/ui";
import { listDrafts } from "@/lib/content-studio/queries";

export default async function ExportPage() {
  const drafts = await listDrafts(undefined, 5000);

  return (
    <div>
      <PageHeader title="Export CSV" subtitle="Download all content drafts for review or external tooling" />
      <ContentStudioNav />
      <p className="mb-4 text-sm text-zinc-400">{drafts.length} drafts available for export.</p>
      <a
        href="/api/content/export"
        className="inline-block rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
      >
        Download content-drafts-export.csv
      </a>
    </div>
  );
}
