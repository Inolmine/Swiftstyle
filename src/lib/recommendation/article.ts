import type { DemoArticle } from "./demo-charts";
import type { SizeChart } from "./types";

export interface ProductInfo {
  title?: string;
  category?: string;
  url?: string;
}

const SWEAT = /\b(sweats?|sweat-?shirts?|hoodies?|capuches?|pulls?|pull-?overs?|sweaters?)\b/i;
const JACKET = /\b(vestes?|blazers?|manteaux|manteau|blousons?|parkas?|doudounes?|trench|cabans?|bombers?|jackets?|coats?|anoraks?)\b/i;
const TROUSERS = /\b(jeans?|denim|pantalons?|chinos?|trousers?|pants|joggers?|joggings?|leggings?|bermudas?|cargos?|salopettes?)\b/i;

export function articleFor(product: ProductInfo): DemoArticle {
  for (const text of [product.category, product.title, product.url?.replace(/[-_/]+/g, " ")]) {
    if (!text) continue;
    if (SWEAT.test(text) || JACKET.test(text)) return "sweat";
    if (TROUSERS.test(text)) return "jean";
  }
  return "tee";
}

export function normalizeSize(label: string): string {
  const s = label.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^(\d)XL$/.exec(s);
  return m ? `${"X".repeat(Number(m[1]))}L` : s;
}

export function sizesOnPage(chart: SizeChart, pageSizes: readonly string[]): (string | undefined)[] {
  const byKey = new Map<string, string>();
  for (const label of pageSizes) {
    const key = normalizeSize(label);
    if (key && !byKey.has(key)) byKey.set(key, label.trim());
  }
  return chart.sizes.map((s) => byKey.get(normalizeSize(s)));
}
