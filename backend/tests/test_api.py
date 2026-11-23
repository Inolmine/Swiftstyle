import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import EXAMPLE, app, get_analyzer
from app.measure import MeasureError, View
from conftest import FRONT_ROWS, SIDE_ROWS, draw, landmarks


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (60, 100), "white").save(buf, format="PNG")
    return buf.getvalue()


class FakeAnalyzer:
    def __init__(self, views: list[View] | None = None, error: MeasureError | None = None):
        self.views = views or [
            View(mask=draw(FRONT_ROWS), landmarks=landmarks()),
            View(mask=draw(SIDE_ROWS), landmarks=landmarks(side=True)),
        ]
        self.error = error

    def __call__(self, rgb):
        if self.error:
            raise self.error
        return self.views.pop(0)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def use(analyzer: FakeAnalyzer) -> None:
    app.dependency_overrides[get_analyzer] = lambda: analyzer


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert set(body) == {"status", "model", "modelReady"}


def test_l_adresse_de_l_api_ouvre_la_documentation(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/docs"
    assert "swagger-ui" in client.get("/docs").text


def test_schema_openapi_documente(client):
    schema = client.get("/openapi.json").json()
    assert "curl" in schema["info"]["description"]
    route = schema["paths"]["/v1/photo/measure"]["post"]
    assert route["summary"] == "Mesurer le corps sur des photos"
    assert {"200", "400", "413", "422"} <= set(route["responses"])
    measurements = schema["components"]["schemas"]["Measurements"]["properties"]
    assert set(measurements) == {"chest", "waist", "hips", "thigh", "inseam"}
    assert "/" not in schema["paths"]


def test_mesure_face_et_profil(client):
    use(FakeAnalyzer())
    r = client.post(
        "/v1/photo/measure",
        data={"heightCm": "180"},
        files={"front": ("face.png", png(), "image/png"), "side": ("profil.png", png(), "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["depthSource"] == "profile"
    assert body["zones"]["thigh"] == {"circumference": 53, "width": 16.0, "depth": 18.0}
    assert body["front"]["inseam"] == {"x": 0.5008, "y1": 0.58, "y2": 0.95}
    assert body["side"]["inseam"] is None
    assert body == EXAMPLE


def test_mesure_face_seule(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/measure", data={"heightCm": "180"}, files={"front": ("face.png", png(), "image/png")})
    assert r.status_code == 200, r.text
    assert r.json()["depthSource"] == "estimated"
    assert r.json()["side"] is None


def test_profil_vide_envoye_par_swagger(client):
    use(FakeAnalyzer())
    r = client.post(
        "/v1/photo/measure", data={"heightCm": "180", "side": ""}, files={"front": ("face.png", png(), "image/png")}
    )
    assert r.status_code == 200, r.text
    assert r.json()["depthSource"] == "estimated"


def test_taille_hors_limites(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/measure", data={"heightCm": "90"}, files={"front": ("face.png", png(), "image/png")})
    assert r.status_code == 422


def test_fichier_qui_n_est_pas_une_image(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/measure", data={"heightCm": "180"}, files={"front": ("face.png", b"pas une image", "image/png")})
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_image"


def test_personne_non_detectee(client):
    use(FakeAnalyzer(error=MeasureError("no_person", "Aucune personne détectée sur la photo.")))
    r = client.post("/v1/photo/measure", data={"heightCm": "180"}, files={"front": ("face.png", png(), "image/png")})
    assert r.status_code == 422
    assert r.json() == {"error": "no_person", "message": "Aucune personne détectée sur la photo."}


def test_un_site_autorise_peut_appeler_l_api_depuis_le_navigateur(client):
    r = client.options(
        "/v1/photo/measure",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_un_site_inconnu_est_refuse(client):
    r = client.options(
        "/v1/photo/measure",
        headers={"Origin": "https://site-inconnu.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in r.headers


def test_cadrage_pret_de_face(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/pose", data={"expect": "front"}, files={"frame": ("image.jpg", png(), "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ready"] is True
    assert body["orientation"] == "front"
    assert body["issue"] is None
    assert body["box"] == {"x1": 0.3, "y1": 0.05, "x2": 0.7, "y2": 0.95}
    assert len(body["landmarks"]) == 33
    assert set(body["landmarks"][0]) == {"x", "y", "visibility"}


def test_cadrage_demande_le_profil(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/pose", data={"expect": "side"}, files={"frame": ("image.jpg", png(), "image/png")})
    body = r.json()
    assert body["ready"] is False
    assert body["issue"] == "wrong_view"
    assert "profil" in body["message"]


def test_cadrage_sans_personne_n_est_pas_une_erreur(client):
    use(FakeAnalyzer(error=MeasureError("no_person", "Aucune personne détectée sur la photo.")))
    r = client.post("/v1/photo/pose", files={"frame": ("image.jpg", png(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["ready"] is False
    assert body["issue"] == "no_person"
    assert body["landmarks"] == []
    assert body["box"] is None


def test_cadrage_image_illisible(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/pose", files={"frame": ("image.jpg", b"pas une image", "image/jpeg")})
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_image"


def test_cadrage_vue_inconnue(client):
    use(FakeAnalyzer())
    r = client.post("/v1/photo/pose", data={"expect": "dos"}, files={"frame": ("image.jpg", png(), "image/png")})
    assert r.status_code == 422


def test_cadrage_documente(client):
    route = client.get("/openapi.json").json()["paths"]["/v1/photo/pose"]["post"]
    assert route["tags"] == ["Prise de vue"]
    assert {"200", "400", "413"} <= set(route["responses"])
