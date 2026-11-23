import { z } from "zod";
import { FIT_PREFERENCES, MEASURE_KEYS } from "./recommendation";

const text = (max: number) => z.string().trim().max(max);
const cm = (description: string, example: number) => z.number().min(20).max(250).optional().meta({ description, examples: [example] });
const confidence = (description: string) => z.number().min(0).max(1).meta({ description, examples: [0.9] });

export const RecommendRequestSchema = z
  .object({
    measurements: z
      .object({
        chest: cm("Tour de poitrine, en cm.", 92),
        waist: cm("Tour de taille, en cm.", 76),
        hips: cm("Tour de hanches, en cm.", 96),
        thigh: cm("Tour de cuisse, juste sous l'entrejambe, en cm.", 53),
        inseam: cm("Entrejambe : hauteur de l'entrejambe au sol, en cm (une longueur, pas un tour).", 74),
      })
      .meta({
        description:
          "Mensurations du client en cm : le champ measurements de la mesure sur photo (faite dans le navigateur, ou par l'API photo pour l'extension), éventuellement corrigées par le client. Chacune est facultative, mais il faut celles dont le guide du vêtement a besoin.",
      }),
    fit: z
      .enum(FIT_PREFERENCES)
      .default("normale")
      .meta({ description: "Coupe choisie par le client : ajustee, normale (par défaut) ou ample. Se change sans reprendre les photos." }),
    garment: z
      .object({
        id: text(200)
          .min(1)
          .meta({
            description:
              "Identifiant du vêtement sur le site de la marque (id Shopify, SKU…). Désigne le vêtement et son guide des tailles dans le catalogue de SwiftStyle.",
            examples: ["demo-tee"],
          }),
        shop: text(253)
          .default("")
          .meta({ description: "Site de la marque (nom d'hôte, par exemple www.leslipfrancais.fr) : un même identifiant peut exister chez deux marques. Facultatif." }),
        title: text(300).default("").meta({ description: "Nom du vêtement, facultatif. Sert à choisir un guide des tailles quand le vêtement n'est pas dans le catalogue." }),
        category: text(300)
          .default("")
          .meta({ description: "Catégorie ou fil d'Ariane, facultatif. Sert à choisir un guide des tailles quand le vêtement n'est pas dans le catalogue." }),
        url: text(2000).default("").meta({ description: "Adresse de la fiche produit, facultative. Même usage que title." }),
        sizes: z
          .array(z.string().trim().max(40))
          .max(200)
          .default([])
          .meta({ description: "Tailles proposées sur la page, telles qu'écrites. Sert à donner la taille à sélectionner sur la page (pageSize)." }),
      })
      .meta({ description: "Le vêtement concerné : son identifiant, et ce que l'extension a lu sur sa fiche produit." }),
  })
  .meta({ description: "Demande de taille pour un vêtement." });

export type RecommendRequest = z.input<typeof RecommendRequestSchema>;

export const RecommendResponseSchema = z
  .object({
    ok: z.boolean().meta({ description: "true si une taille est recommandée." }),
    size: z.string().optional().meta({ description: "Taille recommandée, telle qu'écrite dans le guide des tailles.", examples: ["M"] }),
    pageSize: z
      .string()
      .nullable()
      .optional()
      .meta({ description: "La même taille, telle qu'écrite sur la page : c'est elle qu'il faut sélectionner. null si la page ne la propose pas." }),
    confidence: confidence(
      "Proximité entre les mensurations et le guide des tailles, de 0 à 1. Ce n'est pas un taux de bonnes recommandations mesuré : aucun n'existe à ce jour.",
    ).optional(),
    reason: z.string().optional().meta({ description: "Explication à montrer au client.", examples: ["Taille M : juste à la poitrine."] }),
    details: z
      .array(
        z
          .object({
            key: z.enum(MEASURE_KEYS).meta({ description: "Mensuration : chest, waist, hips, thigh ou inseam." }),
            position: z.number().meta({ description: "Place dans l'intervalle de la taille : 0 au milieu, -1 et +1 aux bornes." }),
            feel: z.string().meta({ description: "Ressenti attendu, à montrer au client.", examples: ["Juste"] }),
          })
          .meta({ description: "Ressenti à une mensuration." }),
      )
      .optional()
      .meta({ description: "Ressenti attendu à chaque mensuration utilisée par le guide du vêtement, la plus déterminante en premier." }),
    alternatives: z
      .array(
        z
          .object({
            size: z.string().meta({ description: "Taille voisine, telle qu'écrite dans le guide." }),
            confidence: confidence("Proximité avec le guide pour cette taille, de 0 à 1."),
            note: z.string().meta({ description: "Ce qui change avec cette taille.", examples: ["un peu ample à la poitrine"] }),
          })
          .meta({ description: "Taille voisine." }),
      )
      .optional()
      .meta({ description: "Les tailles juste en dessous et juste au-dessus." }),
    garment: z
      .object({
        id: z.string().meta({ description: "Identifiant du vêtement, celui de la demande." }),
        name: z.string().meta({ description: "Nom du vêtement dans le catalogue, ou de l'article de démonstration dont le guide a servi.", examples: ["T-shirt"] }),
        source: z.enum(["catalog", "inferred"]).meta({
          description:
            "catalog : vêtement connu du catalogue, avec son propre guide des tailles. inferred : vêtement inconnu, guide d'un article de démonstration choisi d'après son nom et sa catégorie.",
        }),
      })
      .optional()
      .meta({ description: "Le vêtement et le guide des tailles utilisés." }),
    error: z
      .enum(["invalid_input", "missing_measurements", "rate_limited"])
      .optional()
      .meta({ description: "Code de l'erreur quand ok vaut false (voir les réponses)." }),
    message: z.string().optional().meta({ description: "Explication de l'erreur missing_measurements." }),
  })
  .meta({ description: "Réponse de la route." });

export type RecommendResponse = z.infer<typeof RecommendResponseSchema>;

export const RECOMMEND_EXAMPLE: RecommendRequest = {
  measurements: { chest: 92, waist: 76, hips: 96, thigh: 53, inseam: 74 },
  fit: "normale",
  garment: {
    id: "demo-tee",
    shop: "boutique.example",
    title: "T-shirt en coton bio",
    category: "Homme > T-shirts",
    url: "https://boutique.example/products/t-shirt-coton-bio",
    sizes: ["S", "M", "L", "XL"],
  },
};

export const RECOMMEND_RESPONSES: { status: number; description: string; example: RecommendResponse }[] = [
  {
    status: 200,
    description: "Taille recommandée.",
    example: {
      ok: true,
      size: "S",
      pageSize: "S",
      confidence: 0.89,
      reason: "Taille S : près du corps à la poitrine, juste à la taille.",
      details: [
        { key: "chest", position: 1, feel: "Près du corps" },
        { key: "waist", position: 0.33, feel: "Juste" },
      ],
      alternatives: [
        { size: "XS", confidence: 0.49, note: "serré à la poitrine" },
        { size: "M", confidence: 0.81, note: "ample à la taille" },
      ],
      garment: { id: "demo-tee", name: "T-shirt", source: "catalog" },
    },
  },
  { status: 400, description: "Champ manquant ou invalide (par exemple garment.id absent).", example: { ok: false, error: "invalid_input" } },
  {
    status: 422,
    description: "Il manque des mensurations dont le guide du vêtement a besoin.",
    example: { ok: false, error: "missing_measurements", message: "mensurations manquantes pour cet article : chest" },
  },
  { status: 429, description: "Plus de 120 demandes par minute depuis la même adresse.", example: { ok: false, error: "rate_limited" } },
];
