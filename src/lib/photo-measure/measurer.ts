// Choix de l'endroit où mesurer : l'API photo d'abord (rien de lourd dans le navigateur), le navigateur en secours
// (MediaPipe, environ 24 Mo à la première fois) quand l'API n'est pas configurée, ne répond pas à ce site, ou
// tombe en panne en cours de route. Une fois passé au navigateur, on y reste jusqu'à la fermeture de la fenêtre.
import { WIDGET_CONFIG_PATH, WidgetConfigSchema } from "../widget-config";
import { checkPoseViaApi, measureViaApi, photoApiHealth } from "./api";
import { checkPoseInBrowser, measureInBrowser, preloadVision } from "./browser";
import { apiIsDown, parseMeasureInput, type MeasureInput, type PhotoMeasurement, type PoseCheck, type PoseView } from "./types";

export type MeasureMode = "api" | "browser";

export interface MeasurerOptions {
  /** Adresse de l'API photo, déjà vérifiée (widget) ; null : pas d'API. Absente : demandée au site (GET /api/v1/widget). */
  photoApiUrl?: string | null;
  /** Site SwiftStyle à interroger quand photoApiUrl est absente. Par défaut, celui qui sert la page. */
  siteUrl?: string;
  /** Dossier des fichiers de MediaPipe, pour mesurer dans le navigateur. */
  visionUrl?: string;
  fetch?: typeof fetch;
  /** Appelée quand l'API tombe et que la mesure passe au navigateur. */
  onFallback?: (reason: string) => void;
}

export interface Measurer {
  /** Où la mesure se fait en ce moment. */
  mode(): Promise<MeasureMode>;
  /** Avec l'API, rien ; dans le navigateur, commence à charger MediaPipe. */
  preload(): Promise<void>;
  /** Cadrage d'une image de la caméra ; null si l'image a été refusée (on passe à la suivante). */
  checkPose(frame: HTMLCanvasElement, expect: PoseView): Promise<PoseCheck | null>;
  measure(input: MeasureInput): Promise<PhotoMeasurement>;
}

/** Adresse de l'API photo donnée par le site, si elle répond à cette page et que son modèle est prêt ; sinon null. */
export async function findPhotoApi(siteUrl = "", fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${siteUrl.replace(/\/+$/, "")}${WIDGET_CONFIG_PATH}`, { cache: "no-store", credentials: "omit" });
    const config = WidgetConfigSchema.safeParse(await res.json());
    const url = config.success ? config.data.photoApiUrl : null;
    return url && (await photoApiHealth(url, fetchFn)) ? url : null;
  } catch {
    return null;
  }
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

export function createMeasurer(opts: MeasurerOptions = {}): Measurer {
  const fetchFn = opts.fetch ?? fetch;
  const vision = { visionUrl: opts.visionUrl };
  let api: Promise<string | null> = opts.photoApiUrl !== undefined ? Promise.resolve(opts.photoApiUrl) : findPhotoApi(opts.siteUrl, fetchFn);

  async function apiFirst<T>(remote: (url: string) => Promise<T>, local: () => Promise<T>): Promise<T> {
    const url = await api;
    if (url) {
      try {
        return await remote(url);
      } catch (err) {
        if (!apiIsDown(err)) throw err;
        api = Promise.resolve(null);
        opts.onFallback?.(err instanceof Error ? err.message : String(err));
      }
    }
    return local();
  }

  return {
    mode: async () => ((await api) ? "api" : "browser"),
    preload: async () => {
      if (!(await api)) await preloadVision(vision);
    },
    checkPose: (frame, expect) =>
      apiFirst(
        async (url) => {
          const jpeg = await toJpeg(frame, 0.7);
          return jpeg ? checkPoseViaApi(url, jpeg, expect, fetchFn) : null;
        },
        () => checkPoseInBrowser(frame, expect, vision),
      ),
    measure: async (input) => {
      const valid = parseMeasureInput(input);
      return apiFirst(
        (url) => measureViaApi(url, valid, fetchFn),
        () => measureInBrowser(valid, vision),
      );
    },
  };
}
