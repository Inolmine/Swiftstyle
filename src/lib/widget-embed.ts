// Ce que les marques copient sur leurs fiches produit pour afficher le widget, et ce qu'elles peuvent régler.
// Sans zod : importé par la page /docs côté navigateur.

export const WIDGET_SCRIPT_PATH = "/widget/v1.js";

/** Connexion au démarrage : 4 tentatives, 1, 2 puis 4 s d'attente entre elles, 5 s au plus chacune. */
export const WIDGET_RETRY = { attempts: 4, delaysMs: [1000, 2000, 4000], timeoutMs: 5000 } as const;

/** Le t-shirt de démonstration du catalogue : le code HTML marche tel quel, avant d'y mettre l'identifiant du produit. */
export const WIDGET_DEMO_PRODUCT_ID = "demo-tee";

/** Adresse du site en production (DEPLOIEMENT.md), pour les codes affichés avant que la page ne connaisse la sienne. */
export const WIDGET_DEFAULT_ORIGIN = "https://swiftstyle.jesololido2004.workers.dev";

export interface WidgetSnippet {
  id: string;
  label: string;
  lang: string;
  code: string;
  /** Où coller ce code, et d'où vient l'identifiant du produit. */
  note?: string;
}

/** Les codes à copier (deux lignes), avec l'adresse du site SwiftStyle qui sert le script (WIDGET_DEFAULT_ORIGIN en production). */
export function widgetSnippets(origin: string, productId = WIDGET_DEMO_PRODUCT_ID): WidgetSnippet[] {
  const script = `<script src="${origin.replace(/\/+$/, "")}${WIDGET_SCRIPT_PATH}" async></script>`;
  return [
    {
      id: "html",
      label: "HTML",
      lang: "html",
      code: `<div data-swiftstyle data-product-id="${productId}"></div>
${script}`,
    },
    {
      id: "shopify",
      label: "Shopify",
      lang: "liquid",
      code: `<div data-swiftstyle data-product-id="{{ product.id }}" data-product-name="{{ product.title | escape }}"></div>
${script}`,
      note: "Dans la section produit du thème (main-product.liquid). Shopify remplit l'identifiant et le nom du produit de chaque fiche.",
    },
    {
      id: "woocommerce",
      label: "WooCommerce",
      lang: "php",
      code: `<div data-swiftstyle data-product-id="<?php echo esc_attr( $product->get_id() ); ?>" data-product-name="<?php echo esc_attr( $product->get_name() ); ?>"></div>
${script}`,
      note: "Dans le modèle de la fiche produit (single-product). WooCommerce remplit l'identifiant et le nom du produit de chaque fiche.",
    },
  ];
}

export const WIDGET_ATTRIBUTES: { name: string; description: string }[] = [
  { name: "data-swiftstyle", description: "Obligatoire. L'endroit où le bouton s'affiche." },
  {
    name: "data-product-id",
    description:
      "Identifiant du vêtement (id Shopify, SKU…), celui du catalogue SwiftStyle. Sans lui, le script le cherche sur la page (Shopify, WooCommerce, données JSON-LD, adresse) ; s'il ne le trouve pas, le bouton ne s'affiche pas.",
  },
  { name: "data-product-name", description: "Nom du vêtement. Par défaut : données JSON-LD, og:title ou titre h1 de la page." },
  { name: "data-product-category", description: "Catégorie ou fil d'Ariane. Par défaut : le fil d'Ariane de la page." },
  { name: "data-sizes", description: "Tailles proposées, séparées par des virgules (XS,S,M,L). Par défaut : lues dans le formulaire du produit." },
  { name: "data-label", description: "Texte du bouton. Par défaut : « Trouver ma taille »." },
];

export const WIDGET_EVENTS: { name: string; description: string }[] = [
  { name: "swiftstyle:ready", description: "Le site SwiftStyle répond et la mesure est possible (API photo, ou MediaPipe dans le navigateur) : le bouton est affiché." },
  {
    name: "swiftstyle:unavailable",
    description: `Le site ne répond pas, ou ni l'API photo ni le navigateur ne peuvent mesurer, après ${WIDGET_RETRY.attempts} tentatives : rien n'est affiché (l'élément reçoit l'attribut hidden).`,
  },
  {
    name: "swiftstyle:size",
    description:
      "Le client a choisi la taille event.detail.size. Le script la coche dans le formulaire du produit ; appeler event.preventDefault() pour la sélectionner soi-même.",
  },
];

export const WIDGET_STYLE =
  "Le bouton reprend la police de la page. Couleurs et arrondi se règlent sur l'élément data-swiftstyle avec les variables CSS --swiftstyle-accent (#111 par défaut), --swiftstyle-on-accent (#fff) et --swiftstyle-radius (4px), ou entièrement avec le sélecteur [data-swiftstyle]::part(button).";
