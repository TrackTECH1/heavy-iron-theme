#!/usr/bin/env python3
"""Duplicate Shopify model metaobject hero images into Supabase, one file per make/model.

Shopify often reuses the same generic hero (e.g. bobcat-skid-steer-hero.webp) across
many models. This script downloads each source once, converts to WebP, and uploads a
per-model copy named {model_handle}-hero.webp to the machine-images bucket.

Prerequisites:
  ./scripts/fitment doctor   (Supabase service role + Shopify CLI or SHOPIFY_ADMIN_TOKEN)

Usage:
  python3 scripts/sync-model-hero-images.py --dry-run
  python3 scripts/sync-model-hero-images.py --apply
  python3 scripts/sync-model-hero-images.py --apply --handle bobcat-t730
  python3 scripts/sync-model-hero-images.py --apply --limit 10
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import (  # noqa: E402
    DEFAULT_SUPABASE_URL,
    supabase_get_all,
    supabase_key,
    supabase_request,
    supabase_url,
)

STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
BUCKET = "machine-images"
MAX_WIDTH = 1600
WEBP_QUALITY = 85

MODELS_PAGE_QUERY = """
query ModelHeroes($cursor: String) {
  metaobjects(type: "model", first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      handle
      displayName: field(key: "display_name") { value }
      make: field(key: "make") {
        reference {
          ... on Metaobject {
            handle
            name: field(key: "name") { value }
          }
        }
      }
      hero: field(key: "hero_image") {
        reference {
          ... on MediaImage {
            id
            image { url altText width height }
          }
        }
      }
    }
  }
}
"""


def shopify_gql_cli(query: str, variables: dict | None = None) -> dict:
    cmd = [
        "shopify", "store", "execute",
        "--store", STORE,
        "--query", query,
        "--json",
    ]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:sync-heroes|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def shopify_gql(query: str, variables: dict | None = None) -> dict:
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN")
    version = os.environ.get("SHOPIFY_API_VERSION", "2025-10")
    if token:
        url = f"https://{STORE}/admin/api/{version}/graphql.json"
        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return shopify_gql_cli(query, variables)
            raise
        if payload.get("errors"):
            raise RuntimeError(json.dumps(payload["errors"]))
        return payload.get("data") or payload
    return shopify_gql_cli(query, variables)


def load_env() -> None:
    env_file = ROOT / ".env.fitment.local"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def hero_filename(handle: str) -> str:
    return f"{handle}-hero.webp"


def hero_alt(make: str, model_name: str, display_name: str) -> str:
    label = display_name.strip() or f"{make} {model_name}".strip()
    if not label:
        return "Heavy equipment rubber tracks and parts"
    return f"{label} rubber tracks and parts"


def fetch_all_shopify_models() -> list[dict]:
    rows: list[dict] = []
    cursor: str | None = None
    while True:
        data = shopify_gql(MODELS_PAGE_QUERY, {"cursor": cursor})
        conn = data.get("metaobjects") or {}
        for node in conn.get("nodes") or []:
            handle = (node.get("handle") or "").strip()
            if not handle:
                continue
            make_ref = (node.get("make") or {}).get("reference") or {}
            make_name = (make_ref.get("name") or {}).get("value") or make_ref.get("handle") or ""
            display = (node.get("displayName") or {}).get("value") or ""
            hero_ref = (node.get("hero") or {}).get("reference") or {}
            img = hero_ref.get("image") or {}
            url = (img.get("url") or "").strip()
            rows.append(
                {
                    "handle": handle,
                    "make": make_name,
                    "display_name": display,
                    "hero_url": url,
                    "hero_media_id": hero_ref.get("id") or "",
                    "hero_width": img.get("width"),
                    "hero_height": img.get("height"),
                    "shopify_alt": (img.get("altText") or "").strip(),
                }
            )
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")
    return rows


def download_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "heavy-iron-sync/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def optimize_webp(raw: bytes) -> bytes:
    try:
        from PIL import Image
    except ImportError:
        return raw
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    if img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    w, h = img.size
    if w > MAX_WIDTH:
        nh = max(1, round(h * MAX_WIDTH / w))
        img = img.resize((MAX_WIDTH, nh), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=WEBP_QUALITY, method=6)
    return out.getvalue()


def storage_public_url(path: str) -> str:
    return f"{supabase_url().rstrip('/')}/storage/v1/object/public/{BUCKET}/{path.lstrip('/')}"


def storage_upload(path: str, data: bytes, content_type: str = "image/webp") -> None:
    key = supabase_key()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY required")
    url = f"{supabase_url().rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120):
            return
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"storage upload failed ({e.code}): {body}") from e


def patch_model(model_key: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    key = supabase_key()
    path = f"model?model_key=eq.{urllib.parse.quote(model_key, safe='')}"
    req = urllib.request.Request(
        f"{supabase_url().rstrip('/')}/rest/v1/{path}",
        data=body,
        method="PATCH",
        headers={
            "apikey": key or "",
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60):
        return


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="Sync per-model hero images Shopify → Supabase")
    ap.add_argument("--dry-run", action="store_true", help="Report only (default)")
    ap.add_argument("--apply", action="store_true", help="Upload and update model rows")
    ap.add_argument("--handle", help="Single model handle (Shopify metaobject handle)")
    ap.add_argument("--limit", type=int, default=0, help="Max models to process")
    ap.add_argument("--force", action="store_true", help="Re-upload even if source URL unchanged")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    if not supabase_key():
        print("FAIL: SUPABASE_SERVICE_ROLE_KEY required (./scripts/fitment bootstrap)", file=sys.stderr)
        sys.exit(1)

    print("Loading Shopify model metaobjects …", file=sys.stderr)
    shopify_rows = fetch_all_shopify_models()
    by_handle = {r["handle"]: r for r in shopify_rows}

    print("Loading Supabase model rows …", file=sys.stderr)
    db_rows = supabase_get_all(
        "model?select=model_key,model_handle,make,model,hero_image_path,hero_source_url"
    )
    handle_to_key = {
        (r.get("model_handle") or "").strip(): r.get("model_key")
        for r in db_rows
        if r.get("model_handle")
    }
    db_by_handle = {
        (r.get("model_handle") or "").strip(): r
        for r in db_rows
        if r.get("model_handle")
    }

    targets = shopify_rows
    if args.handle:
        targets = [by_handle[args.handle]] if args.handle in by_handle else []
        if not targets:
            print(f"No Shopify model metaobject: {args.handle}", file=sys.stderr)
            sys.exit(1)

    download_cache: dict[str, bytes] = {}
    stats = {"upload": 0, "skip_no_hero": 0, "skip_unchanged": 0, "skip_no_db": 0, "planned": 0}

    manifest: list[dict] = []

    for i, row in enumerate(targets):
        if args.limit and stats["planned"] + stats["upload"] >= args.limit:
            break
        handle = row["handle"]
        hero_url = row["hero_url"]
        if not hero_url:
            stats["skip_no_hero"] += 1
            continue

        model_key = handle_to_key.get(handle)
        db_row = db_by_handle.get(handle) or {}
        if not model_key:
            stats["skip_no_db"] += 1
            manifest.append(
                {
                    "handle": handle,
                    "status": "skip_no_supabase_row",
                    "source_url": hero_url,
                }
            )
            continue

        filename = hero_filename(handle)
        alt = row["shopify_alt"] or hero_alt(
            row["make"] or db_row.get("make") or "",
            db_row.get("model") or "",
            row["display_name"] or "",
        )
        unchanged = (
            not args.force
            and db_row.get("hero_source_url") == hero_url
            and db_row.get("hero_image_path") == filename
        )
        if unchanged:
            stats["skip_unchanged"] += 1
            continue

        stats["planned"] += 1
        public_url = storage_public_url(filename)
        manifest.append(
            {
                "handle": handle,
                "model_key": model_key,
                "filename": filename,
                "public_url": public_url,
                "source_url": hero_url,
                "alt": alt,
                "make": row["make"] or db_row.get("make"),
                "model": db_row.get("model"),
            }
        )

        print(f"{'UPLOAD' if apply else 'PLAN'} {handle} → {filename}")
        if not apply:
            continue

        if hero_url not in download_cache:
            download_cache[hero_url] = download_bytes(hero_url)
        optimized = optimize_webp(download_cache[hero_url])
        storage_upload(filename, optimized)
        patch_model(
            model_key,
            {
                "hero_image_path": filename,
                "hero_image_alt": alt,
                "hero_source_url": hero_url,
                "hero_image_synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
        stats["upload"] += 1

    manifest_path = ROOT / "data" / "model-hero-images-manifest.json"
    manifest_path.parent.mkdir(exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(
        f"\nDone. planned={stats['planned']} uploaded={stats['upload']} "
        f"skip_no_hero={stats['skip_no_hero']} skip_unchanged={stats['skip_unchanged']} "
        f"skip_no_db={stats['skip_no_db']}",
        file=sys.stderr,
    )
    print(f"Manifest: {manifest_path}", file=sys.stderr)
    if manifest and not apply:
        print(f"Example URL: {manifest[0]['public_url']}", file=sys.stderr)


if __name__ == "__main__":
    main()
