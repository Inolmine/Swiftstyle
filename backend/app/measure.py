from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

Zone = Literal["chest", "waist", "hips", "thigh"]
TORSO: tuple[Zone, ...] = ("chest", "waist", "hips")
ZONES: tuple[Zone, ...] = (*TORSO, "thigh")
ZONE_NAMES: dict[Zone, str] = {"chest": "poitrine", "waist": "taille", "hips": "hanches", "thigh": "cuisse"}
AT_ZONE: dict[Zone, str] = {"chest": "à la poitrine", "waist": "à la taille", "hips": "aux hanches", "thigh": "aux cuisses"}

LEVELS: dict[Zone, float] = {"chest": 0.30, "waist": 0.62, "hips": 1.05}

SEARCH_BAND = 0.08

FRONT_MODES: dict[Zone, str] = {"chest": "at", "waist": "min", "hips": "max"}
SIDE_MODES: dict[Zone, str] = {"chest": "at", "waist": "at", "hips": "max"}

THIGH_DROP = 0.02

CROTCH_MAX = 0.8
CROTCH_LEVEL = 0.6

DEPTH_RATIO: dict[Zone, float] = {"chest": 0.75, "waist": 0.72, "hips": 0.70, "thigh": 1.0}

PLAUSIBLE: dict[Zone, tuple[float, float]] = {"chest": (65, 150), "waist": (50, 150), "hips": (70, 160), "thigh": (35, 90)}

PLAUSIBLE_INSEAM = (0.40, 0.55)

MASK_THRESHOLD = 0.5
MIN_VISIBILITY = 0.5

L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_INDEX, R_INDEX = 19, 20
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28
ARMS = ((L_SHOULDER, L_ELBOW, L_WRIST, L_INDEX), (R_SHOULDER, R_ELBOW, R_WRIST, R_INDEX))
LEGS = ((L_HIP, L_KNEE), (R_HIP, R_KNEE))


class MeasureError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Landmark:
    x: float
    y: float
    visibility: float = 1.0


@dataclass
class View:
    mask: np.ndarray
    landmarks: list[Landmark]


@dataclass(frozen=True)
class Segment:
    y: int
    x1: int
    x2: int
    arm_removed: bool = False

    @property
    def width(self) -> int:
        return self.x2 - self.x1 + 1


@dataclass(frozen=True)
class Inseam:
    x: int
    y1: int
    y2: int
    estimated: bool = False

    @property
    def length(self) -> int:
        return self.y2 - self.y1


@dataclass
class ViewResult:
    height: int
    width: int
    cm_per_px: float
    segments: dict[Zone, Segment]
    inseam: Inseam | None = None
    thigh_at: float | None = None

    def size_cm(self, zone: Zone) -> float:
        return self.segments[zone].width * self.cm_per_px


@dataclass
class Measurement:
    measurements: dict[str, int]
    widths_cm: dict[Zone, float]
    depths_cm: dict[Zone, float]
    depth_source: Literal["profile", "estimated"]
    front: ViewResult
    side: ViewResult | None
    warnings: list[str] = field(default_factory=list)


def ellipse_perimeter(a: float, b: float) -> float:
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


def _check_pose(view: View, *, both_sides: bool, label: str) -> None:
    lm = view.landmarks
    if len(lm) < 33:
        raise MeasureError("no_person", f"Aucune personne détectée sur la photo {label}.")

    def visible(i: int) -> bool:
        return lm[i].visibility >= MIN_VISIBILITY

    for a, b in ((L_SHOULDER, R_SHOULDER), (L_HIP, R_HIP)):
        ok = (visible(a) and visible(b)) if both_sides else (visible(a) or visible(b))
        if not ok:
            raise MeasureError(
                "pose_not_detected",
                f"Épaules ou hanches mal visibles sur la photo {label} : tenez-vous droit, face à l'objectif.",
            )
    if not (visible(L_ANKLE) or visible(R_ANKLE)):
        raise MeasureError(
            "body_not_fully_visible",
            f"Les pieds ne sont pas visibles sur la photo {label} : il faut le corps entier, de la tête aux pieds.",
        )


def _body_rows(mask: np.ndarray, inside_row: int) -> tuple[int, int]:
    rows = mask.any(axis=1)
    h = mask.shape[0]
    if not rows[inside_row]:
        raise MeasureError("no_person", "La silhouette n'a pas été détourée correctement.")
    top = inside_row
    while top > 0 and rows[top - 1]:
        top -= 1
    bottom = inside_row
    while bottom < h - 1 and rows[bottom + 1]:
        bottom += 1
    return top, bottom


def _run_at(row: np.ndarray, cx: int, search: int) -> tuple[int, int] | None:
    w = row.shape[0]
    cx = min(max(cx, 0), w - 1)
    if not row[cx]:
        lo = max(0, cx - search)
        near = np.flatnonzero(row[lo : cx + search + 1]) + lo
        if near.size == 0:
            return None
        cx = int(near[np.argmin(np.abs(near - cx))])
    left_gaps = np.flatnonzero(~row[:cx])
    x1 = int(left_gaps[-1]) + 1 if left_gaps.size else 0
    right_gaps = np.flatnonzero(~row[cx:])
    x2 = cx + int(right_gaps[0]) - 1 if right_gaps.size else w - 1
    return x1, x2


def _arm_axes(lm: list[Landmark], w: int, h: int) -> list[list[tuple[float, float]]]:
    axes = []
    for shoulder, elbow, wrist, index in ARMS:
        axis = [(lm[i].x * w, lm[i].y * h) for i in (shoulder, elbow, wrist, index) if lm[i].visibility >= MIN_VISIBILITY]
        if lm[wrist].visibility >= MIN_VISIBILITY and lm[index].visibility >= MIN_VISIBILITY:
            (wx, wy), (ix, iy) = axis[-2], axis[-1]
            axis.append((2 * ix - wx, 2 * iy - wy))
        axes.append(axis)
    return axes


def _axis_x(axis: list[tuple[float, float]], y: float) -> float | None:
    for (xa, ya), (xb, yb) in zip(axis, axis[1:]):
        if ya != yb and min(ya, yb) <= y <= max(ya, yb):
            return xa + (xb - xa) * (y - ya) / (yb - ya)
    return None


def _remove_arms(x1: int, x2: int, y: int, cx: float, axes: list[list[tuple[float, float]]]) -> tuple[int, int, bool]:
    removed = False
    for axis in axes:
        ax = _axis_x(axis, y)
        if ax is None or not x1 < ax < x2:
            continue
        if ax < cx:
            x1, removed = max(x1, int(round(2 * ax - x1))), True
        else:
            x2, removed = min(x2, int(round(2 * ax - x2))), True
    return x1, x2, removed


def _pick(found: list[Segment], mode: str, level: float) -> Segment:
    if mode == "at":
        return min(found, key=lambda s: abs(s.y - level))
    widths = np.array([s.width for s in found], dtype=float)
    k = min(5, len(found))
    smooth = np.array([np.median(widths[max(0, i - k // 2) : i + k // 2 + 1]) for i in range(len(found))])
    return found[int(np.argmin(smooth) if mode == "min" else np.argmax(smooth))]


def _crotch(binary: np.ndarray, legs: Callable[[float], tuple[float, float]], hip_y: float, knee_y: float, body_px: int) -> tuple[int, int] | None:
    h = binary.shape[0]

    def gap(y: int) -> np.ndarray:
        xa, xb = legs(y)
        a, b = int(round(xa)), int(round(xb))
        return np.flatnonzero(~binary[y, a : b + 1]) + a

    y_top = max(0, int(round(hip_y)))
    y = min(h - 1, int(round(knee_y)))
    while y >= y_top and gap(y).size == 0:
        y -= 1
    if y < y_top:
        return None
    tolerance = max(2, int(0.005 * body_px))
    crotch, misses = y, 0
    while y > y_top and misses <= tolerance:
        y -= 1
        if gap(y).size:
            crotch, misses = y, 0
        else:
            misses += 1
    if crotch > hip_y + CROTCH_MAX * (knee_y - hip_y):
        return None
    return int(round(gap(crotch).mean())), crotch


def _thigh_front(
    binary: np.ndarray, level: float, legs: Callable[[float], tuple[float, float]], split_x: float, search: int, axes
) -> Segment | None:
    found: list[Segment] = []
    for y in range(int(round(level)) - 2, int(round(level)) + 3):
        if not 0 <= y < binary.shape[0]:
            continue
        xa, xb = legs(y)
        best: Segment | None = None
        for xc, is_left in ((xa, True), (xb, False)):
            run = _run_at(binary[y], int(round(xc)), search)
            if not run:
                continue
            x1, x2 = run
            if x1 <= xa and x2 >= xb:
                if is_left:
                    x2 = int(math.floor(split_x)) - 1
                else:
                    x1 = int(math.floor(split_x))
            x1, x2, removed = _remove_arms(x1, x2, y, xc, axes)
            if x2 >= x1 and (best is None or x2 - x1 + 1 > best.width):
                best = Segment(y, x1, x2, removed)
        if best:
            found.append(best)
    return _pick(found, "at", level) if found else None


def analyse_view(
    view: View, height_cm: float, modes: dict[Zone, str], *, front: bool, label: str, thigh_at: float | None = None
) -> ViewResult:
    _check_pose(view, both_sides=front, label=label)
    mask = view.mask
    if mask.ndim == 3:
        mask = mask[..., 0]
    binary = mask > MASK_THRESHOLD
    h, w = binary.shape
    lm = view.landmarks

    def point(i: int) -> tuple[float, float]:
        return lm[i].x * w, lm[i].y * h

    def mean_point(a: int, b: int) -> tuple[float, float]:
        pts = [lm[i] for i in (a, b) if lm[i].visibility >= MIN_VISIBILITY] or [lm[a], lm[b]]
        return (sum(p.x for p in pts) / len(pts) * w, sum(p.y for p in pts) / len(pts) * h)

    sx, sy = mean_point(L_SHOULDER, R_SHOULDER)
    hx, hy = mean_point(L_HIP, R_HIP)
    kx, ky = mean_point(L_KNEE, R_KNEE)
    torso = hy - sy

    top, bottom = _body_rows(binary, int(round(min(max((sy + hy) / 2, 0), h - 1))))
    margin = max(2, h // 200)
    if top <= margin or bottom >= h - 1 - margin:
        raise MeasureError(
            "body_not_fully_visible",
            f"La silhouette touche le bord de la photo {label} : reculez pour être visible de la tête aux pieds.",
        )
    body_px = bottom - top + 1
    if torso < 0.15 * body_px or ky <= hy:
        raise MeasureError("pose_not_detected", f"Posture non reconnue sur la photo {label} : tenez-vous debout, bien droit.")

    cm_per_px = height_cm / body_px
    search = max(3, w // 20)
    axes = _arm_axes(lm, w, h) if front else []

    def center_x(y: float) -> float:
        return sx + (hx - sx) * (y - sy) / torso

    segments: dict[Zone, Segment] = {}
    for zone in TORSO:
        level = sy + LEVELS[zone] * torso
        band = SEARCH_BAND * torso if modes[zone] != "at" else 2
        y0 = max(top, int(round(level - band)))
        y1 = min(bottom, int(round(level + band)))
        found: list[Segment] = []
        for y in range(y0, y1 + 1):
            cx = center_x(y)
            run = _run_at(binary[y], int(round(cx)), search)
            if run:
                x1, x2, removed = _remove_arms(run[0], run[1], y, cx, axes)
                found.append(Segment(y, x1, x2, removed))
        if not found:
            raise MeasureError("measure_failed", f"Impossible de mesurer le tour de {ZONE_NAMES[zone]} sur la photo {label}.")
        segments[zone] = _pick(found, modes[zone], level)

    inseam: Inseam | None = None
    if front:

        def legs(y: float) -> tuple[float, float]:
            xs = []
            for hip, knee in LEGS:
                (x0, y0), (x1, y1) = point(hip), point(knee)
                xs.append(x0 + (x1 - x0) * (y - y0) / (y1 - y0) if y1 != y0 else x0)
            return min(xs), max(xs)

        found_crotch = _crotch(binary, legs, hy, ky, body_px)
        if found_crotch:
            crotch_x, crotch_y = found_crotch
        else:
            crotch_y = int(round(hy + CROTCH_LEVEL * (ky - hy)))
            crotch_x = int(round(sum(legs(crotch_y)) / 2))
        inseam = Inseam(x=crotch_x, y1=crotch_y, y2=bottom + 1, estimated=found_crotch is None)
        thigh_y = crotch_y + THIGH_DROP * body_px
        thigh = _thigh_front(binary, thigh_y, legs, crotch_x, search, axes)
    else:
        if thigh_at is None:
            thigh_y = hy + CROTCH_LEVEL * (ky - hy) + THIGH_DROP * body_px
        else:
            thigh_y = top + thigh_at * body_px
        yy = int(round(thigh_y))
        thigh = None
        if 0 <= yy < h:
            run = _run_at(binary[yy], int(round(hx + (kx - hx) * (yy - hy) / (ky - hy))), search)
            thigh = Segment(yy, *run) if run else None
    if thigh is None:
        raise MeasureError("measure_failed", f"Impossible de mesurer le tour de cuisse sur la photo {label}.")
    segments["thigh"] = thigh

    return ViewResult(
        height=h,
        width=w,
        cm_per_px=cm_per_px,
        segments=segments,
        inseam=inseam,
        thigh_at=(thigh_y - top) / body_px,
    )


def measure(height_cm: float, front: View, side: View | None = None) -> Measurement:
    f = analyse_view(front, height_cm, FRONT_MODES, front=True, label="de face")
    s = (
        analyse_view(side, height_cm, SIDE_MODES, front=False, label="de profil", thigh_at=f.thigh_at)
        if side is not None
        else None
    )
    assert f.inseam is not None

    warnings = []
    arms = [AT_ZONE[z] for z in ZONES if f.segments[z].arm_removed]
    if arms:
        warnings.append(
            f"Bras collés au corps ({', '.join(arms)}) : leur largeur a été retirée par estimation. "
            "Écartez un peu les bras pour une mesure plus sûre."
        )
    if s is None:
        warnings.append("Sans photo de profil, la profondeur du corps est estimée : la mesure est moins fiable.")
    if f.inseam.estimated:
        warnings.append(
            "Jambes serrées : l'entrejambe n'est pas visible, sa hauteur est estimée. "
            "Écartez les pieds de la largeur des hanches pour le mesurer."
        )

    widths: dict[Zone, float] = {}
    depths: dict[Zone, float] = {}
    measurements: dict[str, int] = {}
    for zone in ZONES:
        width = f.size_cm(zone)
        depth = s.size_cm(zone) if s else width * DEPTH_RATIO[zone]
        widths[zone] = round(width, 1)
        depths[zone] = round(depth, 1)
        circumference = ellipse_perimeter(width / 2, depth / 2)
        measurements[zone] = int(round(circumference))
        low, high = PLAUSIBLE[zone]
        if not low <= circumference <= high:
            warnings.append(f"Tour de {ZONE_NAMES[zone]} peu plausible ({circumference:.0f} cm) : vérifiez la photo.")

    inseam_cm = f.inseam.length * f.cm_per_px
    measurements["inseam"] = int(round(inseam_cm))
    low, high = PLAUSIBLE_INSEAM
    if inseam_cm < low * height_cm:
        warnings.append(
            f"Entrejambe court pour {height_cm:.0f} cm ({inseam_cm:.0f} cm) : la photo a sans doute été prise de trop "
            "près ou de trop haut, ce qui raccourcit les jambes. Placez l'appareil à hauteur des hanches, à 2 ou 3 m."
        )
    elif inseam_cm > high * height_cm:
        warnings.append(f"Entrejambe peu plausible ({inseam_cm:.0f} cm) : vérifiez la photo.")

    return Measurement(
        measurements=measurements,
        widths_cm=widths,
        depths_cm=depths,
        depth_source="profile" if s else "estimated",
        front=f,
        side=s,
        warnings=warnings,
    )
