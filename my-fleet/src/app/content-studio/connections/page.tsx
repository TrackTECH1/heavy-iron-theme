import Link from "next/link";
import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { PageHeader } from "@/components/ui";
import { getSocialConnection, getPublishLogs } from "@/lib/content-studio/queries";

export default async function SocialConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [connection, logs] = await Promise.all([getSocialConnection(), getPublishLogs(20)]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Social Connections"
        subtitle="Facebook Page + Instagram Business via Meta Graph API (tokens server-side only)"
      />
      <ContentStudioNav />

      {params.connected === "1" && (
        <p className="rounded-lg bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300 ring-1 ring-emerald-800">
          Meta account connected successfully.
        </p>
      )}
      {params.error && (
        <p className="rounded-lg bg-red-950/40 px-4 py-3 text-sm text-red-300 ring-1 ring-red-800">
          Connection error: {decodeURIComponent(params.error)}
        </p>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">Current connection</h2>
        {connection ? (
          <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            <div><dt className="text-zinc-500">Status</dt><dd>{connection.status}</dd></div>
            <div><dt className="text-zinc-500">Facebook Page</dt><dd>{connection.page_name} ({connection.page_id})</dd></div>
            <div><dt className="text-zinc-500">Instagram Business ID</dt><dd className="font-mono text-xs">{connection.instagram_business_account_id ?? "—"}</dd></div>
            <div><dt className="text-zinc-500">Token</dt><dd>{connection.has_token ? "Configured (not exposed)" : "Missing"}</dd></div>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">No OAuth connection yet. Connect via Meta or set server env vars.</p>
        )}

        <Link
          href="/api/social/connect"
          className="mt-6 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Connect Facebook Page
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase text-zinc-400">Recent publish log</h2>
        <ul className="space-y-2 text-sm">
          {logs.map((log) => (
            <li key={log.log_id as string} className="rounded-lg border border-zinc-800 px-3 py-2">
              <span className="font-mono text-xs text-zinc-500">{log.platform as string}</span>{" "}
              <span className={log.status === "succeeded" ? "text-emerald-400" : "text-red-400"}>
                {log.status as string}
              </span>
              {log.external_post_id && (
                <span className="ml-2 font-mono text-xs text-zinc-500">{log.external_post_id as string}</span>
              )}
              {log.error_message && <p className="text-xs text-red-400">{log.error_message as string}</p>}
            </li>
          ))}
          {logs.length === 0 && <li className="text-zinc-500">No publish attempts yet.</li>}
        </ul>
      </section>
    </div>
  );
}
