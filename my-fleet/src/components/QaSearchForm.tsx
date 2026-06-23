"use client";

import { useCallback, useEffect, useState } from "react";

const COOKIE = "fleet_qa_ctx";

export function useQaContext() {
  const [ctx, setCtx] = useState<string | null>(null);

  useEffect(() => {
    const match = document.cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
    setCtx(match?.[1] ?? null);
  }, []);

  const saveContext = useCallback((machineId: string) => {
    document.cookie = `${COOKIE}=${machineId};path=/;max-age=86400;SameSite=Lax`;
    setCtx(machineId);
  }, []);

  const clearContext = useCallback(() => {
    document.cookie = `${COOKIE}=;path=/;max-age=0`;
    setCtx(null);
  }, []);

  return { ctx, saveContext, clearContext };
}

export function QaSearchForm({
  defaultQuestion = "",
  defaultCtx = "",
}: {
  defaultQuestion?: string;
  defaultCtx?: string;
}) {
  const { ctx } = useQaContext();
  const contextId = defaultCtx || ctx || "";

  return (
    <form action="/qa" method="get" className="space-y-3">
      <textarea
        name="q"
        defaultValue={defaultQuestion}
        rows={3}
        placeholder="What tracks fit John Deere 323E?"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      />
      {contextId && <input type="hidden" name="ctx" value={contextId} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-5 py-2.5 font-medium text-zinc-950 hover:bg-amber-400"
        >
          Ask
        </button>
        {contextId && (
          <p className="self-center text-xs text-zinc-500">
            Context: <span className="font-mono text-amber-500">{contextId}</span> — &ldquo;for
            it&rdquo; questions will use this machine
          </p>
        )}
      </div>
    </form>
  );
}

export function QaContextSync({ machineId }: { machineId: string | null }) {
  const { saveContext } = useQaContext();

  useEffect(() => {
    if (machineId) saveContext(machineId);
  }, [machineId, saveContext]);

  return null;
}
