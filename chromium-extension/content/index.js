// Content script SwiftStyle :
// 1. Charge la liste des sites compatibles depuis sites.json
// 2. Si le site actuel n'est pas dans la liste -> arrêt immédiat
// 3. Scraping intelligent :
//    - Localise les sélecteurs de taille (menus déroulants, radios, pastilles/swatches)
//    - Localise le bouton "Ajouter au panier" (textes multilingues, attributs e-commerce)
//    - Place automatiquement "Trouver ma taille" au meilleur endroit (sous les tailles ou sous le bouton panier)
// 4. Au clic -> ouvre l'iframe /embed (SizeFinder, React) et applique la taille recommandée

const APP_ORIGIN = "https://localhost:3000";
const MESSAGE_SOURCE = "swiftstyle";
const EMBED_SRC = APP_ORIGIN + "/embed";

// Configuration de secours si sites.json ne peut pas être lu
const FALLBACK_SITES = [
  {
    id: "localhost-demo",
    name: "Boutique Démo Locale",
    enabled: true,
    matches: ["localhost:3000", "127.0.0.1:3000"],
    shopKey: "pk_demo_boutique",
    productPage: { pathPattern: "(boutique-extension|boutique-demo)" },
    button: { anchor: null, position: "afterend", text: "Trouver ma taille" },
    productId: { strategy: "auto" }
  }
];

main();

async function main() {
  const sites = await loadSites();
  const siteConfig = matchCurrentSite(sites);
  if (!siteConfig) {
    // Ce site n'est pas dans la liste des sites compatibles : arrêt immédiat.
    return;
  }

  let tries = 0;
  const maxTries = 15; // 15 essais * 300ms = 4.5s pour les SPAs qui chargent en asynchrone

  function tryMount() {
    if (document.querySelector("#swiftstyle-root, [data-swiftstyle-root], [data-swiftstyle-modal]")) return;

    // 2. Vérifier si on est bien sur une page produit (si un motif d'URL est configuré)
    if (siteConfig.productPage && siteConfig.productPage.pathPattern) {
      try {
        const regex = new RegExp(siteConfig.productPage.pathPattern);
        if (!regex.test(location.pathname + location.search)) {
          return;
        }
      } catch (e) {
        // Expression régulière invalide, continuer
      }
    }

    const origin = location.origin;
    if (!origin || origin === "null") return;

    // 3. Extraire le productId selon la stratégie du site
    const strategy = (siteConfig.productId && siteConfig.productId.strategy) || "auto";
    const productId = extractProductId(strategy);
    const anchorInfo = findBestAnchor(siteConfig);

    // Si React / le framework n'a pas encore fini de monter le DOM (ex: Uniqlo, Shopify Hydrogen)
    if ((!productId || !anchorInfo || !anchorInfo.element) && tries < maxTries) {
      tries++;
      setTimeout(tryMount, 300);
      return;
    }

    if (!productId) return;

    (async () => {
      // 4. Récupérer la clé de boutique (soit définie dans sites.json, soit via /discover)
      const shopKey = siteConfig.shopKey || (await discover(origin));
      if (!shopKey) return;

      // 5. Afficher le bouton au point d'ancrage scrapé
      renderButton(shopKey, productId, siteConfig);
    })();
  }

  tryMount();

  // Écouter les changements d'URL (SPA type history.pushState sur Uniqlo, etc.)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const oldRoot = document.querySelector("#swiftstyle-root");
      if (oldRoot) oldRoot.remove();
      tries = 0;
      setTimeout(tryMount, 400);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// ---------- chargement et correspondance des sites ----------

async function loadSites() {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      const url = chrome.runtime.getURL("sites.json");
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    }
  } catch (err) {
    // En cas de problème de lecture, utiliser la liste de secours
  }
  return FALLBACK_SITES;
}

function matchCurrentSite(sites) {
  const currentHost = location.host.toLowerCase();
  const currentHostname = location.hostname.toLowerCase();

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (site.enabled === false) continue;
    if (!Array.isArray(site.matches)) continue;

    for (let j = 0; j < site.matches.length; j++) {
      let p = site.matches[j].toLowerCase().trim().replace(/^https?:\/\//, "");
      p = p.split("/")[0].trim(); // Supprimer les chemins accidentels type "uniqlo.com/fr/fr"

      if (p === currentHost || p === currentHostname) {
        return site;
      }
      if (p.startsWith("*.") && (currentHostname.endsWith(p.slice(1)) || currentHostname === p.slice(2))) {
        return site;
      }
      if (p.startsWith(".") && currentHostname.endsWith(p)) {
        return site;
      }
    }
  }
  return null;
}

// ---------- découverte de la boutique ----------

async function discover(origin) {
  try {
    const url = `${APP_ORIGIN}/api/v1/discover?origin=${encodeURIComponent(origin)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.shopKey === "string" ? data.shopKey : null;
  } catch {
    return null;
  }
}

// ---------- Scraping : détection du bouton Ajouter au Panier et du Sélecteur de Taille ----------

const ADD_TO_CART_CONTAINS_REGEX = /(ajouter au panier|ajouter au sac|add to cart|add to bag|add to basket|in den warenkorb|añadir a la cesta|commander|j'achète)/i;
const SIZE_LABEL_REGEX = /\b(taille|size|pointure|choisir une taille|select size)\b/i;

function isVisible(el) {
  if (!el) return false;
  try {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  } catch (e) {
    return true;
  }
}

/**
 * Localise le bouton "Ajouter au panier" par sélecteurs e-commerce connus ou recherche textuelle.
 */
function findAddToCartButton(scope = document) {
  // 1. Sélecteurs standard du e-commerce (Shopify, WooCommerce, PrestaShop, Magento)
  const standardSelectors = [
    'button[name="add"]',
    'button[name="add-to-cart"]',
    '.single_add_to_cart_button',
    '.product-form__submit',
    '.product-form__cart-submit',
    '[data-action="add-to-cart"]',
    '[data-add-to-cart]',
    '#add-to-cart',
    '#AddToCart',
    '#addToCart',
    '.btn-add-to-cart',
    '.add-to-cart-button',
    'form[action*="/cart/add"] button[type="submit"]',
    'form.cart button[type="submit"]',
    'form[action*="/cart/add"] input[type="submit"]',
    'form.cart input[type="submit"]',
  ];

  for (let i = 0; i < standardSelectors.length; i++) {
    const el = scope.querySelector(standardSelectors[i]);
    if (el && isVisible(el)) return el;
  }

  // 2. Recherche textuelle parmi les boutons et liens cliquables
  const candidates = scope.querySelectorAll('button, input[type="submit"], [role="button"], a.btn, a.button');
  for (let j = 0; j < candidates.length; j++) {
    const el = candidates[j];
    const text = (el.value || el.textContent || "").trim();
    if (ADD_TO_CART_CONTAINS_REGEX.test(text) && isVisible(el)) {
      return el;
    }
  }

  return null;
}

/**
 * Localise l'emplacement des tailles : menu déroulant, pastilles/swatches, radios ou conteneur de choix.
 */
function findSizeSelector(scope = document) {
  // 1. Menus déroulants select explicitement liés à la taille
  const selectSelectors = [
    'select[name*="size" i]',
    'select[name*="taille" i]',
    'select[id*="size" i]',
    'select[id*="taille" i]',
  ];
  for (let i = 0; i < selectSelectors.length; i++) {
    const el = scope.querySelector(selectSelectors[i]);
    if (el && isVisible(el)) {
      return el.closest(".product-form__input, .form-group, .selector-wrapper, .size-picker") || el;
    }
  }

  // 2. Conteneurs de pastilles / radios de taille (Shopify Dawn, WooCommerce swatches, etc.)
  const swatchContainers = [
    '[data-option*="size" i]',
    '[data-option-name*="taille" i]',
    '[data-attribute_name*="size" i]',
    '.product-form__input--pill',
    '.size-swatches',
    '.swatch-size',
    '.variant-radios',
    'fieldset[class*="size" i]',
    'fieldset[class*="taille" i]',
  ];
  for (let j = 0; j < swatchContainers.length; j++) {
    const el = scope.querySelector(swatchContainers[j]);
    if (el && isVisible(el)) return el;
  }

  // 3. Recherche via libellé "Taille" ou "Size"
  const labels = scope.querySelectorAll("label, legend, span, h3, h4, div");
  for (let k = 0; k < labels.length; k++) {
    const el = labels[k];
    const text = (el.textContent || "").trim();
    if (text.length <= 30 && SIZE_LABEL_REGEX.test(text)) {
      const parent = el.closest("fieldset, .product-form__input, .swatches, .variant-wrapper, .selector-wrapper");
      if (parent && isVisible(parent)) {
        return parent;
      }
      if (el.nextElementSibling && isVisible(el.nextElementSibling)) {
        return el.nextElementSibling;
      }
    }
  }

  return null;
}

/**
 * Trouve le meilleur point d'ancrage pour le bouton :
 * 1. Ancre personnalisée si spécifiée dans sites.json
 * 2. Juste en dessous du sélecteur de taille (UX optimale)
 * 3. Juste sous le bouton "Ajouter au panier"
 * 4. Formulaire produit standard
 */
function findBestAnchor(siteConfig) {
  const customAnchor = siteConfig && siteConfig.button && siteConfig.button.anchor;
  if (customAnchor) {
    const el = document.querySelector(customAnchor);
    if (el) {
      return { element: el, position: siteConfig.button.position || "afterend" };
    }
  }

  // Priorité 1 : Scraping sous le sélecteur de tailles
  const sizeSelector = findSizeSelector();
  if (sizeSelector && sizeSelector.parentNode) {
    return { element: sizeSelector, position: "afterend" };
  }

  // Priorité 2 : Scraping sous le bouton "Ajouter au panier"
  const addToCartBtn = findAddToCartButton();
  if (addToCartBtn && addToCartBtn.parentNode) {
    const wrapper = addToCartBtn.closest(".product-form__buttons, .product-actions, .add-to-cart-wrapper");
    return { element: wrapper || addToCartBtn, position: "afterend" };
  }

  // Priorité 3 : Formulaire produit standard
  const form = findProductForm();
  if (form && form.parentNode) {
    return { element: form, position: "afterend" };
  }

  // Repli
  return { element: document.querySelector("main") || document.body, position: "afterend" };
}

// ---------- bouton (ancré selon le scraping ou la configuration) ----------

function renderButton(shopKey, productId, siteConfig) {
  const { element: anchor, position } = findBestAnchor(siteConfig);
  const buttonConfig = (siteConfig && siteConfig.button) || {};
  const buttonText = buttonConfig.text || "Trouver ma taille";

  const root = document.createElement("div");
  root.id = "swiftstyle-root";
  root.dataset.productId = productId;
  root.style.margin = "12px 0";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = buttonText;
  btn.style.cssText
    = "display:flex;align-items:center;justify-content:center;gap:8px;"
    + "width:100%;padding:12px 16px;border:1px solid #111;border-radius:2px;"
    + "background:#fff;color:#111;font:inherit;font-weight:600;cursor:pointer";
  btn.addEventListener("mouseenter", () => { btn.style.background = "#111"; btn.style.color = "#fff"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#fff"; btn.style.color = "#111"; });
  btn.addEventListener("click", () => openModal(shopKey, productId));

  root.appendChild(btn);

  if (anchor && anchor.parentNode && position !== "inside") {
    anchor.insertAdjacentElement(position, root);
  } else if (anchor && position === "inside") {
    anchor.appendChild(root);
  } else {
    (document.body || document.documentElement).appendChild(root);
  }
}

// ---------- modale (iframe /embed + postMessage) ----------

function openModal(shopKey, productId) {
  if (document.querySelector("[data-swiftstyle-modal]")) return;

  const src = EMBED_SRC + "?shopKey=" + encodeURIComponent(shopKey) + "&productId=" + encodeURIComponent(productId);

  // Utiliser des éléments du DOM standard sans attachShadow (évite que les scripts
  // tiers de Shopify comme exit-interstitial ne court-circuitent le Shadow DOM)
  const host = document.createElement("div");
  host.setAttribute("data-swiftstyle-modal", "");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;";

  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);";

  const dialog = document.createElement("div");
  dialog.style.cssText
    = "position:relative;z-index:1;width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 32px);"
    + "background:#fff;border-radius:6px;box-shadow:0 12px 30px rgba(0,0,0,0.25);overflow:hidden;display:flex;flex-direction:column;font-family:sans-serif;";

  // En-tête avec bouton Fermer (croix)
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa;";
  header.innerHTML
    = '<span style="font-weight:600;font-size:14px;color:#111;">Trouver ma taille avec SwiftStyle</span>'
    + '<button type="button" aria-label="Fermer" style="border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:#666;padding:0 4px;">&times;</button>';

  const closeBtn = header.querySelector("button");

  // Détection du Mixed Content (site en HTTPS vs serveur local en HTTP)
  const isMixedContent = location.protocol === "https:" && APP_ORIGIN.startsWith("http:");
  let mixedNotice = null;
  if (isMixedContent) {
    mixedNotice = document.createElement("div");
    mixedNotice.style.cssText = "padding:10px 14px;background:#fff8e6;border-bottom:1px solid #ffe58f;font-size:12px;color:#874d00;line-height:1.4;";
    mixedNotice.innerHTML
      = '<strong>Note de test :</strong> Ce site est en HTTPS mais votre serveur SwiftStyle est en <code>http://localhost:3000</code>. '
      + 'Si l\'iframe reste blanche, le navigateur bloque le contenu mixte. '
      + '<a href="' + src + '" target="_blank" style="color:#1890ff;text-decoration:underline;margin-left:4px;">Ouvrir le formulaire dans un onglet</a>.';
  }

  const iframe = document.createElement("iframe");
  iframe.title = "Trouver ma taille avec SwiftStyle";
  iframe.src = src;
  iframe.style.cssText = "display:block;width:100%;height:440px;border:none;background:#fff;";

  dialog.appendChild(header);
  if (mixedNotice) dialog.appendChild(mixedNotice);
  dialog.appendChild(iframe);

  host.appendChild(backdrop);
  host.appendChild(dialog);

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  document.body.appendChild(host);

  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey);
    host.remove();
    document.documentElement.style.overflow = prevOverflow;
  }

  function onMessage(e) {
    if (e.source !== iframe.contentWindow) return;
    if (e.origin !== APP_ORIGIN) return;
    if (!isMessage(e.data)) return;
    const msg = e.data;

    if (msg.type === "ready") {
      const context = {
        source: MESSAGE_SOURCE,
        type: "context",
        font: getComputedStyle(document.body).fontFamily || null,
        sizes: listSizes(findProductForm() || document),
      };
      iframe.contentWindow.postMessage(context, APP_ORIGIN);
    } else if (msg.type === "resize" && typeof msg.height === "number") {
      iframe.style.height = clamp(msg.height, 120, 2000) + "px";
    } else if (msg.type === "close") {
      close();
    } else if (msg.type === "size-selected" && typeof msg.size === "string") {
      selectSize(msg.size, findProductForm() || document);
      close();
    }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  backdrop.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKey);
}

// ---------- protocole postMessage ----------

function isMessage(data) {
  return typeof data === "object" && data !== null && data.source === MESSAGE_SOURCE;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---------- sélecteur et détection des tailles dans la page ----------

function findProductForm() {
  return document.querySelector('form[action*="/cart/add"], form.cart, [data-swiftstyle-form]');
}

function tokens(label) {
  return label.toUpperCase().split(/[\s/|,()\u2013\u2014-]+/).filter(Boolean);
}

function matchesSize(label, size) {
  return tokens(label).includes(size.trim().toUpperCase());
}

function labelOf(input) {
  const text = input.labels && input.labels[0] ? input.labels[0].textContent : "";
  return (input.value + " " + text).trim();
}

/**
 * Récupère les tailles disponibles sur la page (radios, selects, pastilles / boutons swatches).
 */
function listSizes(scope) {
  const labels = [];

  // 1. Radios
  scope.querySelectorAll('input[type="radio"]').forEach(function (el) {
    labels.push(labelOf(el));
  });

  // 2. Menus déroulants (select)
  scope.querySelectorAll("select").forEach(function (s) {
    for (let i = 0; i < s.options.length; i++) {
      const o = s.options[i];
      if (o.value !== "" && !o.disabled) labels.push(o.text);
    }
  });

  // 3. Pastilles et boutons de taille (swatches data-value ou boutons enfants)
  const sizeContainer = findSizeSelector(scope) || scope;
  sizeContainer.querySelectorAll('[data-value], [data-option-value], [role="radio"]').forEach(function (el) {
    const val = el.getAttribute("data-value") || el.getAttribute("data-option-value") || el.textContent;
    if (val) labels.push(val.trim());
  });

  const seen = {};
  return labels
    .flatMap(tokens)
    .filter(function (t) { if (seen[t]) return false; seen[t] = true; return true; })
    .slice(0, 200);
}

/**
 * Sélectionne automatiquement la taille recommandée sur le site (clic sur radio, sélection dropdown, ou clic pastille).
 */
function selectSize(size, scope) {
  // 1. Boutons radio
  const radios = scope.querySelectorAll('input[type="radio"]');
  for (let i = 0; i < radios.length; i++) {
    const r = radios[i];
    if (!r.disabled && matchesSize(labelOf(r), size)) {
      r.click();
      return true;
    }
  }

  // 2. Menus déroulants (select)
  const selects = scope.querySelectorAll("select");
  for (let j = 0; j < selects.length; j++) {
    const s = selects[j];
    for (let k = 0; k < s.options.length; k++) {
      const o = s.options[k];
      if (!o.disabled && o.value !== "" && (matchesSize(o.text, size) || matchesSize(o.value, size))) {
        s.value = o.value;
        s.dispatchEvent(new Event("input", { bubbles: true }));
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
  }

  // 3. Pastilles, boutons et swatches (data-value / data-option-value)
  const sizeContainer = findSizeSelector(scope) || scope;
  const swatches = sizeContainer.querySelectorAll('[data-value], [data-option-value], button, [role="radio"], label');
  for (let m = 0; m < swatches.length; m++) {
    const el = swatches[m];
    const val = el.getAttribute("data-value") || el.getAttribute("data-option-value") || (el.tagName !== "FORM" ? el.textContent : "");
    if (matchesSize(val || "", size)) {
      el.click();
      return true;
    }
  }

  return false;
}

// ---------- styles de la modale ----------

const MODAL_CSS
  = ":host{all:initial}"
  + ".backdrop{position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.45)}"
  + ".dialog{position:fixed;z-index:2147483646;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:#fff;border-radius:2px}"
  + "iframe{display:block;width:100%;height:440px;border:0}"
  + "@media (max-width:520px){.dialog{top:auto;bottom:0;transform:translateX(-50%);width:100vw;max-height:92vh;border-radius:2px 2px 0 0}}";

// ---------- extraction du productId ----------

function extractProductId(strategy = "auto") {
  if (strategy === "shopify") {
    return fromShopify() || fromJsonLd() || fromMeta() || fromUrl();
  }
  if (strategy === "woocommerce") {
    return fromWooCommerce() || fromJsonLd() || fromMeta() || fromUrl();
  }
  if (strategy === "json-ld") {
    return fromJsonLd() || fromMeta() || fromUrl();
  }
  return fromShopify() || fromWooCommerce() || fromJsonLd() || fromMeta() || fromUrl() || fromSwiftStyleRoot();
}

function firstString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

function fromShopify() {
  const id = window.ShopifyAnalytics?.meta?.product?.id ?? window.meta?.product?.id;
  return id === undefined || id === null ? null : String(id);
}

function fromWooCommerce() {
  const addToCart = document.querySelector('input[name="add-to-cart"], button[name="add-to-cart"]');
  const id = (addToCart && addToCart.value) || (document.querySelector(".variations_form, [data-product_id]") || {}).getAttribute?.("data-product_id");
  return firstString(id);
}

function flatten(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (typeof data !== "object") return [];
  if (data["@graph"]) return [data].concat(flatten(data["@graph"]));
  return [data];
}

function isProduct(node) {
  const t = node && node["@type"];
  return (Array.isArray(t) ? t : [t]).some(function (x) { return typeof x === "string" && x.toLowerCase() === "product"; });
}

function fromJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let data;
    try { data = JSON.parse(scripts[i].textContent || ""); } catch (e) { continue; }
    const products = flatten(data).filter(isProduct);
    for (let j = 0; j < products.length; j++) {
      const p = products[j];
      if (typeof p.sku === "number") return String(p.sku);
      const sku = firstString(p.sku);
      if (sku) return sku;
      const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
      if (offer && typeof offer.sku === "number") return String(offer.sku);
      const offerSku = firstString(offer && offer.sku);
      if (offerSku) return offerSku;
      if (typeof p.productID === "number") return String(p.productID);
      const mpn = firstString(p.mpn);
      if (mpn) return mpn;
    }
  }
  return null;
}

function fromMeta() {
  const selectors = ['meta[property="product:retailer_item_id"]', 'meta[itemprop="productID"]'];
  for (let i = 0; i < selectors.length; i++) {
    const value = firstString((document.querySelector(selectors[i]) || {}).getAttribute?.("content"));
    if (value) return value;
  }
  return null;
}

function fromUrl() {
  const sources = [
    location.pathname,
    (document.querySelector('link[rel="canonical"]') || {}).getAttribute?.("href") || "",
    (document.querySelector('meta[property="og:url"]') || {}).getAttribute?.("content") || "",
  ];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!src) continue;
    // Ex: /products/E486176-000/00 -> E486176-000
    const m = src.match(/\/products?\/([A-Za-z0-9_-]+)/i);
    if (m && m[1]) return m[1];
    const m2 = src.match(/\/p\/([A-Za-z0-9_-]+)/i);
    if (m2 && m2[1]) return m2[1];
  }
  return null;
}

function fromSwiftStyleRoot() {
  const root = document.querySelector("#swiftstyle-root[data-product-id], [data-swiftstyle-root][data-product-id]");
  return root ? root.getAttribute("data-product-id") : null;
}
