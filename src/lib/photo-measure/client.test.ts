import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE } from "./example";
import { measureFromPhotos } from "./index";

const front = new File([new Uint8Array(1)], "face.jpg", { type: "image/jpeg" });
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("measureFromPhotos", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie la taille et les photos, et rend la réponse de l'API", async () => {
    const fetch = reply(200, EXAMPLE);
    vi.stubGlobal("fetch", fetch);
    expect(await measureFromPhotos({ front, heightCm: 178 }, "https://api.example")).toEqual(EXAMPLE);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/photo/measure");
    const body = init.body as FormData;
    expect(body.get("heightCm")).toBe("178");
    expect(body.get("front")).toBeInstanceOf(File);
    expect(body.has("side")).toBe(false);
  });

  it("refuse une taille hors limites sans appeler l'API", async () => {
    const fetch = reply(200, EXAMPLE);
    vi.stubGlobal("fetch", fetch);
    await expect(measureFromPhotos({ front, heightCm: 90 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reprend le code et le message d'une erreur de l'API", async () => {
    vi.stubGlobal("fetch", reply(422, { error: "no_person", message: "Aucune personne détectée sur la photo." }));
    await expect(measureFromPhotos({ front, heightCm: 178 })).rejects.toMatchObject({
      code: "no_person",
      message: "Aucune personne détectée sur la photo.",
    });
  });

  it("traduit une erreur de validation de FastAPI", async () => {
    vi.stubGlobal("fetch", reply(422, { detail: [{ msg: "Input should be less than or equal to 210" }] }));
    await expect(measureFromPhotos({ front, heightCm: 178 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("signale une API injoignable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(measureFromPhotos({ front, heightCm: 178 })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("refuse une réponse qui n'a plus la forme attendue", async () => {
    vi.stubGlobal("fetch", reply(200, { ...EXAMPLE, measurements: { chest: 92 } }));
    await expect(measureFromPhotos({ front, heightCm: 178 })).rejects.toMatchObject({ code: "unexpected_response" });
  });
});
