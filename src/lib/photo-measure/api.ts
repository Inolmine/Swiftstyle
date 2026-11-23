// Client de l'API photo (projet swiftstyle-api) : la mesure se fait sur le serveur, le navigateur n'a rien de lourd
// à charger. Une API injoignable, trop lente, en panne (5xx) ou saturée (429) donne l'erreur `unreachable` :
// la mesure passe alors au navigateur (measurer.ts).
import {
  MEASURE_ERRORS,
  MeasureError,
  PhotoMeasurementSchema,
  type MeasureErrorCode,
  type PhotoMeasurement,
  type PoseCheck,
  type PoseView,
} from "./types";

const TIMEOUT_MS = { health: 4000, pose: 5000, measure: 30000 };

async function call(url: string, init: RequestInit, timeoutMs: number, fetchFn: typeof fetch): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal, credentials: "omit" });
  } catch {
    throw new MeasureError("unreachable", ctrl.signal.aborted ? `API photo : pas de réponse en ${timeoutMs / 1000} s.` : `API photo injoignable (${url}).`);
  } finally {
    clearTimeout(timer);
  }
}

const down = (status: number) => status >= 500 || status === 429;

/** L'API répond à ce site (CORS) et son modèle est prêt. */
export async function photoApiHealth(apiUrl: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await call(`${apiUrl}/health`, { cache: "no-store" }, TIMEOUT_MS.health, fetchFn);
    const json = (await res.json().catch(() => null)) as { status?: unknown; modelReady?: unknown } | null;
    return res.ok && json?.status === "ok" && json.modelReady === true;
  } catch {
    return false;
  }
}

export async function measureViaApi(
  apiUrl: string,
  input: { heightCm: number; front: Blob; side?: Blob | null },
  fetchFn: typeof fetch = fetch,
): Promise<PhotoMeasurement> {
  const body = new FormData();
  body.append("heightCm", String(input.heightCm));
  body.append("front", input.front, "face.jpg");
  if (input.side) body.append("side", input.side, "profil.jpg");

  const res = await call(`${apiUrl}/v1/photo/measure`, { method: "POST", body }, TIMEOUT_MS.measure, fetchFn);
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (down(res.status)) throw new MeasureError("unreachable", `API photo indisponible (erreur ${res.status}).`);
    const err = (json ?? {}) as { error?: string; message?: string; detail?: { msg?: string }[] };
    const code: MeasureErrorCode =
      err.error && err.error in MEASURE_ERRORS ? (err.error as MeasureErrorCode) : err.detail ? "invalid_input" : "unexpected_response";
    throw new MeasureError(code, err.message ?? err.detail?.[0]?.msg ?? `Erreur ${res.status} de l'API photo.`);
  }
  const result = PhotoMeasurementSchema.safeParse(json);
  if (!result.success) throw new MeasureError("unexpected_response", "Réponse inattendue de l'API photo : le site et l'API ne sont plus d'accord.");
  return result.data;
}

/** Cadrage d'une image de la caméra par l'API ; null si l'API refuse cette image (illisible, trop lourde). */
export async function checkPoseViaApi(apiUrl: string, frame: Blob, expect: PoseView, fetchFn: typeof fetch = fetch): Promise<PoseCheck | null> {
  const body = new FormData();
  body.append("frame", frame, "image.jpg");
  body.append("expect", expect);
  const res = await call(`${apiUrl}/v1/photo/pose`, { method: "POST", body }, TIMEOUT_MS.pose, fetchFn);
  if (down(res.status)) throw new MeasureError("unreachable", `API photo indisponible (erreur ${res.status}).`);
  const json = (await res.json().catch(() => null)) as PoseCheck | null;
  if (res.ok && !(json && typeof json.ready === "boolean")) throw new MeasureError("unexpected_response", "Réponse inattendue de l'API photo.");
  return res.ok ? json : null;
}
