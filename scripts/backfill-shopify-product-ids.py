#!/usr/bin/env python3
"""Backfill product.shopify_product_id via Shopify handle, SKU, or normalized handle.

Supabase handles often differ from Shopify (e.g. 230x72bx45-c-block-rubber-tracks vs
230x72x45-rubber-track-c-block). Resolution order: exact handle → SKU → normalized handle.

Prerequisites:
  ./scripts/fitment setup   (writes .env.fitment.local with SHOPIFY_ADMIN_TOKEN)
  Or: shopify store auth + export SUPABASE_SERVICE_ROLE_KEY

Usage:
  ./scripts/fitment sync
  python3 scripts/backfill-shopify-product-ids.py --dry-run
  python3 scripts/backfill-shopify-product-ids.py --apply
  python3 scripts/backfill-shopify-product-ids.py --dry-run --limit 20 --workers 8
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

STORE = "tracktech-530.myshopify.com"
PROJECT_REF = "tcykyktvdlsbscrsbjyt"
DEFAULT_SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"

TREAD_SUFFIXES = {
    "directional": "directional",
    "multi-bar": "multi-bar",
    "c-block": "c-block",
    "zig-zag": "zig-zag",
    "mx": "mx",
    "mx-non-marking": "mx",
    "l-tread": "l-tread",
    "block": "block",
    "zb": "z-max",
    "all-terrain": "all-terrain",
    "staggered-block": "staggered-block",
    "x-terrain": "x-terrain",
    "v-pattern": "v-pattern",
    "s-lug": "s-lug",
    "nd": "nd",
    "standard": "standard",
    "offset-block": "offset-block",
    "t-bar": "t-bar",
    "fitment-reference": "directional",
}


PRODUCTS_PAGE_QUERY = """
query ProductsPage($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      variants(first: 50) {
        nodes { sku }
      }
    }
  }
}
"""


class ShopifyProductCache:
    """In-memory index of all Shopify products (one paginated load at startup)."""

    def __init__(self) -> None:
        self.by_handle: dict[str, str] = {}
        self.by_sku: dict[str, str] = {}
        self.all_products: list[dict] = []

    @classmethod
    def load(cls) -> ShopifyProductCache:
        cache = cls()
        cursor: str | None = None
        page = 0
        t0 = time.monotonic()
        while True:
            data = shopify_gql(PRODUCTS_PAGE_QUERY, {"cursor": cursor})
            conn = data.get("products") or data.get("data", {}).get("products")
            if not conn:
                raise RuntimeError(f"Unexpected products response: {data}")
            for node in conn["nodes"]:
                gid = node["id"]
                handle = (node.get("handle") or "").strip().lower()
                product = {"id": gid, "handle": node.get("handle", ""), "title": node.get("title", "")}
                cache.all_products.append(product)
                if handle:
                    cache.by_handle[handle] = gid
                for variant in (node.get("variants") or {}).get("nodes") or []:
                    sku = (variant.get("sku") or "").strip()
                    if sku and sku not in cache.by_sku:
                        cache.by_sku[sku] = gid
            page += 1
            page_info = conn["pageInfo"]
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
        elapsed = time.monotonic() - t0
        print(
            f"[cache] loaded {len(cache.all_products)} products, "
            f"{len(cache.by_handle)} handles, {len(cache.by_sku)} SKUs "
            f"({page} pages, {elapsed:.1f}s)",
            file=sys.stderr,
        )
        return cache

    def product_by_handle(self, handle: str) -> str | None:
        return self.by_handle.get(handle.strip().lower())

    def product_by_sku(self, sku: str) -> str | None:
        return self.by_sku.get(sku.strip())

    def search(self, query: str, limit: int = 8) -> list[dict]:
        q = query.strip()
        m = re.match(r"title:\*([^*]+)\*([^*]+)\*$", q)
        if m:
            w, links = m.group(1).lower(), m.group(2).lower()
            out = [
                p
                for p in self.all_products
                if w in f"{p.get('handle', '')} {p.get('title', '')}".lower()
                and links in f"{p.get('handle', '')} {p.get('title', '')}".lower()
            ]
            return out[:limit]
        m = re.match(r"title:\*([^*]+)\*$", q)
        if m:
            term = m.group(1).lower()
            out = [
                p
                for p in self.all_products
                if term in f"{p.get('handle', '')} {p.get('title', '')}".lower()
            ]
            return out[:limit]
        return []


def shopify_gql_cli(query: str, variables: dict | None = None, retries: int = 3) -> dict:
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
        "SHOPIFY_CLI_AGENT_IDS": "s:backfill|r:script|i:1",
    }
    last_err = ""
    for attempt in range(retries):
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
        if r.returncode == 0:
            return json.loads(r.stdout)
        last_err = r.stderr or r.stdout
        if attempt + 1 < retries:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_err)


def shopify_gql(query: str, variables: dict | None = None) -> dict:
    """Prefer SHOPIFY_ADMIN_TOKEN (direct HTTP); fall back to Shopify CLI."""
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN")
    shop = os.environ.get("SHOPIFY_STORE_DOMAIN", STORE)
    version = os.environ.get("SHOPIFY_API_VERSION", "2025-10")
    if token:
        body: dict = {"query": query}
        if variables:
            body["variables"] = variables
        req = urllib.request.Request(
            f"https://{shop}/admin/api/{version}/graphql.json",
            data=json.dumps(body).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
            },
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read())
        if payload.get("errors"):
            raise RuntimeError(json.dumps(payload["errors"]))
        return payload.get("data") or payload
    return shopify_gql_cli(query, variables)


def shopify_product_by_handle(handle: str, cache: ShopifyProductCache | None = None) -> str | None:
    if cache is not None:
        return cache.product_by_handle(handle)
    data = shopify_gql(
        "query ProductByHandle($handle: String!) { productByHandle(handle: $handle) { id handle } }",
        {"handle": handle},
    )
    product = data.get("productByHandle")
    return product.get("id") if product else None


def shopify_product_by_sku(sku: str, cache: ShopifyProductCache | None = None) -> str | None:
    if cache is not None:
        return cache.product_by_sku(sku)
    data = shopify_gql(
        "query ProductBySku($q: String!) { productVariants(first: 1, query: $q) { nodes { product { id handle } } } }",
        {"q": f"sku:{sku}"},
    )
    nodes = (data.get("productVariants") or {}).get("nodes") or []
    if nodes and nodes[0].get("product"):
        return nodes[0]["product"]["id"]
    return None


def normalize_supabase_handle(handle: str) -> str | None:
    """Map Supabase catalog handle → Shopify product handle."""
    h = handle.strip().lower()
    if not h.endswith("-rubber-tracks"):
        return None

    base = h[: -len("-rubber-tracks")]
    tread = None
    for key in sorted(TREAD_SUFFIXES, key=len, reverse=True):
        suffix = f"-{key}"
        if base.endswith(suffix):
            tread = TREAD_SUFFIXES[key]
            base = base[: -len(suffix)]
            break

    base = re.sub(r"\s+", "", base)
    base = re.sub(r"(\d+\.\d+)", lambda m: m.group(1).replace(".", "-"), base)
    base = base.replace("bx", "x").replace("tx", "x").replace("wx", "x").replace("kx", "x")

    if tread:
        return f"{base}-rubber-track-{tread}"
    return None


def parse_track_size(raw: str) -> tuple[str, str, str]:
    """Parse track size into (width, pitch, links). Accepts handles or track_size fields."""
    ts = re.sub(r"\s+", "", (raw or "").lower())
    ts = ts.replace("bx", "x").replace("tx", "x").replace("wx", "x").replace("kx", "x")
    m = re.search(r"(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)[a-z]*x(\d+)", ts)
    if not m:
        return "", "", ""
    return m.group(1), m.group(2), m.group(3)


def track_size_family_key(width: str, links: str) -> str | None:
    if not width or not links:
        return None
    return f"{width}::{links}"


def pitch_fuzzy_base_variants(base: str) -> list[str]:
    """Shopify often hyphenates pitch (160x87-63x28) while Supabase uses 160x87bx28."""
    variants = [base]
    m = re.match(r"^(\d+)x87x(\d+)$", base)
    if m:
        variants.append(f"{m.group(1)}x87-63x{m.group(2)}")
    m = re.match(r"^(\d+)x87-63x(\d+)$", base)
    if m:
        variants.append(f"{m.group(1)}x87x{m.group(2)}")
    return variants


def digits_match_size_family(digits: str, width: str, links: str) -> bool:
    w = re.sub(r"[^0-9]", "", width)
    if not digits or not w or not links:
        return False
    return digits.startswith(w) and digits.endswith(links)


def normalize_handle_candidates(handle: str) -> list[str]:
    """Generate Shopify handle candidates from a Supabase catalog handle."""
    h = handle.strip().lower()
    out: list[str] = []

    def add(c: str | None) -> None:
        if c and c not in out:
            out.append(c)

    add(h.replace("-rubber-tracks", "-rubber-track-directional"))
    add(normalize_supabase_handle(h))

    if h.endswith("-rubber-tracks"):
        base = h[: -len("-rubber-tracks")]
        tread_suffix = ""
        for key in sorted(TREAD_SUFFIXES, key=len, reverse=True):
            suffix = f"-{key}"
            if base.endswith(suffix):
                tread_suffix = key
                base = base[: -len(suffix)]
                break
        base = re.sub(r"\s+", "", base)
        base = re.sub(r"(\d+\.\d+)", lambda m: m.group(1).replace(".", "-"), base)
        base = base.replace("bx", "x").replace("tx", "x").replace("wx", "x").replace("kx", "x")
        tread_slugs = sorted(set(TREAD_SUFFIXES.values()))
        for pitch_base in pitch_fuzzy_base_variants(base):
            for slug in tread_slugs:
                add(f"{pitch_base}-rubber-track-{slug}")

    return out


def shopify_products_search(query: str, cache: ShopifyProductCache | None = None) -> list[dict]:
    if cache is not None:
        return cache.search(query)
    data = shopify_gql(
        "query ProductSearch($q: String!) { products(first: 8, query: $q) { nodes { id handle title } } }",
        {"q": query},
    )
    return (data.get("products") or {}).get("nodes") or []


def digits_from_handle(handle: str) -> str:
    return re.sub(r"[^0-9]", "", handle or "")


def pick_product_by_size_tread(products: list[dict], digits: str, tread_slug: str | None) -> str | None:
    if not products or not digits:
        return None
    tread_bits = [tread_slug] if tread_slug else []
    tread_bits.extend(["directional", "multi-bar", "c-block", "mx", "v-pattern"])
    size_matches: list[dict] = []
    for p in products:
        blob = f"{p.get('handle', '')} {p.get('title', '')}".lower()
        blob_digits = re.sub(r"[^0-9]", "", blob)
        if digits not in blob_digits and not blob_digits.startswith(digits[:3]):
            continue
        size_matches.append(p)
        if tread_slug and any(t in blob for t in tread_bits if t):
            return p.get("id")
    if size_matches:
        return size_matches[0].get("id")
    return products[0].get("id") if products else None


def pick_product_by_size_family(products: list[dict], width: str, links: str) -> str | None:
    for p in products:
        blob_digits = re.sub(r"[^0-9]", "", f"{p.get('handle', '')} {p.get('title', '')}")
        if digits_match_size_family(blob_digits, width, links):
            return p.get("id")
    return None


class BackfillContext:
    """Shared maps: tread variants in Supabase often share one Shopify product per size."""

    def __init__(self) -> None:
        self.sibling_gid_by_family: dict[str, str] = {}
        self.track_gid_by_family: dict[str, str] = {}

    def sibling_gid(self, track_size: str | None, handle: str) -> str | None:
        width, _, links = parse_track_size(track_size or handle)
        fk = track_size_family_key(width, links)
        if not fk:
            return None
        return self.sibling_gid_by_family.get(fk) or self.track_gid_by_family.get(fk)


def resolve_shopify_gid(
    handle: str,
    sku: str | None,
    track_size: str | None = None,
    ctx: BackfillContext | None = None,
    cache: ShopifyProductCache | None = None,
) -> tuple[str | None, str]:
    gid = shopify_product_by_handle(handle, cache)
    if gid:
        return gid, "handle"

    if sku:
        gid = shopify_product_by_sku(sku.strip(), cache)
        if gid:
            return gid, "sku"

    for candidate in normalize_handle_candidates(handle):
        if candidate == handle:
            continue
        gid = shopify_product_by_handle(candidate, cache)
        if gid:
            return gid, "normalized"

    width, _, links = parse_track_size(track_size or handle)
    digits = digits_from_handle(handle)
    tread = None
    for key, slug in TREAD_SUFFIXES.items():
        if f"-{key}" in handle.lower():
            tread = slug
            break
    if digits:
        nodes = shopify_products_search(f"title:*{digits}*", cache)
        gid = pick_product_by_size_tread(nodes, digits, tread)
        if gid:
            return gid, "search"
        if width and links:
            search_width = re.sub(r"[^0-9]", "", width)
            nodes = shopify_products_search(f"title:*{search_width}*{links}*", cache)
            gid = pick_product_by_size_family(nodes, width, links)
            if gid:
                return gid, "search_family"

    if ctx:
        gid = ctx.sibling_gid(track_size, handle)
        if gid:
            return gid, "sibling"

    return None, "none"


def apply_match_to_ctx(ctx: BackfillContext, track_size: str | None, handle: str, gid: str) -> None:
    width, _, links = parse_track_size(track_size or handle)
    fk = track_size_family_key(width, links)
    if fk and fk not in ctx.sibling_gid_by_family:
        ctx.sibling_gid_by_family[fk] = gid


def process_row(
    row: dict,
    ctx: BackfillContext,
    cache: ShopifyProductCache | None,
) -> tuple[str, str | None, str, str | None]:
    """Returns (handle, gid, method, error)."""
    handle = (row.get("handle") or "").strip()
    sku = (row.get("sku") or "").strip() or None
    track_size = (row.get("track_size") or "").strip() or None
    if not handle:
        return "", None, "none", None
    try:
        gid, method = resolve_shopify_gid(handle, sku, track_size, ctx, cache)
    except Exception as e:
        return handle, None, "none", str(e)
    return handle, gid, method, None


def supabase_fetch_pending(url: str, key: str) -> list[dict]:
    req = urllib.request.Request(
        f"{url}/rest/v1/product?select=id,handle,sku,track_size"
        "&shopify_product_id=is.null&handle=not.is.null&order=handle",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def supabase_get_json(url: str, key: str, path: str) -> list[dict]:
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        return data if isinstance(data, list) else []


def build_backfill_context(url: str, key: str) -> BackfillContext:
    ctx = BackfillContext()
    for row in supabase_get_json(
        url,
        key,
        "product?select=track_size,shopify_product_id&shopify_product_id=not.is.null",
    ):
        gid = row.get("shopify_product_id")
        if not gid:
            continue
        width, _, links = parse_track_size(row.get("track_size") or "")
        fk = track_size_family_key(width, links)
        if fk and fk not in ctx.sibling_gid_by_family:
            ctx.sibling_gid_by_family[fk] = gid

    for row in supabase_get_json(url, key, "shopify_track_map?select=handle,product_id"):
        gid = row.get("product_id")
        if not gid:
            continue
        width, _, links = parse_track_size(row.get("handle") or "")
        fk = track_size_family_key(width, links)
        if fk and fk not in ctx.track_gid_by_family:
            ctx.track_gid_by_family[fk] = gid

    return ctx


def supabase_update_product(url: str, key: str, product_id: str, shopify_gid: str) -> None:
    body = json.dumps({"shopify_product_id": shopify_gid}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/product?id=eq.{product_id}",
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req) as resp:
        resp.read()


def load_dotenv_fitment() -> None:
    """Load .env.fitment.local if present (SHOPIFY_ADMIN_TOKEN, Supabase keys)."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, ".env.fitment.local")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = val.strip().strip('"').strip("'")


def main() -> int:
    load_dotenv_fitment()
    parser = argparse.ArgumentParser(description="Backfill product.shopify_product_id from Shopify handles")
    parser.add_argument("--dry-run", action="store_true", help="Resolve handles only; do not write to Supabase")
    parser.add_argument("--apply", action="store_true", help="Write matched GIDs to Supabase")
    parser.add_argument("--input-json", help="Read pending rows from JSON file (id, handle, sku) instead of Supabase REST")
    parser.add_argument("--output-updates", help="Write matched updates JSON to file (for MCP/SQL apply)")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to process (0 = all)")
    parser.add_argument("--workers", type=int, default=8, help="Parallel workers for GID resolution (default 8)")
    parser.add_argument("--no-cache", action="store_true", help="Skip bulk Shopify product cache (CLI per lookup)")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        print("Use --dry-run or --apply, not both.", file=sys.stderr)
        return 1
    if not args.dry_run and not args.apply:
        args.dry_run = True

    url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL)
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if args.input_json:
        rows = json.loads(open(args.input_json, encoding="utf-8").read())
    else:
        if not key:
            print("Set SUPABASE_SERVICE_ROLE_KEY (service_role JWT) or pass --input-json.", file=sys.stderr)
            return 1
        rows = supabase_fetch_pending(url, key)
    if args.limit:
        rows = rows[: args.limit]

    ctx = build_backfill_context(url, key) if key else BackfillContext()

    cache: ShopifyProductCache | None = None
    if not args.no_cache:
        cache = ShopifyProductCache.load()

    matched = 0
    missing = 0
    errors: list[str] = []
    by_method: dict[str, int] = {}
    updates: list[dict] = []
    t0 = time.monotonic()

    def record_result(row: dict, handle: str, gid: str | None, method: str, err: str | None) -> None:
        nonlocal matched, missing
        if err:
            errors.append(f"{handle}: {err}")
            return
        if gid:
            matched += 1
            by_method[method] = by_method.get(method, 0) + 1
            track_size = (row.get("track_size") or "").strip() or None
            updates.append({"id": row["id"], "handle": handle, "gid": gid, "method": method})
            apply_match_to_ctx(ctx, track_size, handle, gid)
            if args.apply:
                if not key:
                    errors.append(f"{handle}: --apply requires SUPABASE_SERVICE_ROLE_KEY")
                    return
                try:
                    supabase_update_product(url, key, row["id"], gid)
                except urllib.error.HTTPError as e:
                    errors.append(f"{handle}: supabase {e.code} {e.read().decode()}")
                    return
            elif not args.apply:
                print(f"[dry-run] {handle} → {gid} ({method})")
        else:
            missing += 1
            print(f"[miss] {handle}", file=sys.stderr)

    def resolve_rows(work_rows: list[dict], parallel: bool) -> list[tuple[dict, str, str | None, str, str | None]]:
        """Resolve GIDs; parallel pass skips live ctx (sibling uses frozen ctx)."""
        frozen_ctx = ctx
        results: list[tuple[dict, str, str | None, str, str | None] | None] = [None] * len(work_rows)

        if parallel and args.workers > 1 and len(work_rows) > 1:
            lock = Lock()

            def task(idx_row: tuple[int, dict]) -> tuple[int, dict, str, str | None, str, str | None]:
                idx, row = idx_row
                handle, gid, method, err = process_row(row, frozen_ctx, cache)
                return idx, row, handle, gid, method, err

            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futs = [pool.submit(task, (i, row)) for i, row in enumerate(work_rows)]
                for fut in as_completed(futs):
                    idx, row, handle, gid, method, err = fut.result()
                    with lock:
                        results[idx] = (row, handle, gid, method, err)
        else:
            for i, row in enumerate(work_rows):
                handle, gid, method, err = process_row(row, ctx, cache)
                results[i] = (row, handle, gid, method, err)

        return [r for r in results if r is not None]

    # Pass 1: parallel resolve (sibling uses Supabase/pre-seeded ctx only)
    pass1 = resolve_rows(rows, parallel=True)
    pending_sibling: list[dict] = []
    for i, (row, handle, gid, method, err) in enumerate(pass1):
        if err:
            errors.append(f"{handle}: {err}")
            continue
        if gid:
            record_result(row, handle, gid, method, None)
        elif handle:
            pending_sibling.append(row)
        if (i + 1) % 25 == 0:
            elapsed = time.monotonic() - t0
            print(
                f"[progress] {i + 1}/{len(rows)} rows, {matched} matched, {elapsed:.1f}s",
                file=sys.stderr,
            )

    # Pass 2: sequential sibling retry with ctx updated from pass 1 matches
    for i, row in enumerate(pending_sibling):
        handle = (row.get("handle") or "").strip()
        sku = (row.get("sku") or "").strip() or None
        track_size = (row.get("track_size") or "").strip() or None
        try:
            gid, method = resolve_shopify_gid(handle, sku, track_size, ctx, cache)
        except Exception as e:
            errors.append(f"{handle}: {e}")
            continue
        record_result(row, handle, gid, method, None)
        done = len(rows) - len(pending_sibling) + i + 1
        if done % 25 == 0:
            elapsed = time.monotonic() - t0
            print(
                f"[progress] {done}/{len(rows)} rows, {matched} matched, {elapsed:.1f}s",
                file=sys.stderr,
            )

    elapsed = time.monotonic() - t0
    mode = "apply" if args.apply else "dry-run"
    print(
        f"\n=== backfill ({mode}) ===\n"
        f"  candidates: {len(rows)}\n"
        f"  matched:    {matched}\n"
        f"  missing:    {missing}\n"
        f"  errors:     {len(errors)}\n"
        f"  elapsed:    {elapsed:.1f}s\n"
        f"  by method:  {', '.join(f'{k}={v}' for k, v in sorted(by_method.items()))}"
    )
    for err in errors[:10]:
        print(f"  - {err}", file=sys.stderr)
    if args.output_updates:
        with open(args.output_updates, "w", encoding="utf-8") as f:
            json.dump({"updates": updates, "missing": missing, "by_method": by_method}, f, indent=2)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
