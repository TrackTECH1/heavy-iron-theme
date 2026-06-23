"""Dev branch Supabase Postgres access (My Fleet clean spine)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV_REF = "zhdqdxtwipcowbtdyviq"
PARENT_REF = "tcykyktvdlsbscrsbjyt"


def get_dev_postgres_url(*, pooling: bool = True) -> str:
    out = subprocess.check_output(
        [
            "npx",
            "supabase",
            "branches",
            "get",
            DEV_REF,
            "--project-ref",
            PARENT_REF,
            "-o",
            "json",
        ],
        cwd=ROOT,
        text=True,
    )
    data = json.loads(out)
    key = "POSTGRES_URL" if pooling else "POSTGRES_URL_NON_POOLING"
    url = data.get(key) or data.get("POSTGRES_URL")
    if not url or DEV_REF not in url:
        raise RuntimeError(f"Dev branch Postgres URL not found for {DEV_REF}")
    return url
