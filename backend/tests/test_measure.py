import math

import pytest

from app.measure import DEPTH_RATIO, Landmark, MeasureError, View, ellipse_perimeter, measure
from conftest import FRONT_ROWS, draw, landmarks

HEIGHT = 180


def test_cercle():
    assert ellipse_perimeter(10, 10) == pytest.approx(2 * math.pi * 10)


def test_largeurs_lues_sur_la_photo_de_face(front_view):
    m = measure(HEIGHT, front_view)
    assert m.front.cm_per_px == pytest.approx(0.2)
    assert m.widths_cm == {"chest": 34.0, "waist": 28.0, "hips": 36.0, "thigh": 16.0}


def test_sans_profil_la_profondeur_est_estimee(front_view):
    m = measure(HEIGHT, front_view)
    assert m.depth_source == "estimated"
    assert m.depths_cm["chest"] == pytest.approx(34.0 * DEPTH_RATIO["chest"], abs=0.05)
    assert m.measurements["chest"] == round(ellipse_perimeter(17.0, 34.0 * DEPTH_RATIO["chest"] / 2))
    assert any("profil" in w for w in m.warnings)


def test_avec_profil(front_view, side_view):
    m = measure(HEIGHT, front_view, side_view)
    assert m.depth_source == "profile"
    assert m.depths_cm == {"chest": 24.0, "waist": 20.0, "hips": 24.8, "thigh": 18.0}
    assert m.measurements == {
        "chest": round(ellipse_perimeter(17.0, 12.0)),
        "waist": round(ellipse_perimeter(14.0, 10.0)),
        "hips": round(ellipse_perimeter(18.0, 12.4)),
        "thigh": round(ellipse_perimeter(8.0, 9.0)),
        "inseam": 74,
    }
    assert m.warnings == []


def test_la_taille_est_la_ligne_la_plus_etroite():
    waist = FRONT_ROWS.index((400, 479, 70))
    rows = FRONT_ROWS[:waist] + [(400, 424, 70), (425, 429, 65), (430, 479, 70)] + FRONT_ROWS[waist + 1 :]
    m = measure(HEIGHT, View(mask=draw(rows), landmarks=landmarks()))
    assert m.widths_cm["waist"] == 26.0


def test_bras_colle_au_corps_retire():
    mask = draw(FRONT_ROWS)
    mask[380:521, 200:230] = 1.0
    view = View(mask=mask, landmarks=landmarks(lm13=(215, 380), lm15=(215, 440), lm19=(215, 520)))
    m = measure(HEIGHT, view)
    assert m.widths_cm["waist"] == 28.0
    assert m.front.segments["waist"].arm_removed
    assert any("Bras collés" in w and "à la taille" in w for w in m.warnings)


def test_bras_ecartes_rien_a_retirer(front_view):
    m = measure(HEIGHT, front_view)
    assert not any(s.arm_removed for s in m.front.segments.values())


def test_personne_coupee_par_le_cadre():
    rows = [(0, 199, 40)] + FRONT_ROWS[1:]
    with pytest.raises(MeasureError) as err:
        measure(HEIGHT, View(mask=draw(rows), landmarks=landmarks()))
    assert err.value.code == "body_not_fully_visible"


def test_pieds_invisibles():
    lm = landmarks()
    lm[27] = Landmark(lm[27].x, lm[27].y, 0.1)
    lm[28] = Landmark(lm[28].x, lm[28].y, 0.1)
    with pytest.raises(MeasureError) as err:
        measure(HEIGHT, View(mask=draw(FRONT_ROWS), landmarks=lm))
    assert err.value.code == "body_not_fully_visible"


def test_aucune_personne():
    with pytest.raises(MeasureError) as err:
        measure(HEIGHT, View(mask=draw(FRONT_ROWS), landmarks=[]))
    assert err.value.code == "no_person"


def test_entrejambe_et_cuisse(front_view):
    m = measure(HEIGHT, front_view)
    assert (m.front.inseam.y1, m.front.inseam.y2) == (580, 950)
    assert not m.front.inseam.estimated
    assert m.measurements["inseam"] == 74
    thigh = m.front.segments["thigh"]
    assert thigh.y == 598
    assert (thigh.x1, thigh.x2) == (215, 294)
    assert m.depths_cm["thigh"] == 16.0 * DEPTH_RATIO["thigh"]
    assert not any("ntrejambe" in w for w in m.warnings)


def test_cuisse_de_profil_a_la_meme_hauteur(front_view, side_view):
    m = measure(HEIGHT, front_view, side_view)
    assert m.side.segments["thigh"].y == 598
    assert m.side.inseam is None


def test_jambes_serrees_entrejambe_estime():
    rows = [r if r[0] != 580 else (580, 799, 85) for r in FRONT_ROWS]
    m = measure(HEIGHT, View(mask=draw(rows), landmarks=landmarks()))
    assert m.front.inseam.estimated
    assert m.front.inseam.y1 == 690
    assert any("Jambes serrées" in w for w in m.warnings)
    assert m.widths_cm["thigh"] == 17.0


def test_entrejambe_trop_court_signale():
    rows = FRONT_ROWS[:4] + [(480, 699, 90), (700, 799, 85, 5), (800, 949, 60, 15)]
    m = measure(HEIGHT, View(mask=draw(rows), landmarks=landmarks()))
    assert m.measurements["inseam"] == 50
    assert any("Entrejambe court" in w for w in m.warnings)


def test_main_contre_la_cuisse_retiree():
    mask = draw(FRONT_ROWS)
    mask[560:640, 190:220] = 1.0
    view = View(mask=mask, landmarks=landmarks(lm13=(205, 400), lm15=(205, 560), lm19=(205, 600)))
    m = measure(HEIGHT, view)
    assert (m.front.segments["thigh"].x1, m.front.segments["thigh"].x2) == (305, 384)
