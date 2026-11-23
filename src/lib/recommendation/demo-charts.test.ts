import { describe, expect, it } from "vitest";
import { chartFromGuide, DEMO_ARTICLES } from "./demo-charts";
import GUIDES from "./guides-des-tailles.json";
import { validateChart } from "./recommend";

describe("guides des tailles (guides-des-tailles.json)", () => {
  it("donne aux articles de démonstration les mensurations du fichier, taille par taille", () => {
    const tee = DEMO_ARTICLES.tee.chart;
    expect(tee.sizes).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    expect(tee.ranges.chest).toEqual([[80, 86], [86, 92], [92, 98], [98, 105], [105, 113], [113, 122]]);
    expect(DEMO_ARTICLES.jean.chart.ranges.inseam?.[0]).toEqual(GUIDES.articles.jean.tailles.XS.mensurations_corps_recommandees.entrejambe);
    expect(DEMO_ARTICLES.sweat.chart.ranges.waist?.[5]).toEqual([105, 115]);
    expect(DEMO_ARTICLES.sweat.name).toBe("Sweat");
  });

  it("produit des guides valides", () => {
    for (const { chart } of Object.values(DEMO_ARTICLES)) expect(validateChart(chart)).toEqual([]);
  });

  it("refuse une mensuration inconnue ou un intervalle mal formé", () => {
    const guide = (body: Record<string, number[]>) => ({ nom: "Test", tailles: { M: { mensurations_corps_recommandees: body } } });
    expect(() => chartFromGuide(guide({ tour_de_cou: [38, 40] }), { chest: 1 })).toThrow(/tour_de_cou/);
    expect(() => chartFromGuide(guide({ tour_poitrine: [90] }), { chest: 1 })).toThrow(/intervalle/);
  });
});
