const FALLBACK_SITES = [
  {
    id: "localhost-demo",
    name: "Boutique Démo Locale",
    enabled: true,
    matches: ["localhost:3000", "127.0.0.1:3000"],
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
    return;
  }

  let tries = 0;
  const maxTries = 15;

  function tryMount() {
    if (document.querySelector("#swiftstyle-root, [data-swiftstyle-root], [data-swiftstyle-modal]")) return;

    if (siteConfig.productPage && siteConfig.productPage.pathPattern) {
      try {
        const regex = new RegExp(siteConfig.productPage.pathPattern);
        if (!regex.test(location.pathname + location.search)) {
          return;
        }
      } catch (e) {
      }
    }

    const origin = location.origin;
    if (!origin || origin === "null") return;

    const strategy = (siteConfig.productId && siteConfig.productId.strategy) || "auto";
    const productId = extractProductId(strategy);
    const anchorInfo = findBestAnchor(siteConfig);

    if ((!productId || !anchorInfo || !anchorInfo.element) && tries < maxTries) {
      tries++;
      setTimeout(tryMount, 300);
      return;
    }

    if (!productId) return;

    renderButton(productId, siteConfig);
  }

  tryMount();

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
      p = p.split("/")[0].trim();

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

function findAddToCartButton(scope = document) {
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

function findSizeSelector(scope = document) {
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

function findBestAnchor(siteConfig) {
  const customAnchor = siteConfig && siteConfig.button && siteConfig.button.anchor;
  if (customAnchor) {
    const el = document.querySelector(customAnchor);
    if (el) {
      return { element: el, position: siteConfig.button.position || "afterend" };
    }
  }

  const sizeSelector = findSizeSelector();
  if (sizeSelector && sizeSelector.parentNode) {
    return { element: sizeSelector, position: "afterend" };
  }

  const addToCartBtn = findAddToCartButton();
  if (addToCartBtn && addToCartBtn.parentNode) {
    const wrapper = addToCartBtn.closest(".product-form__buttons, .product-actions, .add-to-cart-wrapper");
    return { element: wrapper || addToCartBtn, position: "afterend" };
  }

  const form = findProductForm();
  if (form && form.parentNode) {
    return { element: form, position: "afterend" };
  }

  return { element: document.querySelector("main") || document.body, position: "afterend" };
}

function renderButton(productId, siteConfig) {
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
  btn.addEventListener("click", () => openModal(productId));

  root.appendChild(btn);

  if (anchor && anchor.parentNode && position !== "inside") {
    anchor.insertAdjacentElement(position, root);
  } else if (anchor && position === "inside") {
    anchor.appendChild(root);
  } else {
    (document.body || document.documentElement).appendChild(root);
  }
}

function openModal(productId) {
  if (document.querySelector("[data-swiftstyle-modal]")) return;
  const garment = readGarment(productId);
  garment.sizes = listSizes(findProductForm() || document);
  globalThis.SwiftStyleModal.open({
    garment,
    font: getComputedStyle(document.body).fontFamily || null,
    onSelect: (size) => selectSize(size, findProductForm() || document),
  });
}

function readGarment(productId) {
  const product = jsonLdProducts()[0] || {};
  const metaTitle = (document.querySelector('meta[property="og:title"]') || {}).getAttribute?.("content");
  const h1 = document.querySelector("h1");
  const title = firstString(product.name) || firstString(metaTitle) || (h1 && h1.textContent.trim()) || document.title;
  const category = [categoryOf(product.category), breadcrumbText()].filter(Boolean).join(" > ");
  return {
    id: String(productId || "").trim().slice(0, 200),
    shop: location.hostname,
    title: String(title || "").trim().slice(0, 300),
    category: category.slice(0, 300),
    url: (location.origin + location.pathname).slice(0, 2000),
  };
}

function categoryOf(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.name === "string") return value.name;
  return "";
}

function breadcrumbText() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let data;
    try { data = JSON.parse(scripts[i].textContent || ""); } catch (e) { continue; }
    const lists = flatten(data).filter(function (n) { return n && n["@type"] === "BreadcrumbList"; });
    for (let j = 0; j < lists.length; j++) {
      const items = Array.isArray(lists[j].itemListElement) ? lists[j].itemListElement : [];
      const names = items.map(function (it) { return firstString(it && (it.name || (it.item && it.item.name))); }).filter(Boolean);
      if (names.length) return names.join(" > ");
    }
  }
  const nav = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb" i]');
  return nav ? nav.textContent.replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

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

function listSizes(scope) {
  const labels = [];

  scope.querySelectorAll('input[type="radio"]').forEach(function (el) {
    labels.push(labelOf(el));
  });

  scope.querySelectorAll("select").forEach(function (s) {
    for (let i = 0; i < s.options.length; i++) {
      const o = s.options[i];
      if (o.value !== "" && !o.disabled) labels.push(o.text);
    }
  });

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

function selectSize(size, scope) {
  const radios = scope.querySelectorAll('input[type="radio"]');
  for (let i = 0; i < radios.length; i++) {
    const r = radios[i];
    if (!r.disabled && matchesSize(labelOf(r), size)) {
      r.click();
      return true;
    }
  }

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

function jsonLdProducts() {
  const products = [];
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let data;
    try { data = JSON.parse(scripts[i].textContent || ""); } catch (e) { continue; }
    products.push(...flatten(data).filter(isProduct));
  }
  return products;
}

function fromJsonLd() {
  const products = jsonLdProducts();
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
