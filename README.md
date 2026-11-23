# SwiftStyle · API photo

Mesure une personne à partir de sa taille et d'une photo de face, plus une photo de profil si
possible : tours de poitrine, de taille, de hanches et de cuisse, et entrejambe. La détection du
corps est faite par MediaPipe Tasks Vision (Pose Landmarker), en Python, côté serveur.

Elle est faite pour être appelée par les sites des marques, depuis leurs fiches produit. Le site
de ce dépôt l'appelle aussi, depuis sa page `/test-photo`.

C'est un prototype : la méthode fonctionne de bout en bout, mais ses réglages n'ont jamais été
comparés à des mesures prises au mètre ruban.

## Installer et lancer

Python 3.14 (version essayée).

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows ; sous macOS / Linux : source .venv/bin/activate
pip install -r requirements-dev.txt
python scripts/download_model.py  # pose_landmarker_full.task, environ 9 Mo, dans models/
uvicorn app.main:app --reload --port 8000
```

- http://localhost:8000/docs : documentation Swagger (http://localhost:8000 y mène aussi)
- http://localhost:8000/health : `modelReady` vaut `false` si le modèle n'est pas téléchargé

Le paquet `mediapipe` installe aussi `opencv-contrib-python`, dont il dépend. Notre code ne
l'utilise pas.

Tests (sans le modèle) :

```bash
pytest
```

## Documentation (Swagger)

La page http://localhost:8000/docs est générée par FastAPI à partir du code (`app/main.py`).
Elle contient :

- les adresses de l'API, les champs à envoyer et la forme de la réponse, champ par champ ;
- des exemples d'appel : depuis le site d'une marque (JavaScript) et en curl ;
- les erreurs possibles et les conseils de prise de vue ;
- un formulaire pour essayer : déplier `POST /v1/photo/measure`, choisir les photos et la
  taille, puis **Execute**.

Autres formats : http://localhost:8000/redoc (lecture seule) et http://localhost:8000/openapi.json
(schéma OpenAPI, pour générer un client). Pour modifier la documentation, changer la description
`DESCRIPTION`, les `Field(description=...)` des modèles ou la docstring des routes dans
`app/main.py` : la page se met à jour au redémarrage de l'API.

## Appel depuis le site d'une marque

`POST /v1/photo/measure`, en `multipart/form-data` :

| Champ | | |
|---|---|---|
| `heightCm` | obligatoire | taille du client en cm, de 140 à 210 |
| `front` | obligatoire | photo de face, de la tête aux pieds (JPEG, PNG ou WebP, 10 Mo au plus) |
| `side` | facultatif | photo de profil, de la tête aux pieds |

```js
const body = new FormData();
body.append("heightCm", "178");
body.append("front", photoDeFace);   // un File, par exemple input.files[0]
body.append("side", photoDeProfil);  // facultatif
const res = await fetch("https://<adresse de l'API>/v1/photo/measure", { method: "POST", body });
const resultat = await res.json();
```

Le navigateur n'autorise l'appel que si l'adresse du site est dans `ALLOWED_ORIGINS` :

| Variable | Sans elle |
|---|---|
| `ALLOWED_ORIGINS` | seul `http://localhost:3000` (le site de ce dépôt, en local). Mettre les adresses des sites des marques, séparées par des virgules, ou `*` pour tous |
| `MODEL_PATH` | `models/pose_landmarker_full.task` |

Réponse (exemple complet : `app/example.json`) :

```json
{
  "measurements": { "chest": 96, "waist": 84, "hips": 99, "thigh": 55, "inseam": 80 },
  "zones": { "chest": { "circumference": 96, "width": 34.0, "depth": 25.5 } },
  "depthSource": "profile",
  "front": {
    "cmPerPx": 0.21,
    "lines": { "chest": { "y": 0.35, "x1": 0.39, "x2": 0.64 } },
    "inseam": { "x": 0.5, "y1": 0.55, "y2": 0.96 }
  },
  "side": { "cmPerPx": 0.21, "lines": {}, "inseam": null },
  "warnings": []
}
```

- `measurements` : tours de poitrine (`chest`), de taille (`waist`), de hanches (`hips`) et de
  cuisse (`thigh`), et entrejambe (`inseam`, hauteur de l'entrejambe au sol), en cm. Se passe tel
  quel à `recommendSize` du site, qui prend les mesures dont son guide des tailles a besoin.
- `zones` : largeur et profondeur de chaque tour (pas de l'entrejambe, qui est une longueur).
- `lines` : l'endroit mesuré sur chaque photo, en coordonnées 0 à 1, pour le dessiner par-dessus.
  La cuisse est lue sur une seule jambe, la plus forte. `inseam` : ligne verticale de l'entrejambe
  (`y1`) au sol (`y2`), sur la photo de face seulement.
- `depthSource` : `profile` si la profondeur vient de la photo de profil, `estimated` sinon.
- `warnings` : remarques à montrer au client.

Erreurs : `{ "error": "<code>", "message": "<texte à afficher>" }`

| Code HTTP | `error` | Cas |
|---|---|---|
| 400 | `invalid_image` | fichier illisible |
| 413 | `image_too_large` | plus de 10 Mo |
| 422 | `no_person`, `pose_not_detected`, `body_not_fully_visible`, `measure_failed` | la photo ne permet pas de mesurer |

Un champ manquant ou hors limites renvoie aussi un 422, au format de FastAPI : `{"detail": [...]}`.

Les photos sont analysées en mémoire puis oubliées. Elles ne sont ni enregistrées ni journalisées.

## Prise de vue automatique (extension navigateur)

`POST /v1/photo/pose`, en `multipart/form-data` : une image de la caméra (`frame`, 640 px de côté
suffisent) et la vue attendue (`expect` : `front` ou `side`). L'extension en envoie environ trois
par seconde. Dès que la réponse est `ready` deux fois de suite sans que la silhouette ait bougé,
elle affiche un compte à rebours de 3 s ; s'il va au bout sans que la personne bouge ni sorte du
cadre, elle garde comme photo la dernière image validée, en pleine résolution, puis l'envoie à
`/v1/photo/measure` avec l'autre vue.

```json
{
  "ready": false,
  "orientation": "front",
  "issue": "feet_cut",
  "message": "Reculez : vos pieds doivent être visibles.",
  "tips": [],
  "box": { "x1": 0.38, "y1": 0.1, "x2": 0.62, "y2": 1.0 },
  "landmarks": [{ "x": 0.5, "y": 0.14, "visibility": 0.99 }]
}
```

- `ready` : la personne est prête, dans la vue attendue.
- `issue` : ce qui empêche la photo (`no_person`, `pose_not_detected`, `head_cut`, `feet_cut`,
  `too_far`, `off_center`, `wrong_view`), `message` : quoi lui dire, en français.
- `tips` : conseils qui n'empêchent pas la photo (bras collés, pieds serrés), de face seulement.
- `orientation` : `front`, `side` ou `turning`, d'après l'écart horizontal des épaules et des
  hanches rapporté à la hauteur du buste (environ 0,53 de face et 0,04 de profil sur les photos
  d'essai ; seuils dans `app/framing.py`).
- `landmarks` : les 33 repères de MediaPipe, pour dessiner le squelette sur la vidéo.

Une image sans personne n'est pas une erreur : `200` avec `ready: false` et `issue: "no_person"`.
Les vérifications de cadrage reprennent celles de la mesure (silhouette qui touche le bord,
chevilles invisibles) : une photo prise quand `ready` vaut `true` passe ces contrôles.

## Méthode

1. MediaPipe renvoie les 33 repères du corps et un masque de la personne (`app/vision.py`).
2. Échelle : la hauteur du masque en pixels correspond à la taille donnée (`app/measure.py`).
3. Niveaux : poitrine, taille et hanches sont placés entre la ligne des épaules et celle des
   hanches. La taille est la ligne la plus étroite autour de son niveau, les hanches la plus large.
4. Bas du corps, sur la photo de face : en remontant des genoux vers les hanches, l'entrejambe est
   le haut de l'écart entre les deux jambes. Entrejambe = sa hauteur au-dessus du bas de la
   silhouette. La cuisse est mesurée 2 % de la hauteur du corps plus bas (`THIGH_DROP`), sur la
   jambe la plus forte ; de profil, à la même hauteur, les deux cuisses se superposent.
5. Largeur sur la photo de face, profondeur sur la photo de profil. Sans profil, la profondeur
   est déduite de la largeur par un rapport moyen (`DEPTH_RATIO`).
6. Tour = périmètre de l'ellipse qui a cette largeur et cette profondeur.

Un bras collé au corps (ou une main contre la cuisse) est retiré par estimation : son bord
extérieur est le bord de la silhouette, et son axe passe par l'épaule, le coude, le poignet et la
main. Le résultat le signale.

Jambes serrées, l'écart entre les cuisses n'existe pas : l'entrejambe est alors estimé à 60 % du
chemin des hanches aux genoux (`CROTCH_LEVEL`), et le résultat le signale. Un entrejambe de moins
de 40 % de la taille est signalé aussi : c'est en général une photo prise de trop près ou de trop
haut, qui raccourcit les jambes.

## Limites connues

Essai sur les deux photos de la page d'accueil (`public/photos/`, bras le long du corps, sans
photo de profil), en cm :

| | Poitrine | Taille | Hanches | Cuisse | Entrejambe |
|---|---|---|---|---|---|
| Aurélien, 178 cm | 89 | 97 | 101 | 45 | 62 |
| Léa, 166 cm | 72 | 80 | 98 | 42 | 63 |

- Les bras touchent le corps : leur retrait est approximatif, surtout avec des manches ou les mains
  sur les hanches.
- L'entrejambe est bien placé à l'œil, mais on attend environ 45 % de la taille (80 et 75 cm). Les
  photos sont prises de près, à hauteur de poitrine : les jambes, plus loin de l'objectif,
  paraissent plus courtes et plus fines. L'API le signale. Un pantalon ample place aussi
  l'entrejambe plus bas que le corps.

Pour une mesure fiable :

- bras un peu écartés du corps, pieds écartés de la largeur des hanches ;
- appareil à hauteur des hanches, à 2 ou 3 m ;
- vêtements près du corps, fond uni ;
- une photo de profil, sinon la profondeur est seulement estimée ;
- surtout, recalibrer `LEVELS`, `THIGH_DROP`, `CROTCH_LEVEL`, `DEPTH_RATIO` et la formule de
  l'ellipse avec des personnes mesurées au mètre ruban.
