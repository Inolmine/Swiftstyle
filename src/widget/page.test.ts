import { describe, expect, it } from "vitest";
import { matchesSize, parseSizes, tokens } from "./page";

describe("lecture de la fiche produit", () => {
  it("lit les tailles de data-sizes", () => {
    expect(parseSizes("XS, S,M ,L,,M")).toEqual(["XS", "S", "M", "L"]);
    expect(parseSizes("  ")).toBeNull();
    expect(parseSizes(undefined)).toBeNull();
  });

  it("reconnaît une taille dans le libellé d'un bouton ou d'une option", () => {
    expect(tokens("M / 38-40 (Taille normale)")).toEqual(["M", "38", "40", "TAILLE", "NORMALE"]);
    expect(matchesSize("Taille M", "m")).toBe(true);
    expect(matchesSize("XL – épuisé", "XL")).toBe(true);
    expect(matchesSize("XXL", "XL")).toBe(false);
    expect(matchesSize("Medium", "M")).toBe(false);
  });
});
