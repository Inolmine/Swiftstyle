// MediaPipe Pose Landmarker dans le navigateur du client : repères du corps et silhouette, sans envoyer d'image.
// Ses fichiers (moteur WASM, modèle) sont servis par le site à /mediapipe/<version>/ (scripts/prepare-mediapipe.mjs).
import type { ImageSource, PoseLandmarker, PoseLandmarkerOptions } from "@mediapipe/tasks-vision";
import type { View } from "./measure";
import { MeasureError } from "./types";

/** Version de @mediapipe/tasks-vision (package.json) : elle nomme le dossier des fichiers, gardés un an en cache. */
export const MEDIAPIPE_VERSION = "1.2.2";
export const POSE_MODEL_FILE = "pose_landmarker_full.task";

/** Dossier des fichiers de MediaPipe : sur le site lui-même par défaut, ou sur le site SwiftStyle (widget chez une marque). */
export const visionUrl = (origin = "") => `${origin.replace(/\/+$/, "")}/mediapipe/${MEDIAPIPE_VERSION}`;

const USAGE_LOG_HOST = "odml.pa.googleapis.com";

/**
 * MediaPipe envoie toutes les minutes à Google des statistiques d'utilisation (temps de calcul, nombre d'images ;
 * jamais les images), sans réglage pour l'éviter. On coupe son journal, retrouvé par l'adresse où il écrit :
 * marqué en erreur, il n'accumule plus rien et n'envoie plus rien. Renvoie false s'il n'a pas été trouvé.
 */
export function disableUsageLogging(task: object): boolean {
  const seen = new Set<object>();
  const visit = (o: unknown, depth: number): boolean => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return false;
    seen.add(o);
    const logger = o as { flush?: unknown; close?: unknown; error?: unknown };
    if (typeof logger.flush === "function" && String(logger.flush).includes(USAGE_LOG_HOST)) {
      logger.error = new Error("statistiques d'utilisation désactivées par SwiftStyle");
      if (typeof logger.close === "function") logger.close.call(o);
      return true;
    }
    return depth < 2 && Object.values(o).some((v) => visit(v, depth + 1));
  };
  return visit(task, 0);
}

const engines = new Map<string, Promise<PoseLandmarker>>();

/** Charge MediaPipe une fois par dossier (environ 24 Mo la première fois, puis depuis le cache du navigateur). */
export function loadPoseLandmarker(baseUrl = visionUrl()): Promise<PoseLandmarker> {
  let engine = engines.get(baseUrl);
  if (!engine) {
    engine = createLandmarker(baseUrl);
    engines.set(baseUrl, engine);
    engine.catch(() => engines.delete(baseUrl));
  }
  return engine;
}

async function createLandmarker(baseUrl: string): Promise<PoseLandmarker> {
  if (typeof WebAssembly !== "object") {
    throw new MeasureError("engine_unavailable", "Ce navigateur ne peut pas analyser les photos : utilisez un navigateur récent.");
  }
  try {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(baseUrl);
    const options = (delegate: "GPU" | "CPU"): PoseLandmarkerOptions => ({
      baseOptions: { modelAssetPath: `${baseUrl}/${POSE_MODEL_FILE}`, delegate },
      runningMode: "IMAGE",
      numPoses: 1,
      outputSegmentationMasks: true,
    });
    let landmarker: PoseLandmarker;
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      // Pas de WebGL utilisable : le processeur. Avec MediaPipe 1.2.2, il s'arrête net dès qu'on lui demande la
      // silhouette (vu dans Chromium) : l'essai ne coûte rien, mais la mesure demande en pratique la carte graphique.
      landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
    if (!disableUsageLogging(landmarker)) console.warn("SwiftStyle : les statistiques d'utilisation de MediaPipe n'ont pas pu être coupées.");
    return landmarker;
  } catch (err) {
    if (err instanceof MeasureError) throw err;
    throw new MeasureError("engine_unavailable", "L'analyse des photos n'a pas pu démarrer sur cet appareil. Vérifiez votre connexion, puis réessayez.");
  }
}

/** Repères et silhouette de la personne sur l'image ; null si personne n'est détecté. */
export function detectView(landmarker: PoseLandmarker, image: ImageSource): View | null {
  // Forme synchrone, qui copie les masques : avec la carte graphique, le masque lu dans le rappel de detect() est vide.
  const result = landmarker.detect(image);
  try {
    const points = result.landmarks[0];
    const mask = result.segmentationMasks?.[0];
    if (!points || !mask) return null;
    return {
      width: mask.width,
      height: mask.height,
      mask: mask.getAsFloat32Array().slice(),
      landmarks: points.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })),
    };
  } finally {
    result.close();
  }
}

/** Image d'un fichier, tournée selon ses données EXIF et réduite à `maxSide` pixels de côté, comme le faisait l'API. */
export async function decodeImage(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
