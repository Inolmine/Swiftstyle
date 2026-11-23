export const BODY_KEYS = ["chest", "waist", "hips"] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

export const MEASURE_KEYS = [...BODY_KEYS, "thigh", "inseam"] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];
export type Body = Partial<Record<MeasureKey, number>>;

export const FIT_PREFERENCES = ["ajustee", "normale", "ample"] as const;
export type FitPreference = (typeof FIT_PREFERENCES)[number];

export interface SizeChart<K extends MeasureKey = MeasureKey> {
  sizes: string[];
  ranges: Partial<Record<K, [number, number][]>>;
  weights: Partial<Record<K, number>>;
}

export interface Theme {
  font?: string;
  radius?: string;
  accent?: string;
  bg?: string;
  text?: string;
  border?: string;
}

export type Basis = "measured" | "estimated" | "reference";

export interface FitDetail<K extends MeasureKey = MeasureKey> {
  key: K;
  position: number;
  feel: string;
}

export interface Alternative {
  size: string;
  confidence: number;
  note: string;
}

export interface SizeResult<K extends MeasureKey = MeasureKey> {
  size: string;
  index: number;
  confidence: number;
  reason: string;
  details: FitDetail<K>[];
  alternatives: Alternative[];
}
