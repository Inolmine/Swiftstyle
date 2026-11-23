// Tests repris de swiftstyle-api/tests/test_framing.py.
import { describe, expect, it } from "vitest";
import { MESSAGES, TIPS, checkFraming, orientationOf } from "./framing";
import { CX, FRONT_ROWS, H, SIDE_ROWS, W, draw, frontView, landmarks, sideView, view, type Row } from "./test-silhouettes";

describe("cadrage en direct (comme l'API Python)", () => {
  it("accepte une personne de face, bien cadrée", () => {
    const f = checkFraming(frontView(), "front");
    expect(f.ready).toBe(true);
    expect(f.orientation).toBe("front");
    expect(f.issue).toBeNull();
    expect(f.message).toBe(MESSAGES.ready);
    expect(f.tips).toEqual([]);
    expect(f.box).toEqual({ x1: 0.3, y1: 0.05, x2: 0.7, y2: 0.95 });
    expect(f.landmarks).toHaveLength(33);
  });

  it("accepte une personne de profil, bien cadrée", () => {
    const f = checkFraming(sideView(), "side");
    expect(f.ready).toBe(true);
    expect(f.orientation).toBe("side");
    expect(f.tips).toEqual([]);
  });

  it("demande de se tourner", () => {
    let f = checkFraming(frontView(), "side");
    expect(f.ready).toBe(false);
    expect(f.issue).toBe("wrong_view");
    expect(f.message).toBe(MESSAGES.turn_side);
    f = checkFraming(sideView(), "front");
    expect(f.issue).toBe("wrong_view");
    expect(f.message).toBe(MESSAGES.turn_front);
  });

  it("voit une personne entre face et profil", () => {
    const lm = landmarks({ moved: { 11: [CX - 40, 250], 12: [CX + 40, 250], 23: [CX - 25, 540], 24: [CX + 25, 540] } });
    const v = view(draw(FRONT_ROWS), lm);
    expect(orientationOf(v)).toBe("turning");
    const f = checkFraming(v, "side");
    expect(f.issue).toBe("wrong_view");
    expect(f.message).toBe(MESSAGES.turn_more);
  });

  it("signale l'absence de personne", () => {
    const f = checkFraming(null, "front");
    expect(f.ready).toBe(false);
    expect(f.issue).toBe("no_person");
    expect(f.orientation).toBeNull();
    expect(f.box).toBeNull();
    expect(f.landmarks).toEqual([]);
  });

  it("signale une tête coupée", () => {
    const rows: Row[] = [[0, 199, 40], ...FRONT_ROWS.slice(1)];
    const f = checkFraming(view(draw(rows), landmarks()), "front");
    expect(f.issue).toBe("head_cut");
    expect(f.box).not.toBeNull();
  });

  it("signale des pieds coupés", () => {
    const rows: Row[] = [...FRONT_ROWS.slice(0, -1), [800, H - 1, 60, 15]];
    expect(checkFraming(view(draw(rows), landmarks()), "front").issue).toBe("feet_cut");
  });

  it("signale des chevilles non vues", () => {
    const lm = landmarks();
    for (const i of [27, 28]) lm[i] = { ...lm[i]!, visibility: 0.1 };
    expect(checkFraming(view(draw(FRONT_ROWS), lm), "front").issue).toBe("feet_cut");
  });

  it("signale une personne trop loin", () => {
    const full = draw(FRONT_ROWS);
    const small = new Float32Array(W * H);
    for (let i = 0; i < 450; i++) small.set(full.subarray((50 + 2 * i) * W, (51 + 2 * i) * W), (300 + i) * W);
    const lm = landmarks().map((p) => ({ ...p, y: 0.3 + (p.y - 0.05) / 2 }));
    expect(checkFraming(view(small, lm), "front").issue).toBe("too_far");
  });

  it("signale une personne décentrée", () => {
    const wide = 1500;
    const full = draw(FRONT_ROWS);
    const mask = new Float32Array(wide * H);
    for (let y = 0; y < H; y++) mask.set(full.subarray(y * W + 100, (y + 1) * W), y * wide);
    const lm = landmarks().map((p) => ({ ...p, x: (p.x * W - 100) / wide }));
    expect(checkFraming(view(mask, lm, wide, H), "front").issue).toBe("off_center");
  });

  it("conseille d'écarter les bras et les pieds", () => {
    const lm = landmarks({ moved: { 15: [CX - 110, 600], 16: [CX + 110, 600], 27: [CX - 15, 930], 28: [CX + 15, 930] } });
    const f = checkFraming(view(draw(FRONT_ROWS), lm), "front");
    expect(f.ready).toBe(true);
    expect(f.tips).toEqual([TIPS.arms, TIPS.feet]);
  });

  it("ne donne pas de conseils de profil", () => {
    expect(checkFraming(view(draw(SIDE_ROWS), landmarks({ side: true })), "side").tips).toEqual([]);
  });
});
