import { afterEach, describe, expect, it, vi } from "vitest";
import { photoApiUrl } from "@/lib/photo-api-url";
import { WidgetConfigSchema } from "@/lib/widget-config";
import { GET, OPTIONS } from "./route";

describe("GET /api/v1/widget", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("répond à tous les sites, sans cache, sans API photo par défaut", async () => {
    vi.stubEnv("PHOTO_API_URL", "");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(WidgetConfigSchema.parse(await res.json())).toEqual({ ok: true, photoApiUrl: null });
  });

  it("donne l'adresse de l'API photo de PHOTO_API_URL, lue à chaque requête", async () => {
    vi.stubEnv("PHOTO_API_URL", " https://api.swiftstyle.example/ ");
    expect(await GET().json()).toEqual({ ok: true, photoApiUrl: "https://api.swiftstyle.example" });
  });

  it("ignore une adresse invalide", () => {
    for (const raw of ["api.swiftstyle.example", "ftp://api.example", "javascript:alert(1)", undefined]) expect(photoApiUrl(raw)).toBeNull();
  });

  it("répond à la vérification CORS", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
