import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { DraftActions } from "@/components/content-studio/DraftActions";
import { DataTable, PageHeader } from "@/components/ui";
import { listDrafts } from "@/lib/content-studio/queries";

export default async function DraftLibraryPage() {
  const drafts = await listDrafts(undefined, 200);

  return (
    <div>
      <PageHeader title="Draft Library" subtitle="All saved posts — edit via regenerate or API" />
      <ContentStudioNav />
      <DataTable
        headers={["Entity", "Caption", "Image", "Status", "Actions"]}
        rows={drafts.map((d) => [
          <div key="e">
            <span className="font-mono text-xs text-amber-500">{d.entity_type}</span>
            <p className="text-sm">{d.entity_label ?? d.entity_id}</p>
          </div>,
          <p key="c" className="max-w-md truncate text-sm">{d.caption}</p>,
          d.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key="i" src={d.image_url} alt="" className="h-12 w-20 rounded object-cover" />
          ) : (
            "—"
          ),
          d.status,
          <DraftActions key="a" draft={d} />,
        ])}
      />
    </div>
  );
}
