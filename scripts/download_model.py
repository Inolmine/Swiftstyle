from __future__ import annotations

import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

BASE_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
MODEL_URLS = {
    variant: f"{BASE_URL}/pose_landmarker_{variant}/float16/latest/pose_landmarker_{variant}.task"
    for variant in ("lite", "full", "heavy")
}
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Empreinte du modèle « latest » à la date du portage dans le navigateur (le site vérifie la même) : un changement
# chez Google fait échouer le téléchargement, et donc la construction de l'image Docker, au lieu de passer inaperçu.
SHA256 = {"full": "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad"}


def https_only_opener() -> urllib.request.OpenerDirector:
    """Opener qui ne parle que HTTPS.

    Contrairement à `urlretrieve` / `build_opener`, il n'a ni FileHandler, ni FTPHandler, ni
    DataHandler, ni HTTPHandler : une URL (ou une redirection) en file://, ftp://, data: ou http://
    est refusée par UnknownHandler.
    """
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.ProxyHandler(),
        urllib.request.UnknownHandler(),
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.HTTPDefaultErrorHandler(),
        urllib.request.HTTPErrorProcessor(),
    ):
        opener.add_handler(handler)
    return opener


def main() -> None:
    variant = sys.argv[1] if len(sys.argv) > 1 else "full"
    if variant not in MODEL_URLS:
        sys.exit("Variante inconnue : lite, full ou heavy.")
    MODELS_DIR.mkdir(exist_ok=True)
    target = MODELS_DIR / f"pose_landmarker_{variant}.task"
    partial = target.with_suffix(".task.part")
    print(f"Téléchargement de {target.name}…")
    with https_only_opener().open(MODEL_URLS[variant], timeout=60) as response, partial.open("wb") as out:
        shutil.copyfileobj(response, out)
    digest = hashlib.sha256(partial.read_bytes()).hexdigest()
    if variant in SHA256 and digest != SHA256[variant]:
        partial.unlink()
        sys.exit(f"Le modèle publié par Google a changé (empreinte {digest}) : le vérifier, puis mettre à jour SHA256.")
    partial.replace(target)
    print(f"{target} ({target.stat().st_size / 1e6:.1f} Mo)")


if __name__ == "__main__":
    main()
