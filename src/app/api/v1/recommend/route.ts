import { clientIp, rateLimit } from "@/lib/http";
import { RecommendRequestSchema, type RecommendResponse } from "@/lib/recommend-request";
import { RecommendError, recommendSize, resolveGarment, sizesOnPage } from "@/lib/recommendation";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const LIMIT_PER_MINUTE = 120;

const reply = (body: RecommendResponse, status = 200) => Response.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  if (!rateLimit(`recommend:${clientIp(req)}`, LIMIT_PER_MINUTE, 60_000)) return reply({ ok: false, error: "rate_limited" }, 429);

  const parsed = RecommendRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return reply({ ok: false, error: "invalid_input" }, 400);
  const { measurements, fit, garment: input } = parsed.data;

  const garment = resolveGarment(input);

  try {
    const r = recommendSize(garment.chart, measurements, fit);
    return reply({
      ok: true,
      size: r.size,
      pageSize: sizesOnPage(garment.chart, input.sizes)[r.index] ?? null,
      confidence: r.confidence,
      reason: r.reason,
      details: r.details,
      alternatives: r.alternatives,
      garment: { id: garment.id, name: garment.name, source: garment.source },
    });
  } catch (err) {
    if (err instanceof RecommendError && err.code === "missing_measurements") {
      return reply({ ok: false, error: "missing_measurements", message: err.message }, 422);
    }
    throw err;
  }
}
