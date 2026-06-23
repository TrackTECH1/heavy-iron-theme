# My Fleet — TrackTECH Read-Only Viewer

Read-only catalog viewer for the **Supabase dev branch** (`zhdqdxtwipcowbtdyviq`).

**Hard rules:** no production connection, no data mutations, no Shopify publish.

## Quick start

```bash
cd my-fleet
cp .env.local.example .env.local   # or use existing .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and search **CAT 299D3**.

## Pages

| Route | Source |
|-------|--------|
| `/qa` | Natural-language parts Q&A (tracks, treads, undercarriage) |
| `/` | Global machine search |
| `/brands` | `core.make` via `fleet_brands` |
| `/models` | `core.v_machine_godlist` via `fleet_machine_godlist` |
| `/machines/[id]` | Machine detail + fitments + review warnings |
| `/track-sizes` | `core.v_track_size_spine` |
| `/products` | `core.product` |
| `/fitments` | `core.v_fitment_godlist` |
| `/review` | Local CSVs in `data/tracktech-source-of-truth-package/03_review_queues/` |

## Dev branch views

Applied via `supabase/quality-audit/phase2/my_fleet_public_read_views.sql`:

- `public.fleet_machine_godlist`
- `public.fleet_fitment_godlist`
- `public.fleet_track_size_spine`
- `public.fleet_brands`
- `public.fleet_products`

## Definition of done

1. Search `CAT 299D3` on home
2. Open machine page (`mdl_cat_299d3`)
3. See brand, model, machine type, track size `450x86x60`
4. See linked SKUs and fitments
5. Review warnings when validation ≠ Verified or CSV queue hits
