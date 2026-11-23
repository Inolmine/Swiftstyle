import { HeroDemo } from "./HeroDemo";

export function Hero() {
  return (
    <section className="hero crumple" aria-labelledby="hero-title">
      <HeroDemo />
      <p className="sr">
        SwiftStyle ajoute à vos fiches produit un widget qui conseille la bonne taille à partir d&apos;une photo : le client indique sa
        taille, l&apos;analyse mesure le reste. Il commande juste, et le colis ne revient pas.
      </p>
    </section>
  );
}
