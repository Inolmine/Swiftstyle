import { z } from "zod";
import pkg from "../../../package.json";
import { PHOTO_API_DOCS_URL } from "../photo-measure";
import { RECOMMEND_EXAMPLE, RECOMMEND_RESPONSES, RecommendRequestSchema, RecommendResponseSchema } from "../recommend-request";
import { TRIAL_EXAMPLE, TRIAL_RESPONSES, TrialRequestSchema, TrialResponseSchema } from "../trial-request";

export type JsonSchema = { [key: string]: unknown };

export function jsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
  return rest;
}

export interface DocResponse {
  code: string;
  description: string;
  schema?: string;
  example?: unknown;
}

export interface DocOperation {
  id: string;
  tag: string;
  method: "POST";
  path: string;
  summary: string;
  description: string[];
  input: { label: string; contentType: string; schema: string; example?: unknown };
  responses: DocResponse[];
  usage: { label: string; lang: string; code: string }[];
}

export interface Docs {
  title: string;
  version: string;
  description: string[];
  links: { label: string; href: string; description: string }[];
  tags: { name: string; description: string }[];
  operations: DocOperation[];
  schemas: Record<string, JsonSchema>;
}

export function buildDocs(): Docs {
  const trialBody = JSON.stringify(TRIAL_EXAMPLE);
  const recommendBody = JSON.stringify(RECOMMEND_EXAMPLE);
  return {
    title: "SwiftStyle · Documentation du site",
    version: pkg.version,
    description: [
      "Les routes HTTP du site Next.js. Cette page est générée depuis le code (schémas zod et exemples testés) : elle suit les changements sans être réécrite. Même contenu au format OpenAPI 3.1 : /openapi.json.",
    ],
    links: [
      {
        label: "API photo",
        href: PHOTO_API_DOCS_URL,
        description:
          "La mesure du corps sur photo, appelée par les sites des marques : documentation Swagger générée par FastAPI, avec « Try it out ».",
      },
    ],
    tags: [
      { name: "Formulaire d'essai", description: "Demandes d'essai des marques, rangées dans un Google Sheet." },
      { name: "Recommandation", description: "Taille idéale d'un article, à partir des mensurations mesurées sur photo. Appelée par l'extension navigateur." },
    ],
    operations: [
      {
        id: "trial",
        tag: "Formulaire d'essai",
        method: "POST",
        path: "/api/demande-essai",
        summary: "Envoyer une demande d'essai",
        description: [
          "Reçoit le formulaire « Demander un essai » de la page d'accueil et le transmet au Google Sheet de l'équipe (GOOGLE_SHEETS_WEBHOOK_URL). En local sans cette variable, rien n'est envoyé : la demande s'affiche seulement dans le terminal.",
          "5 demandes au plus par adresse IP et par tranche de 10 minutes.",
        ],
        input: { label: "Corps de la requête", contentType: "application/json", schema: "TrialRequest", example: TRIAL_EXAMPLE },
        responses: TRIAL_RESPONSES.map((r) => ({ code: String(r.status), description: r.description, schema: "TrialResponse", example: r.example })),
        usage: [
          {
            label: "curl",
            lang: "bash",
            code: `curl -X POST http://localhost:3000/api/demande-essai -H "content-type: application/json" -d '${trialBody}'`,
          },
          {
            label: "JavaScript",
            lang: "js",
            code: `const res = await fetch("/api/demande-essai", {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(TRIAL_EXAMPLE, null, 2).replace(/\n/g, "\n  ")}),\n});\nconst { ok, error } = await res.json();`,
          },
        ],
      },
      {
        id: "recommend",
        tag: "Recommandation",
        method: "POST",
        path: "/api/v1/recommend",
        summary: "Recommander une taille",
        description: [
          "Reçoit les mensurations du client (le champ measurements de la réponse de l'API photo, POST /v1/photo/measure), la coupe qu'il préfère et l'identifiant du vêtement, et rend la taille idéale. L'extension navigateur l'appelle juste après avoir pris et mesuré les photos, puis à chaque fois que le client corrige une mesure ou change de coupe : sans nouvelles photos.",
          "Le guide des tailles est celui du vêtement dans le catalogue de SwiftStyle, retrouvé par garment.id (et garment.shop). Pour un vêtement absent du catalogue, c'est celui d'un article de démonstration (t-shirt, jean ou veste), choisi d'après le nom, la catégorie et l'adresse de la page ; garment.source le dit. Le catalogue ne contient encore que les articles de démonstration (demo-tee, demo-jean, demo-veste).",
          "Les tailles de la page servent à rendre la taille telle qu'elle y est écrite (pageSize), pour la sélectionner.",
          "Ouverte à tous les sites (CORS) : la route ne lit ni cookie ni session et ne garde rien. 120 demandes au plus par adresse IP et par minute.",
        ],
        input: { label: "Corps de la requête", contentType: "application/json", schema: "RecommendRequest", example: RECOMMEND_EXAMPLE },
        responses: RECOMMEND_RESPONSES.map((r) => ({ code: String(r.status), description: r.description, schema: "RecommendResponse", example: r.example })),
        usage: [
          {
            label: "curl",
            lang: "bash",
            code: `curl -X POST http://localhost:3000/api/v1/recommend -H "content-type: application/json" -d '${recommendBody}'`,
          },
          {
            label: "JavaScript",
            lang: "js",
            code: `// mesure = réponse de l'API photo (POST /v1/photo/measure)
const res = await fetch("http://localhost:3000/api/v1/recommend", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ measurements: mesure.measurements, fit: "normale", garment: { id: "demo-tee", shop: location.hostname, title: document.title, sizes: ["S", "M", "L"] } }),
});
const { size, pageSize, confidence } = await res.json();`,
          },
        ],
      },
    ],
    schemas: {
      TrialRequest: jsonSchema(TrialRequestSchema, "input"),
      TrialResponse: jsonSchema(TrialResponseSchema, "output"),
      RecommendRequest: jsonSchema(RecommendRequestSchema, "input"),
      RecommendResponse: jsonSchema(RecommendResponseSchema, "output"),
    },
  };
}

export function buildOpenApi() {
  const docs = buildDocs();
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  return {
    openapi: "3.1.0",
    info: { title: docs.title, version: docs.version, description: docs.description.join("\n\n") },
    externalDocs: { description: docs.links[0]!.description, url: docs.links[0]!.href },
    tags: docs.tags,
    paths: Object.fromEntries(
      docs.operations.map((op) => [
        op.path,
        {
          [op.method.toLowerCase()]: {
            tags: [op.tag],
            summary: op.summary,
            description: op.description.join("\n\n"),
            requestBody: {
              required: true,
              content: { [op.input.contentType]: { schema: ref(op.input.schema), example: op.input.example } },
            },
            responses: Object.fromEntries(
              op.responses.map((r) => [r.code, { description: r.description, content: { "application/json": { schema: ref(r.schema!), example: r.example } } }]),
            ),
          },
        },
      ]),
    ),
    components: { schemas: docs.schemas },
  };
}
