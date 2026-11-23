// Lecture de la fiche produit de la marque : portage des fonctions de l'extension (content/index.js).
// Les attributs data-* de l'élément du widget passent avant tout ce qui est deviné sur la page.
import type { RecommendRequest } from "@/lib/recommend-request";

type Garment = RecommendRequest["garment"];

export const tokens = (label: string) =>
  label
    .toUpperCase()
    .split(/[\s/|,()–—-]+/)
    .filter(Boolean);

export const matchesSize = (label: string, size: string) => tokens(label).includes(size.trim().toUpperCase());

/** data-sizes="XS, S,M" → ["XS", "S", "M"] ; null si l'attribut est absent ou vide. */
export function parseSizes(attr: string | null | undefined): string[] | null {
  const sizes = (attr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return sizes.length ? [...new Set(sizes)].slice(0, 200) : null;
}

const firstString = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const idString = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : firstString(v));

type Json = Record<string, unknown>;

function flatten(data: unknown): Json[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (typeof data !== "object") return [];
  const node = data as Json;
  return node["@graph"] ? [node, ...flatten(node["@graph"])] : [node];
}

function jsonLd(doc: Document): Json[] {
  const nodes: Json[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      nodes.push(...flatten(JSON.parse(s.textContent || "")));
    } catch {
      // JSON-LD mal formé : ignoré.
    }
  });
  return nodes;
}

const isType = (node: Json, type: string) =>
  ([] as unknown[]).concat(node["@type"]).some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());

const products = (doc: Document) => jsonLd(doc).filter((n) => isType(n, "Product"));
const attr = (doc: Document, selector: string, name: string) => firstString(doc.querySelector(selector)?.getAttribute(name));

function fromShopify(): string | null {
  const w = window as unknown as { ShopifyAnalytics?: { meta?: { product?: { id?: unknown } } }; meta?: { product?: { id?: unknown } } };
  return idString(w.ShopifyAnalytics?.meta?.product?.id ?? w.meta?.product?.id);
}

function fromWooCommerce(doc: Document): string | null {
  const button = doc.querySelector<HTMLInputElement | HTMLButtonElement>('input[name="add-to-cart"], button[name="add-to-cart"]');
  return firstString(button?.value) ?? attr(doc, ".variations_form, [data-product_id]", "data-product_id");
}

function fromJsonLd(doc: Document): string | null {
  for (const p of products(doc)) {
    const offer = (Array.isArray(p.offers) ? p.offers[0] : p.offers) as Json | undefined;
    const id = idString(p.sku) ?? idString(offer?.sku) ?? idString(p.productID) ?? idString(p.mpn);
    if (id) return id;
  }
  return null;
}

function fromMeta(doc: Document): string | null {
  return attr(doc, 'meta[property="product:retailer_item_id"]', "content") ?? attr(doc, 'meta[itemprop="productID"]', "content");
}

function fromUrl(doc: Document): string | null {
  const sources = [location.pathname, attr(doc, 'link[rel="canonical"]', "href"), attr(doc, 'meta[property="og:url"]', "content")];
  for (const src of sources) {
    const m = src?.match(/\/products?\/([A-Za-z0-9_-]+)/i) ?? src?.match(/\/p\/([A-Za-z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Identifiant du vêtement : data-product-id, sinon ce que la page laisse voir (Shopify, WooCommerce, JSON-LD, meta, adresse). */
export function productId(el: HTMLElement, doc: Document = document): string | null {
  const id = firstString(el.dataset.productId) ?? fromShopify() ?? fromWooCommerce(doc) ?? fromJsonLd(doc) ?? fromMeta(doc) ?? fromUrl(doc);
  return id ? id.slice(0, 200) : null;
}

function breadcrumb(doc: Document): string {
  for (const list of jsonLd(doc).filter((n) => isType(n, "BreadcrumbList"))) {
    const items = Array.isArray(list.itemListElement) ? (list.itemListElement as Json[]) : [];
    const names = items.map((it) => firstString(it?.name) ?? firstString((it?.item as Json | undefined)?.name)).filter(Boolean);
    if (names.length) return names.join(" > ");
  }
  const nav = doc.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb" i]');
  return nav?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function categoryOf(value: unknown): string {
  if (typeof value === "string") return value;
  return firstString((value as Json | null)?.name) ?? "";
}

/** Le vêtement envoyé à /api/v1/recommend. */
export function readGarment(el: HTMLElement, id: string, scope: ParentNode, doc: Document = document): Garment {
  const product = products(doc)[0] ?? {};
  const title =
    firstString(el.dataset.productName) ??
    firstString(product.name) ??
    attr(doc, 'meta[property="og:title"]', "content") ??
    firstString(doc.querySelector("h1")?.textContent) ??
    doc.title;
  const category = firstString(el.dataset.productCategory) ?? [categoryOf(product.category), breadcrumb(doc)].filter(Boolean).join(" > ");
  return {
    id,
    shop: location.hostname,
    title: title.slice(0, 300),
    category: category.slice(0, 300),
    url: (location.origin + location.pathname).slice(0, 2000),
    sizes: parseSizes(el.dataset.sizes) ?? listSizes(scope),
  };
}

/** Le formulaire du produit, où se trouvent les tailles : celui qui contient le widget, sinon celui de la page. */
export function productScope(el: HTMLElement, doc: Document = document): ParentNode {
  return el.closest("form") ?? doc.querySelector('form[action*="/cart/add"], form.cart, [data-swiftstyle-form]') ?? doc;
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

const SIZE_LABEL = /\b(taille|size|pointure|choisir une taille|select size)\b/i;

function findSizeSelector(scope: ParentNode): Element | null {
  for (const sel of ['select[name*="size" i]', 'select[name*="taille" i]', 'select[id*="size" i]', 'select[id*="taille" i]']) {
    const el = scope.querySelector(sel);
    if (el && isVisible(el)) return el.closest(".product-form__input, .form-group, .selector-wrapper, .size-picker") ?? el;
  }
  for (const sel of [
    '[data-option*="size" i]',
    '[data-option-name*="taille" i]',
    '[data-attribute_name*="size" i]',
    ".product-form__input--pill",
    ".size-swatches",
    ".swatch-size",
    ".variant-radios",
    'fieldset[class*="size" i]',
    'fieldset[class*="taille" i]',
  ]) {
    const el = scope.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  for (const el of scope.querySelectorAll("label, legend, span, h3, h4, div")) {
    const text = (el.textContent || "").trim();
    if (text.length > 30 || !SIZE_LABEL.test(text)) continue;
    const parent = el.closest("fieldset, .product-form__input, .swatches, .variant-wrapper, .selector-wrapper");
    if (parent && isVisible(parent)) return parent;
    if (el.nextElementSibling && isVisible(el.nextElementSibling)) return el.nextElementSibling;
  }
  return null;
}

/** Taille épuisée : bouton désactivé, ou étiquette d'un bouton radio désactivé (cliquer dessus ne coche rien). */
const unavailable = (el: HTMLElement) =>
  el.matches(':disabled, [aria-disabled="true"]') || (el instanceof HTMLLabelElement && Boolean((el.control as HTMLInputElement | null)?.disabled));

const labelOf = (input: HTMLInputElement) => (input.value + " " + (input.labels?.[0]?.textContent ?? "")).trim();
const swatchValue = (el: Element) => el.getAttribute("data-value") ?? el.getAttribute("data-option-value") ?? el.textContent ?? "";

/** Tailles proposées sur la page : boutons radio, listes déroulantes et pastilles du choix des tailles. */
export function listSizes(scope: ParentNode): string[] {
  const labels: string[] = [];
  scope.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => labels.push(labelOf(r)));
  scope.querySelectorAll("select").forEach((s) => {
    for (const o of s.options) if (o.value !== "" && !o.disabled) labels.push(o.text);
  });
  (findSizeSelector(scope) ?? scope).querySelectorAll('[data-value], [data-option-value], [role="radio"]').forEach((el) => labels.push(swatchValue(el).trim()));
  return [...new Set(labels.flatMap(tokens))].slice(0, 200);
}

/** Coche la taille sur la page ; false si aucun contrôle ne la propose. */
export function selectSize(size: string, scope: ParentNode): boolean {
  for (const r of scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (!r.disabled && matchesSize(labelOf(r), size)) {
      r.click();
      return true;
    }
  }
  for (const s of scope.querySelectorAll("select")) {
    for (const o of s.options) {
      if (o.disabled || o.value === "" || !(matchesSize(o.text, size) || matchesSize(o.value, size))) continue;
      s.value = o.value;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  for (const el of (findSizeSelector(scope) ?? scope).querySelectorAll<HTMLElement>('[data-value], [data-option-value], button, [role="radio"], label')) {
    if (el.closest("[data-swiftstyle]") || unavailable(el)) continue;
    if (matchesSize(swatchValue(el), size)) {
      el.click();
      return true;
    }
  }
  return false;
}
