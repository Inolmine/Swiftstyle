from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from .measure import (
    L_ANKLE,
    L_HIP,
    L_SHOULDER,
    L_WRIST,
    MASK_THRESHOLD,
    MIN_VISIBILITY,
    R_ANKLE,
    R_HIP,
    R_SHOULDER,
    R_WRIST,
    View,
)

Expect = Literal["front", "side"]
Orientation = Literal["front", "side", "turning"]
Issue = Literal["no_person", "pose_not_detected", "head_cut", "feet_cut", "too_far", "off_center", "wrong_view"]

FRONT_MIN_SPREAD = 0.35
SIDE_MAX_SPREAD = 0.18

MIN_BODY_HEIGHT = 0.5

CENTER_RANGE = (0.2, 0.8)

ARMS_MIN_SPREAD = 0.7

FEET_MIN_SPREAD = 0.6

MESSAGES: dict[str, str] = {
    "no_person": "Placez-vous devant la caméra, de la tête aux pieds.",
    "pose_not_detected": "Tenez-vous debout, bien droit, épaules et hanches visibles.",
    "head_cut": "Reculez un peu : votre tête sort de l'image.",
    "feet_cut": "Reculez : vos pieds doivent être visibles.",
    "too_far": "Rapprochez-vous un peu de la caméra.",
    "off_center": "Placez-vous au centre de l'image.",
    "turn_front": "Placez-vous face à la caméra.",
    "turn_side": "Tournez-vous de profil, sur le côté.",
    "turn_more": "Encore un peu : tournez-vous complètement de profil.",
    "ready": "Parfait, ne bougez plus.",
}

TIPS: dict[str, str] = {
    "arms": "Écartez un peu les bras du corps.",
    "feet": "Écartez les pieds de la largeur des hanches.",
}


@dataclass
class Framing:
    ready: bool
    orientation: Orientation | None
    issue: Issue | None
    message: str
    tips: list[str] = field(default_factory=list)
    box: tuple[float, float, float, float] | None = None


def _not_ready(issue: Issue, message: str, orientation: Orientation | None = None, box=None) -> Framing:
    return Framing(ready=False, orientation=orientation, issue=issue, message=message, box=box)


def _silhouette(binary: np.ndarray, inside_row: int) -> tuple[int, int, int, int] | None:
    rows = binary.any(axis=1)
    h = binary.shape[0]
    if not rows[inside_row]:
        return None
    top = inside_row
    while top > 0 and rows[top - 1]:
        top -= 1
    bottom = inside_row
    while bottom < h - 1 and rows[bottom + 1]:
        bottom += 1
    cols = np.flatnonzero(binary[top : bottom + 1].any(axis=0))
    return int(cols[0]), top, int(cols[-1]), bottom


def orientation_of(view: View) -> Orientation | None:
    lm = view.landmarks
    h, w = view.mask.shape[:2]
    if len(lm) < 33:
        return None

    def visible(i: int) -> bool:
        return lm[i].visibility >= MIN_VISIBILITY

    if not ((visible(L_SHOULDER) or visible(R_SHOULDER)) and (visible(L_HIP) or visible(R_HIP))):
        return None
    shoulders_y = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2 * h
    hips_y = (lm[L_HIP].y + lm[R_HIP].y) / 2 * h
    torso = hips_y - shoulders_y
    if torso <= 0:
        return None
    spread = (abs(lm[L_SHOULDER].x - lm[R_SHOULDER].x) + abs(lm[L_HIP].x - lm[R_HIP].x)) * w / (2 * torso)
    if spread >= FRONT_MIN_SPREAD:
        return "front"
    if spread <= SIDE_MAX_SPREAD:
        return "side"
    return "turning"


def _front_tips(view: View) -> list[str]:
    lm = view.landmarks
    w = view.mask.shape[1]
    tips = []
    shoulders = abs(lm[L_SHOULDER].x - lm[R_SHOULDER].x) * w
    axis = (lm[L_SHOULDER].x + lm[R_SHOULDER].x + lm[L_HIP].x + lm[R_HIP].x) / 4 * w
    wrists = [lm[i] for i in (L_WRIST, R_WRIST) if lm[i].visibility >= MIN_VISIBILITY]
    if shoulders > 0 and any(abs(p.x * w - axis) < ARMS_MIN_SPREAD * shoulders for p in wrists):
        tips.append(TIPS["arms"])
    hips = abs(lm[L_HIP].x - lm[R_HIP].x) * w
    if lm[L_ANKLE].visibility >= MIN_VISIBILITY and lm[R_ANKLE].visibility >= MIN_VISIBILITY:
        if hips > 0 and abs(lm[L_ANKLE].x - lm[R_ANKLE].x) * w < FEET_MIN_SPREAD * hips:
            tips.append(TIPS["feet"])
    return tips


def check_framing(view: View | None, expect: Expect) -> Framing:
    if view is None or len(view.landmarks) < 33:
        return _not_ready("no_person", MESSAGES["no_person"])
    mask = view.mask[..., 0] if view.mask.ndim == 3 else view.mask
    binary = mask > MASK_THRESHOLD
    h, w = binary.shape
    lm = view.landmarks

    orientation = orientation_of(View(mask=mask, landmarks=lm))
    if orientation is None:
        return _not_ready("pose_not_detected", MESSAGES["pose_not_detected"])

    torso_mid = (lm[L_SHOULDER].y + lm[R_SHOULDER].y + lm[L_HIP].y + lm[R_HIP].y) / 4
    rect = _silhouette(binary, min(max(int(torso_mid * h), 0), h - 1))
    if rect is None:
        return _not_ready("no_person", MESSAGES["no_person"], orientation)
    x1, top, x2, bottom = rect
    box = (round(x1 / w, 4), round(top / h, 4), round((x2 + 1) / w, 4), round((bottom + 1) / h, 4))

    margin = max(2, h // 200)
    if top <= margin:
        return _not_ready("head_cut", MESSAGES["head_cut"], orientation, box)
    if bottom >= h - 1 - margin or not (lm[L_ANKLE].visibility >= MIN_VISIBILITY or lm[R_ANKLE].visibility >= MIN_VISIBILITY):
        return _not_ready("feet_cut", MESSAGES["feet_cut"], orientation, box)
    if (bottom - top + 1) / h < MIN_BODY_HEIGHT:
        return _not_ready("too_far", MESSAGES["too_far"], orientation, box)
    center = (x1 + x2 + 1) / 2 / w
    if not CENTER_RANGE[0] <= center <= CENTER_RANGE[1]:
        return _not_ready("off_center", MESSAGES["off_center"], orientation, box)

    if expect == "front" and orientation != "front":
        return _not_ready("wrong_view", MESSAGES["turn_front"], orientation, box)
    if expect == "side" and orientation != "side":
        key = "turn_more" if orientation == "turning" else "turn_side"
        return _not_ready("wrong_view", MESSAGES[key], orientation, box)

    tips = _front_tips(View(mask=mask, landmarks=lm)) if expect == "front" else []
    return Framing(ready=True, orientation=orientation, issue=None, message=MESSAGES["ready"], tips=tips, box=box)
