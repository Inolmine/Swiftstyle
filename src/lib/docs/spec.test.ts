import { describe, expect, it } from "vitest";
import { RECOMMEND_EXAMPLE, RECOMMEND_RESPONSES, RecommendRequestSchema, RecommendResponseSchema } from "../recommend-request";
import { TRIAL_EXAMPLE, TRIAL_RESPONSES, TrialRequestSchema, TrialResponseSchema } from "../trial-request";
import { buildDocs, buildOpenApi } from "./spec";

interface S {
  description?: string;
  properties?: Record<string, S>;
  items?: S;
  anyOf?: S[];
}

function undocumented(schema: S, path: string): string[] {
  const missing: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const here = `${path}.${key}`;
    if (!prop.description) missing.push(here);
    for (const inner of [prop, ...(prop.anyOf ?? []), ...(prop.items ? [prop.items] : [])]) missing.push(...undocumented(inner, here));
  }
  return missing;
}

describe("documentation générée", () => {
  const docs = buildDocs();

  it("décrit chaque champ de chaque schéma", () => {
    for (const [name, schema] of Object.entries(docs.schemas)) {
      expect((schema as S).description, name).toBeTruthy();
      expect(undocumented(schema as S, name)).toEqual([]);
    }
  });

  it("donne des exemples qui respectent les schémas", () => {
    expect(() => TrialRequestSchema.parse(TRIAL_EXAMPLE)).not.toThrow();
    for (const r of TRIAL_RESPONSES) expect(() => TrialResponseSchema.parse(r.example)).not.toThrow();
    expect(() => RecommendRequestSchema.parse(RECOMMEND_EXAMPLE)).not.toThrow();
    for (const r of RECOMMEND_RESPONSES) expect(() => RecommendResponseSchema.parse(r.example)).not.toThrow();
  });

  it("renvoie vers la documentation de l'API photo", () => {
    expect(docs.links.map((l) => l.href)).toContain("http://localhost:8000/docs");
  });

  it("produit un document OpenAPI 3.1 avec la route et ses réponses", () => {
    const api = JSON.parse(JSON.stringify(buildOpenApi()));
    expect(api.openapi).toBe("3.1.0");
    const post = api.paths["/api/demande-essai"].post;
    expect(Object.keys(post.responses)).toEqual(["200", "400", "429", "502", "503"]);
    expect(post.requestBody.content["application/json"].schema).toEqual({ $ref: "#/components/schemas/TrialRequest" });
    expect(Object.keys(api.components.schemas)).toEqual(["TrialRequest", "TrialResponse", "RecommendRequest", "RecommendResponse"]);
    expect(api.components.schemas.TrialRequest.required).toEqual(["name", "email", "brand", "site", "platform", "volume", "consent"]);

    const recommend = api.paths["/api/v1/recommend"].post;
    expect(Object.keys(recommend.responses)).toEqual(["200", "400", "422", "429"]);
    expect(api.components.schemas.RecommendRequest.required).toEqual(["measurements", "garment"]);
    expect(api.components.schemas.RecommendRequest.properties.garment.required).toEqual(["id"]);
  });
});
