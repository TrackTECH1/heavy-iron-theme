# Matrixify Model Publish Runbook

Export approved **My Fleet** machine data from clean dev Supabase into Matrixify-ready Shopify **Model** metaobject updates — then verify on a **preview theme** before any production publish.

## Scope

| Source (dev Supabase `zhdqdxtwipcowbtdyviq`) | Purpose |
|---|---|
| `fleet_machine_catalog` | `active_v1` machines only (excludes quarantine / reference / review) |
| `fleet_machine_track_size_options` | Approved track sizes; wide → standard → alternate → narrow |
| `fleet_qa_parts` | Track + UC product handles; v2 track sizes only |
| `fleet_model_hero` | Machine hero image URL when available |
| `fleet_track_size_media` | Track-size gallery URLs |
| `fleet_product_media` | Product image URLs tied to fitment SKUs |

**Never** auto-import to production. Dev store: `tracktech-530.myshopify.com`. Prod: `heavyironsupply.myshopify.com` — preview theme only until sign-off.

## Generate exports

```bash
cd heavy-iron-theme
python3 scripts/export-model-matrixify.py
# or
./scripts/fitment export-matrixify
```

Outputs in `data/model-publish/`:

1. **`model_metaobjects_matrixify.xlsx`** — Matrixify MERGE rows for Model metaobjects  
   Fields: `display_name`, `primary_track_size`, `hero_image`, `track_products`, `uc_products`
2. **`model_track_variants_matrixify.xlsx`** — Audit sheet: sort order (TNT first, wide before narrow, tread order)
3. **`model_media_matrixify.xlsx`** — Hero + track-size + product media URLs for QA
4. **`model-publish-contract-report.csv`** — Per-machine publish status / blockers

Legacy CSV + API manifest (optional, for programmatic apply):

```bash
./scripts/fitment export-models          # matrixify-model-publish.csv + shopify-api-manifest.json
./scripts/fitment apply-models --apply --handle john-deere-323e   # dev API apply (one model)
```

## Publish rules (contract)

- **Machines:** `machine_status = active_v1` via `fleet_machine_catalog`
- **Track sizes:** v2 canonical sizes only (`core.v_track_size_v2` + QA filter; drops rubbertrack / malformed sizes)
- **Product order on `track_products`:**
  1. Width: wide → standard → alternate → narrow (`fleet_machine_track_size_options.display_priority`)
  2. Tier: TNT → BS → TT
  3. Tread: C-Block → Zig-Zag → Multi-Bar → X-Terrain → …
- **Hero:** included when `fleet_model_hero` has a URL; omission does not block publish
- **Blocked:** no track and no UC product references (nothing to render)

## Matrixify import (dev store)

1. Shopify Admin → **Apps → Matrixify**
2. **Import → Metaobjects**
3. Upload **`model_metaobjects_matrixify.xlsx`** (or export sheet to CSV if preferred)
4. Type: **model**, Command: **MERGE**, match on **Handle**
5. Map columns:
   - `Field: hero_image` → file/URL field (confirm Matrixify accepts Supabase public URLs)
   - `Field: track_products [list.product_reference]` → comma-separated product handles
   - `Field: uc_products [list.product_reference]` → comma-separated product handles
6. Run import on **tracktech-530** only

Use **`model_track_variants_matrixify.xlsx`** and **`model_media_matrixify.xlsx`** for QA — they are not a separate Matrixify import unless you add variant/media metaobject types later.

## Theme verification (preview)

Model pages use **`templates/metaobject/model.json`** → section **`main-fitment`**.

Fields consumed:

| Metaobject field | Theme usage |
|---|---|
| `hero_image` | Hero banner (`main-fitment.liquid`, `main-machine-fitment.liquid`) |
| `primary_track_size` | Spec strip + track grouping label |
| `track_products` | Track product cards (fallback when `track_variants` empty) |
| `uc_products` | Undercarriage product grid |

**Preview checklist**

1. Push theme to dev store as unpublished preview theme
2. Open pilot models:
   - `/pages/fitment/john-deere-323e`
   - `/pages/fitment/kubota-svl75-2`
3. Confirm: hero image, primary track size, TNT/wide tracks listed first, UC section populated
4. Compare against `model-publish-contract-report.csv` row for same handle

**Machine hub template** (`main-machine-fitment.liquid`) also reads `track_products` when `track_variants` / legacy `track_product` are empty — same publish contract.

## Production

Do **not** Matrixify-import to `heavyironsupply.myshopify.com` until:

- Dev preview sign-off complete
- Hero URLs resolve on storefront CDN
- Product handles exist on production catalog (or import products first)

## Troubleshooting

| Symptom | Check |
|---|---|
| Empty track list | `fleet_qa_parts` v2 filter; SKU → handle in `data/shopify-canonical-handles.json` |
| Wrong track order | `model_track_variants_matrixify.xlsx` sort columns vs theme render |
| Missing hero | `fleet_model_hero` — optional; run media layer build if empty |
| Matrixify rejects hero URL | Upload hero to Shopify Files or use `sync-heroes` pipeline |

## Related docs

- `docs/MODEL_PUBLISH_PIPELINE.md` — CSV/API apply path
- `supabase/quality-audit/phase2/media_fleet_views.sql` — media view definitions
