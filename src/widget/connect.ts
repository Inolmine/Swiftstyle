import { photoApiHealth } from "@/lib/photo-measure/api";
import { POSE_MODEL_FILE, visionUrl } from "@/lib/photo-measure/vision";
import { WIDGET_RETRY } from "@/lib/widget-embed";
import { WIDGET_CONFIG_PATH, WidgetConfigSchema } from "@/lib/widget-config";

export const RECOMMEND_PATH = "/api/v1/recommend";

/** Où et comment mesurer, une fois le site joignable. */
export interface Connection {
  /** api : l'API photo répond à ce site ; browser : mesure dans le navigateur (MediaPipe). */
  mode: "api" | "browser";
  /** Adresse de l'API photo en mode api, sinon null. */
  photoApiUrl: string | null;
  /** Dossier des fichiers de MediaPipe sur le site SwiftStyle (mode browser, ou secours si l'API tombe). */
  visionUrl: string;
  recommendUrl: string;
}

export interface ConnectOptions {
  attempts?: number;
  /** Attente avant chaque nouvelle tentative ; la dernière valeur sert pour les suivantes. */
  delaysMs?: readonly number[];
  /** Durée maximale de chaque requête au site. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Appelée après chaque tentative ratée, avec la raison. */
  onFailure?: (attempt: number, reason: string) => void;
  /** Appelée quand l'API photo est configurée mais ne répond pas à ce site : le widget mesure dans le navigateur. */
  onApiUnavailable?: (apiUrl: string) => void;
  /** Le navigateur sait-il faire tourner MediaPipe ? Par défaut, la présence de WebAssembly. */
  supported?: () => boolean;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Vérifie que le widget peut marcher. Le site SwiftStyle doit répondre (GET /api/v1/widget). Puis, s'il donne une
 * API photo et qu'elle répond à ce site (CORS, modèle prêt) : mode api, rien de lourd à charger. Sinon, le navigateur
 * doit savoir faire tourner MediaPipe (WebAssembly) et lire ses fichiers sur le site (HEAD sur le modèle) : mode
 * browser. Recommence en cas d'échec ; renvoie null si aucune tentative n'a réussi.
 */
export async function connect(siteUrl: string, opts: ConnectOptions = {}): Promise<Connection | null> {
  const attempts = Math.max(1, opts.attempts ?? WIDGET_RETRY.attempts);
  const delays = opts.delaysMs ?? WIDGET_RETRY.delaysMs;
  const sleep = opts.sleep ?? wait;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delays[Math.min(i - 1, delays.length - 1)] ?? 0);
    try {
      return await attempt(siteUrl, opts);
    } catch (err) {
      opts.onFailure?.(i + 1, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}

async function attempt(siteUrl: string, opts: ConnectOptions): Promise<Connection> {
  const fetchFn = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? WIDGET_RETRY.timeoutMs;
  const request = async (url: string, what: string, method: "GET" | "HEAD") => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(url, { method, signal: ctrl.signal, cache: "no-store", credentials: "omit" });
    } catch {
      throw new Error(ctrl.signal.aborted ? `${what} : pas de réponse en ${timeoutMs / 1000} s` : `${what} injoignable (${url})`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`${what} : erreur ${res.status}`);
    return res;
  };

  const res = await request(new URL(WIDGET_CONFIG_PATH, siteUrl).href, "site SwiftStyle", "GET");
  const config = WidgetConfigSchema.safeParse(await res.json().catch(() => null));
  if (!config.success) throw new Error("site SwiftStyle : réponse inattendue");
  const vision = visionUrl(new URL(siteUrl).origin);
  const recommendUrl = new URL(RECOMMEND_PATH, siteUrl).href;

  const apiUrl = config.data.photoApiUrl;
  if (apiUrl) {
    if (await photoApiHealth(apiUrl, fetchFn)) return { mode: "api", photoApiUrl: apiUrl, visionUrl: vision, recommendUrl };
    opts.onApiUnavailable?.(apiUrl);
  }

  if (!(opts.supported ?? (() => typeof WebAssembly === "object"))()) {
    throw new Error(`${apiUrl ? "API photo injoignable et " : ""}ce navigateur ne sait pas faire tourner la mesure (WebAssembly)`);
  }
  await request(`${vision}/${POSE_MODEL_FILE}`, "fichiers de MediaPipe", "HEAD");
  return { mode: "browser", photoApiUrl: null, visionUrl: vision, recommendUrl };
}
