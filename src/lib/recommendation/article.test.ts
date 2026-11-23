import { describe, expect, it } from "vitest";
import { articleFor, normalizeSize, sizesOnPage } from "./article";
import { DEMO_ARTICLES } from "./demo-charts";

describe("articleFor", () => {
  it("reconnaît un pantalon par sa catégorie, son nom ou son adresse", () => {
    expect(articleFor({ category: "Femme > Jeans" })).toBe("jean");
    expect(articleFor({ title: "Pantalon chino slim" })).toBe("jean");
    expect(articleFor({ url: "https://www.nike.com/fr/t/pantalon-de-jogging-tech-fleece" })).toBe("jean");
  });

  it("reconnaît une veste, même en jean", () => {
    expect(articleFor({ title: "Veste en jean oversize" })).toBe("veste");
    expect(articleFor({ url: "https://www.uniqlo.com/fr/fr/products/E470070-000/doudoune-ultra-light" })).toBe("veste");
  });

  it("garde le t-shirt pour les hauts, y compris « short sleeve »", () => {
    expect(articleFor({ title: "Short Sleeve Crew Neck T-Shirt" })).toBe("tee");
    expect(articleFor({ title: "Pull col rond" })).toBe("tee");
    expect(articleFor({})).toBe("tee");
  });

  it("préfère la catégorie au nom", () => {
    expect(articleFor({ category: "Vestes", title: "Le Jean" })).toBe("veste");
  });
});

describe("sizesOnPage", () => {
  const chart = DEMO_ARTICLES.tee.chart;

  it("rend le libellé de la page pour chaque taille du guide", () => {
    expect(sizesOnPage(chart, ["s", " M ", "L", "2XL", "Bleu", "42"])).toEqual([undefined, "s", "M", "L", undefined, "2XL"]);
  });

  it("ne trouve rien sans tailles sur la page", () => {
    expect(sizesOnPage(chart, []).every((s) => s === undefined)).toBe(true);
  });

  it("compare 2XL et XXL", () => {
    expect(normalizeSize("2xl")).toBe("XXL");
    expect(normalizeSize("3XL")).toBe("XXXL");
    expect(normalizeSize(" xs ")).toBe("XS");
  });
});
