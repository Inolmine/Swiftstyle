from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{v}/float16/latest/pose_landmarker_{v}.task"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def main() -> None:
    variant = sys.argv[1] if len(sys.argv) > 1 else "full"
    if variant not in ("lite", "full", "heavy"):
        sys.exit("Variante inconnue : lite, full ou heavy.")
    MODELS_DIR.mkdir(exist_ok=True)
    target = MODELS_DIR / f"pose_landmarker_{variant}.task"
    print(f"Téléchargement de {target.name}…")
    urllib.request.urlretrieve(URL.format(v=variant), target)
    print(f"{target} ({target.stat().st_size / 1e6:.1f} Mo)")


if __name__ == "__main__":
    main()
