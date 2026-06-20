# Pre-launch admin checklist (Shopify Admin / Matrixify)

Theme code is ready; these steps must be done in Shopify Admin or Matrixify.

## 1. Track Finder page

1. **Online Store → Pages → Add page**
2. Title: `Track Finder`
3. Handle: `track-finder` (must match `/pages/track-finder`)
4. Theme template: **track-finder**
5. Save

## 2. Machine-type smart collections

Create two smart collections (mirror `compact-track-loaders` / `mini-excavators`):

### Skid Steers
- **Handle:** `skid-steers`
- **Title:** Skid Steer Tracks
- **Type:** Smart collection
- **Conditions:** Product tag equals `skid-steer` OR product type contains `Skid Steer`  
  (Adjust to match how your track SKUs are tagged in Shopify.)

### Multi-Terrain Loaders
- **Handle:** `multi-terrain-loaders`
- **Title:** Multi-Terrain Loader Tracks
- **Type:** Smart collection
- **Conditions:** Product tag equals `multi-terrain-loader` OR product tag equals `mtl`

Until these exist, silo links will 404. Tag products accordingly when importing.

## 3. Matrixify imports (operational CSVs in `data/`)

| File | Purpose |
|------|---------|
| `matrixify-fitment-import-batch-1.csv` | 10 SKUs missing `fits_equipment_models` |
| `matrixify-model-seo-top50.csv` | SEO title/description for top 50 model metaobjects |

Import via Matrixify → Metaobjects (models) and Products (fitment metafields).

Regenerate SEO CSV:
```bash
python3 scripts/generate-model-seo-csv.py < supabase-export.json
```

## 4. Deploy theme

```bash
git checkout cursor/fix-brand-grid-metaobject-links
shopify theme push --store=tracktech-530.myshopify.com
```

## 5. Smoke test

- [ ] `/pages/track-finder`
- [ ] `/collections/skid-steers` and `/collections/multi-terrain-loaders`
- [ ] Homepage hero → `/search`
- [ ] About → Shop Rubber Tracks button
- [ ] Model page JSON-LD (Rich Results Test)
- [ ] PDP fitment + trust strip
- [ ] Search `bobcat t650`
