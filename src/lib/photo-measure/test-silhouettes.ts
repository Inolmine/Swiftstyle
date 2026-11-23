// Silhouettes dessinées des tests : portage de swiftstyle-api/tests/conftest.py (mêmes dimensions, mêmes repères).
// Pour les tests seulement.
import type { Landmark, View } from "./measure";

export const H = 1000;
export const W = 600;
export const CX = 300;

/** [haut, bas, demi-largeur, demi-écart entre les jambes] */
export type Row = [number, number, number, number?];

export const FRONT_ROWS: Row[] = [
  [50, 199, 40],
  [200, 249, 120],
  [250, 399, 85],
  [400, 479, 70],
  [480, 579, 90],
  [580, 799, 85, 5],
  [800, 949, 60, 15],
];

export const SIDE_ROWS: Row[] = [
  [50, 199, 40],
  [200, 249, 55],
  [250, 399, 60],
  [400, 479, 50],
  [480, 579, 62],
  [580, 949, 45],
];

export function draw(rows: Row[], w = W, h = H): Float32Array {
  const mask = new Float32Array(w * h);
  for (const [y0, y1, hw, g = 0] of rows) {
    for (let y = y0; y <= y1; y++) {
      mask.fill(1, y * w + CX - hw, y * w + CX - g);
      mask.fill(1, y * w + CX + g, y * w + CX + hw);
    }
  }
  return mask;
}

/** Remplit un rectangle du masque (lignes y0 à y1 exclue, colonnes x0 à x1 exclue), comme mask[y0:y1, x0:x1] = 1. */
export function fill(mask: Float32Array, y0: number, y1: number, x0: number, x1: number, w = W) {
  for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
}

export function landmarks(opts: { side?: boolean; moved?: Record<number, [number, number]> } = {}): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, visibility: 1 }));
  const spread = opts.side ? 0 : 1;
  const points: Record<number, [number, number]> = {
    11: [CX - 100 * spread, 250],
    12: [CX + 100 * spread, 250],
    23: [CX - 60 * spread, 540],
    24: [CX + 60 * spread, 540],
    25: [CX - 45 * spread, 790],
    26: [CX + 45 * spread, 790],
    27: [CX - 40 * spread, 930],
    28: [CX + 40 * spread, 930],
    13: [30, 400],
    14: [570, 400],
    15: [20, 600],
    16: [580, 600],
    19: [15, 650],
    20: [585, 650],
  };
  for (const [i, [x, y]] of Object.entries(points)) lm[Number(i)] = { x: x / W, y: y / H, visibility: 1 };
  if (opts.side) for (const i of [12, 24, 26, 28]) lm[i] = { ...lm[i]!, visibility: 0.2 };
  for (const [i, [x, y]] of Object.entries(opts.moved ?? {})) lm[Number(i)] = { x: x / W, y: y / H, visibility: 1 };
  return lm;
}

export const view = (mask: Float32Array, lm: Landmark[], w = W, h = H): View => ({ width: w, height: h, mask, landmarks: lm });
export const frontView = () => view(draw(FRONT_ROWS), landmarks());
export const sideView = () => view(draw(SIDE_ROWS), landmarks({ side: true }));
