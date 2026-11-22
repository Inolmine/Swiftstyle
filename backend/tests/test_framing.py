import numpy as np

from app.framing import MESSAGES, TIPS, check_framing, orientation_of
from app.measure import Landmark, View
from conftest import CX, FRONT_ROWS, H, SIDE_ROWS, W, draw, landmarks


def test_de_face_et_bien_cadre(front_view):
    f = check_framing(front_view, "front")
    assert f.ready
    assert f.orientation == "front"
    assert f.issue is None
    assert f.message == MESSAGES["ready"]
    assert f.tips == []
    assert f.box == (0.3, 0.05, 0.7, 0.95)


def test_de_profil_et_bien_cadre(side_view):
    f = check_framing(side_view, "side")
    assert f.ready
    assert f.orientation == "side"
    assert f.tips == []


def test_demande_de_se_tourner(front_view, side_view):
    f = check_framing(front_view, "side")
    assert not f.ready
    assert f.issue == "wrong_view"
    assert f.message == MESSAGES["turn_side"]

    f = check_framing(side_view, "front")
    assert f.issue == "wrong_view"
    assert f.message == MESSAGES["turn_front"]


def test_entre_face_et_profil():
    lm = landmarks(lm11=(CX - 40, 250), lm12=(CX + 40, 250), lm23=(CX - 25, 540), lm24=(CX + 25, 540))
    view = View(mask=draw(FRONT_ROWS), landmarks=lm)
    assert orientation_of(view) == "turning"
    f = check_framing(view, "side")
    assert f.issue == "wrong_view"
    assert f.message == MESSAGES["turn_more"]


def test_personne_absente():
    f = check_framing(None, "front")
    assert not f.ready
    assert f.issue == "no_person"
    assert f.orientation is None
    assert f.box is None


def test_tete_coupee():
    rows = [(0, 199, 40), *FRONT_ROWS[1:]]
    f = check_framing(View(mask=draw(rows), landmarks=landmarks()), "front")
    assert f.issue == "head_cut"
    assert f.box is not None


def test_pieds_coupes():
    rows = [*FRONT_ROWS[:-1], (800, H - 1, 60, 15)]
    f = check_framing(View(mask=draw(rows), landmarks=landmarks()), "front")
    assert f.issue == "feet_cut"


def test_chevilles_non_vues():
    lm = landmarks()
    for i in (27, 28):
        lm[i] = Landmark(lm[i].x, lm[i].y, 0.1)
    f = check_framing(View(mask=draw(FRONT_ROWS), landmarks=lm), "front")
    assert f.issue == "feet_cut"


def test_trop_loin():
    small = np.zeros((H, W), dtype=np.float32)
    small[300:750:1, :] = draw(FRONT_ROWS)[50:950:2, :]
    lm = [Landmark(p.x, 0.3 + (p.y - 0.05) / 2, p.visibility) for p in landmarks()]
    f = check_framing(View(mask=small, landmarks=lm), "front")
    assert f.issue == "too_far"


def test_decentre():
    wide = 1500
    mask = np.zeros((H, wide), dtype=np.float32)
    mask[:, : W - 100] = draw(FRONT_ROWS)[:, 100:]
    lm = [Landmark((p.x * W - 100) / wide, p.y, p.visibility) for p in landmarks()]
    f = check_framing(View(mask=mask, landmarks=lm), "front")
    assert f.issue == "off_center"


def test_conseils_bras_colles_et_pieds_serres():
    lm = landmarks(lm15=(CX - 110, 600), lm16=(CX + 110, 600), lm27=(CX - 15, 930), lm28=(CX + 15, 930))
    f = check_framing(View(mask=draw(FRONT_ROWS), landmarks=lm), "front")
    assert f.ready
    assert f.tips == [TIPS["arms"], TIPS["feet"]]


def test_pas_de_conseils_de_profil():
    f = check_framing(View(mask=draw(SIDE_ROWS), landmarks=landmarks(side=True)), "side")
    assert f.tips == []
