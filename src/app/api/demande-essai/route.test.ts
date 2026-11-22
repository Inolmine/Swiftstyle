import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIAL_EXAMPLE } from "@/lib/trial-request";
import { POST } from "./route";

const post = (body: unknown, ip: string) =>
  POST(
    new Request("http://localhost/api/demande-essai", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/demande-essai", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("accepte l'exemple de la documentation (mode démo, sans Google Sheet)", async () => {
    vi.stubEnv("GOOGLE_SHEETS_WEBHOOK_URL", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await post(TRIAL_EXAMPLE, "203.0.113.1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "demo" });
  });

  it("refuse une adresse e-mail invalide", async () => {
    const res = await post({ ...TRIAL_EXAMPLE, email: "pas-une-adresse" }, "203.0.113.2");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_input" });
  });

  it("ignore un robot qui remplit le piège, sans le lui dire", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await post({ ...TRIAL_EXAMPLE, societe: "Robot SA" }, "203.0.113.3");
    expect(await res.json()).toEqual({ ok: true });
    expect(info).not.toHaveBeenCalled();
  });

  it("limite à 5 demandes en 10 minutes par adresse", async () => {
    vi.stubEnv("GOOGLE_SHEETS_WEBHOOK_URL", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) expect((await post(TRIAL_EXAMPLE, "203.0.113.4")).status).toBe(200);
    expect((await post(TRIAL_EXAMPLE, "203.0.113.4")).status).toBe(429);
  });
});
