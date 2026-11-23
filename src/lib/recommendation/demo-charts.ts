import GUIDES from "./guides-des-tailles.json";
import type { MeasureKey, SizeChart } from "./types";

export type DemoArticle = "tee" | "jean" | "sweat";

const BODY_FIELDS: Record<string, MeasureKey> = {
  tour_poitrine: "chest",
  tour_taille: "waist",
  tour_hanches: "hips",
  tour_cuisse: "thigh",
  entrejambe: "inseam",
};

interface Guide {
  nom: string;
  tailles: Record<string, { mensurations_corps_recommandees: Record<string, number[]> }>;
}

/** Guide des tailles de guides-des-tailles.json : les intervalles de mensurations du corps, taille par taille. */
export function chartFromGuide(guide: Guide, weights: SizeChart["weights"]): SizeChart {
  const ranges: SizeChart["ranges"] = {};
  for (const [size, { mensurations_corps_recommandees: body }] of Object.entries(guide.tailles)) {
    for (const [field, range] of Object.entries(body)) {
      const key = BODY_FIELDS[field];
      const [min, max] = range;
      if (!key) throw new Error(`${guide.nom}, taille ${size} : mensuration inconnue « ${field} »`);
      if (range.length !== 2 || min === undefined || max === undefined) throw new Error(`${guide.nom}, taille ${size} : ${field} n'est pas un intervalle [min, max]`);
      (ranges[key] ??= []).push([min, max]);
    }
  }
  return { sizes: Object.keys(guide.tailles), ranges, weights };
}

const { t_shirt, jean, sweat } = GUIDES.articles;

export const DEMO_ARTICLES: Record<DemoArticle, { name: string; externalId: string; chart: SizeChart }> = {
  tee: {
    name: t_shirt.nom,
    externalId: "demo-tee",
    chart: chartFromGuide(t_shirt, { chest: 0.75, waist: 0.25 }),
  },
  jean: {
    name: jean.nom,
    externalId: "demo-jean",
    chart: chartFromGuide(jean, { waist: 0.45, hips: 0.3, thigh: 0.15, inseam: 0.1 }),
  },
  sweat: {
    name: sweat.nom,
    externalId: "demo-sweat",
    chart: chartFromGuide(sweat, { chest: 0.8, waist: 0.2 }),
  },
};
