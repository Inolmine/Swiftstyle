import { PHOTO_ZONES, type InseamLine, type MeasuredLine, type PhotoMeasurement, type PhotoZone } from "./types";

export function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export type PhotoLines = Record<PhotoZone, MeasuredLine>;

export interface EditedLines {
  front: PhotoLines;
  side: PhotoLines | null;
  inseam: InseamLine;
}

export interface AdjustedZone {
  circumference: number;
  width: number;
  depth: number;
  edited: boolean;
}

export interface AdjustedMeasurement {
  measurements: Record<PhotoZone | "inseam", number>;
  zones: Record<PhotoZone, AdjustedZone>;
  inseam: { length: number; edited: boolean };
  edited: boolean;
}

export function initialLines(data: PhotoMeasurement): EditedLines {
  return {
    front: { ...data.front.lines },
    side: data.side ? { ...data.side.lines } : null,
    inseam: { ...data.front.inseam! },
  };
}

const span = (l: MeasuredLine) => l.x2 - l.x1;

const sameSpan = (a: MeasuredLine, b: MeasuredLine) => a.x1 === b.x1 && a.x2 === b.x2;

const rescale = (cm: number, before: MeasuredLine, after: MeasuredLine) => (span(before) > 0 ? (cm * span(after)) / span(before) : cm);

const round1 = (v: number) => Math.round(v * 10) / 10;

function adjustInseam(data: PhotoMeasurement, line: InseamLine): { length: number; edited: boolean } {
  const api = data.measurements.inseam;
  const original = data.front.inseam;
  if (!original || (line.y1 === original.y1 && line.y2 === original.y2)) return { length: api, edited: false };
  const before = original.y2 - original.y1;
  return { length: before > 0 ? Math.round((api * (line.y2 - line.y1)) / before) : api, edited: true };
}

export function adjustMeasurement(data: PhotoMeasurement, lines: EditedLines): AdjustedMeasurement {
  const zones = {} as Record<PhotoZone, AdjustedZone>;
  for (const key of PHOTO_ZONES) {
    const api = data.zones[key];
    const frontEdited = !sameSpan(lines.front[key], data.front.lines[key]);
    const sideEdited = Boolean(data.side && lines.side && !sameSpan(lines.side[key], data.side.lines[key]));

    if (!frontEdited && !sideEdited) {
      zones[key] = { ...api, edited: false };
      continue;
    }

    const width = rescale(api.width, data.front.lines[key], lines.front[key]);
    const depth =
      data.depthSource === "profile" && data.side && lines.side
        ? rescale(api.depth, data.side.lines[key], lines.side[key])
        :
          api.width > 0
          ? (width * api.depth) / api.width
          : api.depth;
    zones[key] = {
      circumference: Math.round(ellipsePerimeter(width / 2, depth / 2)),
      width: round1(width),
      depth: round1(depth),
      edited: true,
    };
  }

  const inseam = adjustInseam(data, lines.inseam);
  const measurements = { inseam: inseam.length } as Record<PhotoZone | "inseam", number>;
  for (const key of PHOTO_ZONES) measurements[key] = zones[key].circumference;
  return { measurements, zones, inseam, edited: inseam.edited || PHOTO_ZONES.some((k) => zones[k].edited) };
}
