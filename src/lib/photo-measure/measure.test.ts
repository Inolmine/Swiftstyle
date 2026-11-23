// Tests repris de swiftstyle-api/tests/test_measure.py : la mesure du navigateur doit donner les mêmes chiffres que l'API Python.
import { describe, expect, it } from "vitest";
import { EXAMPLE } from "./example";
import { DEPTH_RATIO, ellipsePerimeter, measure, pyRound, toPhotoMeasurement } from "./measure";
import { FRONT_ROWS, draw, fill, frontView, landmarks, sideView, view, type Row } from "./test-silhouettes";
import { MeasureError } from "./types";

const HEIGHT = 180;

function measureError(run: () => unknown): MeasureError {
  try {
    run();
  } catch (err) {
    if (err instanceof MeasureError) return err;
    throw err;
  }
  throw new Error("aucune erreur");
}

describe("arrondi de Python", () => {
  it("arrondit à égalité vers le pair, comme round()", () => {
    expect([0.5, 1.5, 2.5, -2.5, 2.4, 2.6].map((x) => pyRound(x))).toEqual([0, 2, 2, -2, 2, 3]);
    expect(pyRound(0.33666, 4)).toBe(0.3367);
    expect(pyRound(24.75, 1)).toBe(24.8);
  });
});

describe("mesure sur des silhouettes dessinées (comme l'API Python)", () => {
  it("rend exactement example.json, la réponse de l'API sur la silhouette de test", () => {
    expect(toPhotoMeasurement(measure(HEIGHT, frontView(), sideView()))).toEqual(EXAMPLE);
  });

  it("calcule le tour d'un cercle", () => {
    expect(ellipsePerimeter(10, 10)).toBeCloseTo(2 * Math.PI * 10, 10);
  });

  it("lit les largeurs sur la photo de face", () => {
    const m = measure(HEIGHT, frontView());
    expect(m.front.cmPerPx).toBeCloseTo(0.2, 10);
    expect(m.widthsCm).toEqual({ chest: 34, waist: 28, hips: 36, thigh: 16 });
  });

  it("estime la profondeur sans photo de profil", () => {
    const m = measure(HEIGHT, frontView());
    expect(m.depthSource).toBe("estimated");
    expect(m.depthsCm.chest).toBeCloseTo(34 * DEPTH_RATIO.chest, 1);
    expect(m.measurements.chest).toBe(pyRound(ellipsePerimeter(17, (34 * DEPTH_RATIO.chest) / 2)));
    expect(m.warnings.some((w) => w.includes("profil"))).toBe(true);
  });

  it("lit la profondeur sur la photo de profil", () => {
    const m = measure(HEIGHT, frontView(), sideView());
    expect(m.depthSource).toBe("profile");
    expect(m.depthsCm).toEqual({ chest: 24, waist: 20, hips: 24.8, thigh: 18 });
    expect(m.measurements).toEqual({
      chest: pyRound(ellipsePerimeter(17, 12)),
      waist: pyRound(ellipsePerimeter(14, 10)),
      hips: pyRound(ellipsePerimeter(18, 12.4)),
      thigh: pyRound(ellipsePerimeter(8, 9)),
      inseam: 74,
    });
    expect(m.warnings).toEqual([]);
  });

  it("prend pour la taille la ligne la plus étroite", () => {
    const i = FRONT_ROWS.findIndex((r) => r[0] === 400);
    const rows: Row[] = [...FRONT_ROWS.slice(0, i), [400, 424, 70], [425, 429, 65], [430, 479, 70], ...FRONT_ROWS.slice(i + 1)];
    expect(measure(HEIGHT, view(draw(rows), landmarks())).widthsCm.waist).toBe(26);
  });

  it("retire un bras collé au corps", () => {
    const mask = draw(FRONT_ROWS);
    fill(mask, 380, 521, 200, 230);
    const m = measure(HEIGHT, view(mask, landmarks({ moved: { 13: [215, 380], 15: [215, 440], 19: [215, 520] } })));
    expect(m.widthsCm.waist).toBe(28);
    expect(m.front.segments.waist.armRemoved).toBe(true);
    expect(m.warnings.some((w) => w.includes("Bras collés") && w.includes("à la taille"))).toBe(true);
  });

  it("ne retire rien quand les bras sont écartés", () => {
    const m = measure(HEIGHT, frontView());
    expect(Object.values(m.front.segments).some((s) => s.armRemoved)).toBe(false);
  });

  it("refuse une personne coupée par le cadre", () => {
    const rows: Row[] = [[0, 199, 40], ...FRONT_ROWS.slice(1)];
    expect(measureError(() => measure(HEIGHT, view(draw(rows), landmarks()))).code).toBe("body_not_fully_visible");
  });

  it("refuse des pieds invisibles", () => {
    const lm = landmarks();
    lm[27] = { ...lm[27]!, visibility: 0.1 };
    lm[28] = { ...lm[28]!, visibility: 0.1 };
    expect(measureError(() => measure(HEIGHT, view(draw(FRONT_ROWS), lm))).code).toBe("body_not_fully_visible");
  });

  it("refuse une photo sans personne", () => {
    expect(measureError(() => measure(HEIGHT, view(draw(FRONT_ROWS), []))).code).toBe("no_person");
  });

  it("lit l'entrejambe et la cuisse", () => {
    const m = measure(HEIGHT, frontView());
    expect([m.front.inseam!.y1, m.front.inseam!.y2]).toEqual([580, 950]);
    expect(m.front.inseam!.estimated).toBe(false);
    expect(m.measurements.inseam).toBe(74);
    const thigh = m.front.segments.thigh;
    expect(thigh.y).toBe(598);
    expect([thigh.x1, thigh.x2]).toEqual([215, 294]);
    expect(m.depthsCm.thigh).toBe(16 * DEPTH_RATIO.thigh);
    expect(m.warnings.some((w) => w.includes("ntrejambe"))).toBe(false);
  });

  it("lit la cuisse de profil à la même hauteur", () => {
    const m = measure(HEIGHT, frontView(), sideView());
    expect(m.side!.segments.thigh.y).toBe(598);
    expect(m.side!.inseam).toBeNull();
  });

  it("estime l'entrejambe quand les jambes sont serrées", () => {
    const rows = FRONT_ROWS.map((r): Row => (r[0] !== 580 ? r : [580, 799, 85]));
    const m = measure(HEIGHT, view(draw(rows), landmarks()));
    expect(m.front.inseam!.estimated).toBe(true);
    expect(m.front.inseam!.y1).toBe(690);
    expect(m.warnings.some((w) => w.includes("Jambes serrées"))).toBe(true);
    expect(m.widthsCm.thigh).toBe(17);
  });

  it("signale un entrejambe trop court", () => {
    const rows: Row[] = [...FRONT_ROWS.slice(0, 4), [480, 699, 90], [700, 799, 85, 5], [800, 949, 60, 15]];
    const m = measure(HEIGHT, view(draw(rows), landmarks()));
    expect(m.measurements.inseam).toBe(50);
    expect(m.warnings.some((w) => w.includes("Entrejambe court"))).toBe(true);
  });

  it("retire une main posée contre la cuisse", () => {
    const mask = draw(FRONT_ROWS);
    fill(mask, 560, 640, 190, 220);
    const m = measure(HEIGHT, view(mask, landmarks({ moved: { 13: [205, 400], 15: [205, 560], 19: [205, 600] } })));
    expect([m.front.segments.thigh.x1, m.front.segments.thigh.x2]).toEqual([305, 384]);
  });
});
