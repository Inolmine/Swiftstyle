import {
  MEASURE_ERRORS,
  MeasureError,
  MeasureInputSchema,
  PhotoMeasurementSchema,
  type MeasureErrorCode,
  type MeasureInput,
  type PhotoMeasurement,
} from "./types";

export * from "./types";
export { adjustMeasurement, ellipsePerimeter, initialLines, type AdjustedMeasurement, type EditedLines, type PhotoLines } from "./adjust";

export const PHOTO_API_URL = process.env.NEXT_PUBLIC_PHOTO_API_URL || "http://localhost:8000";
export const PHOTO_API_DOCS_URL = `${PHOTO_API_URL}/docs`;

export async function measureFromPhotos(input: MeasureInput, apiUrl = PHOTO_API_URL): Promise<PhotoMeasurement> {
  const parsed = MeasureInputSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new MeasureError(
      "invalid_input",
      field === "heightCm" ? "La taille doit être comprise entre 140 et 210 cm." : "Il faut une photo de face (et, si possible, de profil).",
    );
  }
  const { front, side, heightCm } = parsed.data;
  const body = new FormData();
  body.append("heightCm", String(heightCm));
  body.append("front", front);
  if (side) body.append("side", side);

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/photo/measure`, { method: "POST", body });
  } catch {
    throw new MeasureError("unreachable", `API photo injoignable (${apiUrl}). Le backend est-il lancé ?`);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json ?? {}) as { error?: string; message?: string; detail?: { msg?: string }[] };
    const code: MeasureErrorCode =
      err.error && err.error in MEASURE_ERRORS ? (err.error as MeasureErrorCode) : err.detail ? "invalid_input" : "unexpected_response";
    throw new MeasureError(code, err.message ?? err.detail?.[0]?.msg ?? `Erreur ${res.status} de l'API photo.`);
  }
  const result = PhotoMeasurementSchema.safeParse(json);
  if (!result.success) throw new MeasureError("unexpected_response", "Réponse inattendue de l'API photo : le site et l'API ne sont plus d'accord.");
  return result.data;
}

export async function photoApiHealth(apiUrl = PHOTO_API_URL): Promise<{ ok: boolean; modelReady: boolean }> {
  try {
    const res = await fetch(`${apiUrl}/health`);
    const json = (await res.json()) as { modelReady?: boolean };
    return { ok: res.ok, modelReady: Boolean(json?.modelReady) };
  } catch {
    return { ok: false, modelReady: false };
  }
}
