# Track Size V2 — My Fleet UI Validation

**Generated:** 2026-06-23 21:55 UTC  
**Dev project:** `zhdqdxtwipcowbtdyviq`  
**Spine view:** `core.v_track_size_spine_v2` → `public.fleet_track_size_spine`

## Summary

**Overall:** PASS

## Checks

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | No RUBBERTRACK in spine | PASS | found 0 |
| 2 | No 4+ chunk sizes in spine | PASS | found 0 |
| 3 | Track-size page: 128 active sizes | PASS | count=128 |
| 4 | John Deere 323E Wide/Narrow | PASS | {'wide': '400x86x52', 'narrow': '320x86x52'} |
| 5 | Kubota SVL75-2 TNT track products | PASS | tnt=18 non_tnt=6 bad=0 |
| 6 | Brand pages hide polluted Kubota machines | PASS | active=89 total=364 |

## John Deere 323E — approved track sizes

| Label | Canonical size | Priority |
|-------|----------------|----------|
| wide | `400x86x52` | 1 |
| narrow | `320x86x52` | 3 |

## Kubota SVL75-2 — TNT track SKUs (sample)

| SKU | V2 size |
|-----|---------|
| `TNT3208652HDBL` | `320x86Bx52` |
| `TNT3208652HDC` | `320x86Bx52` |
| `TNT3208652HDMB` | `320x86Bx52` |
| `TNT3208652HDZ` | `320x86Bx52` |
| `TNT3208652HDZB` | `320x86Bx52` |
| `TNT3208652SDC` | `320x86Bx52` |
| `TNT3808652HDBL` | `380x86Bx52` |
| `TNT3808652HDMB` | `380x86Bx52` |
| `TNT4008652HDBD` | `400x86Bx52` |
| `TNT4008652HDBL` | `400x86Bx52` |
| `TNT4008652HDC` | `400x86Bx52` |
| `TNT4008652HDMB` | `400x86Bx52` |
| … | *6 more TNT SKUs* |

## Kubota brand catalog filtering

- **Active (track-finder v1):** 89 models
- **Total in godlist:** 364 models
- **Hidden reference/noise:** 275 models

## App changes (My Fleet)

- `public.fleet_track_size_spine` reads `core.v_track_size_spine_v2` only
- `public.fleet_qa_parts` / `fleet_products` join `core.v_track_size_v2`
- Track size options from `fleet_machine_track_size_options` only (no supplier QA fallback)
- Client filter: `filterV2QaParts()` in `my-fleet/src/lib/track-size-v2.ts`

## SQL artifact

`supabase/quality-audit/phase2/track_size_v2_fleet_views.sql`

