"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  MEDIAPIPE_VERSION,
  PHOTO_ZONES,
  MeasureError,
  adjustMeasurement,
  initialLines,
  createMeasurer,
  type EditedLines,
  type InseamLine,
  type MeasuredLine,
  type PhotoLines,
  type PhotoMeasurement,
  type PhotoZone,
} from "@/lib/photo-measure";
import { DEMO_ARTICLES, recommendSize, type DemoArticle, type FitPreference, type MeasureKey } from "@/lib/recommendation";

const ARTICLES: { id: DemoArticle; image: string }[] = [
  { id: "tee", image: "/demo/tee-blanc.webp" },
  { id: "jean", image: "/demo/jean-bleu.webp" },
];

const ZONE_LABELS: Record<PhotoZone, string> = { chest: "Poitrine", waist: "Taille", hips: "Hanches", thigh: "Cuisse" };

const MEASURE_LABELS: Record<MeasureKey, string> = { ...ZONE_LABELS, inseam: "Entrejambe" };

function chartKeys(weights: Partial<Record<MeasureKey, number>>): string {
  const names = (Object.keys(weights) as MeasureKey[]).filter((k) => weights[k]).map((k) => MEASURE_LABELS[k].toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? "");
}

const FITS: [FitPreference, string][] = [
  ["ajustee", "Ajusté"],
  ["normale", "Normal"],
  ["ample", "Ample"],
];

type Health = "checking" | "api" | "browser" | "down";

function usePreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function RulerIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M2 7h16v6H2zM6 7v3M10 7v3M14 7v3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PhotoInput(props: { label: string; hint: string; file: File | null; onChange: (f: File | null) => void }) {
  const preview = usePreview(props.file);
  return (
    <label className={preview ? "pt-drop has-file" : "pt-drop"}>
      <input type="file" accept="image/*" onChange={(e) => props.onChange(e.target.files?.[0] ?? null)} />
      {preview ? <img src={preview} alt="" /> : <span className="pt-drop-plus" aria-hidden="true">+</span>}
      <span className="pt-drop-text">
        <strong>{props.label}</strong>
        <small>{props.file ? props.file.name : props.hint}</small>
      </span>
    </label>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const MIN_SPAN = 0.01;

type End = "x1" | "x2";

function moveEnd(line: MeasuredLine, end: End, x: number, y: number): MeasuredLine {
  const yy = clamp(y, 0, 1);
  return end === "x1"
    ? { ...line, y: yy, x1: clamp(x, 0, line.x2 - MIN_SPAN) }
    : { ...line, y: yy, x2: clamp(x, line.x1 + MIN_SPAN, 1) };
}

type InseamEnd = "y1" | "y2";

function moveInseamEnd(line: InseamLine, end: InseamEnd, x: number, y: number): InseamLine {
  const xx = clamp(x, 0, 1);
  return end === "y1"
    ? { ...line, x: xx, y1: clamp(y, 0, line.y2 - MIN_SPAN) }
    : { ...line, x: xx, y2: clamp(y, line.y1 + MIN_SPAN, 1) };
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function arrowStep(e: KeyboardEvent<HTMLButtonElement>): [number, number] | null {
  const d = ARROWS[e.key];
  if (!d) return null;
  e.preventDefault();
  const step = e.shiftKey ? 0.02 : 0.004;
  return [d[0] * step, d[1] * step];
}

function EditablePhoto(props: {
  file: File;
  caption: string;
  lines: PhotoLines;
  original: PhotoLines;
  onChange: (zone: PhotoZone, update: (line: MeasuredLine) => MeasuredLine) => void;
  inseam?: { line: InseamLine; original: InseamLine; onChange: (update: (line: InseamLine) => InseamLine) => void };
}) {
  const { file, caption, lines, original, onChange, inseam } = props;
  const src = usePreview(file);
  const frameRef = useRef<HTMLDivElement>(null);
  if (!src) return null;

  const pointer = (e: PointerEvent<HTMLButtonElement>): [number, number] | null => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !frameRef.current) return null;
    const r = frameRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const drag = (zone: PhotoZone, end: End) => (e: PointerEvent<HTMLButtonElement>) => {
    const p = pointer(e);
    if (p) onChange(zone, (l) => moveEnd(l, end, p[0], p[1]));
  };

  const nudge = (zone: PhotoZone, end: End) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = arrowStep(e);
    if (d) onChange(zone, (l) => moveEnd(l, end, l[end] + d[0], l.y + d[1]));
  };

  const capture = (e: PointerEvent<HTMLButtonElement>) => e.currentTarget.setPointerCapture(e.pointerId);
  const photo = caption.toLowerCase();

  return (
    <figure className="pt-shot">
      <div className="pt-shot-frame" ref={frameRef}>
        <img src={src} alt={caption} draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {PHOTO_ZONES.map((zone) => {
            const o = original[zone];
            const l = lines[zone];
            const moved = o.x1 !== l.x1 || o.x2 !== l.x2 || o.y !== l.y;
            return (
              <g key={zone} className={`pt-z-${zone}`}>
                {moved && <line className="is-original" x1={o.x1 * 100} x2={o.x2 * 100} y1={o.y * 100} y2={o.y * 100} />}
                <line x1={l.x1 * 100} x2={l.x2 * 100} y1={l.y * 100} y2={l.y * 100} />
              </g>
            );
          })}
          {inseam && (
            <g className="pt-z-inseam">
              {(inseam.original.x !== inseam.line.x || inseam.original.y1 !== inseam.line.y1 || inseam.original.y2 !== inseam.line.y2) && (
                <line
                  className="is-original"
                  x1={inseam.original.x * 100}
                  x2={inseam.original.x * 100}
                  y1={inseam.original.y1 * 100}
                  y2={inseam.original.y2 * 100}
                />
              )}
              <line x1={inseam.line.x * 100} x2={inseam.line.x * 100} y1={inseam.line.y1 * 100} y2={inseam.line.y2 * 100} />
            </g>
          )}
        </svg>
        {PHOTO_ZONES.flatMap((zone) =>
          (["x1", "x2"] as const).map((end) => (
            <button
              key={`${zone}-${end}`}
              type="button"
              className={`pt-handle pt-z-${zone}`}
              style={{ left: `${lines[zone][end] * 100}%`, top: `${lines[zone].y * 100}%` }}
              aria-label={`${ZONE_LABELS[zone]}, bord ${end === "x1" ? "gauche" : "droit"}, photo ${photo}`}
              onPointerDown={capture}
              onPointerMove={drag(zone, end)}
              onKeyDown={nudge(zone, end)}
            />
          )),
        )}
        {inseam &&
          (["y1", "y2"] as const).map((end) => (
            <button
              key={`inseam-${end}`}
              type="button"
              className="pt-handle pt-z-inseam"
              style={{ left: `${inseam.line.x * 100}%`, top: `${inseam.line[end] * 100}%` }}
              aria-label={`Entrejambe, ${end === "y1" ? "haut (entrejambe)" : "bas (sol)"}, photo ${photo}`}
              onPointerDown={capture}
              onPointerMove={(e) => {
                const p = pointer(e);
                if (p) inseam.onChange((l) => moveInseamEnd(l, end, p[0], p[1]));
              }}
              onKeyDown={(e) => {
                const d = arrowStep(e);
                if (d) inseam.onChange((l) => moveInseamEnd(l, end, l.x + d[0], l[end] + d[1]));
              }}
            />
          ))}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function PhotoTest() {
  const [article, setArticle] = useState<DemoArticle>("tee");
  const [pageSize, setPageSize] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [side, setSide] = useState<File | null>(null);
  const [heightCm, setHeightCm] = useState(170);
  const [fit, setFit] = useState<FitPreference>("normale");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: PhotoMeasurement; front: File; side: File | null } | null>(null);
  const [lines, setLines] = useState<EditedLines | null>(null);
  const [health, setHealth] = useState<Health>("checking");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const measurer = useMemo(() => createMeasurer({ onFallback: () => setHealth("browser") }), []);

  const { name, chart } = DEMO_ARTICLES[article];
  const adjusted = useMemo(() => (result && lines ? adjustMeasurement(result.data, lines) : null), [result, lines]);
  const reco = useMemo(() => (adjusted ? recommendSize(chart, adjusted.measurements, fit) : null), [adjusted, chart, fit]);

  const editLine = (view: "front" | "side") => (zone: PhotoZone, update: (line: MeasuredLine) => MeasuredLine) =>
    setLines((prev) => {
      const current = prev?.[view];
      return prev && current ? { ...prev, [view]: { ...current, [zone]: update(current[zone]) } } : prev;
    });
  const editInseam = (update: (line: InseamLine) => InseamLine) =>
    setLines((prev) => (prev ? { ...prev, inseam: update(prev.inseam) } : prev));

  useEffect(() => {
    measurer
      .mode()
      .then(async (mode) => {
        await measurer.preload();
        setHealth(mode);
      })
      .catch(() => setHealth("down"));
  }, [measurer]);

  const open = () => {
    setError(null);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const analyse = async () => {
    if (!front) return;
    setLoading(true);
    setError(null);
    try {
      const data = await measurer.measure({ front, side, heightCm });
      setResult({ data, front, side });
      setLines(initialLines(data));
    } catch (e) {
      if (!(e instanceof MeasureError)) console.error(e);
      setError(e instanceof MeasureError ? e.message : "Erreur inattendue pendant l'analyse.");
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setResult(null);
    setLines(null);
    setError(null);
  };

  const choose = (size: string) => {
    setPageSize(size);
    close();
  };

  return (
    <div className="pt">
      <p className={`pt-status is-${health}`} role="status">
        Page de test · mesure :{" "}
        {health === "checking" && "recherche de l'API photo…"}
        {health === "api" && "par l'API photo (PHOTO_API_URL), rien de lourd dans le navigateur"}
        {health === "browser" && `dans le navigateur, MediaPipe ${MEDIAPIPE_VERSION} : pas d'API photo, ou elle ne répond pas ; les photos ne quittent pas l'appareil`}
        {health === "down" && "indisponible (pas d'API photo, et MediaPipe ne se charge pas : npm run prepare:mediapipe, ou navigateur trop ancien)"}
      </p>

      <main className="pt-product">
        <div className="pt-product-img">
          <img src={ARTICLES.find((a) => a.id === article)!.image} alt={name} />
        </div>

        <div className="pt-product-info">
          <p className="pt-brand">Boutique de test</p>
          <h1>{name}</h1>

          <label className="pt-field">
            <span>Article testé (guide des tailles de la démo)</span>
            <select
              value={article}
              onChange={(e) => {
                setArticle(e.target.value as DemoArticle);
                setPageSize("");
              }}
            >
              {ARTICLES.map((a) => (
                <option key={a.id} value={a.id}>
                  {DEMO_ARTICLES[a.id].name}
                </option>
              ))}
            </select>
          </label>

          <label className="pt-field">
            <span>Taille</span>
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
              <option value="">Choisir</option>
              {chart.sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="pt-trigger" aria-haspopup="dialog" onClick={open}>
            <RulerIcon />
            Trouver ma taille
          </button>
          <p className="pt-powered">avec SwiftStyle</p>
        </div>
      </main>

      <dialog ref={dialogRef} className="pt-modal" aria-labelledby="pt-modal-title">
        <div className="pt-modal-top">
          <span className="pt-modal-brand">SwiftStyle</span>
          <button type="button" className="pt-close" onClick={close} aria-label="Fermer">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <h2 id="pt-modal-title">{result ? "Votre taille" : "Trouver ma taille"}</h2>

        {!result ? (
          <form
            className="pt-form"
            onSubmit={(e) => {
              e.preventDefault();
              analyse();
            }}
          >
            <p className="pt-lead">
              Photos de la tête aux pieds, bras un peu écartés du corps, pieds écartés de la largeur des hanches,
              vêtements près du corps, sur un fond uni. Appareil à hauteur des hanches, à 2 ou 3 m.
            </p>
            <div className="pt-drops">
              <PhotoInput label="Photo de face" hint="Obligatoire" file={front} onChange={setFront} />
              <PhotoInput label="Photo de profil" hint="Conseillée" file={side} onChange={setSide} />
            </div>

            <label className="pt-range">
              <span>Votre taille</span>
              <output>{heightCm} cm</output>
              <input type="range" min={145} max={205} value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
            </label>

            <fieldset className="pt-fit">
              <legend>Vous aimez porter vos vêtements</legend>
              <div className="pt-seg">
                {FITS.map(([value, label]) => (
                  <label key={value} className={fit === value ? "on" : undefined}>
                    <input type="radio" name="fit" value={value} checked={fit === value} onChange={() => setFit(value)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {error && (
              <p className="pt-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="pt-cta" disabled={!front || loading}>
              {loading ? "Analyse de la photo…" : "Analyser la photo"}
            </button>
          </form>
        ) : (
          reco &&
          adjusted &&
          lines && (
            <div className="pt-result">
              <div className="pt-res">
                <span className="pt-size">{reco.size}</span>
                <p>
                  <strong>Taille conseillée pour ce {name.toLowerCase()}</strong>
                  <span>{reco.reason}</span>
                </p>
              </div>

              <table className="pt-table">
                <thead>
                  <tr>
                    <th scope="col">Mesure</th>
                    <th scope="col">Valeur</th>
                    <th scope="col">Largeur × profondeur</th>
                  </tr>
                </thead>
                <tbody>
                  {PHOTO_ZONES.map((zone) => {
                    const z = adjusted.zones[zone];
                    return (
                      <tr key={zone}>
                        <th scope="row">
                          <i className={`pt-dot pt-z-${zone}`} aria-hidden="true" />
                          {ZONE_LABELS[zone]}
                        </th>
                        <td>
                          {z.circumference} cm
                          {z.edited && (
                            <span className="pt-edited" title={`Mesure d'origine : ${result.data.zones[zone].circumference} cm`}>
                              corrigé
                            </span>
                          )}
                        </td>
                        <td>
                          {z.width} × {z.depth} cm
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row">
                      <i className="pt-dot pt-z-inseam" aria-hidden="true" />
                      Entrejambe
                    </th>
                    <td>
                      {adjusted.inseam.length} cm
                      {adjusted.inseam.edited && (
                        <span className="pt-edited" title={`Mesure d'origine : ${result.data.measurements.inseam} cm`}>
                          corrigé
                        </span>
                      )}
                    </td>
                    <td>de l&apos;entrejambe au sol</td>
                  </tr>
                </tbody>
              </table>
              <p className="pt-note">
                Profondeur {result.data.depthSource === "profile" ? "lue sur la photo de profil" : "estimée (pas de photo de profil)"}.
                Mesures non calibrées sur de vraies mesures. La taille conseillée utilise le guide des tailles de la démo
                pour ce {name.toLowerCase()} : {chartKeys(chart.weights)}.
              </p>

              {result.data.warnings.length > 0 && (
                <ul className="pt-warnings">
                  {result.data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <p className="pt-adjust-hint">
                Une ligne ne colle pas au corps (vêtement ample, bras) ? Faites glisser les points au bout des lignes
                jusqu&apos;aux bords du corps, sans le vêtement. La ligne verticale est l&apos;entrejambe : en haut
                l&apos;entrejambe, en bas le sol. Les mesures et la taille se recalculent. Au clavier : Tab puis les
                flèches (Maj pour aller plus vite).
              </p>
              <div className="pt-shots">
                <EditablePhoto
                  file={result.front}
                  caption="Face"
                  lines={lines.front}
                  original={result.data.front.lines}
                  onChange={editLine("front")}
                  inseam={
                    result.data.front.inseam
                      ? { line: lines.inseam, original: result.data.front.inseam, onChange: editInseam }
                      : undefined
                  }
                />
                {result.side && result.data.side && lines.side && (
                  <EditablePhoto
                    file={result.side}
                    caption="Profil"
                    lines={lines.side}
                    original={result.data.side.lines}
                    onChange={editLine("side")}
                  />
                )}
              </div>
              {adjusted.edited && (
                <button type="button" className="pt-secondary pt-reset" onClick={() => setLines(initialLines(result.data))}>
                  Revenir aux mesures d&apos;origine
                </button>
              )}

              <details className="pt-raw">
                <summary>Résultat brut de la mesure (avant vos corrections)</summary>
                <pre>{JSON.stringify(result.data, null, 2)}</pre>
              </details>

              <button type="button" className="pt-cta" onClick={() => choose(reco.size)}>
                Choisir la taille {reco.size}
              </button>
              <button type="button" className="pt-secondary" onClick={restart}>
                Refaire une mesure
              </button>
            </div>
          )
        )}
      </dialog>
    </div>
  );
}
