"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DEMO_ARTICLES, type DemoArticle } from "@/lib/recommendation";

type View = "face" | "detail";

interface Product {
  name: string;
  rayon: string;
  slug: string;
  price: string;
  desc: string;
  care: string;
  detail: { x: number; y: number; zoom: number };
  colors: { name: string; src: string; swatch: string }[];
}

const PRODUCTS: Record<DemoArticle, Product> = {
  tee: {
    name: "T-shirt SwiftStyle",
    rayon: "T-shirts",
    slug: "t-shirt-swiftstyle",
    price: "39,00 €",
    desc: "Jersey de coton épais, col rond côtelé, coupe droite. Logo SwiftStyle sérigraphié.",
    care: "100 % coton biologique. Lavage en machine à 30 °C.",
    detail: { x: 50, y: 50, zoom: 2.2 },
    colors: [
      { name: "Blanc", src: "/demo/tee-blanc.webp", swatch: "#F4F3EE" },
      { name: "Citron", src: "/demo/tee-citron.webp", swatch: "#E3EB66" },
      { name: "Corail", src: "/demo/tee-corail.webp", swatch: "#F2694B" },
      { name: "Encre", src: "/demo/tee-encre.webp", swatch: "#2B2E35" },
    ],
  },
  jean: {
    name: "Jean droit",
    rayon: "Jeans",
    slug: "jean-droit",
    price: "89,00 €",
    desc: "Denim stretch délavé, taille mi-haute, jambe droite.",
    care: "98 % coton, 2 % élasthanne. Lavage à 30 °C, sur l'envers.",
    detail: { x: 40, y: 12, zoom: 2.6 },
    colors: [{ name: "Bleu délavé", src: "/demo/jean-bleu.webp", swatch: "#7FA3CF" }],
  },
  sweat: {
    name: "Sweat à capuche SwiftStyle",
    rayon: "Sweats",
    slug: "sweat-a-capuche-swiftstyle",
    price: "69,00 €",
    desc: "Molleton gratté, capuche doublée, poche kangourou. Logo SwiftStyle brodé.",
    care: "80 % coton, 20 % polyester. Lavage en machine à 30 °C, sur l'envers.",
    detail: { x: 50, y: 48, zoom: 2.2 },
    colors: [
      { name: "Blanc", src: "/demo/sweat-blanc.webp", swatch: "#F4F3EE" },
      { name: "Sauge", src: "/demo/sweat-sauge.webp", swatch: "#A4B795" },
      { name: "Rouille", src: "/demo/sweat-rouille.webp", swatch: "#B5613E" },
      { name: "Encre", src: "/demo/sweat-encre.webp", swatch: "#2B2E35" },
    ],
  },
};
const ARTICLES = Object.keys(PRODUCTS) as DemoArticle[];

const zoomOn = (d: Product["detail"]): CSSProperties => ({ transform: `scale(${d.zoom})`, transformOrigin: `${d.x}% ${d.y}%` });

const HESITATION = "Vous hésitez entre deux tailles ? SwiftStyle vous conseille.";

export function WidgetDemo() {
  const [article, setArticle] = useState<DemoArticle>("tee");
  const [color, setColor] = useState(0);
  const [view, setView] = useState<View>("face");
  const [size, setSize] = useState<string | null>(null);
  const [reco, setReco] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [changes, setChanges] = useState(0);
  const [cart, setCart] = useState(0);
  const [added, setAdded] = useState(false);

  const shopRef = useRef<HTMLDivElement>(null);
  const closeModal = useRef<(() => void) | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(addedTimer.current);
      closeModal.current?.();
    },
    [],
  );

  useEffect(() => {
    for (const c of PRODUCTS[article].colors) new Image().src = c.src;
  }, [article]);

  const product = PRODUCTS[article];
  const name = product.name;
  const sizes = DEMO_ARTICLES[article].chart.sizes;

  const pickArticle = (a: DemoArticle) => {
    setArticle(a);
    setColor(0);
    setView("face");
    setSize(null);
    setReco(null);
    setHint("");
    setChanges(0);
    setAdded(false);
  };

  const pickSize = (s: string) => {
    setSize(s);
    setAdded(false);
    const n = changes + 1;
    setChanges(n);
    if (n >= 2) setHint(HESITATION);
  };

  const chooseSize = (s: string) => {
    setSize(s);
    setReco(s);
    setAdded(false);
    setHint(`Taille ${s} sélectionnée.`);
  };

  const openWidget = async () => {
    setChanges(0);
    setHint("");
    const { openSizeModal } = await import("@/components/size-modal/size-modal");
    closeModal.current = openSizeModal({
      garment: {
        id: DEMO_ARTICLES[article].externalId,
        shop: "ourlet.example",
        title: name,
        category: `Accueil > ${product.rayon}`,
        url: `https://ourlet.example/produits/${product.slug}`,
        sizes,
      },
      font: shopRef.current ? getComputedStyle(shopRef.current).fontFamily : null,
      onSelect: (s) => {
        if (!sizes.includes(s)) return false;
        chooseSize(s);
        return true;
      },
    });
  };

  const addToCart = () => {
    setCart((c) => c + 1);
    setAdded(true);
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(false), 2200);
  };

  const photo = product.colors[color]!.src;
  const colorName = product.colors[color]!.name;

  return (
    <section className="demo crumple" id="demo" aria-labelledby="demo-title">
      <div className="demo-head">
        <h2 className="display" id="demo-title">
          Essayez le widget.
        </h2>
        <p>
          Voici une fiche produit telle que vos clients la voient. Le widget est un bouton placé sous le choix des tailles : il ouvre une
          fenêtre qui conseille la bonne taille à partir d&apos;une photo, puis la sélectionne sur la fiche.
        </p>
      </div>

      <div className="monitor">
        <div className="monitor-screen">
          <div className="browser">
            <div className="browser-bar" aria-hidden="true">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              <span className="url">
                <svg viewBox="0 0 16 16">
                  <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span>ourlet.example/produits/{product.slug}</span>
              </span>
            </div>

            <div className="shop" ref={shopRef}>
              <div className="shop-page">
                <p className="shop-promo">Livraison offerte dès 80 € · Retours gratuits sous 30 jours</p>
                <header className="shop-head">
                  <nav className="shop-nav" aria-label="Rayons de la boutique">
                    {ARTICLES.map((a) => (
                      <button key={a} type="button" aria-current={article === a ? "page" : undefined} onClick={() => pickArticle(a)}>
                        {PRODUCTS[a].rayon}
                      </button>
                    ))}
                  </nav>
                  <svg className="shop-menu" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span className="shop-logo">Ourlet</span>
                  <span className="shop-icons">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M12.5 12.5 17 17" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="7" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M3.5 17.5c1-3.5 3.6-5 6.5-5s5.5 1.5 6.5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span className="shop-bag">
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M4 6.5h12l-1 11H5zM7 6.5V5a3 3 0 0 1 6 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      {cart > 0 && <b aria-hidden="true">{cart}</b>}
                      <span className="sr">
                        Panier : {cart} article{cart > 1 ? "s" : ""}
                      </span>
                    </span>
                  </span>
                </header>

                <div className="shop-main">
                  <div className="shop-gallery">
                    <div className="shop-photo">
                      <span className="shop-tag">Nouveauté</span>
                      <img src={photo} alt={`${name}, coloris ${colorName}`} style={view === "detail" ? zoomOn(product.detail) : undefined} />
                    </div>
                    <div className="shop-thumbs">
                      {(["face", "detail"] as View[]).map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={view === v}
                          aria-label={v === "face" ? "Vue d'ensemble" : "Vue de détail"}
                          onClick={() => setView(v)}
                        >
                          <img src={photo} alt="" style={v === "detail" ? zoomOn(product.detail) : undefined} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="shop-info">
                    <p className="shop-crumb">Accueil / {product.rayon}</p>
                    <h3 className="shop-title">{name}</h3>
                    <p className="shop-price">{product.price}</p>

                    <fieldset className="shop-opt">
                      <legend>
                        Couleur : <b>{colorName}</b>
                      </legend>
                      <div className="shop-swatches">
                        {product.colors.map((c, i) => (
                          <label key={c.name}>
                            <input className="sr" type="radio" name="demo-color" checked={color === i} onChange={() => setColor(i)} />
                            <span style={{ "--c": c.swatch } as CSSProperties} title={c.name}>
                              <span className="sr">{c.name}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset className="shop-opt">
                      <legend>Taille</legend>
                      <div className="shop-sizes">
                        {sizes.map((s) => (
                          <label key={s} className={reco === s ? "is-reco" : undefined}>
                            <input className="sr" type="radio" name="demo-size" value={s} checked={size === s} onChange={() => pickSize(s)} />
                            <span>
                              {s}
                              {reco === s && <span className="sr"> (conseillée par SwiftStyle)</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <button
                      className={changes >= 2 ? "ss-trigger is-nudge" : "ss-trigger"}
                      type="button"
                      aria-haspopup="dialog"
                      onClick={openWidget}
                    >
                      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                        <path d="M2 7h16v6H2zM6 7v3M10 7v3M14 7v3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      Trouver ma taille
                    </button>
                    <p className="ss-hint" aria-live="polite">
                      {hint}
                    </p>

                    <button className="shop-buy" type="button" disabled={!size} onClick={addToCart}>
                      {!size ? "Choisissez une taille" : added ? `Ajouté au panier, taille ${size}` : `Ajouter au panier · ${product.price}`}
                    </button>

                    <details>
                      <summary>Description</summary>
                      <p>{product.desc}</p>
                    </details>
                    <details>
                      <summary>Composition et entretien</summary>
                      <p>{product.care}</p>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="monitor-stand" aria-hidden="true">
          <i />
          <b />
        </div>
      </div>
    </section>
  );
}
