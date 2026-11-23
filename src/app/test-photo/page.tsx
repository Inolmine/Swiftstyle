import type { Metadata } from "next";
import { PhotoTest } from "@/components/photo-test/PhotoTest";
import "@/components/photo-test/photo-test.css";

export const metadata: Metadata = {
  title: "Test de la mesure sur photo · SwiftStyle",
  robots: { index: false, follow: false },
};

export default function PhotoTestPage() {
  return <PhotoTest />;
}
