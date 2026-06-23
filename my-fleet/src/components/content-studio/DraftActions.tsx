"use client";

import { useState } from "react";
import type { ContentDraft } from "@/lib/content-studio/types";
import { StatusBadge } from "@/components/ui";

export function DraftActions({ draft }: { draft: ContentDraft }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draft.draft_id}/approve`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMsg("Approved");
      window.location.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish(platform: "facebook" | "instagram" | "both") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draft.draft_id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMsg(`Publish ${json.status}: ${JSON.stringify(json.results)}`);
      window.location.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {(draft.status === "draft" || draft.status === "pending_approval") && (
        <button
          type="button"
          disabled={busy}
          onClick={approve}
          className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Approve
        </button>
      )}
      {draft.status === "approved" && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => publish("facebook")}
            className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Publish FB
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => publish("instagram")}
            className="rounded bg-pink-700 px-2 py-1 text-xs text-white hover:bg-pink-600 disabled:opacity-50"
          >
            Publish IG
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => publish("both")}
            className="rounded bg-violet-700 px-2 py-1 text-xs text-white hover:bg-violet-600 disabled:opacity-50"
          >
            Publish both
          </button>
        </>
      )}
      <StatusBadge status={draft.status} />
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
