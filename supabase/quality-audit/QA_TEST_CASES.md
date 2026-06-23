# My Fleet — QA Test Cases

Run against **dev** (`zhdqdxtwipcowbtdyviq`) after any schema or view change.

Automated: `python3 scripts/validate-track-size-v2-ui.py`  
Manual UI: My Fleet at `http://localhost:3000` (or `:3001` if port busy)

---

## 1. Track size spine integrity

| ID | Query / action | Expected |
|----|----------------|----------|
| TS-01 | `SELECT COUNT(*) FROM public.fleet_track_size_spine` | **128** |
| TS-02 | `SELECT COUNT(*) FROM public.fleet_track_size_spine WHERE canonical_size ~* 'rubbertrack'` | **0** |
| TS-03 | `SELECT COUNT(*) FROM public.fleet_track_size_spine WHERE cardinality(string_to_array(lower(canonical_size),'x')) > 3` | **0** |
| TS-04 | UI: `/track-sizes` | Table shows 128 rows, subtitle mentions v2 spine |

---

## 2. Machine catalog (navigation authority)

| ID | Query / action | Expected |
|----|----------------|----------|
| MC-01 | `SELECT COUNT(*) FROM public.fleet_machine_catalog` | **1147** (track-finder `active_v1`) |
| MC-02 | `SELECT COUNT(*) FROM public.fleet_machine_godlist WHERE machine_status NOT IN ('active_v1','active')` | Hidden from default search |
| MC-03 | UI: `/brands` → Kubota | `active_model_count` **89**, not 364 |
| MC-04 | UI: `/models?brand=Kubota` | Only `active_v1` models; no quarantine noise |
| MC-05 | Search `john deere 323e` | Top hit `mdl_john_deere_323e` |

---

## 3. Wide / narrow track options

| ID | Query / action | Expected |
|----|----------------|----------|
| WN-01 | `SELECT option_label, canonical_size FROM fleet_machine_track_size_options WHERE machine_id = 'mdl_john_deere_323e' ORDER BY display_priority` | wide=`400x86x52`, narrow=`320x86x52` |
| WN-02 | Same for `mdl_kubota_svl75_2` | wide=`400x86x52`, narrow=`320x86x52` |
| WN-03 | UI: home search `323e` → Tracks tab | Two groups: Wide Tracks + Narrow Tracks |
| WN-04 | No supplier-inferred third size (e.g. random 380) unless in approved options | |

---

## 4. TNT products & v2 linkage

| ID | Query / action | Expected |
|----|----------------|----------|
| PR-01 | `SELECT COUNT(*) FROM fleet_qa_parts WHERE machine_id='mdl_kubota_svl75_2' AND sku ILIKE 'TNT%' AND product_type ILIKE '%track%'` | **≥ 10** |
| PR-02 | Same query: `product_track_size ~* 'rubbertrack'` | **0** |
| PR-03 | `SELECT COUNT(*) FROM fleet_qa_parts q JOIN core.product p ON p.product_id=q.product_id WHERE q.machine_id='mdl_kubota_svl75_2' AND p.product_type ILIKE '%track%' AND p.track_size_id IS NULL` | **0** |
| PR-04 | UI: SVL75-2 tracks tab | TNT variants with tread labels; no RUBBERTRACK strings |

---

## 5. Image inheritance

| ID | Query / action | Expected |
|----|----------------|----------|
| IM-01 | `SELECT COUNT(*) FROM core.track_size_media` | **> 0** after media audit |
| IM-02 | `SELECT url FROM fleet_model_hero WHERE machine_id = 'mdl_john_deere_323e'` | Non-null hero URL or documented gap |
| IM-03 | `SELECT url FROM fleet_track_size_media WHERE track_size_id = 'ts_320x86x52' LIMIT 1` | Non-null OR fallback via `320x86Bx52` variant |
| IM-04 | UI: machine page | Machine hero shown first in header |
| IM-05 | UI: tracks tab group card | Track-size image on group (not text placeholder ▬) |
| IM-06 | UI: product row | SKU image if `product_media` exists; else inherited track-size hero |
| IM-07 | Sprocket/idler tab | Part-specific image only (no track-size inherit for non-track categories) |

---

## 6. Enrichment tasks (controlled intelligence)

| ID | Query / action | Expected |
|----|----------------|----------|
| EN-01 | `SELECT task_type, COUNT(*) FROM fleet_enrichment_tasks GROUP BY 1` | Deterministic counts; no duplicate machine_id+task_type |
| EN-02 | UI: `/enrichment` or machine review panel | Lists missing hero, missing TNT, missing track image |
| EN-03 | Tasks are **suggestions** — no auto-write to Shopify | |
| EN-04 | `machine_missing_tnt_tracks` only for `active_v1` in catalog | |

---

## 7. Fitment & Q&A

| ID | Query / action | Expected |
|----|----------------|----------|
| QA-01 | Parts Q&A: "What tracks fit John Deere 323E?" | Wide/narrow groups, TNT prioritized |
| QA-02 | Parts Q&A: "320x86x52 tread options" | Products on v2 size only |
| QA-03 | Inferred fitment rows | Show review warning badge |

---

## 8. Regression guards

| ID | Must never happen |
|----|-------------------|
| RG-01 | `RUBBERTRACK` in UI track size labels |
| RG-02 | 4+ chunk sizes like `457x152.4x53-970` in spine |
| RG-03 | `product_url` (MWE dealer page) rendered as product thumbnail |
| RG-04 | `buildMachineTrackSizeOptions()` supplier fallback in UI path |
| RG-05 | My Fleet connected to production Supabase ref |

---

## Quick validation script

```bash
python3 scripts/validate-track-size-v2-ui.py
python3 scripts/audit-supabase-media.py --validate-only
```

Pass criteria: both exit 0, manual IM-04 through IM-06 verified on sample machines (323E, SVL75-2, CAT 299D3).
