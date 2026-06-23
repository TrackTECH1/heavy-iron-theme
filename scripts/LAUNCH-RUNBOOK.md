# Heavy Iron curated launch runbook

One-page checklist for a **curated** track launch (core sizes only — not full TrackTech catalog).

## Prerequisites

| Item | Location / command |
|------|-------------------|
| TrackTech export (xlsx) | `~/Desktop/SUPABASE/tracktech-products-*.xlsx` |
| Shopify Products.csv | `~/Desktop/SUPABASE/Products.csv` (Matrixify export) |
| Dev store | `tracktech-530.myshopify.com` |
| Prod store | `heavyironsupply.myshopify.com` |
| Supabase | `npx supabase login` → `./scripts/fitment bootstrap` |
| Shopify CLI (dev) | `shopify store auth --store tracktech-530.myshopify.com` |

---

## Phase 0 — Clean baseline + fitment

```bash
./scripts/fitment doctor
python3 scripts/import-products-from-tracktech-export.py --apply
python3 scripts/import-fitments-from-tracktech-export.py --apply
./scripts/fitment sync
```

Optional audit before changes:

```bash
./scripts/fitment clean audit
```

---

## Phase 1 — Dev gate (tracktech-530)

```bash
./scripts/fitment launch-gate --tier dev
```

**Pass criteria (per core size):**

| Metric | Threshold |
|--------|-----------|
| Score ≥ 5/7 | ≥ 50% of itemids in bucket |
| `live_shopify` | ≥ 40% |
| Perfect 7/7 | ≥ 1 itemid |

Core sizes (default): `450x86x58`, `450x86x60`, `450x86x55`, `320x86x52`, `400x86x53`.

**Scope:** gates default to `--scope curated` (only rubber tracks in `Products.csv` for that size). Use `--scope all` to audit the full TrackTech bucket.

Report only: Products.csv `Image Src` coverage % per size.

Fix failures with `./scripts/fitment validate --track-size <size> --verbose`, then re-run sync/clean as needed.

---

## Phase 2 — Matrixify merge (current catalog only)

Use **`data/heavy-iron-matrixify-import.csv`** — not `heavy-iron-matrixify-import-delta.csv` (full delta).

1. Matrixify → Import → upload `data/heavy-iron-matrixify-import.csv`
2. Mode: **MERGE**, identify by **Variant SKU**, enable Products / Variants / Images / Metafields
3. After import finishes:

```bash
./scripts/post-matrixify-import.sh
```

4. Re-export **Products.csv** from Matrixify → save to `~/Desktop/SUPABASE/Products.csv`

**Alternative when Matrixify MCP returns 403** — backfill product metafields via Admin API instead of Matrixify metafield import (requires `SHOPIFY_ADMIN_TOKEN` or Shopify CLI from `./scripts/fitment setup`):

```bash
./scripts/fitment backfill-metafields
# or step-by-step:
./scripts/fitment backfill-csv --live-only
./scripts/fitment backfill-apply --limit 10   # smoke test
./scripts/fitment backfill-apply
```

Dry-run apply only: `python3 scripts/apply-metafield-backfill.py --dry-run`

5. Align handles + manifest:

```bash
./scripts/fitment clean align-handles --apply
./scripts/fitment sync
./scripts/fitment sync-variants --apply --shop tracktech-530.myshopify.com
```

---

## Phase 3 — Launch gate (pre-prod)

```bash
./scripts/fitment launch-gate --tier launch
./scripts/fitment launch-gate --tier launch --json data/launch-gate-report.json
```

**Pass criteria (per core size):**

| Metric | Threshold |
|--------|-----------|
| Score ≥ 6/7 | ≥ 70% |
| `live_shopify` | ≥ 60% |
| `canonical_manifest` | ≥ 50% |

All requested sizes must pass. Exit code 0 = ready for prod promotion checklist.

---

## Phase 4 — Prod promotion

On **heavyironsupply**:

1. Remove storefront password / enable public access
2. Point env at prod store (`SHOPIFY_STORE_DOMAIN=heavyironsupply.myshopify.com`) or use prod Shopify auth
3. Run catalog + fitment sync against prod
4. Final gate:

```bash
./scripts/fitment launch-gate --tier prod --json data/launch-gate-report.json
```

**Pass criteria (per core size):**

| Metric | Threshold |
|--------|-----------|
| Score ≥ 6/7 | ≥ 85% |
| `live_shopify` | ≥ 80% |
| Perfect 7/7 | ≥ 80% |

---

## Manual gates (human)

- [ ] **Archive 8 duplicate itemid products** in Shopify Admin (legacy handle duplicates vs itemid SSOT)
- [ ] **Model page smoke test:** open `/pages/case-tv450b` (or theme model URL for handle `case-tv450b`) — fitment tracks render, hero image loads, Buy/Quote links resolve

---

## Quick reference

```bash
./scripts/fitment launch-gate --tier dev|launch|prod
./scripts/fitment launch-gate --tier dev --size 450x86x58 --verbose
./scripts/fitment validate --track-size 450x86x58 --verbose
```
