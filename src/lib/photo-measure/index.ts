// Mesure du corps sur photo : par l'API photo (projet swiftstyle-api) quand elle répond, sinon dans le navigateur
// du client (MediaPipe et la méthode de l'API portée en TypeScript). createMeasurer() choisit.
export * from "./types";
export { adjustMeasurement, ellipsePerimeter, initialLines, type AdjustedMeasurement, type EditedLines, type PhotoLines } from "./adjust";
export { MEDIAPIPE_VERSION, visionUrl } from "./vision";
export { checkPoseViaApi, measureViaApi, photoApiHealth } from "./api";
export { checkPoseInBrowser, measureInBrowser, preloadVision, type VisionOptions } from "./browser";
/** Anciens noms de la mesure dans le navigateur, que l'extension utilise (swiftstyle.fr-web-extension/build/). */
export { checkPoseInBrowser as checkPose, measureInBrowser as measureFromPhotos } from "./browser";
export { createMeasurer, findPhotoApi, type MeasureMode, type Measurer, type MeasurerOptions } from "./measurer";
