# Déploiement : GitLab et Cloudflare

Le site Next.js est publié sur **Cloudflare Workers** grâce à OpenNext (`@opennextjs/cloudflare`),
à partir du dépôt GitLab, à l'adresse **https://swiftstyle.jesololido2004.workers.dev** (sous-domaine `workers.dev` du compte
Cloudflare). Ce document donne les réglages à faire côté Cloudflare et GitLab, et les
erreurs déjà rencontrées ou prévisibles, avec leur parade.

## Ce qui est déployé, et où

| Partie | Où | Comment |
|---|---|---|
| Site Next.js (`src/`, `public/`) | Cloudflare Workers | OpenNext le transforme en Worker : `open-next.config.ts`, `wrangler.jsonc` |
| Widget des sites des marques (`src/widget/`) | avec le site, `/widget/v1.js` | compilé par `npm run build:widget`, lancé avant `next build` (script `prebuild`) |
| Mesure sur photo (MediaPipe) | avec le site, `/mediapipe/<version>/` (fichiers statiques), calcul dans le navigateur du client | moteur WASM et modèle préparés par `npm run prepare:mediapipe` (script `prebuild`), qui télécharge le modèle chez Google : le build a besoin d'Internet |
| API photo (`backend/`) | **nulle part pour l'instant** | le site n'en a plus besoin ; seule l'extension l'appelle encore (voir plus bas) |
| Extension navigateur | Chrome Web Store, Firefox Add-ons | hors de ce dépôt (`swiftstyle.fr-web-extension/`, non versionné) |

## Vérifié en local le 22/11/2026

- `npx opennextjs-cloudflare build` : réussi (Next.js 16.4.6, OpenNext 1.20.17).
- Taille du Worker (`npx wrangler deploy --dry-run`) : **1,4 Mo compressé**, sous la limite de
  3 Mo du plan gratuit.
- Le Worker lancé dans le moteur de Cloudflare (`wrangler dev`, workerd) : l'accueil, `/docs`,
  `/test-photo`, `/openapi.json`, les images, la page 404, `POST /api/v1/recommend` (et sa requête
  CORS préliminaire) répondent. `POST /api/demande-essai` lit bien le secret
  `GOOGLE_SHEETS_WEBHOOK_URL` à l'exécution, et répond 503 sans lui.
- Constaté au passage : sans `APP_ORIGIN` au build, l'image d'aperçu des liens pointe vers
  `http://localhost:3000`.

## Choisir comment déployer

Deux façons, **à ne pas cumuler** (sinon chaque push sur `main` déploie deux fois) :

- **Option A, recommandée** : Cloudflare récupère le code sur GitLab, le construit et le déploie
  lui-même (Workers Builds). Aucun jeton Cloudflare dans GitLab.
- **Option B** : la CI GitLab construit et déploie (job `deploy_cloudflare` de `.gitlab-ci.yml`),
  avec un jeton d'API Cloudflare rangé dans GitLab.

Dans les deux cas, la CI GitLab vérifie le dépôt avant (secrets, Semgrep, typecheck, tests, build
Cloudflare).

## Option A : Cloudflare déploie depuis GitLab

Libellés du tableau de bord en anglais.

1. **Workers & Pages → Create → Workers → Import a repository**, se connecter à GitLab, choisir
   `estiam825327/swiftstyle.fr`. Créer un **Worker**, pas un projet **Pages** : Pages ne sait pas
   déployer une application OpenNext.
   - Le compte GitLab qui autorise Cloudflare doit avoir accès au dépôt (rôle Maintainer dans le
     groupe). S'il quitte le groupe ou révoque l'accès, les builds s'arrêtent sans prévenir.
2. **Project name** : `swiftstyle`, exactement le `name` de `wrangler.jsonc`. Sinon le déploiement
   échoue (le nom du Worker et celui du fichier doivent être identiques).
3. **Settings → Build** :

   | Champ | Valeur |
   |---|---|
   | Git branch (production) | `main` |
   | Build command | `npx opennextjs-cloudflare build` |
   | Deploy command | `npx opennextjs-cloudflare deploy` |
   | Non-production branch deploy command | `npx opennextjs-cloudflare upload` (crée une version d'aperçu sans toucher à la production) |
   | Root directory | `/` (la racine du dépôt, pas `backend/`) |

4. **Settings → Build → Variables and secrets** (lues **pendant le build**) :

   | Variable | Valeur |
   |---|---|
   | `APP_ORIGIN` | `https://swiftstyle.jesololido2004.workers.dev` |
   | `NEXT_TELEMETRY_DISABLED` | `1` |

   La version de Node vient du fichier `.node-version` (22). Si les logs de build montrent une
   autre version, ajouter aussi `NODE_VERSION` = `22` ici.
5. **Settings → Variables and Secrets** (lues **à l'exécution** par le Worker) :

   | Nom | Type | Valeur |
   |---|---|---|
   | `GOOGLE_SHEETS_WEBHOOK_URL` | **Secret** | l'URL `/exec` du script Google Sheets (voir `integrations/README.md`) |

6. **Settings → Domains & Routes** : vérifier que l'adresse `workers.dev` est activée. Le site est
   servi à `https://swiftstyle.jesololido2004.workers.dev` : `swiftstyle` est le nom du Worker (`wrangler.jsonc`),
   `jesololido2004` le sous-domaine du compte. Renommer l'un ou l'autre change l'adresse : il
   faudrait alors changer `APP_ORIGIN`, `WIDGET_DEFAULT_ORIGIN` (`src/lib/widget-embed.ts`) et le
   code déjà collé chez les marques.
   - Plus tard, un domaine à soi (par exemple `swiftstyle.fr`) : **Add → Custom domain**. Le
     domaine doit être une zone de ce compte Cloudflare ; supprimer avant les enregistrements DNS
     `A`/`AAAA`/`CNAME` existants pour ce nom. Les marques qui ont collé l'adresse `workers.dev`
     continuent de marcher tant qu'elle reste activée.
7. Pousser sur `main` et suivre le build dans **Deployments**.

## Option B : la CI GitLab déploie

1. Cloudflare : **My Profile → API Tokens → Create Token**, modèle **Edit Cloudflare Workers**,
   limité au compte de SwiftStyle. Noter aussi l'**Account ID** (page d'accueil du compte).
2. GitLab : **Settings → CI/CD → Variables** :

   | Variable | Options |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Masked, Protected |
   | `CLOUDFLARE_ACCOUNT_ID` | Protected |
   | `APP_ORIGIN` | `https://swiftstyle.jesololido2004.workers.dev` |

   Une variable **Protected** n'existe que sur les branches protégées : vérifier que `main` l'est
   (**Settings → Repository → Protected branches**), sinon le job ne voit pas le jeton.
3. Le secret `GOOGLE_SHEETS_WEBHOOK_URL` et le domaine se règlent quand même sur Cloudflare
   (étapes 5 et 6 de l'option A).
4. Si un build Git Cloudflare (option A) existe, le déconnecter : **Settings → Build → Disconnect**.

## Les variables

| Variable | Lue | Où la mettre | Sans elle, en production |
|---|---|---|---|
| `APP_ORIGIN` | au build (pages statiques) | variables de **build** | l'image d'aperçu des liens pointe vers `localhost:3000` |
| `GOOGLE_SHEETS_WEBHOOK_URL` | à l'exécution | **Secret** du Worker | le formulaire d'essai répond 503 `not_configured` |

Changer une variable de build demande un nouveau build (re-pousser, ou **Retry build**) : le
Worker déjà déployé garde l'ancienne valeur.

## Erreurs connues et parades

| Symptôme | Cause | Parade |
|---|---|---|
| `No open-next.config.ts file was found` | fichier absent (le build ne peut pas poser la question en CI) | `open-next.config.ts` est maintenant versionné |
| Le build ne trouve pas `.open-next/worker.js`, ou Cloudflare cherche `.vercel/output` | build command `npm run build` (Next seul), ou projet Pages | build command `npx opennextjs-cloudflare build`, projet **Worker** |
| Erreur de nom au déploiement | nom du Worker ≠ `name` de `wrangler.jsonc` | renommer le projet ou le fichier pour qu'ils soient identiques |
| `npm ci can only install packages when your package.json and package-lock.json are in sync` | `package.json` modifié sans `package-lock.json` | `npm install` en local, versionner les deux fichiers ensemble |
| Version de Node trop ancienne (Next 16 demande ≥ 20.9) | image de build par défaut | `.node-version` (22), ou variable de build `NODE_VERSION` |
| Les variables saisies dans le tableau de bord disparaissent après un déploiement | Wrangler remplace les variables par celles du fichier | `"keep_vars": true` dans `wrangler.jsonc` ; mettre les valeurs sensibles en **Secret** |
| Formulaire d'essai : 503 `not_configured` | secret absent | créer le secret `GOOGLE_SHEETS_WEBHOOK_URL` |
| Formulaire d'essai : 502 `upstream` | URL du script fausse, ou script Apps Script non redéployé | vérifier l'URL `/exec` et le déploiement du script |
| `Error 1102: Worker exceeded resource limits` | plan gratuit : 10 ms de CPU par requête | les pages sont prérendues, ça ne devrait pas arriver ; sinon passer au plan Workers Paid (5 $/mois, 30 s de CPU) |
| Worker refusé car trop gros | plan gratuit : 3 Mo compressés (aujourd'hui 1,4 Mo) | surveiller la taille avec `npx wrangler deploy --dry-run` ; au-delà, plan payant (10 Mo). Les fichiers de MediaPipe (24 Mo) sont des fichiers statiques : ils ne comptent pas dans cette limite |
| Fichier statique refusé au déploiement | Cloudflare limite chaque fichier statique à 25 Mio | le plus gros est le moteur WASM de MediaPipe (14,6 Mo) : à surveiller à chaque mise à jour de `@mediapipe/tasks-vision` |
| Build en échec : « le modèle publié par Google a changé » | le modèle `latest` de MediaPipe a été remplacé | vérifier le nouveau modèle, puis mettre à jour son empreinte dans `scripts/prepare-mediapipe.mjs` (et le modèle de l'API Python) |
| Pipeline GitLab en échec sur Semgrep | un chemin listé n'existe pas, ou un nouveau constat | ne lister que des dossiers versionnés ; lire le constat dans les logs du job |
| Pipeline GitLab en échec sur gitleaks | un secret dans un fichier ou dans l'historique | ne jamais versionner `.env`, `.env.local`, `.dev.vars` (ignorés par `.gitignore`) |
| Deux pipelines par push | branche avec une merge request ouverte | réglé par la règle `workflow` de `.gitlab-ci.yml` |
| Le widget ne s'affiche pas sur le site d'une marque (le spinner tourne quelques secondes puis disparaît) | voulu quand le site ou ses fichiers de mesure ne répondent pas ; la console du navigateur de la page dit pourquoi | « fichiers de MediaPipe injoignable » : `public/_headers` n'a pas été appliqué (en-tête `Access-Control-Allow-Origin` absent sur `/mediapipe/`). « erreur 404 » sur ces fichiers : build lancé sans `npm run build`. Une politique de sécurité (`Content-Security-Policy`) du site de la marque peut aussi bloquer le script, les fichiers ou WebAssembly |
| « L'analyse n'a pas pu démarrer sur cet appareil » dans la fenêtre | navigateur sans WebGL utilisable (MediaPipe 1.2.2 ne sait pas tirer la silhouette sur le processeur), ou fichiers de MediaPipe inaccessibles | essayer un autre navigateur ; vérifier `/mediapipe/<version>/` (commandes plus bas) |
| `/widget/v1.js` répond 404 | build lancé sans `npm run build` (le script `prebuild` compile le widget) | build command `npx opennextjs-cloudflare build`, qui appelle `npm run build` |
| `OpenNext is not fully compatible with Windows` | build lancé sous Windows | avertissement seulement (le build passe) ; le build qui compte est celui de Cloudflare ou de la CI, sous Linux. Pour tester le Worker en local, WSL est plus sûr |

## Réglages Cloudflare conseillés

- **Limite de requêtes** : la limite de `/api/demande-essai` et `/api/v1/recommend` est gardée en
  mémoire, par instance du Worker ; Cloudflare en lance plusieurs, elle est donc approximative.
  Ajouter une règle **Security → WAF → Rate limiting rules** (une règle incluse dans le plan
  gratuit) : chemin commençant par `/api/`, par exemple 30 requêtes par minute et par IP, action
  Block.
- **Observabilité** : activée dans `wrangler.jsonc` ; les erreurs du Worker sont dans
  **Workers → swiftstyle → Logs**.
- **Date de compatibilité** : `2025-04-01` fonctionne (OpenNext suggère une date plus récente).
  La changer seulement en testant avant : elle modifie le comportement du moteur.

## Après chaque déploiement

```bash
curl -I https://swiftstyle.jesololido2004.workers.dev/
```

```bash
curl -s -X POST https://swiftstyle.jesololido2004.workers.dev/api/v1/recommend -H "content-type: application/json" -d '{"measurements":{"chest":92,"waist":76},"garment":{"id":"demo-tee"}}'
```

```bash
curl -s https://swiftstyle.jesololido2004.workers.dev/api/v1/widget
```

```bash
curl -I https://swiftstyle.jesololido2004.workers.dev/widget/v1.js
```

```bash
curl -sI -H "Origin: https://www.marque.example" https://swiftstyle.jesololido2004.workers.dev/mediapipe/1.2.2/pose_landmarker_full.task
```

Le premier répond `200`, le deuxième une taille (`"size":"M"`), le troisième `{"ok":true}`, le
quatrième `200`. Le cinquième (le numéro est la version de `@mediapipe/tasks-vision`) répond `200`
avec `access-control-allow-origin: *` et `cache-control: public, max-age=31536000, immutable` :
sans ces en-têtes, `public/_headers` n'a pas été pris en compte et le widget ne s'affichera pas chez
les marques. Sur `/docs`, l'aperçu du widget doit afficher le bouton « Trouver ma taille ». Vérifier aussi que l'aperçu d'un
lien vers le site (Teams, Slack) affiche l'image : sinon `APP_ORIGIN` manquait au build.

## L'API photo et l'extension en production

- **Site et widget** : rien à héberger en plus. Les photos sont mesurées dans le navigateur du client
  avec les fichiers de `/mediapipe/`, servis par le Worker comme les autres fichiers statiques.
- **API photo** : seule l'extension l'appelle encore. Pour la publier, il faudrait l'héberger sur un
  serveur Python, en Europe (photos du corps : RGPD), avec environ 1 Go de mémoire pour MediaPipe :
  `python scripts/download_model.py`, puis `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
  Faute de budget, l'autre voie est de faire mesurer les photos dans le navigateur par l'extension,
  comme le site.
- **Extension** : remplacer les adresses de `CONFIG` dans `background.js` (`appUrl` :
  `https://swiftstyle.jesololido2004.workers.dev`, `photoApiUrl` : l'adresse de l'API photo) et les ajouter aux
  `host_permissions` des deux manifestes.
