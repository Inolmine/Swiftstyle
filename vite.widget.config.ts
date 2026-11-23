// Compile le widget des sites des marques (src/widget/embed.ts) en un seul fichier, public/widget/v1.js,
// servi par le site. Lancé avant `next dev` et `next build` (scripts predev et prebuild de package.json).
// MediaPipe y est inclus (son code JavaScript) ; son moteur WASM et le modèle sont lus à part, sur le site.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Le code partagé avec Next peut lire process.env, qui n'existe pas dans le navigateur.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: "public/widget",
    emptyOutDir: true,
    target: "es2020",
    lib: { entry: "src/widget/embed.ts", formats: ["iife"], name: "SwiftStyleWidget", fileName: () => "v1.js" },
  },
});
