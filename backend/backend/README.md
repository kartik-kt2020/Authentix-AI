# DeepShield AI — Backend

FastAPI backend for the DeepShield AI frontend. Accepts an uploaded
image, video, or audio file and returns a real/fake verdict using
pretrained Hugging Face models (no training required).

## Models used

| Media | Model | Task |
|---|---|---|
| Image | `prithivMLmods/Deep-Fake-Detector-v2-Model` | ViT image-classification |
| Video | same image model, run on 12 sampled frames and averaged | — |
| Audio | `MelodyMachine/Deepfake-audio-detection-V2` | wav2vec2 audio-classification |

Models download automatically from the Hugging Face Hub the first time
each is used (a few hundred MB–1GB each) and are cached in
`~/.cache/huggingface`. After the first run, startup and inference are
local/offline.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`. First request to
`/api/scan` for each media type will be slow (model download + load);
subsequent requests are fast.

If you have a CUDA GPU, install a CUDA build of `torch` from
https://pytorch.org/get-started/locally/ instead of the CPU wheel in
requirements.txt for much faster inference.

## Endpoints

- `GET /api/health` — health check
- `POST /api/scan` — multipart upload, field name `file`. Returns:
  ```json
  {
    "id": "…",
    "filename": "clip.mp4",
    "kind": "video",
    "verdict": "fake",
    "fakeProbability": 0.87,
    "confidencePercent": 87.0,
    "fileUrl": "/uploads/….mp4",
    "createdAt": 1730000000.0,
    "details": { "framesSampled": 12, "perFrameFakeProbability": [...] }
  }
  ```
- `GET /api/scans?limit=50` — recent scan history (used by the sidebar)
- `GET /api/scans/{id}` — a single scan's full result
- `GET /uploads/{filename}` — serves the originally uploaded file

## Connecting the frontend

Set `VITE_API_BASE` in the frontend's `.env` if the backend isn't at
`http://localhost:8000` (that's the default `App.jsx` uses):

```
VITE_API_BASE=http://localhost:8000
```

CORS is pre-configured for Vite's default dev server
(`http://localhost:5173`). Add your deployed frontend's origin to the
`allow_origins` list in `main.py` before deploying.

## Notes & honest limitations

- These are third-party open-source models, not a proprietary
  "DeepShield" model — accuracy varies by dataset and won't match a
  production-grade commercial detector. Treat scores as a probabilistic
  signal, not ground truth.
- Storage is a flat JSON file (`data/scans.json`) — fine for local dev,
  swap for a real database before shipping this to real users.
- Uploaded files are kept on disk under `uploads/` indefinitely; add
  cleanup/expiry if that matters for your deployment.
