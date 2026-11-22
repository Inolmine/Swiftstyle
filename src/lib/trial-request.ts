import { z } from "zod";
import { EMAIL_RE } from "./email";

const text = (max: number) => z.string().trim().max(max);

export const TrialRequestSchema = z
  .object({
    name: text(120).min(2).meta({ description: "Nom et prénom (2 à 120 caractères).", examples: ["Camille Exemple"] }),
    email: text(200).regex(EMAIL_RE).meta({ description: "Adresse e-mail professionnelle.", examples: ["camille@example.com"] }),
    brand: text(120).min(1).meta({ description: "Nom de la marque.", examples: ["Exemple"] }),
    site: text(200).min(1).meta({ description: "Site web de la marque.", examples: ["https://example.com"] }),
    platform: text(80)
      .min(1)
      .meta({ description: "Plateforme e-commerce : Shopify, WooCommerce, PrestaShop, Magento / Adobe Commerce, Salesforce Commerce Cloud ou Autre.", examples: ["Shopify"] }),
    volume: text(80)
      .min(1)
      .meta({ description: "Commandes par mois : Moins de 1 000, 1 000 à 10 000, 10 000 à 50 000 ou Plus de 50 000.", examples: ["1 000 à 10 000"] }),
    message: text(2000).default("").meta({ description: "Message libre, facultatif (2 000 caractères au plus)." }),
    consent: z.literal("on").meta({ description: "Case « J'accepte que SwiftStyle me recontacte » cochée : vaut toujours \"on\"." }),
    societe: z
      .string()
      .optional()
      .meta({ description: "Piège à robots, invisible dans le formulaire : à laisser vide. Rempli, la demande est ignorée (réponse 200 quand même)." }),
    source: text(300).default("").meta({ description: "Adresse de la page d'où vient la demande, facultative." }),
    referrer: text(300).default("").meta({ description: "Site de provenance de la visite, facultatif." }),
  })
  .meta({ description: "Demande d'essai envoyée par une marque." });

export type TrialRequest = z.input<typeof TrialRequestSchema>;

export const TrialResponseSchema = z
  .object({
    ok: z.boolean().meta({ description: "true si la demande est transmise (ou ignorée car envoyée par un robot)." }),
    mode: z.literal("demo").optional().meta({ description: "\"demo\" en local sans GOOGLE_SHEETS_WEBHOOK_URL : rien n'est transmis." }),
    error: z
      .enum(["invalid_input", "rate_limited", "upstream", "not_configured"])
      .optional()
      .meta({ description: "Code de l'erreur quand ok vaut false (voir les réponses)." }),
  })
  .meta({ description: "Réponse de la route." });

export type TrialResponse = z.infer<typeof TrialResponseSchema>;

export const TRIAL_RESPONSES: { status: number; description: string; example: TrialResponse }[] = [
  { status: 200, description: "Demande transmise au Google Sheet (ou mode démo en local).", example: { ok: true } },
  { status: 400, description: "Champ manquant ou invalide.", example: { ok: false, error: "invalid_input" } },
  { status: 429, description: "Plus de 5 demandes en 10 minutes depuis la même adresse.", example: { ok: false, error: "rate_limited" } },
  { status: 502, description: "Le Google Sheet a refusé la demande.", example: { ok: false, error: "upstream" } },
  { status: 503, description: "En production, GOOGLE_SHEETS_WEBHOOK_URL n'est pas configurée.", example: { ok: false, error: "not_configured" } },
];

export const TRIAL_EXAMPLE: TrialRequest = {
  name: "Camille Exemple",
  email: "camille@example.com",
  brand: "Exemple",
  site: "https://example.com",
  platform: "Shopify",
  volume: "1 000 à 10 000",
  message: "Beaucoup de retours sur les jeans.",
  consent: "on",
  source: "",
  referrer: "",
};
