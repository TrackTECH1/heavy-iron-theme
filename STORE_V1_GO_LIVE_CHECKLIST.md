# Store V1 Go-Live Checklist

**Audit result:** FAIL

## Pre-launch (dev sign-off)

- [ ] `./scripts/run-full-store-audit.py` → overall PASS
- [ ] Matrixify bundle imported on tracktech-530 only
- [ ] Pilot pages verified: john-deere-323e, kubota-svl75-2
- [ ] My Fleet admin smoke test (search, machine tabs, QA)
- [ ] Launch gate `--tier launch` passes on curated sizes
- [ ] Theme preview: tracks grouped, UC categories, PDP fitment selector
- [ ] No quarantine/reference/review in publish contract

## Production (human approval only)

- [ ] Catalog SSOT ≥70% on launch sizes
- [ ] Hero coverage acceptable for launch brands
- [ ] Matrixify import on heavyironsupply (approved window)
- [ ] DNS / redirects reviewed in Shopify Admin
- [ ] SEO titles imported for top 50 models

## Rollback

- Matrixify backup export before prod import
- Theme preview revert
- No production Supabase mutations from this pipeline
