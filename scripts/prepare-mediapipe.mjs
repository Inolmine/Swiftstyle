// Prépare les fichiers de MediaPipe servis par le site, dans public/mediapipe/<version>/ (non versionné) :
// le moteur WASM, copié depuis node_modules/@mediapipe/tasks-vision, et le modèle de pose, téléchargé chez Google.
// La mesure des photos tourne dans le navigateur du client avec ces fichiers (src/lib/photo-measure/vision.ts).
// Lancé avant `next dev` et `next build` (scripts predev et prebuild de package.json).
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "node_modules", "@mediapipe", "tasks-vision");
const OUT_ROOT = join(ROOT, "public", "mediapipe");

const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

// Le même modèle que l'API photo (projet swiftstyle-api, scripts/download_model.py) : « latest » à la date du portage.
// Son empreinte est vérifiée, pour qu'un changement chez Google ne passe pas inaperçu.
const MODEL = {
  file: "pose_landmarker_full.task",
  url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  sha256: "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad",
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function model() {
  const target = join(OUT, MODEL.file);
  const existing = await readFile(target).catch(() => null);
  if (existing && sha256(existing) === MODEL.sha256) return "déjà là";

  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`téléchargement du modèle impossible (HTTP ${res.status}) : ${MODEL.url}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha256(data) !== MODEL.sha256) {
    throw new Error(
      `le modèle publié par Google a changé (empreinte ${sha256(data)}). Vérifier qu'il convient, puis mettre à jour MODEL.sha256 ` +
        "dans scripts/prepare-mediapipe.mjs, et SHA256 dans scripts/download_model.py de l'API photo.",
    );
  }
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  return "téléchargé";
}

const { version } = JSON.parse(await readFile(join(PACKAGE, "package.json"), "utf8"));
const OUT = join(OUT_ROOT, version);

try {
  await mkdir(OUT, { recursive: true });
  for (const dir of await readdir(OUT_ROOT)) if (dir !== version) await rm(join(OUT_ROOT, dir), { recursive: true, force: true });
  for (const file of WASM_FILES) await copyFile(join(PACKAGE, "wasm", file), join(OUT, file));
  const source = await model();
  console.log(`MediaPipe ${version} prêt dans public/mediapipe/${version} (modèle : ${source}).`);
} catch (err) {
  console.error(`MediaPipe : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
