"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { WIDGET_DEFAULT_ORIGIN, WIDGET_DEMO_PRODUCT_ID, widgetSnippets } from "@/lib/widget-embed";

// Coloration minimale : valeurs entre guillemets en vert, l'identifiant d'exemple en jaune.
const STRINGS = /("[^"]*")/g;

function highlight(code: string): ReactNode[] {
  return code.split(STRINGS).map((part, i) =>
    i % 2 === 0 ? (
      part
    ) : (
      <span key={i} className={part === `"${WIDGET_DEMO_PRODUCT_ID}"` ? "tok-id" : "tok-str"}>
        {part}
      </span>
    ),
  );
}

export function EmbedCode() {
  const hydrated = useHydrated();
  const snippets = widgetSnippets(hydrated ? window.location.origin : WIDGET_DEFAULT_ORIGIN);
  const [tab, setTab] = useState(snippets[0]!.id);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const codeRef = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const current = snippets.find((s) => s.id === tab) ?? snippets[0]!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied("ok");
    } catch {
      // Presse-papiers refusé (navigateur ou cadre restreint) : le code est sélectionné, Ctrl+C suffit.
      if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
      setCopied("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2200);
  };

  return (
    <section className="install" id="installation" aria-labelledby="install-title">
      <div className="install-head">
        <h2 className="display" id="install-title">
          Installez-le en deux lignes.
        </h2>
        <p>
          Collez ce code dans la fiche produit, sous le choix des tailles. Le bouton prend la police de votre boutique. Si SwiftStyle ne
          répond pas, il ne s&apos;affiche pas : la fiche reste telle quelle.
        </p>
      </div>

      <div className="code-card">
        <div className="code-bar">
          <div className="code-tabs" role="tablist" aria-label="Plateforme de la boutique">
            {snippets.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`code-tab-${s.id}`}
                aria-selected={tab === s.id}
                aria-controls="code-panel"
                onClick={() => {
                  if (copied === "failed") window.getSelection()?.removeAllRanges();
                  setTab(s.id);
                  setCopied(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className={copied === "ok" ? "code-copy is-done" : "code-copy"} onClick={copy}>
            {copied === "ok" ? "Copié !" : copied === "failed" ? "Code sélectionné : Ctrl+C" : "Copier le code"}
          </button>
        </div>
        <div id="code-panel" role="tabpanel" aria-labelledby={`code-tab-${current.id}`}>
          <pre>
            <code ref={codeRef}>{highlight(current.code)}</code>
          </pre>
          {current.note && <p className="code-note">{current.note}</p>}
        </div>
        <span className="sr" aria-live="polite">
          {copied === "ok" ? "Code copié" : ""}
        </span>
      </div>
    </section>
  );
}
