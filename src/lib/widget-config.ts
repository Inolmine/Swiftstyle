import { z } from "zod";

export const WIDGET_CONFIG_PATH = "/api/v1/widget";

export const WidgetConfigSchema = z
  .object({
    ok: z.literal(true).meta({ description: "Toujours true quand le site répond." }),
    photoApiUrl: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .meta({
        description:
          "Adresse de l'API photo (variable PHOTO_API_URL du site), qui mesure les photos sur le serveur ; null si elle n'est pas configurée. Le widget l'utilise si elle répond depuis le site de la marque, sinon il mesure dans le navigateur.",
        examples: ["https://api.swiftstyle.example"],
      }),
  })
  .meta({ description: "Réponse du site au widget, qui la demande avant d'afficher le bouton." });

export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

export const WIDGET_CONFIG_RESPONSES: { status: number; description: string; example: WidgetConfig }[] = [
  {
    status: 200,
    description:
      "Le site répond, avec l'adresse de l'API photo (ou null). Le widget vérifie ensuite que l'API répond ; sinon, qu'il peut lire les fichiers de MediaPipe pour mesurer dans le navigateur.",
    example: { ok: true, photoApiUrl: "https://api.swiftstyle.example" },
  },
];
