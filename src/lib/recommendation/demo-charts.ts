import type { SizeChart } from "./types";

export type DemoArticle = "tee" | "jean" | "veste";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export const DEMO_ARTICLES: Record<DemoArticle, { name: string; category: string; externalId: string; chart: SizeChart }> = {
  tee: {
    name: "T-shirt en coton",
    category: "tshirt",
    externalId: "demo-tee",
    chart: {
      sizes: SIZES,
      ranges: {
        chest: [[78, 84], [84, 90], [90, 97], [97, 104], [104, 112], [112, 120]],
        waist: [[64, 70], [70, 77], [77, 84], [84, 92], [92, 100], [100, 110]],
      },
      weights: { chest: 0.75, waist: 0.25 },
    },
  },
  jean: {
    name: "Jean droit",
    category: "jean",
    externalId: "demo-jean",
    chart: {
      sizes: SIZES,
      ranges: {
        waist: [[62, 68], [68, 74], [74, 81], [81, 88], [88, 96], [96, 104]],
        hips: [[84, 90], [90, 96], [96, 102], [102, 108], [108, 115], [115, 122]],
        thigh: [[46, 50], [50, 54], [54, 58], [58, 62], [62, 67], [67, 72]],
        inseam: [[74, 78], [76, 80], [78, 82], [79, 83], [80, 84], [81, 85]],
      },
      weights: { waist: 0.45, hips: 0.3, thigh: 0.15, inseam: 0.1 },
    },
  },
  veste: {
    name: "Veste en laine",
    category: "veste",
    externalId: "demo-veste",
    chart: {
      sizes: SIZES,
      ranges: {
        chest: [[80, 86], [86, 92], [92, 99], [99, 106], [106, 114], [114, 122]],
        waist: [[66, 72], [72, 79], [79, 86], [86, 94], [94, 102], [102, 112]],
      },
      weights: { chest: 0.8, waist: 0.2 },
    },
  },
};
