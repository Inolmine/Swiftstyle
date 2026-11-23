import { describe, expect, it } from "vitest";
import { MEDIAPIPE_VERSION } from "@/lib/photo-measure/vision";
import { WIDGET_RETRY } from "@/lib/widget-embed";
import { connect } from "./connect";

const SITE = "https://swiftstyle.example";
const API = "https://api.swiftstyle.example";
const CONFIG_URL = `${SITE}/api/v1/widget`;
const HEALTH_URL = `${API}/health`;
const VISION = `${SITE}/mediapipe/${MEDIAPIPE_VERSION}`;
const MODEL_URL = `${VISION}/pose_landmarker_full.task`;
const RECOMMEND = `${SITE}/api/v1/recommend`;

type Reply = Response | Error | "hang";

/** Faux fetch : pour chaque adresse, les réponses successives (la dernière se répète). */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const list = replies[url] ?? [new Error("adresse inconnue")];
    const reply = list.length > 1 ? list.shift()! : list[0]!;
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (reply instanceof Error) throw reply;
    return reply.clone();
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const NO_API = json({ ok: true, photoApiUrl: null });
const WITH_API = json({ ok: true, photoApiUrl: API });
const HEALTHY = json({ status: "ok", model: "pose_landmarker_full.task", modelReady: true });
const MODEL_OK = new Response(null, { status: 200 });
const DOWN = new TypeError("Failed to fetch");

function run(replies: Record<string, Reply[]>, opts: { timeoutMs?: number; supported?: () => boolean } = {}) {
  const { fetch, calls } = fakeFetch(replies);
  const waits: number[] = [];
  const failures: string[] = [];
  const apiDown: string[] = [];
  const result = connect(SITE, {
    fetch,
    supported: () => true,
    ...opts,
    sleep: async (ms) => void waits.push(ms),
    onFailure: (_, reason) => failures.push(reason),
    onApiUnavailable: (url) => apiDown.push(url),
  });
  return { result, calls, waits, failures, apiDown };
}

describe("connexion du widget", () => {
  it("mesure par l'API photo quand elle répond : rien de lourd à charger", async () => {
    const r = run({ [CONFIG_URL]: [WITH_API], [HEALTH_URL]: [HEALTHY] });
    expect(await r.result).toEqual({ mode: "api", photoApiUrl: API, visionUrl: VISION, recommendUrl: RECOMMEND });
    expect(r.calls).toEqual([`GET ${CONFIG_URL}`, `GET ${HEALTH_URL}`]);
  });

  it("passe au navigateur quand l'API ne répond pas à ce site (panne, CORS, modèle absent)", async () => {
    for (const health of [DOWN, json({}, 503), json({ status: "ok", modelReady: false })]) {
      const r = run({ [CONFIG_URL]: [WITH_API], [HEALTH_URL]: [health], [MODEL_URL]: [MODEL_OK] });
      expect(await r.result).toEqual({ mode: "browser", photoApiUrl: null, visionUrl: VISION, recommendUrl: RECOMMEND });
      expect(r.apiDown).toEqual([API]);
      expect(r.waits).toEqual([]);
    }
  });

  it("mesure dans le navigateur quand le site ne donne pas d'API", async () => {
    const r = run({ [CONFIG_URL]: [NO_API], [MODEL_URL]: [MODEL_OK] });
    expect((await r.result)?.mode).toBe("browser");
    expect(r.calls).toEqual([`GET ${CONFIG_URL}`, `HEAD ${MODEL_URL}`]);
    expect(r.apiDown).toEqual([]);
  });

  it("recommence après des échecs du site, en attendant de plus en plus, puis réussit", async () => {
    const r = run({ [CONFIG_URL]: [DOWN, json({}, 503), NO_API], [MODEL_URL]: [MODEL_OK] });
    expect(await r.result).not.toBeNull();
    expect(r.waits).toEqual([1000, 2000]);
    expect(r.failures).toEqual([`site SwiftStyle injoignable (${CONFIG_URL})`, "site SwiftStyle : erreur 503"]);
  });

  it(`abandonne après ${WIDGET_RETRY.attempts} tentatives : le widget ne s'affiche pas`, async () => {
    const r = run({ [CONFIG_URL]: [DOWN] });
    expect(await r.result).toBeNull();
    expect(r.calls).toHaveLength(WIDGET_RETRY.attempts);
    expect(r.waits).toEqual([1000, 2000, 4000]);
  });

  it("ne s'affiche pas sans API si les fichiers de MediaPipe manquent ou refusent le site de la marque (CORS)", async () => {
    for (const reply of [DOWN, new Response(null, { status: 404 })]) {
      const r = run({ [CONFIG_URL]: [NO_API], [MODEL_URL]: [reply] });
      expect(await r.result).toBeNull();
      expect(r.failures.at(-1)).toMatch(/^fichiers de MediaPipe/);
    }
  });

  it("ne s'affiche pas si l'API ne répond pas et que le navigateur ne sait pas faire tourner la mesure", async () => {
    const r = run({ [CONFIG_URL]: [WITH_API], [HEALTH_URL]: [DOWN] }, { supported: () => false });
    expect(await r.result).toBeNull();
    expect(r.failures.at(-1)).toBe("API photo injoignable et ce navigateur ne sait pas faire tourner la mesure (WebAssembly)");
    expect(r.calls.some((c) => c.startsWith("HEAD"))).toBe(false);
  });

  it("mesure par l'API même dans un navigateur sans WebAssembly", async () => {
    const r = run({ [CONFIG_URL]: [WITH_API], [HEALTH_URL]: [HEALTHY] }, { supported: () => false });
    expect((await r.result)?.mode).toBe("api");
  });

  it("refuse une réponse du site qui n'a pas la forme attendue", async () => {
    for (const config of [{}, { ok: false, photoApiUrl: null }, { ok: true }, { ok: true, photoApiUrl: "javascript:alert(1)" }]) {
      const r = run({ [CONFIG_URL]: [json(config)], [MODEL_URL]: [MODEL_OK] });
      expect(await r.result).toBeNull();
      expect(r.calls.every((c) => c === `GET ${CONFIG_URL}`)).toBe(true);
    }
  });

  it("abandonne une requête au site qui ne répond pas à temps", async () => {
    const r = run({ [CONFIG_URL]: ["hang", NO_API], [MODEL_URL]: [MODEL_OK] }, { timeoutMs: 20 });
    expect(await r.result).not.toBeNull();
    expect(r.failures).toEqual(["site SwiftStyle : pas de réponse en 0.02 s"]);
  });
});
