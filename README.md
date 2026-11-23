# SwiftStyle

Widget de recommandation de taille pour les fiches produit des marques e-commerce de mode.

Équipe : Matteo HEIB, Balla DIAKITE, Thanh Danh NGUYEN, Idriss QARQABI.

Le dépôt a deux parties :

| Où | Contenu | Technologie |
|---|---|---|
| racine (`src/`, `public/`…) | le site : page d'accueil pour les marques, widget des sites des marques, **mesure du corps sur photo dans le navigateur**, formulaire « Demander un essai », page de test de la mesure, documentation | Next.js (App Router, TypeScript), MediaPipe Tasks Vision (WebAssembly) |
| `backend/` | l'**API photo** : la même mesure, en Python. Le site ne l'appelle plus : elle sert de référence (le site reprend sa méthode, et ses tests le vérifient) et à l'extension | Python, FastAPI, MediaPipe Tasks Vision |
| `swiftstyle.fr-web-extension/` | l'**extension navigateur** (Chrome, Firefox) : bouton « Trouver ma taille » sur les fiches produit, photos de face et de profil prises automatiquement par la caméra, taille idéale. Voir son `README.md` | JavaScript, Manifest V3 |

`integrations/google-sheets/` contient le script Apps Script qui range les demandes d'essai dans
un Google Sheet.

## Démarrer

### Le site

Node 22 ou plus récent.

```bash
npm install
```

```bash
npm run dev
```

- http://localhost:3000 : la page d'accueil
- http://localhost:3000/test-photo : la page de test de la mesure sur photo
- http://localhost:3000/docs : la documentation des routes du site, et le code du widget à copier

`npm run dev` prépare d'abord les fichiers de MediaPipe (`npm run prepare:mediapipe` : moteur
WASM copié depuis `node_modules`, modèle de pose téléchargé chez Google la première fois, environ
9 Mo), puis compile le widget des sites des marques (`npm run build:widget`, voir plus bas).

### L'API photo (facultative)

Le site n'en a plus besoin. Elle sert à l'extension, et à comparer la mesure du navigateur avec
celle de Python.

Python 3.14 (version essayée). Voir `backend/README.md` pour le détail.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows ; sous macOS / Linux : source .venv/bin/activate
pip install -r requirements-dev.txt
python scripts/download_model.py  # modèle MediaPipe, environ 9 Mo, non versionné
uvicorn app.main:app --reload --port 8000
```

Documentation de l'API (Swagger, générée par FastAPI) : http://localhost:8000/docs, ou simplement
http://localhost:8000. Elle donne les adresses, les champs, des exemples d'appel (depuis le site
d'une marque, curl), les erreurs, et permet d'envoyer une photo pour essayer.

## Ce que sert le site

| URL | Fichier | Rôle |
|---|---|---|
| `/` | `src/app/page.tsx` | page d'accueil pour les marques (site v0.2) |
| `/api/demande-essai` | `src/app/api/demande-essai/route.ts` | formulaire de la page d'accueil, transmis au Google Sheet |
| `/api/v1/recommend` | `src/app/api/v1/recommend/route.ts` | taille idéale d'un article à partir des mensurations mesurées sur photo, appelée par l'extension, le widget et la démo de la page d'accueil |
| `/widget/v1.js` | `src/widget/embed.ts`, compilé dans `public/widget/` | le widget installé sur les fiches produit des marques : bouton « Trouver ma taille » et sa fenêtre |
| `/api/v1/widget` | `src/app/api/v1/widget/route.ts` | vérifiée par le widget avant d'afficher le bouton |
| `/mediapipe/<version>/` | préparé par `scripts/prepare-mediapipe.mjs` dans `public/mediapipe/` | moteur WASM et modèle de MediaPipe, lus par le navigateur du client pour mesurer les photos (environ 24 Mo, gardés un an en cache, ouverts à tous les sites par CORS : `public/_headers`) |
| `/test-photo` | `src/app/test-photo/page.tsx` | fausse fiche produit avec le bouton « Trouver ma taille » : photos importées, mesurées dans le navigateur |
| `/docs` | `src/app/docs/page.tsx` | documentation des routes du site, façon Swagger UI, avec un bouton « Essayer » |
| `/openapi.json` | `src/app/openapi.json/route.ts` | la même documentation au format OpenAPI 3.1 |

## La mesure sur photo

Elle tourne **dans le navigateur du client** : MediaPipe Tasks Vision (Pose Landmarker, en
WebAssembly) lit les repères du corps et la silhouette, puis la méthode de l'API Python, portée en
TypeScript, en tire les mesures. **Les photos ne quittent pas l'appareil** : seules les mensurations
partent, vers `/api/v1/recommend`. Le site n'a besoin d'aucun serveur Python.

| Fichier | Rôle | Version Python |
|---|---|---|
| `src/lib/photo-measure/vision.ts` | charge MediaPipe depuis `/mediapipe/<version>/` et lit une image | `backend/app/vision.py` |
| `src/lib/photo-measure/measure.ts` | de la silhouette aux mesures | `backend/app/measure.py` |
| `src/lib/photo-measure/framing.ts` | cadrage en direct pour la prise de vue automatique | `backend/app/framing.py` |
| `src/lib/photo-measure/index.ts` | `measureFromPhotos`, `checkPose`, `preloadVision` : ce qu'utilisent la fenêtre et `/test-photo` | `backend/app/main.py` |

Les tests du site reprennent ceux de l'API (silhouettes dessinées de `backend/tests/conftest.py`) :
le portage rend **exactement** `backend/app/example.json`, la réponse de l'API sur la silhouette de
test. Un changement de méthode se fait donc dans les deux versions. Sur une vraie photo, les deux
donnent des mesures voisines, à 1 à 3 cm près : MediaPipe calcule sur la carte graphique dans le
navigateur, sur le processeur en Python, et ses repères diffèrent de quelques pixels.

À savoir :

- **Poids** : environ 24 Mo à la première ouverture de la fenêtre (moteur WASM 14,6 Mo, modèle
  9,4 Mo), puis depuis le cache du navigateur. La fenêtre commence à les charger dès son ouverture.
  La première analyse prépare aussi la carte graphique (quelques secondes) ; les suivantes prennent
  quelques dizaines de millisecondes.
- **Carte graphique nécessaire** : avec MediaPipe 1.2.2, le calcul sur processeur s'arrête net dès
  qu'on lui demande la silhouette (vu dans Chromium). Sans WebGL, l'analyse ne démarre pas, et la
  fenêtre le dit.
- **Statistiques envoyées à Google** : MediaPipe Tasks envoie toutes les minutes à Google des
  statistiques d'utilisation (temps de calcul, nombre d'images, jamais les images), sans réglage
  pour l'éviter ; sa notice demande le consentement des utilisateurs. `vision.ts` coupe ce journal
  juste après le chargement (`disableUsageLogging`) : vérifié dans le navigateur, plus aucun envoi à
  `odml.pa.googleapis.com`, alors qu'une instance non coupée en fait un au bout de 60 s. À
  revérifier à chaque mise à jour de `@mediapipe/tasks-vision`.
- **Versions figées** : `@mediapipe/tasks-vision` en version exacte (le dossier `/mediapipe/1.2.2/`
  porte son numéro, `MEDIAPIPE_VERSION` dans `vision.ts` doit suivre, un test le vérifie), et le
  modèle vérifié par son empreinte SHA-256 dans `scripts/prepare-mediapipe.mjs`.

**Démo de la page d'accueil** : le bouton « Trouver ma taille » de la section « Essayez le widget »
ouvre la fenêtre de `src/components/size-modal/size-modal.ts`, reprise de celle de l'extension
(`content/modal.js`) : caméra et photos de face et de profil, mesure dans le navigateur, taille par
`/api/v1/recommend`, puis sélection de la taille sur la fiche.

**L'API photo** (`backend/`) : `POST /v1/photo/measure` (taille, photo de face et de profil) et
`POST /v1/photo/pose` (cadrage d'une image de la caméra). Le détail est dans sa documentation
Swagger et dans `backend/README.md`. Elle reçoit les photos, les analyse en mémoire puis les oublie.

Méthode (`backend/app/measure.py`, et `src/lib/photo-measure/measure.ts`) :

1. Échelle : la hauteur de la silhouette en pixels correspond à la taille donnée par le client.
2. Poitrine, taille et hanches sont placées entre la ligne des épaules et celle des hanches. La
   taille est la ligne la plus étroite autour de son niveau, les hanches la plus large.
3. L'entrejambe est le haut de l'écart entre les jambes, sur la photo de face. La cuisse est
   mesurée juste en dessous, sur la jambe la plus forte.
4. Largeur sur la photo de face, profondeur sur la photo de profil (sans profil, la profondeur est
   déduite de la largeur par un rapport moyen). Tour = périmètre de l'ellipse correspondante.
5. Un bras collé au corps est retiré par estimation, à partir de l'axe épaule, coude, poignet, main.

Sur la page de test, la taille est ensuite choisie dans le navigateur, avec le même moteur que la
page d'accueil et les guides des tailles de la démo (t-shirt et jean). Le guide du jean utilise la
taille, les hanches, le tour de cuisse et l'entrejambe ; celui du t-shirt, la poitrine et la
taille. Les démos de la page d'accueil ne connaissent que les tours du buste : elles réduisent le
guide du jean à la taille et aux hanches (`restrictChart`), et recommandent comme avant.

Dans le résultat, les lignes de mesure sont réglables à la main : quand un vêtement ample ou un bras
fausse une ligne, on fait glisser ses bouts jusqu'aux bords du corps (ou on les déplace aux flèches
du clavier). La ligne verticale de l'entrejambe se règle par ses deux bouts (l'entrejambe en haut,
le sol en bas). Les mesures et la taille sont recalculées sans refaire l'analyse
(`src/lib/photo-measure/adjust.ts`) ; les mesures corrigées sont marquées « corrigé », et un bouton
ramène aux mesures d'origine.

L'API et le site partagent `backend/app/example.json` : les tests de l'API vérifient qu'il est
exactement sa réponse sur la silhouette de test, ceux du site que le portage TypeScript rend le même
résultat. Si l'un change la méthode ou la forme du résultat sans l'autre, un des deux échoue.

## Le widget des sites des marques

Le bouton « Trouver ma taille » et sa fenêtre, sur la fiche produit d'une marque. La marque copie ce
code dans le modèle de sa fiche produit, sous le choix des tailles. Il se copie depuis la section
« Installez-le en deux lignes » de la page d'accueil (`src/components/landing/EmbedCode.tsx`) ou
depuis `/docs`, section « Intégrer le widget », qui donne aussi les attributs, les événements et un
aperçu qui marche. Versions HTML, Shopify et WooCommerce :

```html
<div data-swiftstyle data-product-id="demo-tee"></div>
<script src="https://swiftstyle.jesololido2004.workers.dev/widget/v1.js" async></script>
```

L'adresse est celle du site en production (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)) : la page
d'accueil et `/docs` affichent celle du site qui les sert, `localhost:3000` en local.

`demo-tee` est le t-shirt de démonstration du catalogue (`WIDGET_DEMO_PRODUCT_ID`) : le code HTML
marche tel quel, avant que la marque n'y mette l'identifiant de son produit. Les versions Shopify et
WooCommerce prennent celui de la fiche.

Au chargement, pour chaque élément `data-swiftstyle` :

1. le script affiche le bouton désactivé, avec un spinner ;
2. il vérifie que le navigateur sait faire tourner la mesure (WebAssembly), que le site répond
   (`GET /api/v1/widget`) et que ses fichiers de MediaPipe se lisent depuis le site de la marque
   (`HEAD` sur le modèle : fichiers présents, en-tête CORS) ;
3. en cas d'échec, il recommence : 4 tentatives en tout, 5 s au plus chacune, avec 1, 2 puis 4 s
   d'attente entre elles (`WIDGET_RETRY`, `src/lib/widget-embed.ts`) ;
4. si tout répond, le bouton s'active et ouvre la même fenêtre que la démo de la page d'accueil
   (`src/components/size-modal/size-modal.ts`) ; sinon le script retire le bouton (l'élément
   reçoit `hidden`) et dit pourquoi dans la console du navigateur.

L'identifiant, le nom, la catégorie et les tailles du vêtement viennent des attributs `data-*`, ou à
défaut de la page (Shopify, WooCommerce, JSON-LD), comme dans l'extension
(`src/widget/page.ts`, portage de `content/index.js`). La taille choisie est cochée dans le
formulaire du produit ; la page peut le faire elle-même en écoutant l'événement `swiftstyle:size`.

Le script est compilé par Vite en un seul fichier (`vite.widget.config.ts`, environ 300 Ko, 93 Ko
compressé, dont le code JavaScript de MediaPipe) dans `public/widget/v1.js`, non versionné. Le
moteur WASM et le modèle ne sont chargés qu'à l'ouverture de la fenêtre. `npm run dev` et
`npm run build` le recompilent d'abord ; pendant le développement, relancer `npm run build:widget`
après un changement dans `src/widget/`, dans la fenêtre ou dans `src/lib/photo-measure/`.

Si le site de la marque a une politique de sécurité (`Content-Security-Policy`), elle doit autoriser
le site SwiftStyle (`script-src`, `connect-src`) et WebAssembly (`'wasm-unsafe-eval'`).

## L'extension navigateur

`swiftstyle.fr-web-extension/` (détail dans son `README.md`). Sur une fiche produit d'un site de
`sites.json`, le bouton « Trouver ma taille » ouvre une fenêtre qui :

1. demande la taille du client et son accord pour l'envoi des photos ;
2. filme le client et envoie ~3 images par seconde à `POST /v1/photo/pose` (API photo, MediaPipe).
   Un mannequin au style de MediaPipe (points et traits), dans un coin de l'image, montre la pose
   à prendre (de face, puis de profil) ; la personne se place où elle veut. Dès que
   MediaPipe voit la personne prête sur deux images de suite sans qu'elle ait bougé, un compte à
   rebours de 3 s s'affiche ; s'il va au bout sans qu'elle bouge, la photo est prise (la dernière
   image validée par MediaPipe). Puis la photo de profil. Les consignes (« Reculez… »,
   « Tournez-vous de profil ») sont affichées sur la vidéo ; la fenêtre ne fait aucun son ;
3. envoie les deux photos à `POST /v1/photo/measure` (API photo) ;
4. envoie les mensurations et l'identifiant du vêtement (lu sur la page, avec le site) à
   `POST /api/v1/recommend` (site). Le site retrouve le vêtement et son guide des tailles dans son
   catalogue (`src/lib/recommendation/catalog.ts`) ; pour un vêtement inconnu, il prend le guide
   de démonstration le plus proche (t-shirt, jean ou sweat) d'après le nom et la catégorie. Les
   guides des tailles des articles de démonstration viennent de
   `src/lib/recommendation/guides-des-tailles.json` (mensurations du corps par taille). Il
   rend la taille, écrite comme sur la page ;
5. affiche la taille, avec le choix de la coupe (ajusté, normal, ample) et les deux photos, où
   chaque mesure est une ligne de couleur. Le client corrige une mesure faussée (vêtement ample,
   bras) en faisant glisser les bouts de sa ligne jusqu'aux bords de son corps, sur un seul axe :
   en largeur pour les tours, en hauteur pour l'entrejambe. Les mesures sont recalculées comme sur
   `/test-photo` (`src/lib/photo-measure/adjust.ts`), puis chaque changement rappelle
   `/api/v1/recommend`, sans reprendre de photos ;
6. coche cette taille sur la page.

Les requêtes partent du service worker de l'extension (`background.js`), pas de la page de la
marque. Le dossier est exclu du dépôt par `.gitignore` : ses changements ne sont pas suivis par Git.

L'extension utilise encore l'API photo, contrairement au site : en production, il faudrait l'héberger
pour elle, ou lui faire mesurer les photos dans le navigateur comme le site (MediaPipe et le modèle
inclus dans l'extension : une extension ne peut pas charger de code depuis un site).

## Documentation

| Quoi | Où | Générée depuis |
|---|---|---|
| API photo | http://localhost:8000/docs (Swagger), `/redoc`, `/openapi.json` | les modèles et descriptions de `backend/app/main.py`, par FastAPI |
| Routes du site | http://localhost:3000/docs (présentation de Swagger UI), `/openapi.json` | les schémas zod de `src/lib/trial-request.ts`, par `src/lib/docs/spec.ts` |

Les deux se mettent à jour d'elles-mêmes : pour documenter un champ, on écrit sa description dans
le code (`Field(description=...)` côté API, `.meta({ description })` côté site). Les tests du site
échouent si un champ n'a pas de description, ou si un exemple ne respecte plus son schéma.

## Les dossiers

```
src/
├── app/                      routes Next.js, voir le tableau ci-dessus
├── components/
│   ├── landing/              sections de la page d'accueil (Hero, WidgetDemo, TrialSignup…)
│   ├── size-modal/           fenêtre « Trouver ma taille » (démo de la page d'accueil et widget)
│   ├── photo-test/           page de test de la mesure sur photo
│   └── docs/                 page de documentation (affichage façon Swagger UI)
└── lib/
    ├── recommendation/       moteur de recommandation et catalogue des vêtements (catalog.ts), TypeScript pur, testés
    ├── photo-measure/        mesure sur photo dans le navigateur (MediaPipe, portage de measure.py et framing.py),
    │                         forme du résultat (zod), correction des lignes à la main, testés
    ├── docs/spec.ts          documentation des routes du site, générée depuis les schémas zod, testée
    ├── trial-request.ts      contrat de la route du formulaire (schéma zod)
    ├── recommend-request.ts  contrat de la route de recommandation (schéma zod)
    ├── widget-config.ts      contrat de la route du widget (schéma zod)
    ├── widget-embed.ts       code du widget à copier, ses attributs, événements et tentatives de connexion
    ├── email.ts              format d'e-mail accepté par le formulaire
    └── http.ts               limite de requêtes du formulaire
└── widget/                   widget des sites des marques : embed.ts (bouton, spinner, fenêtre),
                              connect.ts (tentatives de connexion), page.ts (lecture de la fiche produit), testés

backend/
├── app/
│   ├── main.py               routes FastAPI (/health, /v1/photo/measure) et leur documentation
│   ├── vision.py             lecture de la photo avec MediaPipe (repères du corps et silhouette)
│   ├── measure.py            de la silhouette aux mesures, sans MediaPipe, testé
│   ├── framing.py            cadrage en direct pour la prise de vue automatique, sans MediaPipe, testé
│   └── example.json          exemple de réponse, partagé avec les tests du site
├── scripts/download_model.py télécharge le modèle MediaPipe Pose Landmarker
└── tests/                    tests sur des silhouettes dessinées (pas besoin du modèle)

integrations/google-sheets/   script Apps Script qui range les demandes d'essai dans un Google Sheet

scripts/prepare-mediapipe.mjs fichiers de MediaPipe servis par le site (public/mediapipe/<version>/)
public/_headers               en-têtes des fichiers statiques sur Cloudflare (CORS et cache de /mediapipe)
vite.widget.config.ts         compilation du widget en un seul fichier (public/widget/v1.js)
open-next.config.ts           configuration OpenNext (build Cloudflare)
wrangler.jsonc                configuration du Worker Cloudflare (nom, compatibilité, fichiers statiques)
DEPLOIEMENT.md                publication sur Cloudflare depuis GitLab

swiftstyle.fr-web-extension/  extension navigateur (non suivie par Git, voir .gitignore)
├── chromium-extension/       Chrome, Edge… : manifest.json, background.js, content/index.js, content/modal.js, sites.json
└── firefox-extension/        les mêmes fichiers, avec le manifeste de Firefox
```

Les démos de la page d'accueil (`components/landing/WidgetDemo.tsx`, `HeroDemo.tsx`,
`PhotoSteps.tsx`) appellent le moteur de recommandation directement dans le navigateur, avec des
guides des tailles d'exemple. Elles n'utilisent ni base de données ni API.

## Commandes

| Où | Commande | Effet |
|---|---|---|
| racine | `npm run dev` | lance le site en développement |
| racine | `npm run build` | prépare MediaPipe, compile le widget, puis le site |
| racine | `npm run prepare:mediapipe` | copie le moteur WASM de MediaPipe et télécharge le modèle dans `public/mediapipe/<version>/` |
| racine | `npm run build:widget` | compile le widget des sites des marques dans `public/widget/v1.js` |
| racine | `npm test` | tests du moteur de recommandation, de la mesure sur photo (contre les résultats de l'API Python), du widget, des routes du site et de la documentation (Vitest) |
| racine | `npm run typecheck` | vérification des types |
| racine | `npm run build:cloudflare` | build Cloudflare : `next build`, puis transformation en Worker par OpenNext (`.open-next/`) |
| racine | `npm run preview:cloudflare` | build Cloudflare, puis le Worker lancé en local dans le moteur de Cloudflare |
| racine | `npm run deploy:cloudflare` | build Cloudflare et déploiement (compte Cloudflare requis : `npx wrangler login`) |
| `backend/` | `uvicorn app.main:app --reload --port 8000` | lance l'API photo |
| `backend/` | `pytest` | tests de la mesure, du cadrage et des routes de l'API |

## Configuration

### Le site

Copier `.env.example` en `.env.local`. Tout est facultatif en local. En production, sur
Cloudflare : voir [DEPLOIEMENT.md](DEPLOIEMENT.md) (certaines variables sont lues au build, d'autres
à l'exécution).

| Variable | Sans elle |
|---|---|
| `GOOGLE_SHEETS_WEBHOOK_URL` | le formulaire d'essai affiche « Demande envoyée » mais n'envoie rien ; la demande apparaît seulement dans le terminal. En production, il renvoie une erreur. |
| `APP_ORIGIN` | l'image d'aperçu des liens pointe vers `http://localhost:3000` |

Mise en place du Google Sheet : voir `integrations/README.md`.

### L'API photo

| Variable | Sans elle |
|---|---|
| `ALLOWED_ORIGINS` | seul `http://localhost:3000` peut appeler l'API depuis un navigateur (l'extension n'est pas concernée : elle l'appelle depuis son service worker) |
| `MODEL_PATH` | `backend/models/pose_landmarker_full.task` |

## Ce qui est fictif

- La boutique de la démo, ses guides des tailles et les vêtements de référence (marque « Exemple »).
- L'estimation des tours à partir de la taille et du poids : formule de la démo du site, jamais
  comparée à des mesures réelles.
- Le pourcentage « correspondance avec le guide » : il mesure l'écart avec le guide des tailles,
  ce n'est pas un taux de bonnes recommandations.
- L'analyse de photo de la page d'accueil : la démo la simule. La fenêtre « Trouver ma taille »
  mesure vraiment les photos, mais ses réglages n'ont jamais été comparés à des mesures prises au
  mètre ruban (voir `backend/README.md`).

## Page d'accueil : points à trancher

Le texte du site v0.2 est repris tel quel, à la demande de l'équipe. Il s'écarte de la soutenance
sur plusieurs points :

- **Chiffres** : 70 % (McKinsey) au lieu de 50 à 70 %, 849,9 Md$ (retours américains 2025) au
  lieu de 890 Md$. Le 53 % vient de la même étude Coresight que le 53 % retiré du document de mai,
  formulé autrement (part des marques, pas part des retours).
- **Promesses non mesurées** : « le colis ne revient pas », « photo analysée en 8 secondes »,
  « 94 % de correspondance ».
- **Section « Une photo suffit »** : présente l'analyse d'image comme si elle était au point.
- **Mentions de démonstration** : il n'en reste qu'une, sous l'onglet photo de la démo.
- **Mentions légales et confidentialité** : liens vides, alors que le formulaire collecte des
  données personnelles.

## Retiré de ce dépôt

Le widget installé chez les marchands et tout ce qui servait à le tester sur un site Shopify ou
WordPress ont été retirés : script `/v1/widget.js`, fenêtre `/embed`, l'ancienne API `/api/v1/*`
(boutiques, produits, `/discover`), base de données, extensions Shopify et WooCommerce, composant
React, fausse boutique `/boutique-demo.html`. Ils restent dans l'historique Git (commit `c832e6c`).
De cette API, seule revient `/api/v1/recommend`, sans base de données, pour l'extension. Le widget
actuel (`/widget/v1.js`, `src/widget/`) est une réécriture : il reprend la fenêtre de l'extension et
n'utilise rien de l'ancien.

## Avant la mise en ligne

Publication du site sur Cloudflare depuis GitLab, réglages et erreurs connues :
[DEPLOIEMENT.md](DEPLOIEMENT.md).

- Écrire les pages mentions légales et confidentialité.
- Remplacer la limite de requêtes en mémoire (`src/lib/http.ts`) par un stockage partagé : avec
  plusieurs instances, chacune garde son propre compteur.
- Mesure sur photo : les photos restent sur l'appareil du client et la fenêtre demande son accord,
  mais il reste à écrire l'information RGPD (page confidentialité), et à revérifier que MediaPipe
  n'envoie rien à Google à chaque mise à jour de `@mediapipe/tasks-vision`.
- Extension : elle appelle encore l'API photo. L'héberger pour elle (serveur Python, en Europe :
  elle reçoit des photos du corps), ou lui faire mesurer les photos dans le navigateur comme le site.
- Extension : mettre les adresses de production dans `background.js` et les manifestes, et
  remplir le catalogue des vêtements (`src/lib/recommendation/catalog.ts`, aujourd'hui les trois
  articles de démonstration) avec les vêtements des marques et leurs guides des tailles, dans une
  base de données.
