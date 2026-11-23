import pytest

from app import main
from app.limits import RateLimiter
from conftest import FRONT_ROWS, draw, landmarks
from test_api import FakeAnalyzer, png, use


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_limite_par_adresse_et_par_minute():
    clock = Clock()
    limiter = RateLimiter(2, clock=clock)
    assert [limiter.allow("1.2.3.4") for _ in range(3)] == [True, True, False]
    assert limiter.allow("5.6.7.8")
    clock.now = 60
    assert limiter.allow("1.2.3.4")


def test_zero_veut_dire_sans_limite():
    limiter = RateLimiter(0)
    assert all(limiter.allow("1.2.3.4") for _ in range(1000))


@pytest.mark.parametrize("route", ["/v1/photo/measure", "/v1/photo/pose"])
def test_trop_de_demandes(client, monkeypatch, route):
    monkeypatch.setattr(main.MEASURE_LIMIT, "per_minute", 1)
    monkeypatch.setattr(main.POSE_LIMIT, "per_minute", 1)
    files = {"front": ("face.png", png(), "image/png")} if route.endswith("measure") else {"frame": ("image.png", png(), "image/png")}
    data = {"heightCm": "180"} if route.endswith("measure") else {"expect": "front"}
    use(FakeAnalyzer())
    assert client.post(route, data=data, files=files).status_code == 200
    r = client.post(route, data=data, files=files)
    assert r.status_code == 429
    assert r.json()["error"] == "rate_limited"
    assert r.headers["retry-after"] == "60"
