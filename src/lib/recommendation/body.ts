import type { Body, BodyKey, FitPreference, MeasureKey } from "./types";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function estimateBody(heightCm: number, weightKg: number): Record<BodyKey, number> {
  const b = estimateBodyExact(heightCm, weightKg);
  return { chest: Math.round(b.chest), waist: Math.round(b.waist), hips: Math.round(b.hips) };
}

export function estimateBodyExact(heightCm: number, weightKg: number): Record<BodyKey, number> {
  return {
    chest: clamp(0.62 * weightKg + 0.25 * heightCm + 10, 70, 130),
    waist: clamp(0.85 * weightKg + 0.1 * heightCm + 3, 55, 125),
    hips: clamp(0.55 * weightKg + 0.3 * heightCm + 8, 75, 135),
  };
}

export const DEFAULT_EASE: Record<FitPreference, Required<Body>> = {
  ajustee: { chest: 4, waist: 4, hips: 3, thigh: 2, inseam: 0 },
  normale: { chest: 10, waist: 10, hips: 6, thigh: 4, inseam: 0 },
  ample: { chest: 20, waist: 20, hips: 12, thigh: 8, inseam: 0 },
};

export interface GarmentMeasure {
  measurements: Body;
  cut: FitPreference;
}

export function bodyFromGarment(garment: GarmentMeasure, ease = DEFAULT_EASE): Body {
  const body: Body = {};
  for (const [key, value] of Object.entries(garment.measurements) as [MeasureKey, number][]) {
    body[key] = Math.round(value - ease[garment.cut][key]);
  }
  return body;
}
