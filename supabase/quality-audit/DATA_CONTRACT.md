# My Fleet — Data Contract

**Dev project:** `zhdqdxtwipcowbtdyviq` (never production `tcykyktvdlsbscrsbjyt` for My Fleet reads)  
**Last updated:** 2026-06-23

This document is the stable contract Cursor and My Fleet must follow. Raw tables are not UI sources — only documented clean views.

---

## Read surfaces (My Fleet)

| View | Purpose | Authority |
|------|---------|-----------|
| `public.fleet_machine_catalog` | Default machine list/search | Track-finder v1 (`machine_status = 'active_v1'`) |
| `public.fleet_machine_godlist` | Full machine record incl. hidden | `core.model` + `core.make` |
| `public.fleet_machine_track_size_options` | Wide/narrow/alternate sizes per machine | `core.machine_approved_track_size` (track-finder) |
| `public.fleet_track_size_spine` | Size-key hub (128 active) | `core.v_track_size_spine_v2` |
| `public.fleet_products` | Products with v2 track size only | `core.product` ⋈ `core.v_track_size_v2` |
| `public.fleet_qa_parts` | Machine ↔ product fitment for parts counter | `core.fitment` + v2 track filter |
| `public.fleet_brands_catalog` | Brand nav with active vs total counts | `core.make` + `active_v1` counts |
| `public.fleet_model_hero` | Machine hero image (one row per machine) | `core.model_media` ⋈ `core.media_asset` |
| `public.fleet_track_size_media` | Shared track-size gallery | `core.track_size_media` ⋈ `core.media_asset` |
| `public.fleet_product_media` | SKU-specific images | `core.product_media` ⋈ `core.media_asset` |
| `public.fleet_enrichment_tasks` | Auto-detected gaps (read-only suggestions) | Computed view — requires approval to act |

Legacy views/tables **must not** be read by My Fleet:

- `core.v_track_size_spine` (403 legacy sizes)
- Supplier-inferred track size options (removed from UI)
- `core.product.product_url` as image URL (dealer page link, not media)

---

## Navigation hierarchy

```
Machine Type
  └── Brand (core.make)
        └── Model (core.model, machine_id)
              └── Track Size Options (core.machine_approved_track_size)
                    └── canonical_size → track_size_id (core.v_track_size_v2)
```

**Fields:**

- `machine_type` — CTL, Skid Steer, Mini Excavator, etc. (from track-finder)
- `brand` / `brand_id` — display + FK
- `model` / `machine_id` — e.g. `mdl_john_deere_323e`
- `option_label` — `wide` | `narrow` | `standard` | `alternate`
- `canonical_size` — v2 size key, e.g. `400x86x52`, `320x86Bx52`
- `display_priority` — wide=1, alternate=2, narrow=3

---

## Track size → products → treads

```
Track Size (core.v_track_size_v2, 128 rows)
  └── TNT Products (core.product where sku ILIKE 'TNT%' AND track_size_id set)
        └── Tread Options (product.pattern → display label)
```

**Product rules:**

- Primary catalog tier: `TNT*` SKUs with `track_size_id` on v2 spine
- Secondary (opt-in UI): Bridgestone `BS*`, legacy `TT*`
- Tread display order: C-Block → Zig-Zag → Multi-Bar → X-Terrain (then others alpha)

**Size key format:** `{width}x{pitch}{optional_suffix}x{links}`  
Examples: `320x86x52`, `320x86Bx52`, `400x86Tx52`

---

## Image inheritance contract

| Layer | Scope | Source table | Fallback |
|-------|-------|--------------|----------|
| Machine hero | One per model | `core.model_media` role=`hero` | None (show placeholder) |
| Track size | Shared across all products/machines on that size | `core.track_size_media` | None |
| Product | SKU-specific | `core.product_media` | Inherit track-size hero for same `track_size_id` |
| Part (sprocket/idler/roller) | Component-specific | `core.product_media` on UC SKU | None |

**Resolution order (My Fleet):**

1. Product variant image (`fleet_product_media` for SKU)
2. Else track-size hero for product's v2 `track_size_id` + tread match if available
3. Else track-size hero ignoring tread
4. Else placeholder + enrichment task `missing_image`

Track-size images are **not** duplicated per SKU or machine — they link via `track_size_id`.

---

## Fitment contract

```
Fitment (core.fitment)
  ├── machine_id → core.model
  └── product_id → core.product
```

**Types:** `explicit_supplier_fitment`, `inferred_by_track_size`, etc.  
**Confidence:** `supplier` > inferred  
My Fleet Q&A ranks supplier-confirmed fitments first; inferred fitments show review warnings.

---

## Machine status contract

| Status | Visible in catalog | Meaning |
|--------|-------------------|---------|
| `active_v1` | Yes (default) | Track-finder navigation SSOT |
| `active` | Only with `?show=all` | Legacy active classification |
| `review` | Hidden | Needs human triage |
| `reference` | Hidden | Alias/duplicate reference |
| `quarantine` | Hidden | Polluted/noise record |

Brand pages and search default to `fleet_machine_catalog` (`active_v1` only).

---

## Track size v2 filter

Included in `core.v_track_size_v2` when **all** true:

- `canonical_size` does not contain `RUBBERTRACK` (case insensitive)
- At most **3** chunks when split on `x` (no 4+ chunk legacy strings)

Current count: **128** sizes.

---

## Enrichment pipeline (controlled intelligence)

```
New supplier row
  → auto-normalize (brand alias, size key)
  → auto-link track_size_id (rule-based, spec-backed)
  → inherit images from track_size_id
  → flag conflicts → core.media_review_queue / fleet_enrichment_tasks
  → human approve
  → publish queue → Shopify
```

**No AI guessing.** Suggestions are deterministic rules with explicit approval gates.

---

## Regenerate / validate

```bash
python3 scripts/rebuild-track-size-from-specs.py
python3 scripts/classify-machine-status.py
python3 scripts/import-track-finder-navigation.py
python3 scripts/audit-supabase-media.py
python3 scripts/validate-track-size-v2-ui.py
```

SQL apply order: `phase2/track_size_v2_fleet_views.sql` → `phase2/media_asset_schema.sql` → `phase2/media_fleet_views.sql`
