import { photoApiUrl } from "@/lib/photo-api-url";
import type { WidgetConfig } from "@/lib/widget-config";

export const dynamic = "force-dynamic";

// Appelée depuis les sites des marques : ouverte à tous (aucun cookie, aucune donnée), jamais mise en cache
// pour qu'une panne se voie tout de suite.
const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export function GET() {
  const body: WidgetConfig = { ok: true, photoApiUrl: photoApiUrl() };
  return Response.json(body, { headers: HEADERS });
}
