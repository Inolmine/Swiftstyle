# SwiftStyle · extension navigateur

Ajoute un bouton « Trouver ma taille » sur les fiches produit des sites listés dans `sites.json`.
Au clic, une fenêtre s'ouvre par-dessus la page :

1. le client donne sa taille (elle sert d'échelle aux photos) et accepte l'envoi de ses photos ;
2. la caméra s'allume. **Les photos se prennent toutes seules** : plusieurs fois par seconde, une
   image réduite part à l'API photo, qui dit si la personne est prête (entière dans l'image, assez
   grande, centrée, de face). Sinon, la fenêtre affiche sur la vidéo quoi faire (« Reculez : vos
   pieds doivent être visibles. »). Dans un coin de l'image, un mannequin au style de MediaPipe
   (ses 33 points reliés, orange à gauche, cyan à droite) montre la pose à prendre : de face bras
   un peu écartés et pieds écartés, puis de profil. La personne se place où elle veut dans le
   cadre ; son propre squelette, dans le même style, est dessiné sur elle. Dès que MediaPipe la voit prête
   sur deux images de suite sans qu'elle ait bougé, un **compte à rebours de 3 s** s'affiche. S'il
   va au bout sans qu'elle bouge ni sorte du cadre, la photo de face est prise : la dernière image
   que MediaPipe a validée. Puis « Tournez-vous de profil », et la même chose de profil. La
   fenêtre ne fait **aucun son** ;
3. les deux photos partent à l'API photo, qui mesure poitrine, taille, hanches, cuisse et
   entrejambe ;
4. ces mensurations et **l'identifiant du vêtement** (id Shopify, SKU… lu sur la page, avec le
   site) partent au site SwiftStyle. Il retrouve le vêtement et son guide des tailles dans son
   catalogue, et rend la taille idéale ;
5. sur le résultat, le client **choisit sa coupe** (ajusté, normal, ample) et peut **corriger ses
   mesures sans mètre ruban** : ses deux photos s'affichent avec une ligne de couleur par mesure, là
   où l'API l'a lue. Si une ligne dépasse du corps (vêtement ample, bras), il fait glisser ses
   extrémités jusqu'aux bords du corps, à la souris, au doigt ou aux flèches du clavier. Chaque
   ligne ne bouge que **sur un seul axe** : en largeur pour les tours (poitrine, taille, hanches,
   cuisse), en hauteur pour l'entrejambe. La ligne d'origine reste en pointillés. Les mesures sont
   recalculées dans la fenêtre (même méthode que la page `/test-photo` du site :
   `src/lib/photo-measure/adjust.ts`), et la taille par le site, **sans reprendre de photos**. Les
   mesures dont le guide du vêtement ne se sert pas sont grisées ; un lien ramène aux lignes
   d'origine ;
6. « Sélectionner la taille M » coche la taille sur la page de la marque.

Sans caméra (refusée, absente, ou bloquée par le site), le client peut importer deux photos.

## Les fichiers

Les dossiers `chromium-extension/` (Chrome, Edge, Brave, Opera) et `firefox-extension/` ont les
mêmes fichiers ; seul `manifest.json` diffère (`service_worker` d'un côté, `scripts` de l'autre).
**Modifier les deux**, ou copier l'un dans l'autre en gardant chaque manifeste.

| Fichier | Rôle |
|---|---|
| `manifest.json` | Manifest V3 : scripts, autorisations (`storage`, adresses de nos API) |
| `sites.json` | sites compatibles : adresses, motif des pages produit, emplacement et texte du bouton |
| `content/index.js` | sur la page : reconnaît une fiche produit, place le bouton, lit le nom, la catégorie et les tailles du produit, sélectionne la taille recommandée |
| `content/modal.js` | la fenêtre : caméra, prise de vue automatique, mesure, résultat. Dans un Shadow DOM fermé : la page n'atteint ni la vidéo ni les photos |
| `background.js` | service worker : fait les requêtes vers nos API (adresses dans `CONFIG`, en haut du fichier) |

Les requêtes passent par `background.js` et non par la page : elles n'ont pas besoin que nos API
autorisent chaque site de marque (CORS), et la page de la marque ne voit passer ni les photos ni
les mensurations.

## Les appels

| Étape | Appel | Service |
|---|---|---|
| cadrage, ~3 fois par seconde | `POST /v1/photo/pose` (image 640 px, `expect=front` ou `side`) | API photo (`backend/`), port 8000 |
| mesure | `POST /v1/photo/measure` (`heightCm`, `front`, `side`) | API photo |
| taille idéale, puis à chaque correction ou changement de coupe | `POST /api/v1/recommend` (JSON : `measurements`, `fit`, `garment` avec son `id`) | site SwiftStyle publié sur Cloudflare |

Les adresses sont dans `CONFIG`, en haut de `background.js` :

| Clé | Valeur actuelle | Service |
|---|---|---|
| `appUrl` | `https://swiftstyle.jesololido2004.workers.dev` | le site publié sur Cloudflare (taille idéale) |
| `photoApiUrl` | `http://localhost:8000` | l'API photo, pas encore hébergée : la caméra et la mesure ne marchent que sur un poste où elle tourne |

Chaque adresse doit aussi figurer dans les `host_permissions` des deux manifestes (déjà fait pour
celles-ci). Pour essayer une modification du site avant de la publier, remettre `appUrl` à
`http://localhost:3000` le temps de l'essai.

Documentations : http://localhost:8000/docs (API photo) et
https://swiftstyle.jesololido2004.workers.dev/docs (site, une fois la version actuelle publiée).

## Essayer en local

1. Lancer l'API photo, depuis la racine du dépôt du site (`swiftstyle.fr`, voir son `README.md`).
   Sous Windows PowerShell (`&&` n'y existe pas) :

   ```powershell
   cd backend
   .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
   ```

   Le site, lui, est appelé à son adresse publique (`appUrl`). Pour essayer une version locale du
   site, lancer `npm run dev` et remettre `appUrl` à `http://localhost:3000`.

   Sous macOS / Linux : `cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000`.

2. Charger l'extension :
   - **Chrome / Edge** : `chrome://extensions`, activer le « Mode développeur », « Charger
     l'extension non empaquetée », choisir `chromium-extension/` ;
   - **Firefox** : `about:debugging#/runtime/this-firefox`, « Charger un module complémentaire
     temporaire », choisir `firefox-extension/manifest.json`. Dans `about:addons`, vérifier que
     l'extension a l'autorisation d'accéder à `localhost`.
3. Ouvrir une fiche produit d'un site de `sites.json` (Uniqlo, Le Slip Français, Nike…) : le
   bouton apparaît sous les tailles. Le navigateur demande l'accès à la caméra **pour ce site** :
   choisir « Autoriser cette fois » plutôt qu'une autorisation permanente.
4. Se placer à 2 ou 3 m, l'ordinateur à hauteur des hanches, bras un peu écartés.

Après une modification d'un fichier, recharger l'extension (bouton ↻ dans `chrome://extensions`)
puis la page.

## Mise en production

- `appUrl` pointe déjà vers le site publié (`https://swiftstyle.jesololido2004.workers.dev`).
  Reste `photoApiUrl` : y mettre l'adresse de l'API photo une fois hébergée, et l'ajouter aux
  `host_permissions` des deux manifestes. Si le site passe sur `swiftstyle.fr`, changer `appUrl`
  (`https://swiftstyle.fr/*` et `https://*.swiftstyle.fr/*` sont déjà autorisés).
- Le catalogue des vêtements (`src/lib/recommendation/catalog.ts` du site) ne contient que les
  trois articles de démonstration (`demo-tee`, `demo-jean`, `demo-veste`). Un vêtement inconnu reçoit
  le guide de démonstration le plus proche, choisi d'après son nom et sa catégorie (la réponse le
  dit : `garment.source` vaut `inferred`). Il faut y mettre les vêtements des marques, sous
  l'identifiant que l'extension lit sur leurs pages, avec leurs vrais guides des tailles.
- La caméra est demandée au nom du site de la marque (le script tourne dans sa page) : une
  autorisation permanente donnée là profite aussi aux scripts de ce site. Une page d'extension
  dédiée (onglet ou fenêtre) éviterait ce partage, au prix d'un changement d'onglet.
- Les photos du corps sont des données personnelles : information RGPD, consentement (la case de
  la fenêtre) et hébergement en Europe de l'API photo, avant tout usage par de vrais clients.

## Données

- Envoyées : les images de la caméra pendant le cadrage, les deux photos, la taille du client, ses
  mensurations (corrigées ou non), sa coupe préférée, et pour le vêtement : son identifiant, le
  site, son nom, sa catégorie, son adresse (sans paramètres) et les tailles de la page.
- Gardées dans le navigateur (`chrome.storage.local`, invisible des sites) : la taille du client
  et sa coupe préférée. Ni photo ni mensuration.
- Les API analysent les images en mémoire puis les oublient : rien n'est enregistré ni journalisé.
