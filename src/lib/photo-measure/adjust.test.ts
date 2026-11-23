import { describe, expect, it } from "vitest";
import { adjustMeasurement, ellipsePerimeter, initialLines } from "./adjust";
import { EXAMPLE } from "./example";
import type { PhotoMeasurement } from "./types";

const API = EXAMPLE;

describe("ellipsePerimeter", () => {
  it("donne le périmètre d'un cercle", () => {
    expect(ellipsePerimeter(10, 10)).toBeCloseTo(2 * Math.PI * 10);
  });

  it("retrouve les tours calculés par la mesure", () => {
    expect(Math.round(ellipsePerimeter(17, 12))).toBe(92);
    expect(Math.round(ellipsePerimeter(18, 12.4))).toBe(96);
  });
});

describe("adjustMeasurement", () => {
  it("sans correction, garde les valeurs mesurées", () => {
    const r = adjustMeasurement(API, initialLines(API));
    expect(r.edited).toBe(false);
    expect(r.measurements).toEqual(API.measurements);
    expect(r.zones.chest).toEqual({ ...API.zones.chest, edited: false });
    expect(r.inseam).toEqual({ length: 74, edited: false });
  });

  it("monter ou descendre une ligne ne change rien", () => {
    const lines = initialLines(API);
    lines.front.chest = { ...lines.front.chest, y: 0.3 };
    expect(adjustMeasurement(API, lines).edited).toBe(false);
  });

  it("une profondeur raccourcie sur la photo de profil fait baisser le tour", () => {
    const lines = initialLines(API);
    lines.side!.chest = { y: 0.337, x1: 0.42, x2: 0.57 };
    const r = adjustMeasurement(API, lines);
    expect(r.zones.chest.width).toBe(34);
    expect(r.zones.chest.depth).toBe(18);
    expect(r.zones.chest.circumference).toBe(Math.round(ellipsePerimeter(17, 9)));
    expect(r.zones.chest.edited).toBe(true);
    expect(r.zones.waist.edited).toBe(false);
    expect(r.measurements.chest).toBeLessThan(92);
  });

  it("une largeur corrigée de face change la largeur, pas la profondeur lue de profil", () => {
    const lines = initialLines(API);
    const { x1, x2 } = lines.front.hips;
    lines.front.hips = { y: 0.531, x1: x1 + (x2 - x1) / 4, x2: x2 - (x2 - x1) / 4 };
    const r = adjustMeasurement(API, lines);
    expect(r.zones.hips.width).toBe(18);
    expect(r.zones.hips.depth).toBe(24.8);
  });

  it("sans photo de profil, la profondeur estimée suit la largeur", () => {
    const front = { ...API, depthSource: "estimated" as const, side: null };
    const lines = initialLines(front);
    const { x1, x2 } = lines.front.waist;
    lines.front.waist = { y: 0.407, x1, x2: x1 + (x2 - x1) / 2 };
    const r = adjustMeasurement(front, lines);
    expect(r.zones.waist.width).toBe(14);
    expect(r.zones.waist.depth).toBe(10);
  });

  it("une cuisse corrigée de face change son tour", () => {
    const lines = initialLines(API);
    const { x1, x2 } = lines.front.thigh;
    lines.front.thigh = { y: 0.598, x1: x1 + (x2 - x1) / 8, x2: x2 - (x2 - x1) / 8 };
    const r = adjustMeasurement(API, lines);
    expect(r.zones.thigh.width).toBe(12);
    expect(r.zones.thigh.depth).toBe(18);
    expect(r.measurements.thigh).toBe(Math.round(ellipsePerimeter(6, 9)));
    expect(r.zones.hips.edited).toBe(false);
  });

  it("l'entrejambe suit la hauteur de sa ligne, pas sa position", () => {
    const lines = initialLines(API);
    lines.inseam = { ...lines.inseam, x: 0.45 };
    expect(adjustMeasurement(API, lines).edited).toBe(false);

    lines.inseam = { x: 0.45, y1: 0.543, y2: 0.95 };
    const r = adjustMeasurement(API, lines);
    expect(r.inseam).toEqual({ length: 81, edited: true });
    expect(r.measurements.inseam).toBe(81);
    expect(r.edited).toBe(true);
    expect(r.zones.chest.edited).toBe(false);
  });
});
