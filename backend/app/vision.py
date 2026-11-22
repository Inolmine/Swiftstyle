from __future__ import annotations

import io
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .measure import Landmark, MeasureError, View


class ImageError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def decode_image(data: bytes, max_side: int) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((max_side, max_side))
            return np.asarray(im, dtype=np.uint8)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageError(400, "invalid_image", "Le fichier envoyé n'est pas une image lisible (JPEG, PNG ou WebP).") from exc


class PoseAnalyzer:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self._detector = None
        self._lock = threading.Lock()

    def _load(self):
        from mediapipe.tasks.python import BaseOptions, vision

        if not self.model_path.is_file():
            raise FileNotFoundError(
                f"Modèle MediaPipe introuvable : {self.model_path}. Lancer : python scripts/download_model.py"
            )
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            output_segmentation_masks=True,
        )
        return vision.PoseLandmarker.create_from_options(options)

    def __call__(self, rgb: np.ndarray) -> View:
        import mediapipe as mp

        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        with self._lock:
            if self._detector is None:
                self._detector = self._load()
            result = self._detector.detect(image)
            if not result.pose_landmarks or not result.segmentation_masks:
                raise MeasureError("no_person", "Aucune personne détectée sur la photo.")
            mask = np.array(result.segmentation_masks[0].numpy_view(), dtype=np.float32, copy=True).reshape(rgb.shape[:2])

        landmarks = [
            Landmark(x=p.x, y=p.y, visibility=1.0 if p.visibility is None else p.visibility)
            for p in result.pose_landmarks[0]
        ]
        return View(mask=mask, landmarks=landmarks)
