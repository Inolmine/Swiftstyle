// Cadrage en direct pour la prise de vue automatique : portage de swiftstyle-api/app/framing.py, dans le navigateur.
// Mêmes seuils et mêmes messages que l'API Python (tests repris de swiftstyle-api/tests/test_framing.py).
import {
  L_ANKLE,
  L_HIP,
  L_SHOULDER,
  L_WRIST,
  MIN_VISIBILITY,
  R_ANKLE,
  R_HIP,
  R_SHOULDER,
  R_WRIST,
  binarize,
  bodySpan,
  pyRound,
  type Landmark,
  type View,
} from "./measure";
import type { PoseCheck, PoseView } from "./types";

type Orientation = NonNullable<PoseCheck["orientation"]>;

const FRONT_MIN_SPREAD = 0.35;
const SIDE_MAX_SPREAD = 0.18;
const MIN_BODY_HEIGHT = 0.5;
const CENTER_RANGE = [0.2, 0.8] as const;
const ARMS_MIN_SPREAD = 0.7;
const FEET_MIN_SPREAD = 0.6;

export const MESSAGES = {
  no_person: "Placez-vous devant la caméra, de la tête aux pieds.",
  pose_not_detected: "Tenez-vous debout, bien droit, épaules et hanches visibles.",
  head_cut: "Reculez un peu : votre tête sort de l'image.",
  feet_cut: "Reculez : vos pieds doivent être visibles.",
  too_far: "Rapprochez-vous un peu de la caméra.",
  off_center: "Placez-vous au centre de l'image.",
  turn_front: "Placez-vous face à la caméra.",
  turn_side: "Tournez-vous de profil, sur le côté.",
  turn_more: "Encore un peu : tournez-vous complètement de profil.",
  ready: "Parfait, ne bougez plus.",
} as const;

export const TIPS = {
  arms: "Écartez un peu les bras du corps.",
  feet: "Écartez les pieds de la largeur des hanches.",
} as const;

const visible = (lm: Landmark[], i: number) => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY;
const at = (lm: Landmark[], i: number): Landmark => lm[i] ?? { x: 0, y: 0, visibility: 0 };

const landmarksOut = (lm: Landmark[]) => lm.map((p) => ({ x: pyRound(p.x, 4), y: pyRound(p.y, 4), visibility: pyRound(p.visibility, 3) }));

function notReady(
  view: View | null,
  issue: NonNullable<PoseCheck["issue"]>,
  message: string,
  orientation: Orientation | null = null,
  box: PoseCheck["box"] = null,
): PoseCheck {
  return { ready: false, orientation, issue, message, tips: [], box, landmarks: view ? landmarksOut(view.landmarks) : [] };
}

export function orientationOf(view: View): Orientation | null {
  const lm = view.landmarks;
  const { width: w, height: h } = view;
  if (lm.length < 33) return null;
  if (!((visible(lm, L_SHOULDER) || visible(lm, R_SHOULDER)) && (visible(lm, L_HIP) || visible(lm, R_HIP)))) return null;
  const shouldersY = ((at(lm, L_SHOULDER).y + at(lm, R_SHOULDER).y) / 2) * h;
  const hipsY = ((at(lm, L_HIP).y + at(lm, R_HIP).y) / 2) * h;
  const torso = hipsY - shouldersY;
  if (torso <= 0) return null;
  const spread =
    ((Math.abs(at(lm, L_SHOULDER).x - at(lm, R_SHOULDER).x) + Math.abs(at(lm, L_HIP).x - at(lm, R_HIP).x)) * w) / (2 * torso);
  if (spread >= FRONT_MIN_SPREAD) return "front";
  if (spread <= SIDE_MAX_SPREAD) return "side";
  return "turning";
}

function frontTips(view: View): string[] {
  const lm = view.landmarks;
  const w = view.width;
  const tips: string[] = [];
  const shoulders = Math.abs(at(lm, L_SHOULDER).x - at(lm, R_SHOULDER).x) * w;
  const axis = ((at(lm, L_SHOULDER).x + at(lm, R_SHOULDER).x + at(lm, L_HIP).x + at(lm, R_HIP).x) / 4) * w;
  const wrists = [L_WRIST, R_WRIST].filter((i) => visible(lm, i)).map((i) => at(lm, i));
  if (shoulders > 0 && wrists.some((p) => Math.abs(p.x * w - axis) < ARMS_MIN_SPREAD * shoulders)) tips.push(TIPS.arms);
  const hips = Math.abs(at(lm, L_HIP).x - at(lm, R_HIP).x) * w;
  if (visible(lm, L_ANKLE) && visible(lm, R_ANKLE) && hips > 0 && Math.abs(at(lm, L_ANKLE).x - at(lm, R_ANKLE).x) * w < FEET_MIN_SPREAD * hips) {
    tips.push(TIPS.feet);
  }
  return tips;
}

/** La personne est-elle prête pour la photo attendue ? Sinon, quoi lui dire. `view` vaut null si personne n'est détecté. */
export function checkFraming(view: View | null, expect: PoseView): PoseCheck {
  if (!view || view.landmarks.length < 33) return notReady(null, "no_person", MESSAGES.no_person);
  const lm = view.landmarks;
  const b = binarize(view);
  const { w, h } = b;

  const orientation = orientationOf(view);
  if (orientation === null) return notReady(view, "pose_not_detected", MESSAGES.pose_not_detected);

  const torsoMid = (at(lm, L_SHOULDER).y + at(lm, R_SHOULDER).y + at(lm, L_HIP).y + at(lm, R_HIP).y) / 4;
  const span = bodySpan(b, Math.min(Math.max(Math.trunc(torsoMid * h), 0), h - 1));
  if (!span) return notReady(view, "no_person", MESSAGES.no_person, orientation);
  const [top, bottom] = span;
  let x1 = w;
  let x2 = -1;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (b.on[y * w + x]) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
      }
    }
  }
  const box = { x1: pyRound(x1 / w, 4), y1: pyRound(top / h, 4), x2: pyRound((x2 + 1) / w, 4), y2: pyRound((bottom + 1) / h, 4) };

  const margin = Math.max(2, Math.floor(h / 200));
  if (top <= margin) return notReady(view, "head_cut", MESSAGES.head_cut, orientation, box);
  if (bottom >= h - 1 - margin || !(visible(lm, L_ANKLE) || visible(lm, R_ANKLE))) {
    return notReady(view, "feet_cut", MESSAGES.feet_cut, orientation, box);
  }
  if ((bottom - top + 1) / h < MIN_BODY_HEIGHT) return notReady(view, "too_far", MESSAGES.too_far, orientation, box);
  const center = (x1 + x2 + 1) / 2 / w;
  if (!(CENTER_RANGE[0] <= center && center <= CENTER_RANGE[1])) return notReady(view, "off_center", MESSAGES.off_center, orientation, box);

  if (expect === "front" && orientation !== "front") return notReady(view, "wrong_view", MESSAGES.turn_front, orientation, box);
  if (expect === "side" && orientation !== "side") {
    return notReady(view, "wrong_view", orientation === "turning" ? MESSAGES.turn_more : MESSAGES.turn_side, orientation, box);
  }

  return {
    ready: true,
    orientation,
    issue: null,
    message: MESSAGES.ready,
    tips: expect === "front" ? frontTips(view) : [],
    box,
    landmarks: landmarksOut(lm),
  };
}
