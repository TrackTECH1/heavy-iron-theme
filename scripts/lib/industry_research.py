"""Industry research enrichment — trusted sources only, approval before promotion."""
from __future__ import annotations

import csv
import hashlib
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "data" / "industry-research"
TRACK_FINDER_JSON = ROOT / "data" / "imports" / "track-finder-data.json"
PACKAGE_MODEL_CSV = ROOT / "data" / "tracktech-source-of-truth-package" / "02_import_csvs" / "core_model.csv"

# Canonical machine taxonomy (Track Finder + industry standard)
CANONICAL_MACHINE_TYPES = frozenset(
    {
        "Compact Track Loader",
        "Multi-Terrain Loader",
        "Skid Steer",
        "Mini Excavator",
        "Mini Skid Steer",
        "Excavator",
        "Drilling Machine",
        "Trencher",
        "Forestry",
        "Other",
    }
)

# Disambiguation notes for reviewers (never auto-inferred)
MACHINE_TYPE_GUIDANCE = {
    "Compact Track Loader": "Rubber-track loader; fixed undercarriage (Bobcat T-series, CAT 259, etc.)",
    "Multi-Terrain Loader": "ASV/Terex RT-style MTL; often overlaps marketing with CTL",
    "Mini Skid Steer": "Walk-behind or stand-on compact loader (Dingo, SK600, etc.)",
    "Mini Excavator": "Excavator undercarriage; boom/arm primary implement",
    "Skid Steer": "Wheeled skid steer (not rubber track)",
}

SOURCE_PRIORITY = {
    "oem": 1,
    "dealer": 2,
    "brochure": 3,
    "track_finder": 4,
    "intelligent_fitment": 4,
    "manual_review": 5,
}

SPEC_FIELDS = (
    "machine_type",
    "canonical_model_group",
    "operating_weight_lbs",
    "horsepower",
    "std_gpm",
    "hf_gpm",
    "std_psi",
    "model_year_start",
    "model_year_end",
)

PROTECTED_NAV_SOURCES = frozenset({"track_finder_v1", "oem_approved", "human_approved"})


def sql_str(val: str | None) -> str:
    if val is None or val == "":
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def norm_model(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def candidate_id(machine_id: str, field_name: str, proposed: str, source_type: str, source_url: str) -> str:
    raw = f"{machine_id}|{field_name}|{proposed}|{source_type}|{source_url or ''}"
    return "enr_" + hashlib.sha256(raw.encode()).hexdigest()[:24]


def parse_num(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = s.replace(",", "")
    m = re.search(r"[\d.]+", s)
    return m.group(0) if m else None


@dataclass
class CatalogMachine:
    machine_id: str
    brand: str
    model: str
    shopify_handle: str
    machine_type: str | None
    canonical_model_group: str | None
    operating_weight_lbs: str | None
    horsepower: str | None
    std_gpm: str | None
    hf_gpm: str | None
    std_psi: str | None
    navigation_source: str | None
    machine_status: str | None

    def current(self, field_name: str) -> str | None:
        return getattr(self, field_name, None)


@dataclass
class ResearchFinding:
    machine_id: str
    field_name: str
    proposed_value: str
    source_type: str
    source_url: str
    confidence: float
    evidence_text: str
    source_priority: int = 0

    def __post_init__(self) -> None:
        if not self.source_priority:
            self.source_priority = SOURCE_PRIORITY.get(self.source_type, 5)


@dataclass
class EnrichmentCandidate:
    machine_id: str
    shopify_handle: str
    brand: str
    model: str
    field_name: str
    current_value: str
    proposed_value: str
    source_type: str
    source_url: str
    source_priority: int
    confidence: float
    evidence_text: str
    status: str = "pending"
    conflict_reason: str = ""

    @property
    def candidate_id(self) -> str:
        return candidate_id(
            self.machine_id,
            self.field_name,
            self.proposed_value,
            self.source_type,
            self.source_url,
        )


@dataclass
class QueueItem:
    machine_id: str
    shopify_handle: str
    brand: str
    model: str
    priority: int
    research_fields: list[str]
    notes: str


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_registry(path: Path) -> list[ResearchFinding]:
    """Curated OEM / dealer / brochure rows — explicit values only."""
    findings: list[ResearchFinding] = []
    for row in read_csv(path):
        mid = (row.get("machine_id") or "").strip()
        field_name = (row.get("field_name") or "").strip()
        proposed = (row.get("proposed_value") or "").strip()
        if not mid or mid.startswith("#") or not field_name or not proposed:
            continue
        source_type = (row.get("source_type") or path.stem.split("_")[0]).strip().lower()
        if source_type not in SOURCE_PRIORITY:
            continue
        try:
            confidence = float(row.get("confidence") or 0)
        except ValueError:
            continue
        if confidence <= 0:
            continue
        url = (row.get("source_url") or "").strip()
        evidence = (row.get("evidence_text") or row.get("notes") or "").strip()
        findings.append(
            ResearchFinding(
                machine_id=mid,
                field_name=field_name,
                proposed_value=proposed,
                source_type=source_type,
                source_url=url,
                confidence=min(confidence, 1.0),
                evidence_text=evidence,
            )
        )
    return findings


def load_track_finder_findings() -> list[ResearchFinding]:
    if not TRACK_FINDER_JSON.is_file():
        return []
    import json

    from lib.track_finder_navigation import (  # noqa: WPS433
        build_brand_lookup,
        index_models,
        load_track_finder,
        norm_model as tf_norm_model,
        pick_machine,
        resolve_brand_id,
    )

    entries = load_track_finder(TRACK_FINDER_JSON)
    make_rows = read_csv(ROOT / "data/tracktech-source-of-truth-package/02_import_csvs/core_make.csv")
    model_rows = read_csv(PACKAGE_MODEL_CSV)
    brand_lookup = build_brand_lookup(make_rows)
    model_index = index_models(model_rows)

    findings: list[ResearchFinding] = []
    for entry in entries:
        brand_id = resolve_brand_id(entry.brand, brand_lookup)
        candidates = model_index.get((brand_id, tf_norm_model(entry.model)), []) if brand_id else []
        machine = pick_machine(candidates)
        mid = (machine.get("machine_id") or "").strip()
        if not mid:
            continue
        mtype = (entry.machine_type or "").strip()
        if mtype not in CANONICAL_MACHINE_TYPES:
            continue
        findings.append(
            ResearchFinding(
                machine_id=mid,
                field_name="machine_type",
                proposed_value=mtype,
                source_type="track_finder",
                source_url=entry.url or f"track-finder:{entry.handle}",
                confidence=0.92,
                evidence_text=f"Track Finder v1 category '{mtype}' for {entry.brand} {entry.model}",
            )
        )
        if entry.handle:
            grp = f"{entry.brand} {entry.model}".strip()
            findings.append(
                ResearchFinding(
                    machine_id=mid,
                    field_name="canonical_model_group",
                    proposed_value=grp,
                    source_type="track_finder",
                    source_url=entry.url or f"track-finder:{entry.handle}",
                    confidence=0.88,
                    evidence_text="Track Finder model family label",
                )
            )
    return findings


def load_package_spec_findings(catalog_by_id: dict[str, CatalogMachine]) -> list[ResearchFinding]:
    """Intelligent Fitment / package CSV — only non-empty explicit spec cells."""
    findings: list[ResearchFinding] = []
    for row in read_csv(PACKAGE_MODEL_CSV):
        mid = (row.get("machine_id") or "").strip()
        if not mid or mid not in catalog_by_id:
            continue
        for fld in SPEC_FIELDS:
            if fld in ("model_year_start", "model_year_end"):
                continue
            val = (row.get(fld) or "").strip()
            if not val:
                continue
            if fld == "machine_type" and val not in CANONICAL_MACHINE_TYPES:
                continue
            num = parse_num(val) if fld != "machine_type" and fld != "canonical_model_group" else val
            if not num:
                continue
            findings.append(
                ResearchFinding(
                    machine_id=mid,
                    field_name=fld,
                    proposed_value=str(num),
                    source_type="intelligent_fitment",
                    source_url="data/tracktech-source-of-truth-package/02_import_csvs/core_model.csv",
                    confidence=0.75,
                    evidence_text=f"Package import column {fld}={val}",
                )
            )
    return findings


def is_protected(machine: CatalogMachine, field_name: str) -> bool:
    if machine.navigation_source in PROTECTED_NAV_SOURCES and machine.current(field_name):
        return True
    return False


def build_queue(machines: list[CatalogMachine]) -> list[QueueItem]:
    items: list[QueueItem] = []
    for m in machines:
        if (m.machine_status or "") != "active_v1":
            continue
        fields: list[str] = []
        notes: list[str] = []
        if not m.machine_type:
            fields.append("machine_type")
            notes.append("missing machine_type")
        elif m.machine_type in {"Multi-Terrain Loader", "Compact Track Loader"}:
            fields.append("machine_type")
            notes.append("CTL/MTL disambiguation review")
        if not m.canonical_model_group:
            fields.append("canonical_model_group")
        for spec in ("operating_weight_lbs", "horsepower", "std_gpm", "hf_gpm", "std_psi"):
            if not m.current(spec):
                fields.append(spec)
        if not fields:
            continue
        priority = 10 + len(fields) * 5
        if "machine_type" in fields:
            priority += 20
        items.append(
            QueueItem(
                machine_id=m.machine_id,
                shopify_handle=m.shopify_handle,
                brand=m.brand,
                model=m.model,
                priority=priority,
                research_fields=sorted(set(fields)),
                notes="; ".join(notes),
            )
        )
    items.sort(key=lambda x: (-x.priority, x.brand, x.model))
    return items


def findings_to_candidates(
    machines: dict[str, CatalogMachine],
    findings: list[ResearchFinding],
) -> tuple[list[EnrichmentCandidate], list[dict[str, str]]]:
    """Merge findings; never propose identical to current; flag protected conflicts."""
    citations: list[dict[str, str]] = []
    candidates: list[EnrichmentCandidate] = []
    seen: set[tuple[str, str, str, str]] = set()

    for f in sorted(findings, key=lambda x: (x.source_priority, -x.confidence)):
        machine = machines.get(f.machine_id)
        if not machine:
            continue
        key = (f.machine_id, f.field_name, f.proposed_value, f.source_type)
        if key in seen:
            continue
        seen.add(key)

        current = machine.current(f.field_name) or ""
        proposed = f.proposed_value.strip()
        if not proposed or proposed == current:
            continue

        status = "pending"
        conflict = ""
        if is_protected(machine, f.field_name):
            status = "conflict"
            conflict = f"Protected {f.field_name} from navigation_source={machine.navigation_source}"

        cand = EnrichmentCandidate(
            machine_id=f.machine_id,
            shopify_handle=machine.shopify_handle,
            brand=machine.brand,
            model=machine.model,
            field_name=f.field_name,
            current_value=current,
            proposed_value=proposed,
            source_type=f.source_type,
            source_url=f.source_url,
            source_priority=f.source_priority,
            confidence=f.confidence,
            evidence_text=f.evidence_text,
            status=status,
            conflict_reason=conflict,
        )
        candidates.append(cand)
        citations.append(
            {
                "candidate_id": cand.candidate_id,
                "machine_id": f.machine_id,
                "shopify_handle": machine.shopify_handle,
                "field_name": f.field_name,
                "source_type": f.source_type,
                "source_priority": str(f.source_priority),
                "source_url": f.source_url,
                "confidence": f"{f.confidence:.2f}",
                "evidence_text": f.evidence_text,
            }
        )

    return candidates, citations


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def generate_approval_sql(candidates: list[EnrichmentCandidate], batch_id: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")
    lines = [
        "-- Industry research enrichment — load pending candidates (DEV ONLY)",
        f"-- Generated: {ts}",
        f"-- Batch: {batch_id}",
        "-- Does NOT update core.model. Review in My Fleet / fleet_enrichment_candidates.",
        "",
        "SELECT core.assert_dev_branch();",
        "",
    ]
    pending = [c for c in candidates if c.status == "pending"]
    chunk = 100
    for i in range(0, len(pending), chunk):
        part = pending[i : i + chunk]
        values = ",\n".join(
            "("
            + ", ".join(
                [
                    sql_str(c.candidate_id),
                    sql_str(c.machine_id),
                    sql_str(c.field_name),
                    sql_str(c.current_value or None),
                    sql_str(c.proposed_value),
                    sql_str(c.source_type),
                    sql_str(c.source_url or None),
                    str(c.source_priority),
                    f"{c.confidence:.3f}",
                    sql_str(c.evidence_text or None),
                    sql_str("pending"),
                    sql_str(batch_id),
                ]
            )
            + ")"
            for c in part
        )
        lines.append(
            "INSERT INTO core.enrichment_candidates "
            "(candidate_id, machine_id, field_name, current_value, proposed_value, "
            "source_type, source_url, source_priority, confidence, evidence_text, status, batch_id) "
            f"VALUES\n{values}\n"
            "ON CONFLICT (candidate_id) DO UPDATE SET "
            "proposed_value = EXCLUDED.proposed_value, "
            "confidence = EXCLUDED.confidence, "
            "evidence_text = EXCLUDED.evidence_text, "
            "source_url = EXCLUDED.source_url, "
            "status = CASE WHEN core.enrichment_candidates.status = 'approved' "
            "THEN core.enrichment_candidates.status ELSE EXCLUDED.status END;"
        )
        lines.append("")

    conflict = [c for c in candidates if c.status == "conflict"]
    if conflict:
        lines.append(f"-- {len(conflict)} conflict rows omitted (protected catalog values); see CSV status=conflict")
    lines.append("")
    return "\n".join(lines)


def new_batch_id() -> str:
    return f"industry_research_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
