import { z } from "zod";
import pkg from "../../../package.json";
import { RECOMMEND_EXAMPLE, RECOMMEND_RESPONSES, RecommendRequestSchema, RecommendResponseSchema } from "../recommend-request";
import { TRIAL_EXAMPLE, TRIAL_RESPONSES, TrialRequestSchema, TrialResponseSchema } from "../trial-request";
import { visionUrl } from "../photo-measure/vision";
import { WIDGET_CONFIG_PATH, WIDGET_CONFIG_RESPONSES, WidgetConfigSchema } from "../widget-config";
import { WIDGET_ATTRIBUTES, WIDGET_EVENTS, WIDGET_RETRY, WIDGET_SCRIPT_PATH, WIDGET_STYLE } from "../widget-embed";

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
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string[];
  input?: { label: string; contentType: string; schema: string; example?: unknown };
  responses: DocResponse[];
  usage: { label: string; lang: string; code: string }[];
}

export interface Docs {
  /** Adresse du site, pour les codes à copier avant que la page ne connaisse la sienne. */
  origin: string;
  title: string;
  version: string;
  description: string[];
  links: { label: string; href: string; description: string }[];
  tags: { name: string; description: string }[];
  operations: DocOperation[];
  schemas: Record<string, JsonSchema>;
  embed: {
    scriptPath: string;
    description: string[];
    attributes: { name: string; description: string }[];
    events: { name: string; description: string }[];
    style: string;
  };
}

export function buildDocs(): Docs {
  const trialBody = JSON.stringify(TRIAL_EXAMPLE);
  const recommendBody = JSON.stringify(RECOMMEND_EXAMPLE);
  const waits = WIDGET_RETRY.delaysMs.map((ms) => ms / 1000).join(", ").replace(/, (\d+)$/, " puis $1");
  return {
    origin: process.env.APP_ORIGIN || "http://localhost:3000",
    title: "SwiftStyle · Documentation du site",
    version: pkg.version,
    description: [
      "Les routes HTTP du site Next.js. Cette page est générée depuis le code (schémas zod et exemples testés) : elle suit les changements sans être réécrite. Même contenu au format OpenAPI 3.1 : /openapi.json.",
    ],
    links: [],
    tags: [
      { name: "Formulaire d'essai", description: "Demandes d'essai des marques, rangées dans un Google Sheet." },
      { name: "Recommandation", description: "Taille idéale d'un article, à partir des mensurations mesurées sur photo. Appelée par le widget, la démo et l'extension." },
      { name: "Widget", description: "Bouton « Trouver ma taille » installé sur les fiches produit des marques (voir « Intégrer le widget »)." },
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
          "Reçoit les mensurations du client (le champ measurements de la mesure sur photo, faite par l'API photo ou dans son navigateur), la coupe qu'il préfère et l'identifiant du vêtement, et rend la taille idéale. Le widget l'appelle juste après avoir pris et mesuré les photos, puis à chaque fois que le client corrige une mesure ou change de coupe : sans nouvelles photos. Cette route ne reçoit que les mensurations, jamais les photos.",
          "Le guide des tailles est celui du vêtement dans le catalogue de SwiftStyle, retrouvé par garment.id (et garment.shop). Pour un vêtement absent du catalogue, c'est celui d'un article de démonstration (t-shirt, jean ou sweat), choisi d'après le nom, la catégorie et l'adresse de la page ; garment.source le dit. Le catalogue ne contient encore que les articles de démonstration (demo-tee, demo-jean, demo-sweat), avec les guides des tailles de src/lib/recommendation/guides-des-tailles.json.",
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
            code: `// mesure = await createMeasurer().measure(...) (src/lib/photo-measure : API photo, sinon navigateur)
const res = await fetch("http://localhost:3000/api/v1/recommend", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ measurements: mesure.measurements, fit: "normale", garment: { id: "demo-tee", shop: location.hostname, title: document.title, sizes: ["S", "M", "L"] } }),
});
const { size, pageSize, confidence } = await res.json();`,
          },
        ],
      },
      {
        id: "widget",
        tag: "Widget",
        method: "GET",
        path: WIDGET_CONFIG_PATH,
        summary: "Vérifier que le site répond au widget",
        description: [
          `Appelée par le script du widget (${WIDGET_SCRIPT_PATH}) sur chaque fiche produit, avant d'afficher le bouton : elle montre que le site répond et donne l'adresse de l'API photo (variable PHOTO_API_URL du site), ou null. Le script vérifie ensuite que l'API répond depuis le site de la marque (GET /health : CORS, modèle prêt) : la mesure se fera sur le serveur. Sinon, il vérifie qu'il peut lire, depuis le site de la marque, les fichiers de MediaPipe qui mesurent les photos dans le navigateur (${visionUrl()}/, servis avec l'en-tête Access-Control-Allow-Origin).`,
          `Si le site ne répond pas, ou qu'aucune des deux façons de mesurer n'est possible, le script fait ${WIDGET_RETRY.attempts} tentatives en tout, ${WIDGET_RETRY.timeoutMs / 1000} s au plus chacune, en attendant ${waits} s entre elles ; un spinner occupe la place du bouton pendant ce temps. Au bout du compte, il n'affiche rien.`,
          "Ouverte à tous les sites (CORS), jamais mise en cache.",
        ],
        responses: WIDGET_CONFIG_RESPONSES.map((r) => ({ code: String(r.status), description: r.description, schema: "WidgetConfig", example: r.example })),
        usage: [{ label: "curl", lang: "bash", code: `curl http://localhost:3000${WIDGET_CONFIG_PATH}` }],
      },
    ],
    schemas: {
      TrialRequest: jsonSchema(TrialRequestSchema, "input"),
      TrialResponse: jsonSchema(TrialResponseSchema, "output"),
      RecommendRequest: jsonSchema(RecommendRequestSchema, "input"),
      RecommendResponse: jsonSchema(RecommendResponseSchema, "output"),
      WidgetConfig: jsonSchema(WidgetConfigSchema, "output"),
    },
    embed: {
      scriptPath: WIDGET_SCRIPT_PATH,
      description: [
        "Le bouton « Trouver ma taille » et sa fenêtre (caméra, photos de face et de profil, taille idéale), sur la fiche produit d'une marque : copier ce code dans le modèle de la fiche produit, à l'endroit du bouton, en général sous le choix des tailles.",
        `Au chargement, un spinner occupe la place du bouton pendant que le script vérifie que le site SwiftStyle et ses fichiers de mesure répondent (${WIDGET_RETRY.attempts} tentatives au plus). S'ils ne répondent pas, rien ne s'affiche : la fiche reste telle quelle.`,
        "Les photos sont mesurées par l'API photo de SwiftStyle quand elle répond au site de la marque : rien de lourd à charger. Sinon, elles le sont dans le navigateur du client, avec MediaPipe (environ 24 Mo chargés à la première ouverture, puis gardés en cache), sans quitter son appareil. La taille choisie est cochée dans le formulaire du produit.",
        "Si le site de la marque a une politique de sécurité (Content-Security-Policy), elle doit autoriser le site SwiftStyle (script-src, connect-src) et WebAssembly ('wasm-unsafe-eval').",
      ],
      attributes: WIDGET_ATTRIBUTES,
      events: WIDGET_EVENTS,
      style: WIDGET_STYLE,
    },
  };
}

export function buildOpenApi() {
  const docs = buildDocs();
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  return {
    openapi: "3.1.0",
    info: { title: docs.title, version: docs.version, description: docs.description.join("\n\n") },
    ...(docs.links[0] && { externalDocs: { description: docs.links[0].description, url: docs.links[0].href } }),
    tags: docs.tags,
    paths: Object.fromEntries(
      docs.operations.map((op) => [
        op.path,
        {
          [op.method.toLowerCase()]: {
            tags: [op.tag],
            summary: op.summary,
            description: op.description.join("\n\n"),
            ...(op.input && {
              requestBody: {
                required: true,
                content: { [op.input.contentType]: { schema: ref(op.input.schema), example: op.input.example } },
              },
            }),
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
