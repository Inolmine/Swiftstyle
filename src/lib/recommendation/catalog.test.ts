import { describe, expect, it } from "vitest";
import { findGarment, GARMENTS, resolveGarment, shopKey, type Garment } from "./catalog";
import { DEMO_ARTICLES } from "./demo-charts";

describe("catalogue des vêtements", () => {
  it("contient les articles de démonstration, sous leur identifiant", () => {
    expect(GARMENTS.map((g) => g.id)).toEqual(["demo-tee", "demo-jean", "demo-veste"]);
    expect(findGarment("demo-jean")?.chart).toBe(DEMO_ARTICLES.jean.chart);
  });

  it("préfère le vêtement du site demandé à un vêtement reconnu partout", () => {
    const catalog: Garment[] = [
      { id: "123", name: "Partout", chart: DEMO_ARTICLES.tee.chart },
      { id: "123", shop: "www.marque-a.fr", name: "Marque A", chart: DEMO_ARTICLES.jean.chart },
    ];
    expect(findGarment("123", "https://marque-a.fr/", catalog)?.name).toBe("Marque A");
    expect(findGarment("123", "marque-b.fr", catalog)?.name).toBe("Partout");
    expect(findGarment("456", "marque-a.fr", catalog)).toBeUndefined();
  });

  it("compare les sites sans protocole, www ni chemin", () => {
    expect(shopKey("https://www.Exemple.fr/produits/1")).toBe("exemple.fr");
    expect(shopKey("exemple.fr:443")).toBe("exemple.fr");
    expect(shopKey(undefined)).toBe("");
  });

  it("devine le guide d'un vêtement inconnu d'après la page", () => {
    expect(resolveGarment({ id: " 42 ", title: "Veste en laine" })).toMatchObject({ id: "42", name: "Veste en laine", source: "inferred" });
    expect(resolveGarment({ id: "demo-veste", title: "Jean" })).toMatchObject({ name: "Veste en laine", source: "catalog" });
  });
});
