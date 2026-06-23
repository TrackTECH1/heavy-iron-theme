"use client";

import { useState } from "react";
import type { EntityType, GeneratePostResult } from "@/lib/content-studio/types";

export function PostGeneratorClient() {
  const [entityType, setEntityType] = useState<EntityType>("machine");
  const [entityId, setEntityId] = useState("");
  const [generated, setGenerated] = useState<GeneratePostResult | null>(null);
  const [caption, setCaption] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [shopifyUrl, setShopifyUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/content/drafts?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generate failed");
      const g = json as GeneratePostResult;
      setGenerated(g);
      setCaption(g.caption);
      setHeadline(g.headline);
      setBody(g.body);
      setShopifyUrl(g.shopify_url);
      setImageUrl(g.suggested_image_url ?? "");
      setMediaId(g.image_options.find((o) => o.url === g.suggested_image_url)?.media_id ?? null);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    if (!generated) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/content/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: generated.entity_type,
          entity_id: generated.entity_id,
          entity_label: generated.entity_label,
          headline,
          body,
          caption,
          shopify_url: shopifyUrl,
          image_url: imageUrl,
          media_id: mediaId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setMessage(`Draft saved: ${json.draft_id}`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pickImage(url: string, id: string | null) {
    setImageUrl(url);
    setMediaId(id);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleGenerate} className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 md:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400">Entity type</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as EntityType)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
          >
            <option value="machine">Machine</option>
            <option value="track_size">Track size</option>
            <option value="product">Product / SKU</option>
          </select>
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="mb-1 block text-zinc-400">Entity ID</span>
          <input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="mdl_john_deere_323e · ts_320x86bx52 · TNT3208652HDBL"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm"
            required
          />
        </label>
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            Generate from fleet data
          </button>
        </div>
      </form>

      {generated && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">Headline</span>
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">Body</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">Caption (social)</span>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">Shopify URL</span>
              <input value={shopifyUrl} onChange={(e) => setShopifyUrl(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
            </label>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={busy || !imageUrl}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Save draft (not published)
            </button>
          </div>

          <div>
            <p className="mb-3 text-sm text-zinc-400">Approved media library — pick image</p>
            <div className="grid grid-cols-2 gap-3">
              {generated.image_options.map((opt) => (
                <button
                  key={opt.url}
                  type="button"
                  onClick={() => pickImage(opt.url, opt.media_id)}
                  className={`overflow-hidden rounded-lg border text-left transition ${
                    imageUrl === opt.url ? "border-amber-500 ring-2 ring-amber-500/40" : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={opt.url} alt={opt.label} className="aspect-video w-full object-cover bg-zinc-900" />
                  <span className="block px-2 py-1 text-xs text-zinc-400">{opt.label}</span>
                </button>
              ))}
            </div>
            {generated.image_options.length === 0 && (
              <p className="text-sm text-amber-400">No images in media library for this entity.</p>
            )}
          </div>
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.startsWith("Draft saved") ? "text-emerald-400" : "text-red-400"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
