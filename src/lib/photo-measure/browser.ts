// Mesure dans le navigateur du client : MediaPipe (vision.ts), puis la méthode de l'API photo portée en TypeScript
// (measure.ts, framing.ts). Aucune image ne quitte l'appareil. Sert quand l'API photo n'est pas là (measurer.ts).
import { checkFraming } from "./framing";
import { measure, toPhotoMeasurement } from "./measure";
import { MeasureError, parseMeasureInput, type MeasureInput, type PhotoMeasurement, type PoseCheck, type PoseView } from "./types";
import { decodeImage, detectView, loadPoseLandmarker } from "./vision";

export interface VisionOptions {
  /** Dossier des fichiers de MediaPipe (visionUrl()). Par défaut, celui du site qui sert la page. */
  visionUrl?: string;
}

/** Côté de la photo analysée, en pixels (comme l'API photo). */
const MAX_SIDE = 1280;

/** Commence à charger MediaPipe, pour qu'il soit prêt quand la caméra s'allume. */
export function preloadVision(opts: VisionOptions = {}): Promise<void> {
  return loadPoseLandmarker(opts.visionUrl).then(() => undefined);
}

export async function measureInBrowser(input: MeasureInput, opts: VisionOptions = {}): Promise<PhotoMeasurement> {
  const { front, side, heightCm } = parseMeasureInput(input);
  const landmarker = await loadPoseLandmarker(opts.visionUrl);

  const read = async (file: Blob) => {
    let image: HTMLCanvasElement;
    try {
      image = await decodeImage(file, MAX_SIDE);
    } catch {
      throw new MeasureError("invalid_image", "Ce fichier n'est pas une image lisible (JPEG, PNG ou WebP).");
    }
    let view: ReturnType<typeof detectView>;
    try {
      view = detectView(landmarker, image);
    } catch {
      throw new MeasureError("engine_unavailable", "L'analyse de la photo a échoué sur cet appareil. Réessayez.");
    }
    if (!view) throw new MeasureError("no_person", "Aucune personne détectée sur la photo.");
    return view;
  };

  const frontView = await read(front);
  const sideView = side ? await read(side) : null;
  return toPhotoMeasurement(measure(heightCm, frontView, sideView));
}

/** Cadrage d'une image de la caméra (réduite à 640 px de côté) : la personne est-elle prête pour la photo attendue ? */
export async function checkPoseInBrowser(frame: HTMLCanvasElement | ImageBitmap, expect: PoseView, opts: VisionOptions = {}): Promise<PoseCheck> {
  const landmarker = await loadPoseLandmarker(opts.visionUrl);
  return checkFraming(detectView(landmarker, frame), expect);
}
