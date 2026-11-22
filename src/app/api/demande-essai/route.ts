import { clientIp, rateLimit } from "@/lib/http";
import { TrialRequestSchema, type TrialResponse } from "@/lib/trial-request";

export const dynamic = "force-dynamic";

const reply = (body: TrialResponse, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  if (!rateLimit(`demande:${clientIp(req)}`, 5, 10 * 60_000)) return reply({ ok: false, error: "rate_limited" }, 429);

  const parsed = TrialRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return reply({ ok: false, error: "invalid_input" }, 400);
  const input = parsed.data;

  if (input.societe) return reply({ ok: true });

  const row = {
    date: new Date().toISOString(),
    marque: input.brand,
    siteWeb: input.site,
    nom: input.name,
    email: input.email,
    plateforme: input.platform,
    volume: input.volume,
    message: input.message,
    source: input.source,
    referrer: input.referrer,
  };

  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") return reply({ ok: false, error: "not_configured" }, 503);
    console.info("[demande-essai] GOOGLE_SHEETS_WEBHOOK_URL vide, mode démo : rien n'est envoyé.", row);
    return reply({ ok: true, mode: "demo" });
  }

  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(row) });
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || data?.ok === false) throw new Error(`Google Sheets a refusé la demande (HTTP ${res.status})`);
    return reply({ ok: true });
  } catch (err) {
    console.error("[demande-essai]", err);
    return reply({ ok: false, error: "upstream" }, 502);
  }
}
