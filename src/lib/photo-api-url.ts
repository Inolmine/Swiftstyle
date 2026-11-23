// Côté serveur : adresse de l'API photo (projet swiftstyle-api), donnée au widget par GET /api/v1/widget.
// PHOTO_API_URL est lue à chaque requête : la changer sur Cloudflare ne demande pas de nouveau build.

/** Adresse de l'API photo, sans / final ; null si PHOTO_API_URL est vide ou n'est pas une adresse http(s). */
export function photoApiUrl(raw = process.env.PHOTO_API_URL): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return /^https?:$/.test(new URL(value).protocol) ? value.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}
