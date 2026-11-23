import { afterEach, describe, expect, it, vi } from "vitest";
import { measureViaApi } from "./api";
import * as browser from "./browser";
import { EXAMPLE } from "./example";
import { createMeasurer, findPhotoApi } from "./measurer";
import { MeasureError } from "./types";

const API = "https://api.swiftstyle.example";
const front = new File([new Uint8Array(1)], "face.jpg", { type: "image/jpeg" });
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Faux fetch : la réponse dépend de l'adresse ; les appels sont notés. */
function fakeFetch(route: (url: string) => Response | Error) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    calls.push(String(input));
    const reply = route(String(input));
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetch, calls };
}

describe("mesure par l'API photo", () => {
  it("envoie la taille et les photos, et rend la réponse de l'API", async () => {
    let body: FormData | undefined;
    const fetch: typeof globalThis.fetch = async (_, init) => {
      body = init?.body as FormData;
      return json(EXAMPLE);
    };
    expect(await measureViaApi(API, { front, heightCm: 178 }, fetch)).toEqual(EXAMPLE);
    expect(body?.get("heightCm")).toBe("178");
    expect(body?.get("front")).toBeInstanceOf(File);
    expect(body?.has("side")).toBe(false);
  });

  it("reprend le code et le message d'une erreur de la photo", async () => {
    const { fetch } = fakeFetch(() => json({ error: "no_person", message: "Aucune personne détectée sur la photo." }, 422));
    await expect(measureViaApi(API, { front, heightCm: 178 }, fetch)).rejects.toMatchObject({ code: "no_person" });
  });

  it("dit l'API en panne quand elle ne répond pas, renvoie 5xx ou 429, ou une réponse inattendue", async () => {
    const replies = [new TypeError("Failed to fetch"), json({}, 502), json({ error: "rate_limited" }, 429), json({ ...EXAMPLE, measurements: {} })];
    for (const reply of replies) {
      const { fetch } = fakeFetch(() => reply);
      const err = await measureViaApi(API, { front, heightCm: 178 }, fetch).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MeasureError);
      expect(["unreachable", "unexpected_response"]).toContain((err as MeasureError).code);
    }
  });
});

describe("choix entre l'API et le navigateur", () => {
  afterEach(() => vi.restoreAllMocks());

  it("trouve l'API donnée par le site si elle répond, sinon rien", async () => {
    const up = fakeFetch((url) => (url.endsWith("/api/v1/widget") ? json({ ok: true, photoApiUrl: API }) : json({ status: "ok", modelReady: true })));
    expect(await findPhotoApi("https://site.example", up.fetch)).toBe(API);
    expect(up.calls).toEqual(["https://site.example/api/v1/widget", `${API}/health`]);

    const down = fakeFetch((url) => (url.endsWith("/api/v1/widget") ? json({ ok: true, photoApiUrl: API }) : new TypeError("CORS")));
    expect(await findPhotoApi("https://site.example", down.fetch)).toBeNull();

    const none = fakeFetch(() => json({ ok: true, photoApiUrl: null }));
    expect(await findPhotoApi("", none.fetch)).toBeNull();
    expect(none.calls).toEqual(["/api/v1/widget"]);
  });

  it("mesure par l'API sans charger MediaPipe", async () => {
    const local = vi.spyOn(browser, "measureInBrowser");
    const preload = vi.spyOn(browser, "preloadVision");
    const { fetch } = fakeFetch(() => json(EXAMPLE));
    const m = createMeasurer({ photoApiUrl: API, fetch });
    expect(await m.mode()).toBe("api");
    await m.preload();
    expect(await m.measure({ front, heightCm: 178 })).toEqual(EXAMPLE);
    expect(local).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });

  it("passe au navigateur si l'API tombe, et y reste", async () => {
    vi.spyOn(browser, "measureInBrowser").mockResolvedValue(EXAMPLE);
    const fallbacks: string[] = [];
    const { fetch, calls } = fakeFetch(() => new TypeError("Failed to fetch"));
    const m = createMeasurer({ photoApiUrl: API, fetch, onFallback: (r) => fallbacks.push(r) });
    expect(await m.measure({ front, heightCm: 178 })).toEqual(EXAMPLE);
    expect(await m.mode()).toBe("browser");
    await m.measure({ front, heightCm: 178 });
    expect(calls).toHaveLength(1);
    expect(fallbacks).toEqual([`API photo injoignable (${API}/v1/photo/measure).`]);
  });

  it("ne passe pas au navigateur pour une erreur de la photo", async () => {
    const local = vi.spyOn(browser, "measureInBrowser");
    const { fetch } = fakeFetch(() => json({ error: "body_not_fully_visible", message: "Les pieds ne sont pas visibles." }, 422));
    const m = createMeasurer({ photoApiUrl: API, fetch });
    await expect(m.measure({ front, heightCm: 178 })).rejects.toMatchObject({ code: "body_not_fully_visible" });
    expect(local).not.toHaveBeenCalled();
    expect(await m.mode()).toBe("api");
  });

  it("refuse une taille hors limites sans rien demander", async () => {
    const { fetch, calls } = fakeFetch(() => json(EXAMPLE));
    const m = createMeasurer({ photoApiUrl: API, fetch });
    await expect(m.measure({ front, heightCm: 90 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls).toEqual([]);
  });

  it("mesure dans le navigateur sans API", async () => {
    const local = vi.spyOn(browser, "measureInBrowser").mockResolvedValue(EXAMPLE);
    const m = createMeasurer({ photoApiUrl: null });
    expect(await m.mode()).toBe("browser");
    expect(await m.measure({ front, heightCm: 178 })).toEqual(EXAMPLE);
    expect(local).toHaveBeenCalledOnce();
  });
});
