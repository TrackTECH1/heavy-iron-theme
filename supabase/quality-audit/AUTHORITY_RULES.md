# My Fleet — Authority Rules

**Principle:** Each domain has one authoritative source. Downstream systems read views; they do not re-derive or guess.

---

## Authority matrix

| Domain | Authority | My Fleet view | Never use |
|--------|-----------|---------------|-----------|
| Machine navigation (type/brand/model) | Track-finder JSON → `core.model` (`active_v1`) | `fleet_machine_catalog` | Raw supplier model strings |
| Approved track sizes per machine | Track-finder → `core.machine_approved_track_size` | `fleet_machine_track_size_options` | Supplier fitment size inference |
| Track size spine (128) | TrackTech spec export → `core.track_size` + v2 filter | `fleet_track_size_spine` | Legacy 403-size spine, RUBBERTRACK IDs |
| Product ↔ size link | TrackTech `itemid` specs (SKU) | `fleet_products`, `fleet_qa_parts` | Title parsing, sales-quote aliases |
| SKU / price / inventory | Supplier catalog (`core.product`) | `fleet_products`, `fleet_qa_parts` | Track-finder (nav only) |
| Fitment rows | `core.fitment` (supplier + inferred) | `fleet_qa_parts`, `fleet_fitment_godlist` | Ad-hoc joins in UI |
| Machine status | `classify-machine-status.py` + track-finder promotion | `fleet_machine_catalog` filter | Unfiltered godlist (default UI) |
| Wide / narrow labels | Track-finder approved options | `option_label` on size options | Width sort from QA rows |
| Track-size images | `core.track_size_media` (imported galleries) | `fleet_track_size_media` | `product_url`, random CDN guess |
| Product images | `core.product_media` → fallback track-size | Resolved in app media layer | MWE dealer page URL |
| Machine hero | `core.model_media` | `fleet_model_hero` | Shopify URL on model row alone |
| Publish to Shopify | Approved publish queue (future) | N/A in read-only My Fleet | Direct write from viewer |

---

## Auto-normalization (deterministic, not AI)

| Input pattern | Rule | Output |
|---------------|------|--------|
| Brand `CAT`, `Cat` | Alias map | `Caterpillar` |
| Size `400-86-52B` | Spec normalizer | `400x86Bx52` |
| Size `400X86X52` | Lowercase + x | `400x86x52` |
| `Bx` vs `x` pitch suffix | Preserve when in v2 spine | Match via normalized key for grouping only |

Implementation: `scripts/lib/track_size_from_specs.py`, `scripts/lib/machine_status.py`, `my-fleet/src/lib/track-size-normalize.ts`

---

## Auto-linking rules

1. **Product → track_size_id:** Only when TrackTech export has complete `spec_width_mm`, `spec_pitch`, `spec_links` for that `itemid` (SKU).
2. **Machine → approved sizes:** Only from track-finder import; no auto-add from fitment.
3. **Image → track_size_id:** Parse handle/URL path for canonical size; match against `core.v_track_size_v2` via variant lookup (`catalog_ssot.track_size_image_variants`).
4. **Image → product_id:** Match `itemid` / SKU in filename or catalog row.
5. **Image → machine_id:** Match `shopify_handle` or `{brand}-{model}` slug from hero manifest.

If match confidence is not exact → `core.media_review_queue` (status `pending`).

---

## Auto-enrichment (suggestions only)

My Fleet `fleet_enrichment_tasks` detects:

| Task type | Condition | Suggested action |
|-----------|-----------|------------------|
| `missing_machine_spec` | Null horsepower/weight/GPM on `active_v1` model | Import from spec sheet |
| `missing_machine_hero` | No `model_media` row | Map from hero manifest / Shopify metaobject |
| `missing_track_size_image` | Approved size has zero `track_size_media` | Import from HI master CSV |
| `product_missing_track_size` | TNT track SKU with null `track_size_id` | Re-run spec repoint |
| `machine_missing_tnt_tracks` | `active_v1` machine, zero TNT track rows in `fleet_qa_parts` | Review fitment import |
| `track_size_conflict` | Product links to size not in machine approved options | Review queue |
| `unapproved_size_exposure` | Fitment size ∉ approved options | Hide by default; flag for review |

**All tasks are read-only in My Fleet.** Approval happens outside the viewer (SQL/script), then publish queue pushes to Shopify.

---

## TNT prioritization

In parts counter and Q&A:

1. **Primary tier:** `TNT*` + in stock preferred
2. **Secondary tier:** `BS*`, legacy `TT*` — hidden unless checkbox enabled
3. **OEM reference:** Part number extracted, no SKU — quote required

Rank function: `my-fleet/src/lib/fitment-utils.ts` → `rankPart()`

---

## Publish gate (future)

Data reaches Shopify only when:

- [ ] `machine_status = 'active_v1'`
- [ ] Product has v2 `track_size_id`
- [ ] Fitment approved OR supplier confidence = `supplier`
- [ ] Images resolved (product or inherited track-size)
- [ ] No open `quarantine` or conflicting enrichment task

My Fleet does **not** publish — it surfaces gaps via enrichment tasks.

---

## Dev vs production

| Environment | Project ref | My Fleet reads |
|-------------|-------------|----------------|
| Dev | `zhdqdxtwipcowbtdyviq` | Yes — enforced in `supabase.ts` |
| Production | `tcykyktvdlsbscrsbjyt` | No — import/audit scripts only |

Media URLs may point at production storage until dev bucket sync; entity FKs always use dev `core.*` IDs.
