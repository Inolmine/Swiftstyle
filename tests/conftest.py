from __future__ import annotations

import numpy as np
import pytest

from fastapi.testclient import TestClient

from app.main import MEASURE_LIMIT, POSE_LIMIT, app
from app.measure import Landmark, View

H, W, CX = 1000, 600, 300

FRONT_ROWS = [
    (50, 199, 40),
    (200, 249, 120),
    (250, 399, 85),
    (400, 479, 70),
    (480, 579, 90),
    (580, 799, 85, 5),
    (800, 949, 60, 15),
]

SIDE_ROWS = [
    (50, 199, 40),
    (200, 249, 55),
    (250, 399, 60),
    (400, 479, 50),
    (480, 579, 62),
    (580, 949, 45),
]


def draw(rows: list[tuple[int, ...]]) -> np.ndarray:
    mask = np.zeros((H, W), dtype=np.float32)
    for y0, y1, hw, *gap in rows:
        g = gap[0] if gap else 0
        mask[y0 : y1 + 1, CX - hw : CX - g] = 1.0
        mask[y0 : y1 + 1, CX + g : CX + hw] = 1.0
    return mask


def landmarks(*, side: bool = False, **moved: tuple[float, float]) -> list[Landmark]:
    lm = [Landmark(0.5, 0.1, 1.0) for _ in range(33)]
    spread = 0 if side else 1
    points = {
        11: (CX - 100 * spread, 250),
        12: (CX + 100 * spread, 250),
        23: (CX - 60 * spread, 540),
        24: (CX + 60 * spread, 540),
        25: (CX - 45 * spread, 790),
        26: (CX + 45 * spread, 790),
        27: (CX - 40 * spread, 930),
        28: (CX + 40 * spread, 930),
        13: (30, 400),
        14: (570, 400),
        15: (20, 600),
        16: (580, 600),
        19: (15, 650),
        20: (585, 650),
    }
    for i, (x, y) in points.items():
        lm[i] = Landmark(x / W, y / H, 1.0)
    if side:
        for i in (12, 24, 26, 28):
            lm[i] = Landmark(lm[i].x, lm[i].y, 0.2)
    for name, (x, y) in moved.items():
        i = int(name.removeprefix("lm"))
        lm[i] = Landmark(x / W, y / H, 1.0)
    return lm


@pytest.fixture
def front_view() -> View:
    return View(mask=draw(FRONT_ROWS), landmarks=landmarks())


@pytest.fixture
def side_view() -> View:
    return View(mask=draw(SIDE_ROWS), landmarks=landmarks(side=True))


@pytest.fixture
def client():
    MEASURE_LIMIT.reset()
    POSE_LIMIT.reset()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
