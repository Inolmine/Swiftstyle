// Script d'intégration du widget sur les sites des marques, servi par le site à /widget/v1.js
// (compilé par `npm run build:widget`). Les marques le copient depuis /docs : voir src/lib/widget-embed.ts.
//
// Pour chaque élément [data-swiftstyle] : un bouton avec un spinner pendant les tentatives de connexion, puis le
// bouton « Trouver ma taille » si la mesure est possible, ou rien du tout sinon. La mesure se fait par l'API photo
// si le site en donne une et qu'elle répond à ce site ; sinon dans le navigateur du client (MediaPipe).
import { openSizeModal } from "@/components/size-modal/size-modal";
import { WIDGET_SCRIPT_PATH } from "@/lib/widget-embed";
import { connect, type Connection } from "./connect";
import { productId, productScope, readGarment, selectSize } from "./page";

const SELECTOR = "[data-swiftstyle]";
const STATE = "data-swiftstyle-state";
const DEFAULT_LABEL = "Trouver ma taille";
const SVG_NS = "http://www.w3.org/2000/svg";

const CSS = `
:host { display: block; margin: 12px 0; }
:host([hidden]) { display: none !important; }
button {
  display: flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box;
  width: 100%; min-height: 44px; margin: 0; padding: 11px 16px;
  font: inherit; font-weight: 600; line-height: 1.2; letter-spacing: inherit; text-transform: inherit;
  color: var(--swiftstyle-accent, #111); background: transparent;
  border: 1px solid var(--swiftstyle-accent, #111); border-radius: var(--swiftstyle-radius, 4px);
  cursor: pointer; transition: background-color 0.15s, color 0.15s;
}
button:hover:not(:disabled) { background: var(--swiftstyle-accent, #111); color: var(--swiftstyle-on-accent, #fff); }
button:focus-visible { outline: 2px solid var(--swiftstyle-accent, #111); outline-offset: 2px; }
button:disabled { cursor: progress; opacity: 0.6; }
svg { flex: none; }
.spinner {
  flex: none; box-sizing: border-box; width: 16px; height: 16px;
  border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: ss-spin 0.8s linear infinite;
}
@keyframes ss-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
  .spinner { animation-duration: 2s; }
}
`;

declare global {
  interface Window {
    __swiftstyleWidget?: true;
  }
}

const warn = (text: string) => console.warn("SwiftStyle : " + text);

function emit(el: HTMLElement, name: string, detail: Record<string, unknown> = {}, cancelable = false) {
  return el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable }));
}

function rulerIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 7h16v6H2zM6 7v3M10 7v3M14 7v3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  return svg;
}

function start(site: string) {
  let connection: Promise<Connection | null> | undefined;

  // Une seule série de tentatives pour tous les boutons de la page.
  function connectOnce() {
    connection ??= (async () => {
      let last = "";
      const conn = await connect(site, {
        onFailure: (_, reason) => (last = reason),
        onApiUnavailable: (api) =>
          console.info(
            `SwiftStyle : l'API photo (${api}) ne répond pas à ce site, la mesure se fera dans le navigateur. ` +
              `Pour l'utiliser, ajouter ${location.origin} à sa variable ALLOWED_ORIGINS.`,
          ),
      });
      if (!conn) {
        // Un refus CORS ressemble, vu du script, à un fichier absent.
        const cors = last.startsWith("fichiers de MediaPipe injoignable")
          ? " Le site SwiftStyle doit les servir avec l'en-tête Access-Control-Allow-Origin (public/_headers)."
          : "";
        warn(`widget masqué, connexion impossible (${last}).${cors}`);
      }
      return conn;
    })();
    return connection;
  }

  function mount(el: HTMLElement) {
    if (el.hasAttribute(STATE)) return;
    el.setAttribute(STATE, "loading");
    if (!productId(el)) {
      el.setAttribute(STATE, "unavailable");
      el.hidden = true;
      warn('identifiant du produit introuvable : ajoutez data-product-id="…" à l\'élément data-swiftstyle.');
      return;
    }
    let root: ShadowRoot;
    try {
      root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    } catch {
      el.setAttribute(STATE, "unavailable");
      warn("l'élément data-swiftstyle doit être un <div> (pas un bouton, un lien ou un champ).");
      return;
    }

    const style = document.createElement("style");
    style.textContent = CSS;
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = el.dataset.label?.trim() || DEFAULT_LABEL;
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.setAttribute("part", "button");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-haspopup", "dialog");
    button.append(spinner, label);
    root.replaceChildren(style, button);

    void connectOnce().then((conn) => {
      if (!conn) {
        root.replaceChildren(style);
        el.hidden = true;
        el.setAttribute(STATE, "unavailable");
        emit(el, "swiftstyle:unavailable");
        return;
      }
      spinner.replaceWith(rulerIcon());
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.addEventListener("click", () => open(el, conn));
      el.setAttribute(STATE, "ready");
      emit(el, "swiftstyle:ready");
    });
  }

  function open(el: HTMLElement, conn: Connection) {
    const id = productId(el);
    if (!id) return;
    openSizeModal({
      garment: readGarment(el, id, productScope(el)),
      font: getComputedStyle(el).fontFamily || null,
      photoApiUrl: conn.photoApiUrl,
      visionUrl: conn.visionUrl,
      recommendUrl: conn.recommendUrl,
      // La page peut choisir la taille elle-même (event.preventDefault()) ; sinon le script la coche dans le formulaire.
      onSelect: (size) => !emit(el, "swiftstyle:size", { size }, true) || selectSize(size, productScope(el)),
    });
  }

  const scan = () => document.querySelectorAll<HTMLElement>(SELECTOR).forEach(mount);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      scan();
    }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan, { once: true });
  else scan();
}

function scriptSite(): string | null {
  const src =
    (document.currentScript as HTMLScriptElement | null)?.src ||
    document.querySelector<HTMLScriptElement>(`script[src*="${WIDGET_SCRIPT_PATH}"]`)?.src;
  try {
    return src ? new URL(src).origin : null;
  } catch {
    return null;
  }
}

if (!window.__swiftstyleWidget) {
  window.__swiftstyleWidget = true;
  const site = scriptSite();
  if (site) start(site);
  else warn(`adresse du script introuvable : chargez-le avec <script src="https://…${WIDGET_SCRIPT_PATH}" async>.`);
}
