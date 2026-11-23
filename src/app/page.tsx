import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { EmbedCode } from "@/components/landing/EmbedCode";
import { crumpleBackground } from "@/components/landing/figures";
import { Hero } from "@/components/landing/Hero";
import { PhotoSteps } from "@/components/landing/PhotoSteps";
import { ReturnCosts } from "@/components/landing/ReturnCosts";
import { ReturnsBanner } from "@/components/landing/ReturnsBanner";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SvgDefs } from "@/components/landing/SvgDefs";
import { TrialSignup } from "@/components/landing/TrialSignup";
import { WidgetDemo } from "@/components/landing/WidgetDemo";
import "@/components/landing/landing.css";

const title = "SwiftStyle : la bonne taille dès la première commande";
const description =
  "Un widget qui conseille la bonne taille à vos clients à partir d'une photo. Moins d'erreurs de taille, moins de retours.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, siteName: "SwiftStyle", locale: "fr_FR", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function HomePage() {
  return (
    <>
      <SvgDefs />
      <SiteHeader />
      <main id="top" style={{ "--crumple": crumpleBackground() } as CSSProperties}>
        <Hero />
        <ReturnsBanner />
        <ReturnCosts />
        <PhotoSteps />
        <WidgetDemo />
        <EmbedCode />
        <TrialSignup />
      </main>
      <SiteFooter />
    </>
  );
}
