import type { Alternative, Body, FitDetail, FitPreference, MeasureKey, SizeChart, SizeResult } from "./types";

const SHIFT: Record<FitPreference, number> = { ajustee: -1.5, normale: 0, ample: 3.5 };
const shiftOf = (k: MeasureKey, fit: FitPreference) => (k === "inseam" ? 0 : SHIFT[fit]);

const WHERE: Record<MeasureKey, string> = {
  chest: "à la poitrine",
  waist: "à la taille",
  hips: "aux hanches",
  thigh: "aux cuisses",
  inseam: "de jambe",
};

export class RecommendError extends Error {
  constructor(
    readonly code: "invalid_chart" | "missing_measurements",
    message: string,
  ) {
    super(message);
    this.name = "RecommendError";
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

const position = (v: number, [min, max]: [number, number]) => (v - (min + max) / 2) / ((max - min) / 2);

const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function compareSizes(a: string, b: string): number {
  const ia = LETTER_SIZES.indexOf(a.toUpperCase());
  const ib = LETTER_SIZES.indexOf(b.toUpperCase());
  if (ia >= 0 && ib >= 0) return ia - ib;
  const na = Number.parseFloat(a.replace(/^\D+/, ""));
  const nb = Number.parseFloat(b.replace(/^\D+/, ""));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export function feel(p: number): string {
  if (p > 1) return "Serré";
  if (p > 0.4) return "Près du corps";
  if (p >= -0.4) return "Juste";
  if (p >= -1) return "Un peu ample";
  return "Ample";
}

export function feelLength(p: number): string {
  if (p > 1) return "Trop court";
  if (p > 0.4) return "Un peu court";
  if (p >= -0.4) return "Juste";
  if (p >= -1) return "Un peu long";
  return "Trop long";
}

const feelOf = (k: MeasureKey, p: number) => (k === "inseam" ? feelLength(p) : feel(p));

export function restrictChart<K extends MeasureKey>(chart: SizeChart, keys: readonly K[]): SizeChart<K> {
  const ranges: SizeChart<K>["ranges"] = {};
  const weights: SizeChart<K>["weights"] = {};
  for (const k of keys) {
    if (chart.ranges[k]) ranges[k] = chart.ranges[k];
    if (chart.weights[k] !== undefined) weights[k] = chart.weights[k];
  }
  return { sizes: chart.sizes, ranges, weights };
}

export function validateChart(chart: SizeChart): string[] {
  const errors: string[] = [];
  if (chart.sizes.length === 0) errors.push("aucune taille");
  const weighted = Object.entries(chart.weights) as [MeasureKey, number][];
  if (weighted.length === 0) errors.push("aucune mensuration pondérée");
  for (const [key, weight] of weighted) {
    if (!(weight > 0)) errors.push(`poids de ${key} non positif`);
    const ranges = chart.ranges[key];
    if (!ranges) {
      errors.push(`${key} est pondéré mais n'a pas d'intervalles`);
      continue;
    }
    if (ranges.length !== chart.sizes.length) {
      errors.push(`${key} : ${ranges.length} intervalles pour ${chart.sizes.length} tailles`);
    }
    ranges.forEach(([min, max], i) => {
      if (!(max > min)) errors.push(`${key}, taille ${chart.sizes[i] ?? i} : intervalle vide`);
    });
  }
  return errors;
}

export function recommendSize<K extends MeasureKey>(chart: SizeChart<K>, body: Body, fit: FitPreference = "normale"): SizeResult<K> {
  const errors = validateChart(chart);
  if (errors.length) throw new RecommendError("invalid_chart", errors.join(" ; "));

  const weighted = (Object.entries(chart.weights) as [K, number][]).sort((a, b) => b[1] - a[1]);
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  const used = weighted.filter(([k]) => typeof body[k] === "number");
  const coverage = used.reduce((s, [, w]) => s + w, 0) / total;
  if (coverage < 0.5) {
    const missing = weighted.filter(([k]) => typeof body[k] !== "number").map(([k]) => k);
    throw new RecommendError("missing_measurements", `mensurations manquantes pour cet article : ${missing.join(", ")}`);
  }

  const rangeOf = (k: K, i: number) => chart.ranges[k]![i]!;
  const valueOf = (k: K) => body[k]!;
  const shifted = (k: K, i: number) => Math.abs(position(valueOf(k) + shiftOf(k, fit), rangeOf(k, i)));

  const scoreOf = (i: number) => used.reduce((s, [k, w]) => s + (w / coverage / total) * shifted(k, i), 0);
  const worstOf = (i: number) => Math.max(...used.map(([k]) => shifted(k, i)));
  const confidenceOf = (i: number, floor: number) =>
    round2(clamp(0.99 - 0.12 * scoreOf(i) - 0.08 * Math.max(0, worstOf(i) - 1), floor, 0.99) * coverage);

  let best = 0;
  let bestScore = Infinity;
  chart.sizes.forEach((_, i) => {
    const s = scoreOf(i);
    if (s < bestScore - 1e-9) {
      bestScore = s;
      best = i;
    }
  });

  const details: FitDetail<K>[] = used.map(([k]) => {
    const p = position(valueOf(k), rangeOf(k, best));
    return { key: k, position: round2(p), feel: feelOf(k, p) };
  });

  const alternatives: Alternative[] = [best - 1, best + 1]
    .filter((i) => i >= 0 && i < chart.sizes.length)
    .map((i) => {
      let worstKey = used[0]![0];
      let worstPos = 0;
      for (const [k] of used) {
        const p = position(valueOf(k), rangeOf(k, i));
        if (Math.abs(p) > Math.abs(worstPos)) {
          worstPos = p;
          worstKey = k;
        }
      }
      return {
        size: chart.sizes[i]!,
        confidence: confidenceOf(i, 0),
        note: `${feelOf(worstKey, worstPos).toLowerCase()} ${WHERE[worstKey]}`,
      };
    });

  const size = chart.sizes[best]!;
  return {
    size,
    index: best,
    confidence: confidenceOf(best, 0.52),
    reason: `Taille ${size} : ${details.map((d) => `${d.feel.toLowerCase()} ${WHERE[d.key]}`).join(", ")}.`,
    details,
    alternatives,
  };
}
