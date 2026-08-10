"""
Minimal persistence for scan history (powers the "Recent Scans" sidebar).

Uses a plain JSON file so there's no database to install for local dev.
Swap this out for a real DB (Postgres, SQLite via SQLAlchemy, etc.) later
without changing the API layer — main.py only calls the functions below.
"""

import json
import threading
from pathlib import Path
from typing import Any

DATA_FILE = Path(__file__).parent / "data" / "scans.json"
_lock = threading.Lock()


def _ensure_file() -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text("[]")


def list_scans(limit: int = 50) -> list[dict[str, Any]]:
    _ensure_file()
    with _lock:
        scans = json.loads(DATA_FILE.read_text())
    return scans[:limit]


def get_scan(scan_id: str) -> dict[str, Any] | None:
    _ensure_file()
    with _lock:
        scans = json.loads(DATA_FILE.read_text())
    return next((s for s in scans if s["id"] == scan_id), None)


def add_scan(scan: dict[str, Any]) -> None:
    _ensure_file()
    with _lock:
        scans = json.loads(DATA_FILE.read_text())
        scans.insert(0, scan)  # newest first
        scans = scans[:200]  # cap history size
        DATA_FILE.write_text(json.dumps(scans, indent=2))
