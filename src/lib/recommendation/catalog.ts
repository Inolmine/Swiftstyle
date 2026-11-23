import { articleFor, type ProductInfo } from "./article";
import { DEMO_ARTICLES } from "./demo-charts";
import type { SizeChart } from "./types";

export interface Garment {
  id: string;
  shop?: string;
  name: string;
  chart: SizeChart;
}

export const GARMENTS: Garment[] = Object.values(DEMO_ARTICLES).map((a) => ({ id: a.externalId, name: a.name, chart: a.chart }));

export function shopKey(shop: string | undefined): string {
  return (shop ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/:].*$/, "")
    .replace(/^www\./, "");
}

export function findGarment(id: string, shop?: string, catalog: readonly Garment[] = GARMENTS): Garment | undefined {
  const key = id.trim();
  const site = shopKey(shop);
  return (
    catalog.find((g) => g.id === key && g.shop !== undefined && shopKey(g.shop) === site) ??
    catalog.find((g) => g.id === key && g.shop === undefined)
  );
}

export interface ResolvedGarment {
  id: string;
  name: string;
  chart: SizeChart;
  source: "catalog" | "inferred";
}

export function resolveGarment(input: ProductInfo & { id: string; shop?: string }, catalog: readonly Garment[] = GARMENTS): ResolvedGarment {
  const known = findGarment(input.id, input.shop, catalog);
  if (known) return { id: known.id, name: known.name, chart: known.chart, source: "catalog" };
  const article = DEMO_ARTICLES[articleFor(input)];
  return { id: input.id.trim(), name: article.name, chart: article.chart, source: "inferred" };
}
