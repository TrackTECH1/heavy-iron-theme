# Model publish pipeline — Supabase dev → Shopify Model metaobjects

**Architecture:** Supabase (truth) → My Fleet (validate) → Matrixify / Shopify API (publish) → Heavy Iron theme (render)

The storefront never reads Supabase at runtime. Model pages read **Shopify Model metaobjects** populated from clean dev `fleet_*` views.

## Scripts

| Step | Command | Output |
|------|---------|--------|
| Export | `python3 scripts/export-model-publish-bundle.py` | `data/model-publish/` |
| Matrixify | Import `matrixify-model-publish.csv` | Heroes + primary track size on Model MO |
| API apply | `python3 scripts/apply-model-publish-bundle.py --apply` | `track_products`, `uc_products` GIDs |

Legacy (production fitment table): `scripts/sync-model-product-refs.py` — prefer the export bundle for v2 spine.

## Data sources (dev branch only)

| View / table | Published field |
|--------------|-----------------|
| `fleet_model_hero` | `hero_image` (Matrixify file URL) |
| `core.model` + `v_track_size_v2` | `primary_track_size` |
| `fleet_qa_parts` (v2 filtered) | `track_products`, `uc_products` |

Only `machine_status = active_v1` models with `shopify_handle` are exported.

## Matrixify import

1. Matrixify → Import → `data/model-publish/matrixify-model-publish.csv`
2. Type: **Metaobjects** → definition **model**
3. Command: **MERGE** (by Handle)
4. Enable: Metaobjects + Files (for hero_image URLs)

## Shopify API apply

After Matrixify (or in parallel for product lists):

```bash
python3 scripts/export-model-publish-bundle.py
python3 scripts/apply-model-publish-bundle.py --dry-run
python3 scripts/apply-model-publish-bundle.py --apply --only-changed
python3 scripts/apply-model-publish-bundle.py --apply --handle john-deere-323e
```

Requires Shopify CLI auth on `tracktech-530.myshopify.com` (dev) or `SHOPIFY_ADMIN_TOKEN`.

## Theme rendering

| Template | Section | Product lists |
|----------|---------|---------------|
| Metaobject URL | `main-fitment.liquid` | `track_products`, `uc_products` |
| Page + `custom.model` | `main-machine-fitment.liquid` | Same fields (fallback from `track_variants`) |

Verify on dev store after publish:

- Model metaobject page shows hero + track cards + UC section
- Page template machine-fitment shows same when `custom.model` is set

## Pilot checklist (dev store)

- [ ] `python3 scripts/export-model-publish-bundle.py`
- [ ] Matrixify import heroes for 323E, SVL75-2, CAT 299D3
- [ ] `apply-model-publish-bundle.py --apply --handle <pilot>`
- [ ] Open model page on tracktech-530 — hero + tracks + UC render
- [ ] Promote same bundle to heavyironsupply after review
