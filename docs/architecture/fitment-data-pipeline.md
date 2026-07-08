# Fitment data pipeline — architecture & hardening

Status: **Accepted** · Scope: Supabase ⇄ Shopify fitment sync, catalog search, theme read path

## Context

The store carries rubber tracks / undercarriage parts for heavy equipment. Each product
advertises **fitment** — which equipment make + model it fits. Two systems hold data:

- **Shopify** — the commerce system of record: products, variants, price, inventory, and the
  **published `custom.fitments`** metafield the theme renders.
- **Supabase** — the enrichment system of record: the make/model taxonomy, product↔model
  fitment relationships, embeddings for semantic search, and media pointers.

**Supabase is the source of truth for fitment** (confirmed with the owner: fitment is curated
in the data pipeline, not hand-edited in the Shopify admin). Fitment is therefore *projected*
Supabase → Shopify.

## The root cause behind the audit findings

Nearly every audit finding — across the edge functions, the scripts, and the theme — traced to
**one flaw**: the mapping between the two systems was *reconstructed by heuristics at runtime*
instead of stored as a fact, and data was *transformed at read time* instead of at write time.

Symptoms:

- `TREAD_TO_SHOPIFY` lookup tables + `title:*digits*` searches + "return `products[0]`"
  fallbacks *guessing* which Shopify product a Supabase row maps to.
- Fuzzy make matching (`"Cat"` → `"Caterpillar"` via `startsWith`/`includes`).
- `metafieldsSet` full-replace that silently drops any model that failed to resolve.
- Shopify throttling (HTTP `200` + top-level `errors`) treated as success → silent data loss.
- The theme dereferencing metaobjects in nested loops and cleaning labels with
  `capitalize` / `remove_first` on every page render (the `capitalize` brand-name bug, the
  O(N²) compatible-machines loop).

## The principle

> **Resolve once, in typed/testable code, at write time. Store the resolved result.
> Read it verbatim.**

The read path (theme, search) should be a *pure projection* over pre-resolved, render-ready
data. The write path (sync) is the *only* place that resolves references, and it must be
deterministic, idempotent, throttle-aware, and fail-closed.

## Target design

### 1. One source of truth per concern, joined by an explicit stored key
- Shopify owns commerce; Supabase owns the enrichment graph.
- The join is the **Shopify product GID stored on the Supabase row** (`product.shopify_product_id`),
  backfilled once and verified — never re-derived at runtime. Size/tread guessing is a
  backfill-time last resort, not a hot-path behavior, and must never write a low-confidence match.

### 2. Idempotent, fail-closed projection sync (`sync-product-fitments`)
- **Auth fails closed** for live writes: no `SYNC_API_KEY` configured ⇒ live sync refused.
- **Throttle-aware**: detect `429`/`5xx`/`THROTTLED` (200-with-`errors`) and retry with
  exponential backoff instead of dropping data.
- **All-or-nothing per product**: `metafieldsSet` replaces the whole list, so a product with
  any unresolved model is **deferred** (left intact on Shopify) rather than overwritten with a
  partial list. `allow_partial=true` opts out.
- **Deterministic reads**: ordered + paginated past PostgREST's row cap so the offset/limit
  window is stable and complete.
- **Honest audit log**: records products actually written, deferred, and errored.

### 3. Search read path never touches the Admin API
- `catalog-search` resolves handles from the stored maps; the Admin-API fan-out is a hardened
  fallback only. Target end state: sync precomputes and stores `shopify_handle` on the product
  row so search is a pure DB read (see roadmap).

### 4. Theme is a pure presentation layer
- Curated names render verbatim (casing fixed at the source, not via `capitalize`).
- Fitment JSON is embedded in `<script type="application/json">`, never a quoted attribute.
- Progressive enhancement: the fitment gate degrades to a purchasable form if its JS fails.

### 5. Ops with rails
- Destructive scripts: dry-run default, explicit confirmation, **backup before delete**, and
  **fail-closed prerequisites** (no "skip backfill but still delete").
- Secrets never echoed or passed as CLI args (use `--env-file`, chmod 600, shred on exit).

## What this PR changes

**Edge functions**
- `sync-product-fitments`: fail-closed auth for live writes; throttle/`errors`-aware retry with
  backoff; all-or-nothing per-product writes (`allow_partial` flag); ordered + paginated reads;
  accurate audit-log counts.
- `catalog-search`: throttle/`errors`-aware retry; stop leaking upstream/internal error detail
  to public callers.
- `setup-shopify-fitment-def`: throttle-aware retry; require `SYNC_API_KEY` when configured.

**Theme**
- `main-make-hub.liquid`, `track-finder.liquid`: stop `capitalize`-mangling curated brand names
  ("JCB", "New Holland", "ASV").
- `guaranteed-fit.liquid`: move fitment JSON into a `<script type="application/json">` tag
  (apostrophe-safe) and parse defensively.
- `fitment-selector.liquid` + `fitment-selector.js`: make the required-make gate progressive so a
  JS failure can't make track products un-purchasable.

**Scripts**
- `consolidate-fitment.sh`: fail-closed on missing `SUPABASE_SERVICE_ROLE_KEY`/`SYNC_API_KEY`;
  send the sync auth header; abort before the destructive clear on any sync failure; confirm
  before clearing (`FORCE=1` for CI).
- `clear-fits-equipment-models.py`: append each deleted legacy value to a JSONL backup first.
- `backfill-shopify-product-ids.py`: never write a low-confidence "search" match; paginate the
  pending fetch past the PostgREST cap; add request timeouts.
- `setup-supabase-shopify-secrets.sh`: stop echoing the token / passing it as a CLI arg; use a
  private `--env-file`; optionally seed `SYNC_API_KEY`.

**Precompute `shopify_handle` (roadmap #1 — code landed, needs rollout)**
- Migration `20260708000100_product_shopify_handle.sql`: nullable `product.shopify_handle` +
  partial index (additive; rollback documented in the file).
- `backfill-shopify-product-ids.py`: resolves the Shopify **handle** alongside the GID and writes
  both to Supabase.
- `catalog-search`: reads `product.shopify_handle` first (pure DB read); the Admin-API fan-out is
  now only a fallback for not-yet-backfilled rows and stops firing once the backfill has run.

  **Rollout** (owner runs against live infra — not done by this PR):
  1. Apply the migration to the `Source-of-truth` Supabase project.
  2. Dry-run then `SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/backfill-shopify-product-ids.py --apply`.
  3. Redeploy `catalog-search`.

## Roadmap (not in this PR)

These complete the target design and are worth follow-ups:

1. ~~**Precompute `shopify_handle`**~~ — code landed (see above); needs the rollout steps run.
2. ~~**Denormalized render-ready fitment blob**~~ — code landed (needs rollout). The sync now
   builds a grouped, label-cleaned blob from the `model.make`/`model.model`/`model_handle` text
   columns and writes it to `custom.fitments_display` (JSON) in the same `metafieldsSet` call as
   `custom.fitments`. `setup-shopify-fitment-def` registers the metafield definition.
   `fitment-data.liquid` reads the blob verbatim when present (fast path) and falls back to the
   live metaobject build otherwise — so nothing changes until a sync run populates it.
   **Rollout**: run `setup-shopify-fitment-def` (creates the definition) → run a live sync →
   the PDP grouped path (`guaranteed-fit`) renders from the blob with no metaobject dereferencing.
   *Follow-up*: extend the fast path to the `rows` output (`fitment-selector`) and to
   `compatible-machines.liquid` for the full PDP win.
3. **Event-driven sync**: Supabase DB webhook/trigger enqueues per-product jobs (replacing the
   blind offset-window scan that only ever covered products 0–100), with a **dead-letter table**
   for unresolved products surfaced/alerted instead of silently skipped.
4. **Explicit clear**: detect products whose fitments were removed in Supabase and set
   `custom.fitments = []` on Shopify (today a cleared product can't be cleared).
5. **Make alias table** to replace the fuzzy `startsWith`/`includes` make resolution.
6. **Content-hash idempotency** to skip unchanged products on re-runs.
7. **Reversible migrations** (down-migrations) and a single generator so
   `data/shopify-fitment-definition.json` can't drift from what the code provisions.
8. **CI**: Deno typecheck/lint for edge functions, a staging Supabase branch + Shopify dev store,
   and a smoke dry-run on deploy.
9. **Theme polish** carried from the audit — mostly landed: FAQ structured-data/on-page parity ✓,
   `aria-hidden` panel + Escape/focus ✓, spec-table row-header semantics ✓, bounded
   `hi-machine-jsonld` ItemList ✓, prefix-safe make-strip (the `remove_first` bug) ✓.
   **Still open — needs a Shopify preview + Google Rich Results Test to validate safely:**
   the dual `Product` JSON-LD node in `hi-product-jsonld.liquid` (a correct merge needs the exact
   `@id` Shopify's `structured_data` emits; changing it blind risks suppressing the primary product
   rich result), and the single-pass refactor of the `compatible-machines`/`fitment-data` loops
   (largely obsoleted by roadmap #2's blob once its fast path covers those consumers).

## Acceptance criteria (for the write path)

- A live sync with `SYNC_API_KEY` unset returns `403` and writes nothing.
- A throttled Shopify response is retried, not counted as a successful write.
- A product with an unresolved model is reported `deferred` and its Shopify fitments are unchanged.
- Re-running the same sync produces the same Shopify state (idempotent).
- `consolidate-fitment.sh` cannot reach the destructive clear if the sync errored.
