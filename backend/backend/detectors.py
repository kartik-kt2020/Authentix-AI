"""
Detection backends for Authentix AI.

Loads three pretrained Hugging Face models the first time they're needed
(lazy loading, so the API boots fast) and exposes a single
`analyze_file(path, mime_type)` entrypoint used by main.py.

Models:
  - Image:  prithivMLmods/Deep-Fake-Detector-v2-Model   (ViT image-classification)
  - Video:  same image model, run over sampled frames and averaged
  - Audio:  MelodyMachine/Deepfake-audio-detection-V2   (wav2vec2 audio-classification)

All three are downloaded automatically from the Hugging Face Hub the first
time they're used (requires internet access + a few GB of disk the first
run) and then cached locally under ~/.cache/huggingface.
"""

import io
import logging
from functools import lru_cache
from typing import Literal

import numpy as np
from PIL import Image

logger = logging.getLogger("Authentix.detectors")

IMAGE_MODEL_ID = "prithivMLmods/Deep-Fake-Detector-v2-Model"
AUDIO_MODEL_ID = "MelodyMachine/Deepfake-audio-detection-V2"

# How many frames to sample from a video for analysis.
VIDEO_SAMPLE_FRAMES = 12


# ---------------------------------------------------------------------------
# Lazy model loaders (cached so each model loads into memory only once)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_image_pipeline():
    from transformers import pipeline
    logger.info("Loading image deepfake model: %s", IMAGE_MODEL_ID)
    return pipeline("image-classification", model=IMAGE_MODEL_ID)


@lru_cache(maxsize=1)
def _get_audio_pipeline():
    from transformers import pipeline
    logger.info("Loading audio deepfake model: %s", AUDIO_MODEL_ID)
    return pipeline("audio-classification", model=AUDIO_MODEL_ID)


# ---------------------------------------------------------------------------
# Helpers to normalize a model's label set down to fake_probability in [0,1]
# ---------------------------------------------------------------------------

FAKE_LABEL_HINTS = ("fake", "deepfake", "spoof", "synthetic", "1", "1_fake")
REAL_LABEL_HINTS = ("real", "bonafide", "authentic", "0", "0_real")


def _fake_probability_from_scores(scores: list[dict]) -> float:
    """
    Returns the model's probability that the image is FAKE.

    For prithivMLmods/Deep-Fake-Detector-v2-Model:
        Realism  = class 0
        Deepfake = class 1
    """

    for entry in scores:
        label = str(entry["label"]).lower()

        if label == "deepfake":
            return float(entry["score"])

        if label == "realism":
            return float(1.0 - entry["score"])

    logger.warning("Unexpected model labels: %s", scores)
    return 0.5


# ---------------------------------------------------------------------------
# Per-media-type analyzers
# ---------------------------------------------------------------------------

def analyze_image_bytes(data: bytes) -> dict:
    pipe = _get_image_pipeline()
    image = Image.open(io.BytesIO(data)).convert("RGB")
    scores = pipe(image)

    print("MODEL OUTPUT:", scores)

    fake_prob = _fake_probability_from_scores(scores)

    return {
        "fakeProbability": fake_prob,
        "raw": scores,
    }


def analyze_video_path(path: str) -> dict:
    import cv2

    pipe = _get_image_pipeline()
    cap = cv2.VideoCapture(path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    if total_frames <= 0:
        cap.release()
        raise ValueError("Could not read any frames from video")

    n_samples = min(VIDEO_SAMPLE_FRAMES, total_frames)
    frame_indices = np.linspace(0, total_frames - 1, n_samples, dtype=int)

    frame_scores = []
    for idx in frame_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok:
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(rgb)
        scores = pipe(image)
        frame_scores.append(_fake_probability_from_scores(scores))

    cap.release()

    if not frame_scores:
        raise ValueError("Could not extract usable frames from video")

    fake_prob = float(np.mean(frame_scores))
    return {
        "fakeProbability": fake_prob,
        "raw": {
            "framesSampled": len(frame_scores),
            "perFrameFakeProbability": frame_scores,
        },
    }


def analyze_audio_path(path: str) -> dict:
    import librosa

    pipe = _get_audio_pipeline()
    # wav2vec2-family models expect 16kHz mono audio
    waveform, _sr = librosa.load(path, sr=16000, mono=True)
    scores = pipe({"array": waveform, "sampling_rate": 16000})
    fake_prob = _fake_probability_from_scores(scores)
    return {
        "fakeProbability": fake_prob,
        "raw": scores,
    }


MediaKind = Literal["image", "video", "audio"]


def classify_media_kind(mime_type: str, filename: str) -> MediaKind:
    mime_type = (mime_type or "").lower()
    name = filename.lower()
    if mime_type.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
        return "image"
    if mime_type.startswith("video/") or name.endswith((".mp4", ".mov", ".avi", ".mkv", ".webm")):
        return "video"
    if mime_type.startswith("audio/") or name.endswith((".wav", ".mp3", ".m4a", ".flac", ".ogg")):
        return "audio"
    raise ValueError(f"Unsupported file type: {mime_type or name}")


def analyze_file(path: str, mime_type: str, filename: str) -> dict:
    """
    Single entrypoint used by the API layer.
    Returns: {"kind": ..., "fakeProbability": float 0..1, "raw": ...}
    """
    kind = classify_media_kind(mime_type, filename)

    if kind == "image":
        with open(path, "rb") as f:
            result = analyze_image_bytes(f.read())
    elif kind == "video":
        result = analyze_video_path(path)
    else:
        result = analyze_audio_path(path)

    result["kind"] = kind
    return result
