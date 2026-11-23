// Mesure du corps sur la silhouette et les repères de MediaPipe : portage de swiftstyle-api/app/measure.py, dans le navigateur.
// Mêmes réglages et mêmes résultats que l'API Python : les tests reprennent ses silhouettes dessinées et example.json.
// Un changement de méthode se fait dans les deux fichiers.
import { ellipsePerimeter } from "./adjust";
import { MeasureError, type PhotoMeasurement } from "./types";

export { ellipsePerimeter };

export type Zone = "chest" | "waist" | "hips" | "thigh";
type TorsoZone = Exclude<Zone, "thigh">;
type Mode = "at" | "min" | "max";

const TORSO: readonly TorsoZone[] = ["chest", "waist", "hips"];
export const ZONES: readonly Zone[] = [...TORSO, "thigh"];
const ZONE_NAMES: Record<Zone, string> = { chest: "poitrine", waist: "taille", hips: "hanches", thigh: "cuisse" };
const AT_ZONE: Record<Zone, string> = { chest: "à la poitrine", waist: "à la taille", hips: "aux hanches", thigh: "aux cuisses" };

const LEVELS: Record<TorsoZone, number> = { chest: 0.3, waist: 0.62, hips: 1.05 };
const SEARCH_BAND = 0.08;
export const FRONT_MODES: Record<TorsoZone, Mode> = { chest: "at", waist: "min", hips: "max" };
export const SIDE_MODES: Record<TorsoZone, Mode> = { chest: "at", waist: "at", hips: "max" };
const THIGH_DROP = 0.02;
const CROTCH_MAX = 0.8;
const CROTCH_LEVEL = 0.6;
export const DEPTH_RATIO: Record<Zone, number> = { chest: 0.75, waist: 0.72, hips: 0.7, thigh: 1.0 };
const PLAUSIBLE: Record<Zone, [number, number]> = { chest: [65, 150], waist: [50, 150], hips: [70, 160], thigh: [35, 90] };
const PLAUSIBLE_INSEAM: [number, number] = [0.4, 0.55];

export const MASK_THRESHOLD = 0.5;
export const MIN_VISIBILITY = 0.5;

export const L_SHOULDER = 11;
export const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
export const L_WRIST = 15;
export const R_WRIST = 16;
const L_INDEX = 19;
const R_INDEX = 20;
export const L_HIP = 23;
export const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
export const L_ANKLE = 27;
export const R_ANKLE = 28;
const ARMS = [
  [L_SHOULDER, L_ELBOW, L_WRIST, L_INDEX],
  [R_SHOULDER, R_ELBOW, R_WRIST, R_INDEX],
] as const;
const LEGS = [
  [L_HIP, L_KNEE],
  [R_HIP, R_KNEE],
] as const;

/** Repère de MediaPipe, en coordonnées 0 à 1 de l'image. */
export interface Landmark {
  x: number;
  y: number;
  visibility: number;
}

/** Ce que MediaPipe voit sur une image : la silhouette (masque de 0 à 1, ligne par ligne) et les 33 repères. */
export interface View {
  width: number;
  height: number;
  mask: ArrayLike<number>;
  landmarks: Landmark[];
}

interface Segment {
  y: number;
  x1: number;
  x2: number;
  armRemoved: boolean;
}
const segWidth = (s: Segment) => s.x2 - s.x1 + 1;

interface Inseam {
  x: number;
  y1: number;
  y2: number;
  estimated: boolean;
}

export interface ViewResult {
  height: number;
  width: number;
  cmPerPx: number;
  segments: Record<Zone, Segment>;
  inseam: Inseam | null;
  thighAt: number;
}

export interface Measurement {
  measurements: Record<Zone | "inseam", number>;
  widthsCm: Record<Zone, number>;
  depthsCm: Record<Zone, number>;
  depthSource: "profile" | "estimated";
  front: ViewResult;
  side: ViewResult | null;
  warnings: string[];
}

/** round() de Python : au plus proche, à égalité vers le pair (2,5 → 2), avec `digits` décimales. */
export function pyRound(x: number, digits = 0): number {
  const m = 10 ** digits;
  const y = x * m;
  const r = Math.abs(y - Math.trunc(y)) === 0.5 ? 2 * Math.round(y / 2) : Math.round(y);
  return digits ? r / m : r;
}

/** Silhouette en noir et blanc : `on[y * w + x]` vaut 1 dans le corps ; `rows[y]` vaut 1 si la ligne touche le corps. */
export interface Binary {
  w: number;
  h: number;
  on: Uint8Array;
  rows: Uint8Array;
}

export function binarize(view: View): Binary {
  const { width: w, height: h, mask } = view;
  if (mask.length !== w * h) throw new Error(`masque de ${mask.length} valeurs pour une image de ${w} × ${h}`);
  const on = new Uint8Array(w * h);
  const rows = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      if ((mask[o + x] ?? 0) > MASK_THRESHOLD) {
        on[o + x] = 1;
        rows[y] = 1;
      }
    }
  }
  return { w, h, on, rows };
}

/** Lignes du haut et du bas de la silhouette qui contient la ligne `inside` ; null si cette ligne est vide. */
export function bodySpan(b: Binary, inside: number): [number, number] | null {
  if (!b.rows[inside]) return null;
  let top = inside;
  while (top > 0 && b.rows[top - 1]) top--;
  let bottom = inside;
  while (bottom < b.h - 1 && b.rows[bottom + 1]) bottom++;
  return [top, bottom];
}

const visible = (lm: Landmark[], i: number) => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY;
const at = (lm: Landmark[], i: number): Landmark => lm[i] ?? { x: 0, y: 0, visibility: 0 };

function checkPose(view: View, bothSides: boolean, label: string) {
  const lm = view.landmarks;
  if (lm.length < 33) throw new MeasureError("no_person", `Aucune personne détectée sur la photo ${label}.`);
  for (const [a, b] of [
    [L_SHOULDER, R_SHOULDER],
    [L_HIP, R_HIP],
  ] as const) {
    const ok = bothSides ? visible(lm, a) && visible(lm, b) : visible(lm, a) || visible(lm, b);
    if (!ok) {
      throw new MeasureError(
        "pose_not_detected",
        `Épaules ou hanches mal visibles sur la photo ${label} : tenez-vous droit, face à l'objectif.`,
      );
    }
  }
  if (!(visible(lm, L_ANKLE) || visible(lm, R_ANKLE))) {
    throw new MeasureError(
      "body_not_fully_visible",
      `Les pieds ne sont pas visibles sur la photo ${label} : il faut le corps entier, de la tête aux pieds.`,
    );
  }
}

/** Bords de la zone du corps qui passe par la colonne `cx` de la ligne `y` (ou la plus proche, à `search` pixels près). */
function runAt(b: Binary, y: number, cx: number, search: number): [number, number] | null {
  const { w, on } = b;
  const row = y * w;
  cx = Math.min(Math.max(cx, 0), w - 1);
  if (!on[row + cx]) {
    let best = -1;
    let bestD = Infinity;
    for (let x = Math.max(0, cx - search); x <= Math.min(w - 1, cx + search); x++) {
      if (on[row + x] && Math.abs(x - cx) < bestD) {
        best = x;
        bestD = Math.abs(x - cx);
      }
    }
    if (best < 0) return null;
    cx = best;
  }
  let x1 = cx;
  while (x1 > 0 && on[row + x1 - 1]) x1--;
  let x2 = cx;
  while (x2 < w - 1 && on[row + x2 + 1]) x2++;
  return [x1, x2];
}

type Point = [number, number];

function armAxes(lm: Landmark[], w: number, h: number): Point[][] {
  return ARMS.map(([shoulder, elbow, wrist, index]) => {
    const axis: Point[] = [shoulder, elbow, wrist, index].filter((i) => visible(lm, i)).map((i) => [at(lm, i).x * w, at(lm, i).y * h]);
    if (visible(lm, wrist) && visible(lm, index)) {
      const [wx, wy] = axis[axis.length - 2]!;
      const [ix, iy] = axis[axis.length - 1]!;
      axis.push([2 * ix - wx, 2 * iy - wy]);
    }
    return axis;
  });
}

function axisX(axis: Point[], y: number): number | null {
  for (let i = 0; i + 1 < axis.length; i++) {
    const [xa, ya] = axis[i]!;
    const [xb, yb] = axis[i + 1]!;
    if (ya !== yb && Math.min(ya, yb) <= y && y <= Math.max(ya, yb)) return xa + ((xb - xa) * (y - ya)) / (yb - ya);
  }
  return null;
}

/** Retire un bras collé au corps : son axe (épaule, coude, poignet, main) coupe la ligne, on garde le symétrique du bord. */
function removeArms(x1: number, x2: number, y: number, cx: number, axes: Point[][]): [number, number, boolean] {
  let removed = false;
  for (const axis of axes) {
    const ax = axisX(axis, y);
    if (ax === null || !(x1 < ax && ax < x2)) continue;
    if (ax < cx) x1 = Math.max(x1, pyRound(2 * ax - x1));
    else x2 = Math.min(x2, pyRound(2 * ax - x2));
    removed = true;
  }
  return [x1, x2, removed];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function pick(found: Segment[], mode: Mode, level: number): Segment {
  if (mode === "at") {
    let best = found[0]!;
    for (const s of found) if (Math.abs(s.y - level) < Math.abs(best.y - level)) best = s;
    return best;
  }
  const widths = found.map(segWidth);
  const k = Math.min(5, found.length);
  const half = Math.floor(k / 2);
  const smooth = widths.map((_, i) => median(widths.slice(Math.max(0, i - half), i + half + 1)));
  let idx = 0;
  for (let i = 1; i < smooth.length; i++) {
    if (mode === "min" ? smooth[i]! < smooth[idx]! : smooth[i]! > smooth[idx]!) idx = i;
  }
  return found[idx]!;
}

type Legs = (y: number) => [number, number];

/** Haut de l'écart entre les jambes, en remontant du genou ; null si les jambes se touchent. */
function crotch(b: Binary, legs: Legs, hipY: number, kneeY: number, bodyPx: number): [number, number] | null {
  const gap = (y: number): number[] => {
    const [xa, xb] = legs(y);
    const holes: number[] = [];
    for (let x = Math.max(0, pyRound(xa)); x <= Math.min(b.w - 1, pyRound(xb)); x++) if (!b.on[y * b.w + x]) holes.push(x);
    return holes;
  };
  const yTop = Math.max(0, pyRound(hipY));
  let y = Math.min(b.h - 1, pyRound(kneeY));
  while (y >= yTop && gap(y).length === 0) y--;
  if (y < yTop) return null;
  const tolerance = Math.max(2, Math.trunc(0.005 * bodyPx));
  let found = y;
  let misses = 0;
  while (y > yTop && misses <= tolerance) {
    y--;
    if (gap(y).length) {
      found = y;
      misses = 0;
    } else misses++;
  }
  if (found > hipY + CROTCH_MAX * (kneeY - hipY)) return null;
  const holes = gap(found);
  return [pyRound(holes.reduce((s, x) => s + x, 0) / holes.length), found];
}

function thighFront(b: Binary, level: number, legs: Legs, splitX: number, search: number, axes: Point[][]): Segment | null {
  const found: Segment[] = [];
  const base = pyRound(level);
  for (let y = base - 2; y < base + 3; y++) {
    if (y < 0 || y >= b.h) continue;
    const [xa, xb] = legs(y);
    let best: Segment | null = null;
    for (const [xc, isLeft] of [
      [xa, true],
      [xb, false],
    ] as const) {
      const run = runAt(b, y, pyRound(xc), search);
      if (!run) continue;
      let [x1, x2] = run;
      if (x1 <= xa && x2 >= xb) {
        if (isLeft) x2 = Math.floor(splitX) - 1;
        else x1 = Math.floor(splitX);
      }
      const [r1, r2, removed] = removeArms(x1, x2, y, xc, axes);
      if (r2 >= r1 && (best === null || r2 - r1 + 1 > segWidth(best))) best = { y, x1: r1, x2: r2, armRemoved: removed };
    }
    if (best) found.push(best);
  }
  return found.length ? pick(found, "at", level) : null;
}

export function analyseView(
  view: View,
  heightCm: number,
  modes: Record<TorsoZone, Mode>,
  opts: { front: boolean; label: string; thighAt?: number | null },
): ViewResult {
  checkPose(view, opts.front, opts.label);
  const b = binarize(view);
  const { w, h } = b;
  const lm = view.landmarks;
  const label = opts.label;

  const point = (i: number): Point => [at(lm, i).x * w, at(lm, i).y * h];
  const meanPoint = (a: number, c: number): Point => {
    const vis = [a, c].filter((i) => visible(lm, i));
    const pts = (vis.length ? vis : [a, c]).map((i) => at(lm, i));
    return [(pts.reduce((s, p) => s + p.x, 0) / pts.length) * w, (pts.reduce((s, p) => s + p.y, 0) / pts.length) * h];
  };

  const [sx, sy] = meanPoint(L_SHOULDER, R_SHOULDER);
  const [hx, hy] = meanPoint(L_HIP, R_HIP);
  const [kx, ky] = meanPoint(L_KNEE, R_KNEE);
  const torso = hy - sy;

  const span = bodySpan(b, pyRound(Math.min(Math.max((sy + hy) / 2, 0), h - 1)));
  if (!span) throw new MeasureError("no_person", "La silhouette n'a pas été détourée correctement.");
  const [top, bottom] = span;
  const margin = Math.max(2, Math.floor(h / 200));
  if (top <= margin || bottom >= h - 1 - margin) {
    throw new MeasureError(
      "body_not_fully_visible",
      `La silhouette touche le bord de la photo ${label} : reculez pour être visible de la tête aux pieds.`,
    );
  }
  const bodyPx = bottom - top + 1;
  if (torso < 0.15 * bodyPx || ky <= hy) {
    throw new MeasureError("pose_not_detected", `Posture non reconnue sur la photo ${label} : tenez-vous debout, bien droit.`);
  }

  const cmPerPx = heightCm / bodyPx;
  const search = Math.max(3, Math.floor(w / 20));
  const axes = opts.front ? armAxes(lm, w, h) : [];
  const centerX = (y: number) => sx + ((hx - sx) * (y - sy)) / torso;

  const segments = {} as Record<Zone, Segment>;
  for (const zone of TORSO) {
    const level = sy + LEVELS[zone] * torso;
    const band = modes[zone] !== "at" ? SEARCH_BAND * torso : 2;
    const y0 = Math.max(top, pyRound(level - band));
    const y1 = Math.min(bottom, pyRound(level + band));
    const found: Segment[] = [];
    for (let y = y0; y <= y1; y++) {
      const cx = centerX(y);
      const run = runAt(b, y, pyRound(cx), search);
      if (run) {
        const [x1, x2, removed] = removeArms(run[0], run[1], y, cx, axes);
        found.push({ y, x1, x2, armRemoved: removed });
      }
    }
    if (!found.length) throw new MeasureError("measure_failed", `Impossible de mesurer le tour de ${ZONE_NAMES[zone]} sur la photo ${label}.`);
    segments[zone] = pick(found, modes[zone], level);
  }

  let inseam: Inseam | null = null;
  let thighY: number;
  let thigh: Segment | null = null;
  if (opts.front) {
    const legs: Legs = (y) => {
      const xs = LEGS.map(([hip, knee]) => {
        const [x0, y0] = point(hip);
        const [x1, y1] = point(knee);
        return y1 !== y0 ? x0 + ((x1 - x0) * (y - y0)) / (y1 - y0) : x0;
      });
      return [Math.min(...xs), Math.max(...xs)];
    };
    const foundCrotch = crotch(b, legs, hy, ky, bodyPx);
    let crotchX: number;
    let crotchY: number;
    if (foundCrotch) [crotchX, crotchY] = foundCrotch;
    else {
      crotchY = pyRound(hy + CROTCH_LEVEL * (ky - hy));
      const [la, lb] = legs(crotchY);
      crotchX = pyRound((la + lb) / 2);
    }
    inseam = { x: crotchX, y1: crotchY, y2: bottom + 1, estimated: foundCrotch === null };
    thighY = crotchY + THIGH_DROP * bodyPx;
    thigh = thighFront(b, thighY, legs, crotchX, search, axes);
  } else {
    thighY = opts.thighAt == null ? hy + CROTCH_LEVEL * (ky - hy) + THIGH_DROP * bodyPx : top + opts.thighAt * bodyPx;
    const yy = pyRound(thighY);
    if (yy >= 0 && yy < h) {
      const run = runAt(b, yy, pyRound(hx + ((kx - hx) * (yy - hy)) / (ky - hy)), search);
      thigh = run ? { y: yy, x1: run[0], x2: run[1], armRemoved: false } : null;
    }
  }
  if (!thigh) throw new MeasureError("measure_failed", `Impossible de mesurer le tour de cuisse sur la photo ${label}.`);
  segments.thigh = thigh;

  return { height: h, width: w, cmPerPx, segments, inseam, thighAt: (thighY - top) / bodyPx };
}

/** Tours (périmètre de l'ellipse largeur × profondeur) et entrejambe, en cm, d'après la photo de face et, si possible, de profil. */
export function measure(heightCm: number, front: View, side: View | null = null): Measurement {
  const f = analyseView(front, heightCm, FRONT_MODES, { front: true, label: "de face" });
  const s = side ? analyseView(side, heightCm, SIDE_MODES, { front: false, label: "de profil", thighAt: f.thighAt }) : null;
  const fInseam = f.inseam!;

  const warnings: string[] = [];
  const arms = ZONES.filter((z) => f.segments[z].armRemoved).map((z) => AT_ZONE[z]);
  if (arms.length) {
    warnings.push(
      `Bras collés au corps (${arms.join(", ")}) : leur largeur a été retirée par estimation. ` +
        "Écartez un peu les bras pour une mesure plus sûre.",
    );
  }
  if (!s) warnings.push("Sans photo de profil, la profondeur du corps est estimée : la mesure est moins fiable.");
  if (fInseam.estimated) {
    warnings.push(
      "Jambes serrées : l'entrejambe n'est pas visible, sa hauteur est estimée. " +
        "Écartez les pieds de la largeur des hanches pour le mesurer.",
    );
  }

  const widths = {} as Record<Zone, number>;
  const depths = {} as Record<Zone, number>;
  const measurements = {} as Record<Zone | "inseam", number>;
  for (const zone of ZONES) {
    const width = segWidth(f.segments[zone]) * f.cmPerPx;
    const depth = s ? segWidth(s.segments[zone]) * s.cmPerPx : width * DEPTH_RATIO[zone];
    widths[zone] = pyRound(width, 1);
    depths[zone] = pyRound(depth, 1);
    const circumference = ellipsePerimeter(width / 2, depth / 2);
    measurements[zone] = pyRound(circumference);
    const [low, high] = PLAUSIBLE[zone];
    if (!(low <= circumference && circumference <= high)) {
      warnings.push(`Tour de ${ZONE_NAMES[zone]} peu plausible (${pyRound(circumference)} cm) : vérifiez la photo.`);
    }
  }

  const inseamCm = (fInseam.y2 - fInseam.y1) * f.cmPerPx;
  measurements.inseam = pyRound(inseamCm);
  const [low, high] = PLAUSIBLE_INSEAM;
  if (inseamCm < low * heightCm) {
    warnings.push(
      `Entrejambe court pour ${pyRound(heightCm)} cm (${pyRound(inseamCm)} cm) : la photo a sans doute été prise de trop ` +
        "près ou de trop haut, ce qui raccourcit les jambes. Placez l'appareil à hauteur des hanches, à 2 ou 3 m.",
    );
  } else if (inseamCm > high * heightCm) {
    warnings.push(`Entrejambe peu plausible (${pyRound(inseamCm)} cm) : vérifiez la photo.`);
  }

  return { measurements, widthsCm: widths, depthsCm: depths, depthSource: s ? "profile" : "estimated", front: f, side: s, warnings };
}

const r4 = (v: number) => pyRound(v, 4);

function viewOut(v: ViewResult): PhotoMeasurement["front"] {
  const line = (s: Segment) => ({ y: r4(s.y / v.height), x1: r4(s.x1 / v.width), x2: r4((s.x2 + 1) / v.width) });
  return {
    cmPerPx: r4(v.cmPerPx),
    lines: { chest: line(v.segments.chest), waist: line(v.segments.waist), hips: line(v.segments.hips), thigh: line(v.segments.thigh) },
    inseam: v.inseam ? { x: r4((v.inseam.x + 0.5) / v.width), y1: r4(v.inseam.y1 / v.height), y2: r4(v.inseam.y2 / v.height) } : null,
  };
}

/** Le résultat sous la forme de la réponse de l'API Python (POST /v1/photo/measure), celle qu'attend le reste du site. */
export function toPhotoMeasurement(m: Measurement): PhotoMeasurement {
  const zone = (z: Zone) => ({ circumference: m.measurements[z], width: m.widthsCm[z], depth: m.depthsCm[z] });
  return {
    measurements: m.measurements,
    zones: { chest: zone("chest"), waist: zone("waist"), hips: zone("hips"), thigh: zone("thigh") },
    depthSource: m.depthSource,
    front: viewOut(m.front),
    side: m.side ? viewOut(m.side) : null,
    warnings: m.warnings,
  };
}
