from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .framing import Expect, Framing, check_framing
from .limits import RateLimited, RateLimiter
from .measure import ZONES, Measurement, MeasureError, ViewResult, measure
from .vision import ImageError, PoseAnalyzer, decode_image

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent

MODEL_PATH = Path(os.environ.get("MODEL_PATH") or BACKEND_DIR / "models" / "pose_landmarker_full.task")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
# Requêtes par minute et par adresse IP (0 : pas de limite). Le cadrage en direct en reçoit environ 3 par seconde par client.
MEASURE_LIMIT = RateLimiter(int(os.environ.get("RATE_LIMIT_MEASURE", "30")))
POSE_LIMIT = RateLimiter(int(os.environ.get("RATE_LIMIT_POSE", "600")))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SIDE = 1280
MAX_FRAME_SIDE = 640


DESCRIPTION = """
Mesure une personne à partir de sa taille et de ses photos, avec MediaPipe Tasks Vision
(Pose Landmarker) :

- le haut du corps : **tours de poitrine, de taille et de hanches** ;
- le bas du corps : **tour de cuisse** et **entrejambe** (hauteur de l'entrejambe au sol).

Elle est faite pour être appelée depuis les fiches produit des marques : par le widget du site
SwiftStyle (quand la variable `PHOTO_API_URL` du site donne son adresse ; sinon, le widget mesure
dans le navigateur, avec la même méthode portée en TypeScript) et par l'extension navigateur.

Prototype : la méthode fonctionne de bout en bout, mais ses réglages n'ont jamais été comparés à
des mesures prises au mètre ruban.

## Les adresses

| Méthode | Adresse | Rôle |
|---|---|---|
| `GET` | `/health` | l'API répond-elle, le modèle MediaPipe est-il téléchargé ? |
| `POST` | `/v1/photo/measure` | mesure le corps sur une photo de face (et de profil si possible) |
| `POST` | `/v1/photo/pose` | cadrage en direct : la personne est-elle prête pour la photo ? (prise de vue automatique) |
| `GET` | `/docs` | cette page |
| `GET` | `/redoc` | la même documentation, en lecture seule |
| `GET` | `/openapi.json` | le schéma OpenAPI, pour générer un client |

**Essayer ici** : déplier `POST /v1/photo/measure` plus bas, choisir les photos et la taille,
puis cliquer sur **Execute**. La réponse s'affiche juste en dessous.

## Appeler l'API

La requête est un formulaire `multipart/form-data` avec trois champs :

| Champ | | |
|---|---|---|
| `heightCm` | obligatoire | taille du client en cm, de 140 à 210 |
| `front` | obligatoire | photo de face, de la tête aux pieds (JPEG, PNG ou WebP, 10 Mo au plus) |
| `side` | facultatif | photo de profil, de la tête aux pieds |

### Depuis le site d'une marque (navigateur)

```js
const body = new FormData();
body.append("heightCm", "178");
body.append("front", photoDeFace);   // un File, par exemple input.files[0]
body.append("side", photoDeProfil);  // facultatif
const res = await fetch("https://<adresse de l'API>/v1/photo/measure", { method: "POST", body });
const resultat = await res.json();   // resultat.measurements = { chest, waist, hips, thigh, inseam }
```

Le navigateur n'autorise l'appel que si l'adresse du site est dans la variable
`ALLOWED_ORIGINS` de l'API (CORS). Un appel depuis un serveur n'est pas concerné.

### curl

```bash
curl -X POST http://localhost:8000/v1/photo/measure -F heightCm=178 -F front=@face.jpg -F side=@profil.jpg
```

Sous Windows PowerShell, écrire `curl.exe` (`curl` y désigne une autre commande).

Le site SwiftStyle l'appelle depuis `src/lib/photo-measure/api.ts`, pour le widget des marques,
la démo de sa page d'accueil et sa page `/test-photo`.

## Prendre les photos

- Debout, de la tête aux pieds, sans être coupé par le cadre.
- Bras un peu écartés du corps : collés, ils sont retirés par estimation et la mesure est moins sûre.
- Pieds écartés de la largeur des hanches : jambes serrées, l'entrejambe n'est pas visible et il est
  estimé.
- Appareil à hauteur des hanches, à 2 ou 3 m : pris de trop près ou de trop haut, les jambes
  paraissent plus courtes.
- Vêtements près du corps, fond uni.
- Une photo de profil en plus : sans elle, la profondeur du corps est estimée.

## Prise de vue automatique

Le widget et l'extension de SwiftStyle filment le client et prennent les deux photos tout seuls.
Ils envoient plusieurs images par seconde de la caméra, réduites, à `POST /v1/photo/pose`, avec la
vue attendue (`expect` : `front` ou `side`). La réponse dit si la personne est prête (`ready`),
sinon quoi lui dire (`message` : « Reculez : vos pieds doivent être visibles. »…). Dès que la
réponse est `ready` deux fois de suite sans que la personne ait bougé, ils affichent un compte à
rebours de 3 s ; s'il va au bout sans qu'elle bouge, ils gardent comme photo la dernière image
validée, en pleine résolution, et l'envoient ensuite à `/v1/photo/measure` avec l'autre vue.

## Erreurs

Les erreurs de l'API ont la forme `{"error": "<code>", "message": "<texte à afficher>"}`.
Le `message` est en français et peut être montré tel quel au client ; le code `error` est stable.

| Code HTTP | `error` | Cas |
|---|---|---|
| 400 | `invalid_image` | fichier illisible |
| 413 | `image_too_large` | photo de plus de 10 Mo |
| 422 | `no_person` | personne non détectée |
| 422 | `pose_not_detected` | épaules ou hanches mal visibles, posture non reconnue |
| 422 | `body_not_fully_visible` | pieds non visibles, ou silhouette coupée par le bord de la photo |
| 422 | `measure_failed` | un tour n'a pas pu être lu |
| 429 | `rate_limited` | trop de demandes depuis la même adresse (`RATE_LIMIT_MEASURE`, `RATE_LIMIT_POSE`) |

Un champ manquant ou hors limites (par exemple `heightCm` à 90) renvoie aussi un 422, au format
de FastAPI : `{"detail": [...]}`.

## Données personnelles

Les photos sont envoyées à l'API, analysées en mémoire puis oubliées : rien n'est enregistré ni
journalisé. Ce sont quand même des photos du corps : le site qui appelle l'API doit en informer le
client et recueillir son accord.
"""

TAGS = [
    {"name": "Mesure", "description": "Mesurer une personne sur ses photos."},
    {"name": "Prise de vue", "description": "Cadrage en direct, pour prendre les photos automatiquement."},
    {"name": "Service", "description": "État de l'API."},
]

EXAMPLE = json.loads((APP_DIR / "example.json").read_text(encoding="utf-8"))

app = FastAPI(
    title="SwiftStyle · API photo",
    version="0.1.0",
    summary="Tours de poitrine, de taille, de hanches et de cuisse, et entrejambe, mesurés sur photo.",
    description=DESCRIPTION,
    openapi_tags=TAGS,
    swagger_ui_parameters={"tryItOutEnabled": True, "defaultModelsExpandDepth": 0},
)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])

_analyzer = PoseAnalyzer(MODEL_PATH)


def get_analyzer() -> PoseAnalyzer:
    return _analyzer


@app.exception_handler(MeasureError)
def _measure_error(_: Request, exc: MeasureError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": exc.code, "message": exc.message})


@app.exception_handler(ImageError)
def _image_error(_: Request, exc: ImageError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": exc.code, "message": exc.message})


@app.exception_handler(RateLimited)
def _rate_limited(_: Request, __: RateLimited) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"error": "rate_limited", "message": "Trop de demandes depuis votre connexion : réessayez dans une minute."},
        headers={"Retry-After": "60"},
    )


def _limited(limiter: RateLimiter):
    """Dépendance FastAPI : compte la requête pour l'adresse du client (derrière un proxy, uvicorn --proxy-headers)."""

    def check(request: Request) -> None:
        if not limiter.allow(request.client.host if request.client else "inconnu"):
            raise RateLimited()

    return check


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True)


class Line(CamelModel):
    """Ligne où un tour a été lu, en coordonnées 0 à 1 de la photo (pour la dessiner par-dessus)."""

    y: float = Field(description="Hauteur de la ligne : 0 en haut de la photo, 1 en bas.", examples=[0.34])
    x1: float = Field(description="Bord gauche : 0 à gauche de la photo, 1 à droite.", examples=[0.3583])
    x2: float = Field(description="Bord droit, même repère.", examples=[0.6417])


class Lines(CamelModel):
    """Où chaque tour a été lu sur la photo. La cuisse est lue sur une seule jambe, la plus forte."""

    chest: Line
    waist: Line
    hips: Line
    thigh: Line


class InseamLine(CamelModel):
    """Ligne verticale de l'entrejambe au sol, en coordonnées 0 à 1 de la photo de face."""

    x: float = Field(description="Position de la ligne : 0 à gauche de la photo, 1 à droite.", examples=[0.5])
    y1: float = Field(description="Entrejambe : 0 en haut de la photo, 1 en bas.", examples=[0.58])
    y2: float = Field(description="Sol, sous les pieds, même repère.", examples=[0.95])


class ViewOut(CamelModel):
    """Ce que l'API a lu sur une photo."""

    cm_per_px: float = Field(description="Échelle de la photo en cm par pixel, déduite de la taille du client.", examples=[0.2])
    lines: Lines
    inseam: InseamLine | None = Field(description="Où l'entrejambe a été lu. Photo de face seulement : `null` de profil.")


class Measurements(CamelModel):
    """Mensurations du client, en cm. Même forme que `Body` du moteur de recommandation du site."""

    chest: int = Field(description="Tour de poitrine, en cm.", examples=[92])
    waist: int = Field(description="Tour de taille, en cm.", examples=[76])
    hips: int = Field(description="Tour de hanches, en cm.", examples=[96])
    thigh: int = Field(description="Tour de cuisse, juste sous l'entrejambe, en cm.", examples=[53])
    inseam: int = Field(description="Entrejambe : hauteur de l'entrejambe au sol, en cm (une longueur, pas un tour).", examples=[74])


class ZoneOut(CamelModel):
    """Détail d'un tour : il est calculé comme le périmètre d'une ellipse (largeur × profondeur)."""

    circumference: int = Field(description="Tour, en cm (le même que dans `measurements`).", examples=[92])
    width: float = Field(description="Largeur lue sur la photo de face, en cm.", examples=[34.0])
    depth: float = Field(description="Profondeur en cm : lue sur la photo de profil, ou estimée (voir `depthSource`).", examples=[24.0])


class Zones(CamelModel):
    chest: ZoneOut
    waist: ZoneOut
    hips: ZoneOut
    thigh: ZoneOut


class MeasureOut(CamelModel):
    """Résultat de la mesure."""

    model_config = ConfigDict(json_schema_extra={"examples": [EXAMPLE]})

    measurements: Measurements = Field(description="Tours et entrejambe en cm. Se passent tels quels à `recommendSize` du site.")
    zones: Zones = Field(description="Détail de chaque tour : largeur et profondeur (l'entrejambe n'en a pas).")
    depth_source: Literal["profile", "estimated"] = Field(
        description="`profile` : profondeur lue sur la photo de profil. `estimated` : déduite de la largeur, faute de photo de profil."
    )
    front: ViewOut = Field(description="Lecture de la photo de face.")
    side: ViewOut | None = Field(description="Lecture de la photo de profil, `null` s'il n'y en a pas.")
    warnings: list[str] = Field(
        description=(
            "Remarques à montrer au client : bras collés au corps, pas de photo de profil, jambes serrées "
            "(entrejambe estimé), mesure peu plausible."
        )
    )


class PosePoint(CamelModel):
    """Repère du corps (MediaPipe Pose, 33 points), en coordonnées 0 à 1 de l'image."""

    x: float = Field(description="0 à gauche de l'image, 1 à droite.", examples=[0.52])
    y: float = Field(description="0 en haut de l'image, 1 en bas.", examples=[0.31])
    visibility: float = Field(description="Confiance que le point est visible, de 0 à 1.", examples=[0.98])


class BoxOut(CamelModel):
    """Rectangle de la silhouette, en coordonnées 0 à 1 de l'image."""

    x1: float = Field(description="Bord gauche.", examples=[0.38])
    y1: float = Field(description="Haut (sommet de la tête).", examples=[0.06])
    x2: float = Field(description="Bord droit.", examples=[0.62])
    y2: float = Field(description="Bas (sous les pieds).", examples=[0.94])


class PoseOut(CamelModel):
    """Cadrage d'une image de la caméra."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "ready": False,
                    "orientation": "front",
                    "issue": "feet_cut",
                    "message": "Reculez : vos pieds doivent être visibles.",
                    "tips": [],
                    "box": {"x1": 0.38, "y1": 0.1, "x2": 0.62, "y2": 1.0},
                    "landmarks": [{"x": 0.5, "y": 0.14, "visibility": 0.99}],
                }
            ]
        }
    )

    ready: bool = Field(description="`true` : la personne est prête, dans la vue attendue. La photo peut être prise.")
    orientation: Literal["front", "side", "turning"] | None = Field(
        description="Comment la personne est tournée : `front` (de face), `side` (de profil), `turning` (entre les deux), `null` si on ne la voit pas."
    )
    issue: Literal["no_person", "pose_not_detected", "head_cut", "feet_cut", "too_far", "off_center", "wrong_view"] | None = Field(
        description="Ce qui empêche la photo, `null` si elle est prête. Code stable, à tester dans le code."
    )
    message: str = Field(description="Ce qu'il faut dire à la personne, en français, à afficher sur la vidéo.")
    tips: list[str] = Field(description="Conseils qui n'empêchent pas la photo mais améliorent la mesure (bras, pieds). Photo de face seulement.")
    box: BoxOut | None = Field(description="Rectangle de la silhouette, `null` si elle n'est pas trouvée.")
    landmarks: list[PosePoint] = Field(description="Les 33 repères du corps, pour dessiner le squelette par-dessus la vidéo. Vide sans personne.")


def _pose_out(f: Framing, landmarks: list) -> PoseOut:
    return PoseOut(
        ready=f.ready,
        orientation=f.orientation,
        issue=f.issue,
        message=f.message,
        tips=f.tips,
        box=BoxOut(x1=f.box[0], y1=f.box[1], x2=f.box[2], y2=f.box[3]) if f.box else None,
        landmarks=[PosePoint(x=round(p.x, 4), y=round(p.y, 4), visibility=round(p.visibility, 3)) for p in landmarks],
    )


class ErrorOut(BaseModel):
    """Erreur renvoyée par l'API."""

    error: str = Field(description="Code de l'erreur, stable : à tester dans le code.", examples=["no_person"])
    message: str = Field(description="Explication en français, à afficher au client.", examples=["Aucune personne détectée sur la photo."])


class HealthOut(CamelModel):
    model_config = ConfigDict(protected_namespaces=())

    status: Literal["ok"] = Field(description="Toujours `ok` quand l'API répond.")
    model: str = Field(description="Fichier du modèle MediaPipe utilisé.", examples=["pose_landmarker_full.task"])
    model_ready: bool = Field(description="`false` si le modèle n'est pas téléchargé : lancer `python scripts/download_model.py`.")


def _error_doc(description: str, code: str, message: str) -> dict:
    return {"model": ErrorOut, "description": description, "content": {"application/json": {"example": {"error": code, "message": message}}}}


MEASURE_ERRORS = {
    400: _error_doc("Fichier illisible.", "invalid_image", "Le fichier envoyé n'est pas une image lisible (JPEG, PNG ou WebP)."),
    413: _error_doc("Photo de plus de 10 Mo.", "image_too_large", "Photo trop lourde (10 Mo au maximum)."),
    429: _error_doc(
        "Trop de demandes depuis la même adresse IP, dans la minute.",
        "rate_limited",
        "Trop de demandes depuis votre connexion : réessayez dans une minute.",
    ),
    422: _error_doc(
        "La photo ne permet pas de mesurer (`no_person`, `pose_not_detected`, `body_not_fully_visible`, "
        "`measure_failed`). Un champ manquant ou hors limites renvoie aussi un 422, au format `{\"detail\": [...]}` de FastAPI.",
        "body_not_fully_visible",
        "Les pieds ne sont pas visibles sur la photo de face : il faut le corps entier, de la tête aux pieds.",
    ),
}


def _view_out(v: ViewResult) -> ViewOut:
    return ViewOut(
        cm_per_px=round(v.cm_per_px, 4),
        lines=Lines(
            **{
                zone: Line(y=round(s.y / v.height, 4), x1=round(s.x1 / v.width, 4), x2=round((s.x2 + 1) / v.width, 4))
                for zone, s in v.segments.items()
            }
        ),
        inseam=InseamLine(
            x=round((v.inseam.x + 0.5) / v.width, 4), y1=round(v.inseam.y1 / v.height, 4), y2=round(v.inseam.y2 / v.height, 4)
        )
        if v.inseam
        else None,
    )


def _out(m: Measurement) -> MeasureOut:
    return MeasureOut(
        measurements=Measurements(**m.measurements),
        zones=Zones(
            **{
                zone: ZoneOut(circumference=m.measurements[zone], width=m.widths_cm[zone], depth=m.depths_cm[zone])
                for zone in ZONES
            }
        ),
        depth_source=m.depth_source,
        front=_view_out(m.front),
        side=_view_out(m.side) if m.side else None,
        warnings=m.warnings,
    )


def _read(upload: UploadFile) -> bytes:
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError(413, "image_too_large", "Photo trop lourde (10 Mo au maximum).")
    return data


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """L'adresse de l'API ouvre sa documentation."""
    return RedirectResponse("/docs")


@app.get("/health", tags=["Service"], summary="État de l'API", response_model=HealthOut)
def health() -> HealthOut:
    """Répond `ok` si l'API tourne, et dit si le modèle MediaPipe est téléchargé."""
    return HealthOut(status="ok", model=MODEL_PATH.name, model_ready=MODEL_PATH.is_file())


@app.post(
    "/v1/photo/measure",
    tags=["Mesure"],
    summary="Mesurer le corps sur des photos",
    response_model=MeasureOut,
    responses=MEASURE_ERRORS,
)
def measure_photo(
    height_cm: Annotated[
        float, Form(alias="heightCm", ge=140, le=210, description="Taille du client, en cm (140 à 210).", examples=[178])
    ],
    front: Annotated[UploadFile, File(description="Photo de face, de la tête aux pieds (JPEG, PNG ou WebP, 10 Mo au plus).")],
    analyzer: Annotated[PoseAnalyzer, Depends(get_analyzer)],
    _: Annotated[None, Depends(_limited(MEASURE_LIMIT))],
    side: Annotated[UploadFile | None, File(description="Photo de profil, de la tête aux pieds. Facultative mais conseillée.")] = None,
) -> MeasureOut:
    """Renvoie les tours de poitrine, de taille, de hanches et de cuisse, et l'entrejambe, en cm.

    - La taille donne l'échelle de la photo.
    - L'entrejambe est lu sur la photo de face, au haut de l'écart entre les jambes.
    - Sans photo de profil, la profondeur du corps est estimée (`depthSource: "estimated"`).
    - `warnings` liste ce qu'il faut signaler au client (bras collés au corps, jambes serrées, mesure peu plausible…).

    Les photos sont analysées en mémoire puis oubliées : rien n'est enregistré ni journalisé.
    """
    front_view = analyzer(decode_image(_read(front), MAX_SIDE))
    side_view = analyzer(decode_image(_read(side), MAX_SIDE)) if side is not None and side.filename else None
    return _out(measure(height_cm, front_view, side_view))


@app.post(
    "/v1/photo/pose",
    tags=["Prise de vue"],
    summary="Cadrage en direct d'une image de la caméra",
    response_model=PoseOut,
    responses={k: v for k, v in MEASURE_ERRORS.items() if k in (400, 413, 429)},
)
def check_pose(
    frame: Annotated[UploadFile, File(description="Image de la caméra, réduite (640 px de côté suffisent ; JPEG, PNG ou WebP).")],
    analyzer: Annotated[PoseAnalyzer, Depends(get_analyzer)],
    _: Annotated[None, Depends(_limited(POSE_LIMIT))],
    expect: Annotated[
        Expect, Form(description="Vue attendue : `front` (photo de face) ou `side` (photo de profil).", examples=["front"])
    ] = "front",
) -> PoseOut:
    """Dit si la personne est prête pour la photo attendue : entière dans l'image, assez grande,
    centrée, et tournée comme il faut. Sinon, `message` dit quoi faire (« Reculez… »).

    Faite pour être appelée plusieurs fois par seconde pendant la prise de vue : une image sans
    personne n'est pas une erreur (`ready: false`, `issue: "no_person"`).

    Les images sont analysées en mémoire puis oubliées : rien n'est enregistré ni journalisé.
    """
    image = decode_image(_read(frame), MAX_FRAME_SIDE)
    try:
        view = analyzer(image)
    except MeasureError:
        return _pose_out(check_framing(None, expect), [])
    return _pose_out(check_framing(view, expect), view.landmarks)
