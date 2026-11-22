import { z } from "zod";
import type { BodyKey } from "../recommendation";

export const PHOTO_ZONES = ["chest", "waist", "hips", "thigh"] as const;
export type PhotoZone = BodyKey | (typeof PHOTO_ZONES)[number];

const unit = (description: string) => z.number().min(0).max(1).meta({ description });

export const MeasuredLineSchema = z
  .object({
    y: unit("Hauteur de la ligne : 0 en haut de la photo, 1 en bas."),
    x1: unit("Bord gauche : 0 à gauche de la photo, 1 à droite."),
    x2: unit("Bord droit, même repère."),
  })
  .meta({ description: "Ligne horizontale où un tour a été lu, en coordonnées 0 à 1 de la photo (pour la dessiner par-dessus)." });

export const InseamLineSchema = z
  .object({
    x: unit("Position de la ligne : 0 à gauche de la photo, 1 à droite."),
    y1: unit("Entrejambe : 0 en haut de la photo, 1 en bas."),
    y2: unit("Sol, sous les pieds, même repère."),
  })
  .meta({ description: "Ligne verticale de l'entrejambe au sol, en coordonnées 0 à 1 de la photo de face." });

export const PhotoViewSchema = z
  .object({
    cmPerPx: z.number().positive().meta({ description: "Échelle de la photo en cm par pixel, déduite de la taille du client.", examples: [0.2] }),
    lines: z
      .object({
        chest: MeasuredLineSchema.meta({ description: "Ligne de poitrine." }),
        waist: MeasuredLineSchema.meta({ description: "Ligne de taille." }),
        hips: MeasuredLineSchema.meta({ description: "Ligne de hanches." }),
        thigh: MeasuredLineSchema.meta({ description: "Ligne de cuisse, sur la jambe la plus forte." }),
      })
      .meta({ description: "Où chaque tour a été lu sur la photo." }),
    inseam: InseamLineSchema.nullable().meta({ description: "Où l'entrejambe a été lu. Photo de face seulement : null de profil." }),
  })
  .meta({ description: "Ce que la mesure a lu sur une photo." });

export const ZoneSchema = z
  .object({
    circumference: z.number().int().meta({ description: "Tour, en cm (le même que dans measurements).", examples: [92] }),
    width: z.number().meta({ description: "Largeur lue sur la photo de face, en cm.", examples: [34] }),
    depth: z.number().meta({ description: "Profondeur en cm : lue sur la photo de profil, ou estimée (voir depthSource).", examples: [24] }),
  })
  .meta({ description: "Détail d'un tour : périmètre de l'ellipse largeur × profondeur." });

const cm = (description: string, example: number) => z.number().int().meta({ description, examples: [example] });

export const PhotoMeasurementSchema = z
  .object({
    measurements: z
      .object({
        chest: cm("Tour de poitrine, en cm.", 92),
        waist: cm("Tour de taille, en cm.", 76),
        hips: cm("Tour de hanches, en cm.", 96),
        thigh: cm("Tour de cuisse, juste sous l'entrejambe, en cm.", 53),
        inseam: cm("Entrejambe : hauteur de l'entrejambe au sol, en cm (une longueur, pas un tour).", 74),
      })
      .meta({ description: "Mensurations en cm. Même forme que Body du moteur de recommandation : se passent telles quelles à recommendSize." }),
    zones: z
      .object({
        chest: ZoneSchema.meta({ description: "Détail du tour de poitrine." }),
        waist: ZoneSchema.meta({ description: "Détail du tour de taille." }),
        hips: ZoneSchema.meta({ description: "Détail du tour de hanches." }),
        thigh: ZoneSchema.meta({ description: "Détail du tour de cuisse." }),
      })
      .meta({ description: "Largeur et profondeur de chaque tour (l'entrejambe, une longueur, n'en a pas)." }),
    depthSource: z.enum(["profile", "estimated"]).meta({
      description: "profile : profondeur lue sur la photo de profil. estimated : déduite de la largeur, faute de photo de profil.",
    }),
    front: PhotoViewSchema.meta({ description: "Lecture de la photo de face." }),
    side: PhotoViewSchema.nullable().meta({ description: "Lecture de la photo de profil, null s'il n'y en a pas." }),
    warnings: z.array(z.string()).meta({
      description:
        "Remarques à montrer au client : bras collés au corps, pas de photo de profil, jambes serrées (entrejambe estimé), mesure peu plausible.",
    }),
  })
  .meta({ description: "Résultat de la mesure." });

export const MeasureInputSchema = z
  .object({
    front: z.file().meta({ description: "Photo de face, de la tête aux pieds (JPEG, PNG ou WebP)." }),
    side: z
      .file()
      .nullish()
      .meta({ description: "Photo de profil, de la tête aux pieds. Facultative mais conseillée : sans elle, la profondeur du corps est estimée." }),
    heightCm: z.number().min(140).max(210).meta({ description: "Taille du client, en cm (140 à 210). Donne l'échelle de la photo.", examples: [178] }),
  })
  .meta({ description: "Champs envoyés à l'API (formulaire multipart)." });

export type MeasuredLine = z.infer<typeof MeasuredLineSchema>;
export type InseamLine = z.infer<typeof InseamLineSchema>;
export type PhotoView = z.infer<typeof PhotoViewSchema>;
export type PhotoMeasurement = z.infer<typeof PhotoMeasurementSchema>;
export type MeasureInput = z.infer<typeof MeasureInputSchema>;

export const MEASURE_ERRORS = {
  invalid_image: "fichier illisible",
  image_too_large: "photo de plus de 10 Mo",
  no_person: "personne non détectée",
  pose_not_detected: "épaules ou hanches mal visibles, posture non reconnue",
  body_not_fully_visible: "pieds non visibles, ou silhouette coupée par le bord de la photo",
  measure_failed: "un tour n'a pas pu être lu",
  invalid_input: "taille hors limites (140 à 210 cm) ou photo de face manquante",
  unreachable: "API photo injoignable",
  unexpected_response: "réponse de l'API dans une forme inattendue",
} as const;
export type MeasureErrorCode = keyof typeof MEASURE_ERRORS;

export class MeasureError extends Error {
  constructor(
    readonly code: MeasureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MeasureError";
  }
}
