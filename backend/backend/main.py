"""
Authentix AI backend.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Endpoints:
    GET  /api/health              -> {"status": "ok"}
    POST /api/scan                -> multipart file upload, runs detection
    GET  /api/scans                -> recent scan history (for the sidebar)
    GET  /api/scans/{scan_id}      -> a single scan's full result
    GET  /uploads/{filename}       -> serve the originally uploaded file
"""

import logging
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import detectors
import storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Authentix.api")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB

app = FastAPI(title="Authentix AI API", version="1.0.0")

# Vite's default dev server ports. Add your deployed frontend origin too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/scan")
async def scan_file(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (200 MB max)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    scan_id = uuid.uuid4().hex
    suffix = Path(file.filename or "").suffix
    stored_name = f"{scan_id}{suffix}"
    stored_path = UPLOAD_DIR / stored_name
    stored_path.write_bytes(data)

    try:
        result = detectors.analyze_file(
            str(stored_path), file.content_type or "", file.filename or ""
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Analysis failed for %s", file.filename)
        raise HTTPException(status_code=500, detail="Analysis failed")

    fake_probability = result["fakeProbability"]
    verdict = "fake" if fake_probability >= 0.5 else "real"
    # Confidence in whichever verdict was chosen (0.5 -> 100% would be
    # misleading, so we scale distance-from-0.5 back up to a 0-100 display %)
    confidence_percent = round(
        (max(fake_probability, 1 - fake_probability)) * 100, 1
    )

    scan_record = {
        "id": scan_id,
        "filename": file.filename,
        "mimeType": file.content_type,
        "kind": result["kind"],
        "verdict": verdict,
        "fakeProbability": round(fake_probability, 4),
        "confidencePercent": confidence_percent,
        "fileUrl": f"/uploads/{stored_name}",
        "createdAt": time.time(),
        "details": result.get("raw"),
    }

    storage.add_scan(scan_record)
    return scan_record


@app.get("/api/scans")
def get_scans(limit: int = 50):
    return storage.list_scans(limit=limit)


@app.get("/api/scans/{scan_id}")
def get_scan(scan_id: str):
    scan = storage.get_scan(scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan
