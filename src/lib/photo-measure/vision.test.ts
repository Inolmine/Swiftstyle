import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { measureInBrowser } from "./browser";
import { MEDIAPIPE_VERSION, POSE_MODEL_FILE, disableUsageLogging, visionUrl } from "./vision";

describe("fichiers de MediaPipe", () => {
  it("ont pour dossier la version installée de @mediapipe/tasks-vision", async () => {
    const pkg = JSON.parse(await readFile("node_modules/@mediapipe/tasks-vision/package.json", "utf8")) as { version: string };
    expect(MEDIAPIPE_VERSION).toBe(pkg.version);
    expect(visionUrl()).toBe(`/mediapipe/${pkg.version}`);
    expect(visionUrl("https://swiftstyle.example/")).toBe(`https://swiftstyle.example/mediapipe/${pkg.version}`);
  });

  it("comprennent le modèle préparé par scripts/prepare-mediapipe.mjs", async () => {
    expect(await readFile("scripts/prepare-mediapipe.mjs", "utf8")).toContain(`file: "${POSE_MODEL_FILE}"`);
  });
});

describe("statistiques d'utilisation de MediaPipe", () => {
  // Même forme que le journal de MediaPipe : une file, un envoi toutes les minutes vers odml.pa.googleapis.com.
  class FakeLogger {
    queue: unknown[] = [];
    sent = 0;
    error?: Error;
    timer: ReturnType<typeof setInterval> | undefined = setInterval(() => this.flush(), 60_000);
    flush() {
      if (this.error) return;
      if (this.queue.length) this.sent += this.queue.splice(0).length;
      void "https://odml.pa.googleapis.com/v1/log";
    }
    close() {
      clearInterval(this.timer);
      this.timer = undefined;
      this.flush();
    }
  }

  it("coupe le journal, rangé deux niveaux sous la tâche, avant tout envoi", () => {
    const logger = new FakeLogger();
    logger.queue.push("création de la tâche");
    const task = { graph: { heap: new Uint8Array(16) }, runner: { stats: logger } };
    expect(disableUsageLogging(task)).toBe(true);
    expect(logger.error).toBeInstanceOf(Error);
    expect(logger.timer).toBeUndefined();
    logger.flush();
    expect(logger.sent).toBe(0);
  });

  it("le dit quand il ne le trouve pas", () => {
    expect(disableUsageLogging({ runner: { flush() {} } })).toBe(false);
  });
});

describe("measureInBrowser", () => {
  it("refuse une taille hors limites avant de charger MediaPipe", async () => {
    const front = new File([new Uint8Array(1)], "face.jpg", { type: "image/jpeg" });
    await expect(measureInBrowser({ front, heightCm: 90 })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
