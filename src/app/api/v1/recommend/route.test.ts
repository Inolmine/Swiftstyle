import { describe, expect, it } from "vitest";
import { RECOMMEND_EXAMPLE, RECOMMEND_RESPONSES } from "@/lib/recommend-request";
import { OPTIONS, POST } from "./route";

const post = (body: unknown, ip = "198.51.100.1") =>
  POST(
    new Request("http://localhost/api/v1/recommend", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

const MEASURED = RECOMMEND_EXAMPLE.measurements;

describe("POST /api/v1/recommend", () => {
  it("rend exactement la réponse d'exemple de la documentation", async () => {
    const res = await post(RECOMMEND_EXAMPLE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RECOMMEND_RESPONSES[0]!.example);
  });

  it("prend le guide du vêtement du catalogue d'après son identifiant, quoi que dise la page", async () => {
    const body = await (await post({ measurements: MEASURED, garment: { id: "demo-jean", title: "T-shirt col rond" } })).json();
    expect(body.garment).toEqual({ id: "demo-jean", name: "Jean droit", source: "catalog" });
    expect(body.details.map((d: { key: string }) => d.key)).toEqual(["waist", "hips", "thigh", "inseam"]);
  });

  it("choisit un guide de démo d'après la page pour un vêtement inconnu", async () => {
    const body = await (await post({ measurements: MEASURED, garment: { id: "E486176-000", shop: "www.uniqlo.com", category: "Homme > Jeans" } })).json();
    expect(body.garment).toEqual({ id: "E486176-000", name: "Jean droit", source: "inferred" });
  });

  it("refuse une demande sans identifiant de vêtement", async () => {
    for (const garment of [undefined, {}, { id: "" }, { id: "   " }]) {
      const res = await post({ measurements: MEASURED, garment });
      expect(res.status).toBe(400);
    }
  });

  it("donne la taille telle qu'écrite sur la page", async () => {
    const body = await (await post({ measurements: { chest: 115, waist: 104 }, garment: { id: "demo-tee", sizes: ["s", "m", "l", "xl", "2xl"] } })).json();
    expect(body.size).toBe("XXL");
    expect(body.pageSize).toBe("2xl");
  });

  it("met pageSize à null quand la page ne vend pas la taille", async () => {
    const body = await (await post({ measurements: MEASURED, garment: { id: "demo-tee", sizes: ["XS", "S"] } })).json();
    expect(body.size).toBe("M");
    expect(body.pageSize).toBeNull();
  });

  it("change la taille avec la coupe choisie, sans autre changement", async () => {
    const ask = (fit: string) => post({ measurements: { chest: 95, waist: 82 }, fit, garment: { id: "demo-tee" } }).then((r) => r.json());
    expect((await ask("normale")).size).toBe("M");
    expect((await ask("ample")).size).toBe("L");
  });

  it("suit les mesures corrigées par le client", async () => {
    const ask = (chest: number, waist: number) => post({ measurements: { chest, waist }, garment: { id: "demo-tee" } }).then((r) => r.json());
    expect((await ask(99, 90)).size).toBe("L");
    expect((await ask(93, 80)).size).toBe("M");
  });

  it("signale les mensurations manquantes pour le guide", async () => {
    const res = await post({ measurements: { inseam: 80 }, garment: { id: "demo-tee" } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "missing_measurements" });
  });

  it("refuse une requête invalide", async () => {
    const garment = { id: "demo-tee" };
    for (const body of [null, {}, { measurements: { chest: "grand" }, garment }, { measurements: MEASURED, fit: "moulant", garment }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("est ouverte à tous les sites (CORS), y compris la requête préliminaire", async () => {
    expect((await post(RECOMMEND_EXAMPLE)).headers.get("access-control-allow-origin")).toBe("*");
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("limite à 120 demandes par minute et par adresse", async () => {
    for (let i = 0; i < 120; i++) expect((await post(RECOMMEND_EXAMPLE, "198.51.100.99")).status).toBe(200);
    expect((await post(RECOMMEND_EXAMPLE, "198.51.100.99")).status).toBe(429);
  });
});
