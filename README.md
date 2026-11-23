# SwiftStyle

Widget de recommandation de taille pour les fiches produit des marques e-commerce de mode.

Équipe : Matteo HEIB, Balla DIAKITE, Thanh Danh NGUYEN, Idriss QARQABI.

Le dépôt a deux parties :

| Où | Contenu | Technologie |
|---|---|---|
| racine (`src/`, `public/`…) | le site : page d'accueil pour les marques, formulaire « Demander un essai », page de test de l'API photo, documentation | Next.js (App Router, TypeScript) |
| `backend/` | l'**API photo** : mesure les tours de poitrine, de taille, de hanches et de cuisse, et l'entrejambe, sur une photo. Appelée par les sites des marques, l'extension et la page de test | Python, FastAPI, MediaPipe Tasks Vision |
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
- http://localhost:3000/test-photo : la page de test de l'API photo (l'API doit tourner)
- http://localhost:3000/docs : la documentation des routes du site

### L'API photo

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
| `/api/v1/recommend` | `src/app/api/v1/recommend/route.ts` | taille idéale d'un article à partir des mensurations mesurées sur photo, appelée par l'extension |
| `/test-photo` | `src/app/test-photo/page.tsx` | fausse fiche produit avec le bouton « Trouver ma taille », qui appelle l'API photo comme le ferait le site d'une marque |
| `/docs` | `src/app/docs/page.tsx` | documentation des routes du site, façon Swagger UI, avec un bouton « Essayer » |
| `/openapi.json` | `src/app/openapi.json/route.ts` | la même documentation au format OpenAPI 3.1 |

## L'API photo

`POST /v1/photo/measure`, en `multipart/form-data` : la taille du client (`heightCm`), une photo
de face (`front`) et, si possible, de profil (`side`). Réponse : les tours et l'entrejambe en cm,
l'endroit où chacun a été lu sur les photos, et des remarques à montrer au client. Le détail est
dans sa documentation Swagger et dans `backend/README.md`.

`POST /v1/photo/pose` sert à la prise de vue automatique de l'extension : elle reçoit plusieurs
images par seconde de la caméra et dit, pour chacune, si la personne est prête pour la photo de
face ou de profil, et sinon quoi lui dire (`backend/app/framing.py`).

**Appel depuis le site d'une marque** : un `fetch` avec un `FormData`, depuis le navigateur. Le
navigateur ne l'autorise que si l'adresse du site est dans la variable `ALLOWED_ORIGINS` de l'API
(par défaut, seul `http://localhost:3000`). Dans ce dépôt, le site l'appelle depuis
`src/lib/photo-measure/index.ts` (`measureFromPhotos`), qui vérifie aussi que la réponse a la
forme attendue.

**Les photos sont envoyées à l'API**, analysées en mémoire puis oubliées : rien n'est enregistré ni
journalisé.

Méthode (`backend/app/measure.py`) :

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
le sol en bas). Les mesures et la taille sont recalculées dans le navigateur, sans rappeler l'API
(`src/lib/photo-measure/adjust.ts`) ; les mesures corrigées sont marquées « corrigé », et un bouton
ramène à celles de l'API.

L'API et le site partagent l'exemple de réponse `backend/app/example.json` : les tests de l'API
vérifient qu'il est exactement sa réponse sur la silhouette de test, ceux du site qu'il a la forme
attendue par le site. Si l'un change la forme du résultat sans l'autre, un des deux échoue.

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
   de démonstration le plus proche (t-shirt, jean ou veste) d'après le nom et la catégorie. Il
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

## Documentation

| Quoi | Où | Générée depuis |
|---|---|---|
| API photo | http://localhost:8000/docs (Swagger), `/redoc`, `/openapi.json` | les modèles et descriptions de `backend/app/main.py`, par FastAPI |
| Routes du site | http://localhost:3000/docs (présentation de Swagger UI), `/openapi.json` | les schémas zod de `src/lib/trial-request.ts`, par `src/lib/docs/spec.ts` |

Les deux se mettent à jour d'elles-mêmes : pour documenter un champ, on écrit sa description dans
le code (`Field(description=...)` côté API, `.meta({ description })` côté site). Les tests du site
échouent si un champ n'a pas de description, ou si un exemple ne respecte plus son schéma. La page
`/docs` du site renvoie vers la documentation de l'API.

## Les dossiers

```
src/
├── app/                      routes Next.js, voir le tableau ci-dessus
├── components/
│   ├── landing/              sections de la page d'accueil (Hero, WidgetDemo, TrialSignup…)
│   ├── photo-test/           page de test de l'API photo
│   └── docs/                 page de documentation (affichage façon Swagger UI)
└── lib/
    ├── recommendation/       moteur de recommandation et catalogue des vêtements (catalog.ts), TypeScript pur, testés
    ├── photo-measure/        client de l'API photo, forme de sa réponse (zod), correction des lignes à la main, testés
    ├── docs/spec.ts          documentation des routes du site, générée depuis les schémas zod, testée
    ├── trial-request.ts      contrat de la route du formulaire (schéma zod)
    ├── recommend-request.ts  contrat de la route de recommandation (schéma zod)
    ├── email.ts              format d'e-mail accepté par le formulaire
    └── http.ts               limite de requêtes du formulaire

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
| racine | `npm run build` | compile le site |
| racine | `npm test` | tests du moteur de recommandation, du client de l'API photo, des routes du formulaire et de recommandation, et de la documentation (Vitest) |
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
| `NEXT_PUBLIC_PHOTO_API_URL` | la page `/test-photo` appelle `http://localhost:8000` |

Mise en place du Google Sheet : voir `integrations/README.md`.

### L'API photo

| Variable | Sans elle |
|---|---|
| `ALLOWED_ORIGINS` | seul `http://localhost:3000` peut appeler l'API depuis un navigateur. Mettre les adresses des sites des marques, séparées par des virgules, ou `*` pour tous |
| `MODEL_PATH` | `backend/models/pose_landmarker_full.task` |

## Ce qui est fictif

- La boutique de la démo, ses guides des tailles et les vêtements de référence (marque « Exemple »).
- L'estimation des tours à partir de la taille et du poids : formule de la démo du site, jamais
  comparée à des mesures réelles.
- Le pourcentage « correspondance avec le guide » : il mesure l'écart avec le guide des tailles,
  ce n'est pas un taux de bonnes recommandations.
- L'analyse de photo de la page d'accueil : la démo la simule. L'API photo mesure vraiment les
  photos, mais ses réglages n'ont jamais été comparés à des mesures prises au mètre ruban (voir
  `backend/README.md`).

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
De cette API, seule revient `/api/v1/recommend`, sans base de données, pour l'extension.

## Avant la mise en ligne

Publication du site sur Cloudflare depuis GitLab, réglages et erreurs connues :
[DEPLOIEMENT.md](DEPLOIEMENT.md).

- Écrire les pages mentions légales et confidentialité.
- Remplacer la limite de requêtes en mémoire (`src/lib/http.ts`) par un stockage partagé : avec
  plusieurs instances, chacune garde son propre compteur.
- API photo : l'héberger sur un serveur Python (Cloudflare, qui héberge le site, ne fait pas tourner
  MediaPipe), et y mettre les adresses des sites des marques dans `ALLOWED_ORIGINS`.
- API photo : elle reçoit des photos du corps des clients. Il faut prévoir le consentement,
  l'information RGPD et l'hébergement (en Europe) avant toute utilisation par de vrais clients.
- API photo : rien ne limite encore qui l'appelle ni combien de fois. Pour des marques clientes,
  prévoir une clé par marque et une limite de requêtes. L'extension l'appelle environ 3 fois par
  seconde pendant la prise de vue (`/v1/photo/pose`).
- Extension : mettre les adresses de production dans `background.js` et les manifestes, et
  remplir le catalogue des vêtements (`src/lib/recommendation/catalog.ts`, aujourd'hui les trois
  articles de démonstration) avec les vêtements des marques et leurs guides des tailles, dans une
  base de données.
