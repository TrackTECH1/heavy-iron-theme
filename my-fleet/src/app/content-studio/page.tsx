import Link from "next/link";
import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { PageHeader } from "@/components/ui";
import { listDrafts, getSocialConnection } from "@/lib/content-studio/queries";

export default async function ContentStudioPage() {
  const [drafts, connection] = await Promise.all([
    listDrafts(undefined, 500),
    getSocialConnection(),
  ]);

  const counts = drafts.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Content Studio"
        subtitle="Generate social posts from approved My Fleet data. Publish only after human approval."
      />
      <ContentStudioNav />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase text-zinc-500">Drafts</p>
          <p className="mt-1 text-2xl font-semibold">{drafts.length}</p>
          <p className="mt-2 text-xs text-zinc-400">
            {counts.approved ?? 0} approved · {counts.published ?? 0} published
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase text-zinc-500">Meta connection</p>
          <p className="mt-1 text-lg font-medium text-zinc-100">
            {connection?.status === "connected" ? connection.page_name : "Not connected"}
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            {connection?.has_token ? "Token configured (server-side)" : "Connect or set env vars"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs uppercase text-zinc-500">Quick start</p>
          <Link href="/content-studio/generate" className="mt-2 block text-sm text-amber-400 hover:text-amber-300">
            Generate a post →
          </Link>
        </div>
      </div>

      <p className="mt-8 text-sm text-zinc-500">
        Unapproved drafts are never auto-posted. Approval is required before Facebook Page or Instagram publishing.
      </p>
    </div>
  );
}
