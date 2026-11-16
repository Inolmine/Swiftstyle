# SwiftStyle Widget v0.2.0

Widget de recommandation de taille — webcam + TensorFlow.js + OpenCV.js.
Pensé pour les marques e-commerce mode de niche. Single file, 100% client-side, embarquable partout.

## Ce qui a été corrigé et amélioré (v0.2.0)

1. **Isolation Shadow DOM complète** :
   - Correction du bug où la modale s'insérait dans le `document.body` sans styles.
   - Désormais la modale est entièrement encapsulée dans le Shadow Root avec support backdrop blur.
   - Les événements `swiftstyle:add-to-cart` utilisent `composed: true` pour traverser la frontière Shadow DOM vers la page hôte.
2. **Performance OpenCV GrabCut multipliée par 50** :
   - Downscaling intelligent à ~360px pour la segmentation GrabCut (passage de 6000ms à <100ms) évitant tout gel du navigateur.
   - Gestion stricte de la mémoire avec `try...finally` pour `delete()` tous les `cv.Mat`.
3. **Calibrage corporel & Fallback MoveNet fiabilisés** :
   - Prise en compte de la distance biacromiale réelle (+22% par rapport aux articulations d'épaules brutes) évitant le sous-dimensionnement en fallback.
   - Algorithme de détection de hauteur anthropométrique avec tolérance si les chevilles sont partiellement coupées.
4. **Refonte Design & UX Luxury Mode** :
   - Fil d'Ariane en 3 étapes (*1. Profil* → *2. Scan silhouette* → *3. Recommandation*).
   - Cadre guide en superposition vidéo et indicateurs dynamiques de posture.
   - Sélecteur interactif de tailles avec comparaison visuelle des mensurations (poitrine, taille, hanches, épaules).
   - Démo e-commerce haut de gamme (« Maison Swift ») avec synchronisation panier et toasts de confirmation.

## Ce que ça fait

1. Bouton `Trouver ma taille exacte avec SwiftStyle` injecté sur la fiche produit.
2. Pop-up : l'utilisateur saisit sa taille + genre.
3. Capture webcam avec overlay live du squelette MoveNet (17 keypoints).
4. Snapshot → MoveNet → OpenCV GrabCut → largeurs poitrine / taille / hanches.
5. Conversion en circonférences via coefficients anthropométriques.
6. Matching size chart → taille recommandée + détail des mesures.
7. `Ajouter le L au panier` → event `swiftstyle:add-to-cart`.

## Intégration

### Shopify

```liquid
<script
  src="https://cdn.swiftstyle.io/widget.js"
  data-mount-selector=".product-form__buttons"
  data-product-id="{{ product.id }}"
  defer></script>
```

### Custom

```html
<script>
  window.SwiftStyleConfig = {
    mountSelector: '.add-to-cart',
    productId: 'tshirt-001',
    sizeChart: { unit: 'cm', sizes: [ /* ... */ ] },
    onAddToCart: (size, measurements) => { /* ... */ }
  };
</script>
<script src="widget.js"></script>
```

### Events

- `swiftstyle:add-to-cart` — detail: `{ size, measurements, productId }`
- Hook direct : `window.SwiftStyleConfig.onAddToCart(size, measurements)`

## Modèle de données — size chart

```json
{
  "unit": "cm",
  "sizes": [
    { "label": "M", "chest": [92, 98], "waist": [74, 80], "hip": [96, 102] }
  ]
}
```

Ranges `[min, max]` en cm. Le widget score chaque taille (42 % poitrine, 28 % taille, 30 % hanches) et retourne le best match.

## Précision attendue (MVP)

| Mesure | Précision | Méthode |
|---|---|---|
| Largeur épaules | ±3–4 cm | MoveNet / silhouette |
| Largeur hanches | ±3–4 cm | MoveNet / silhouette |
| Circonf. poitrine | ±6–8 cm | Ratio anthropométrique |
| Circonf. taille | ±6–8 cm | Ratio anthropométrique |
| Circonf. hanches | ±6–8 cm | Ratio anthropométrique |

### Limites honnêtes :

- Profondeur du corps non mesurable depuis une seule caméra → circonférences estimées par ratio.
- Poitrine féminine : projection mammaire non capturée → estimation basse.
- La précision réelle s'améliore avec un historique de retours par marque (boucle feedback).

## Roadmap technique

- **v0.2** — Size chart par marque avec vêtement mesuré (garment measurements), pas juste le corps.
- **v0.3** — Feedback loop : capture retour produit post-achat pour ajuster les coefficients par marque.
- **v0.4** — Multi-frame capture (3 angles : face, profil, dos) pour profondeur réelle.
- **v0.5** — Modèle de régression entraîné sur dataset anthropométrique (CAESAR / SizeUSA).

## Notes techniques

- **MoveNet SINGLEPOSE_THUNDER** — ~30 ms par frame sur GPU WebGL, chargé depuis jsDelivr.
- **OpenCV.js 4.10** — ~8 Mo, chargé en parallèle de la caméra. Fallback automatique sur MoveNet keypoints si timeout ou échec.
- **Shadow DOM** — aucun conflit CSS avec le thème hôte.
- **Client-side first** — Aucune donnée envoyée au serveur par défaut — tout le calcul est client-side. `apiBase` optionnel pour logging.
- **Watermark / branding** — modifiable via `window.SwiftStyleConfig.brand`.

## Test

```text
Ouvrir demo.html dans un navigateur
→ cliquer "Trouver ma taille exacte"
→ saisir une taille, autoriser la caméra
→ reculer jusqu'à voir le squelette entier en vert
→ cliquer "Capturer"
```

## Structure du projet

```text
swiftstyle/
├── src/
│   └── widget.js          # Code source du widget
├── dist/
│   └── widget.js          # Version distribuable autonome
├── examples/
│   ├── demo.html          # Démo produit e-commerce
│   └── size-chart.json    # Exemple de grille de tailles
├── data/
│   └── size-chart.json    # Grille de tailles de référence
├── demo.html              # Point d'accès direct démo
├── widget.js              # Point d'accès direct widget
├── package.json           # Métadonnées et scripts npm
├── .gitignore             # Règles d'exclusion git
└── README.md              # Documentation
```

---

### Prochaines étapes pour un pilote payant :
1. Un size chart réel fourni par une marque (mesures vêtements, pas juste corps).
2. Une baseline du taux de retour actuel de la marque.
3. 2–3 semaines de données d'usage pour mesurer l'impact réel sur retours / conversion.
