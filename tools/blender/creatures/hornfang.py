"""
Recipe: ホーンファング（獣） — ported from ranvora-kit (blender/build_monsters.py).

build() returns a finished Rig (geometry, armature, skin weights, clips Idle / Move / Attack / Hit / Die).
Front = -Y in Blender (= +Z in glTF / Three.js), origin at the feet. Sizes are authored with the hero at
about 1.1 units; the final size in tiles comes from creatures.json (scale).
Run through build_creatures.py, not directly.
"""
import math
from rigkit import *  # noqa: F401,F403


def build():
    reset()
    r = Rig("Hornfang")
    r.bone("root", (0, 0, 0), (0, 0, 0.1), None, False)
    r.bone("hips", (0, 0.30, 0.52), (0, 0.05, 0.55), "root")
    r.bone("spine", (0, 0.05, 0.55), (0, -0.25, 0.58), "hips")
    r.bone("neck", (0, -0.25, 0.58), (0, -0.40, 0.72), "spine")
    r.bone("head", (0, -0.40, 0.72), (0, -0.62, 0.70), "neck")
    r.bone("jaw", (0, -0.47, 0.66), (0, -0.64, 0.62), "head")
    r.chain("tail", [(0, 0.32, 0.56), (0, 0.48, 0.63), (0, 0.62, 0.63), (0, 0.74, 0.58)], "hips")
    r.side("fupper", (0.11, -0.2, 0.50), (0.115, -0.21, 0.28), "spine")
    r.side("flower", (0.115, -0.21, 0.28), (0.115, -0.23, 0.07), "fupper_$")
    r.side("fpaw", (0.115, -0.23, 0.07), (0.115, -0.31, 0.02), "flower_$")
    r.side("hupper", (0.11, 0.30, 0.48), (0.115, 0.38, 0.28), "hips")
    r.side("hlower", (0.115, 0.38, 0.28), (0.115, 0.32, 0.08), "hupper_$")
    r.side("hpaw", (0.115, 0.32, 0.08), (0.115, 0.24, 0.02), "hlower_$")
    r.side("ear", (0.065, -0.44, 0.80), (0.09, -0.42, 0.93), "head")
    r.build_armature()

    fur, furD, mane, belly = mat("FurSlate", "3d4658"), mat("FurDark", "282e3b"), mat("Mane", "e6decb"), mat("FurBelly", "6a7385")
    horn, tip, eye, ink, tooth = mat("Horn", "2b2622"), mat("GlowTeal", "5ff2e2", emit="5ff2e2", strength=4), mat("GlowAmber", "ffb347", emit="ffb347", strength=6), mat("Ink", "1b1d22"), mat("Tooth", "f2eee4")

    r.add("Body", tube([(0, 0.42, 0.52), (0, 0.2, 0.555), (0, -0.05, 0.575), (0, -0.25, 0.6)], [(0.13, 0.13), (0.16, 0.17), (0.17, 0.19), (0.17, 0.19)], 10), fur, ["hips", "spine"])
    r.add("Belly", tube([(0, 0.25, 0.47), (0, -0.2, 0.5)], [(0.1, 0.06), (0.12, 0.07)], 8), belly, ["hips", "spine"])
    r.add("Mane", jitter(tube([(0, -0.12, 0.6), (0, -0.3, 0.66), (0, -0.42, 0.74)], [(0.22, 0.22), (0.21, 0.2), (0.15, 0.14)], 10), 0.015, 3), mane, ["spine", "neck"])
    for k in range(7):
        t = k / 6
        base = V((0, -0.12 - 0.3 * t, 0.78 + 0.05 * t))
        r.add(f"ManeSpike{k}", cone(tuple(base), tuple(base + V((0, 0.12, 0.08 - 0.05 * t))), 0.05, 5), mane, ["spine", "neck"])
    r.add("Head", jitter(sphere((0, -0.5, 0.735), 0.13, (0.9, 1.1, 0.85), 10, 8), 0.006, 4), fur, ["head"])
    r.add("Snout", tube([(0, -0.56, 0.71), (0, -0.70, 0.675)], [(0.075, 0.06), (0.05, 0.04)], 8), furD, ["head"])
    r.add("Nose", sphere((0, -0.71, 0.69), 0.026, (1.2, 1, 0.8), 8, 6), ink, ["head"])
    r.add("Jaw", box((0, -0.59, 0.63), (0.1, 0.15, 0.04)), furD, ["jaw"])
    for sx in (1, -1):
        r.add(f"Fang{sx}", cone((0.035 * sx, -0.64, 0.665), (0.035 * sx, -0.645, 0.62), 0.012, 4), tooth, ["head"])
        r.add(f"Eye{sx}", sphere((0.062 * sx, -0.585, 0.765), 0.024, (1, 0.6, 0.8), 8, 6), eye, ["head"])
        s = "L" if sx > 0 else "R"
        r.add(f"Ear{s}", cone((0.065 * sx, -0.44, 0.80), (0.095 * sx, -0.42, 0.95), 0.045, 4), furD, [f"ear_{s}"])
        r.add(f"FUpper{s}", tube([(0.11 * sx, -0.2, 0.52), (0.115 * sx, -0.21, 0.28)], [0.065, 0.045], 7), fur, [f"fupper_{s}", "spine"])
        r.add(f"FLower{s}", tube([(0.115 * sx, -0.21, 0.28), (0.115 * sx, -0.23, 0.07)], [0.045, 0.035], 7), furD, [f"flower_{s}"])
        r.add(f"FPaw{s}", sphere((0.115 * sx, -0.27, 0.035), 0.05, (0.9, 1.3, 0.6), 8, 6), furD, [f"fpaw_{s}"])
        r.add(f"HUpper{s}", tube([(0.11 * sx, 0.28, 0.52), (0.115 * sx, 0.38, 0.28)], [0.08, 0.05], 7), fur, [f"hupper_{s}", "hips"])
        r.add(f"HLower{s}", tube([(0.115 * sx, 0.38, 0.28), (0.115 * sx, 0.32, 0.08)], [0.045, 0.035], 7), furD, [f"hlower_{s}"])
        r.add(f"HPaw{s}", sphere((0.115 * sx, 0.28, 0.035), 0.05, (0.9, 1.3, 0.6), 8, 6), furD, [f"hpaw_{s}"])
    hp, hr = [], []
    for i in range(7):
        t = i / 6
        hp.append((0, -0.53 - 0.12 * t, 0.83 + 0.2 * t - 0.04 * t * t)); hr.append(0.032 * (1 - t) + 0.004)
    r.add("Horn", tube(hp, hr, 7), horn, ["head"])
    r.add("HornTip", tube(hp[4:], [x * 1.08 for x in hr[4:]], 7), tip, ["head"])
    r.add("Tail", tube([(0, 0.32, 0.56), (0, 0.48, 0.63), (0, 0.62, 0.63), (0, 0.74, 0.58)], [0.06, 0.08, 0.07, 0.02], 7), fur, ["tail_1", "tail_2", "tail_3"])
    r.add("TailTip", tube([(0, 0.6, 0.635), (0, 0.68, 0.62), (0, 0.76, 0.575)], [0.075, 0.06, 0.005], 7), mane, ["tail_2", "tail_3"])
    r.skin()

    r.clip("Idle", [
        (0, {"tail_1": ("e", (0, 0, 18)), "tail_2": ("e", (0, 0, 10)), "spine": ("e", (0, 0, 0))}),
        (12, {"tail_1": ("e", (0, 0, -18)), "tail_2": ("e", (0, 0, -10)), "spine": ("e", (-2, 0, 0)), "hips": ("l", (0, 0, -0.008)), "head": ("e", (0, 0, 8))}),
        (24, {"tail_1": ("e", (0, 0, 18)), "tail_2": ("e", (0, 0, 10)), "head": ("e", (0, 0, 10)), "ear_L": ("e", (0, 15, 0))}),
        (36, {"tail_1": ("e", (0, 0, -18)), "tail_2": ("e", (0, 0, -10)), "spine": ("e", (-2, 0, 0)), "hips": ("l", (0, 0, -0.008)), "head": ("e", (0, 0, 2))}),
        (48, {"tail_1": ("e", (0, 0, 18)), "tail_2": ("e", (0, 0, 10)), "spine": ("e", (0, 0, 0))}),
    ])
    def legs(fu, fl, hu, hl, off=0):
        return {"fupper_L": ("e", (fu, 0, 0)), "flower_L": ("e", (fl, 0, 0)), "fupper_R": ("e", (fu + off, 0, 0)), "flower_R": ("e", (fl, 0, 0)),
                "hupper_L": ("e", (hu, 0, 0)), "hlower_L": ("e", (hl, 0, 0)), "hupper_R": ("e", (hu + off, 0, 0)), "hlower_R": ("e", (hl, 0, 0))}
    r.clip("Move", [
        (0, {**legs(-45, -10, 35, 10, 8), "spine": ("e", (-4, 0, 0)), "neck": ("e", (6, 0, 0)), "tail_1": ("e", (-25, 0, 0)), "ear_L": ("e", (30, 0, 0)), "ear_R": ("e", (30, 0, 0))}),
        (4, {**legs(-5, 30, -10, -30, 8), "root": ("l", (0, 0, 0.07)), "spine": ("e", (6, 0, 0)), "tail_1": ("e", (-15, 0, 0)), "ear_L": ("e", (30, 0, 0)), "ear_R": ("e", (30, 0, 0))}),
        (8, {**legs(35, 40, -45, -15, 8), "spine": ("e", (10, 0, 0)), "hips": ("l", (0, 0, 0.02)), "neck": ("e", (-6, 0, 0)), "tail_1": ("e", (-30, 0, 0)), "ear_L": ("e", (30, 0, 0)), "ear_R": ("e", (30, 0, 0))}),
        (12, {**legs(-15, 10, 20, -5, 8), "root": ("l", (0, 0, 0.05)), "spine": ("e", (0, 0, 0)), "tail_1": ("e", (-20, 0, 0)), "ear_L": ("e", (30, 0, 0)), "ear_R": ("e", (30, 0, 0))}),
        (16, {**legs(-45, -10, 35, 10, 8), "spine": ("e", (-4, 0, 0)), "neck": ("e", (6, 0, 0)), "tail_1": ("e", (-25, 0, 0)), "ear_L": ("e", (30, 0, 0)), "ear_R": ("e", (30, 0, 0))}),
    ])
    r.clip("Attack", [
        (0, {}),
        (8, {**legs(-20, 15, 30, 40), "hips": ("l", (0, 0.08, -0.07)), "spine": ("e", (-8, 0, 0)), "neck": ("e", (12, 0, 0)), "head": ("e", (-10, 0, 0)),
             "jaw": ("e", (8, 0, 0)), "ear_L": ("e", (40, 0, 0)), "ear_R": ("e", (40, 0, 0)), "tail_1": ("e", (-20, 0, 0))}),
        (13, {**legs(-55, -10, 45, 10), "root": ("l", (0, -0.38, 0.08)), "spine": ("e", (4, 0, 0)), "head": ("e", (8, 0, 0)), "jaw": ("e", (35, 0, 0)),
              "ear_L": ("e", (45, 0, 0)), "ear_R": ("e", (45, 0, 0)), "tail_1": ("e", (-35, 0, 0))}),
        (16, {**legs(-25, 5, 20, 5), "root": ("l", (0, -0.4, 0)), "head": ("e", (15, 0, 0)), "jaw": ("e", (0, 0, 0)), "tail_1": ("e", (-15, 0, 0))}),
        (30, {}),
    ])
    r.clip("Hit", [
        (0, {}),
        (3, {"root": ("l", (0, 0.12, 0)), "spine": ("e", (10, 0, 0)), "neck": ("e", (-15, 0, 0)), "head": ("e", (-15, 0, 10)), "jaw": ("e", (20, 0, 0)),
             "ear_L": ("e", (50, 0, 0)), "ear_R": ("e", (50, 0, 0)), "tail_1": ("e", (30, 0, 0))}),
        (14, {}),
    ])
    lying = {**legs(-30, 20, 25, -10), "root": ("el", (0, 82, 0), (0.0, 0, 0.12)), "neck": ("e", (0, 0, 0)), "head": ("e", (15, 0, 0)), "jaw": ("e", (15, 0, 0)), "tail_1": ("e", (0, 0, 20))}
    r.clip("Die", [
        (0, {}),
        (5, {"root": ("l", (0, 0.12, 0)), "spine": ("e", (10, 0, 0)), "head": ("e", (-15, 0, 10)), "jaw": ("e", (20, 0, 0))}),
        (18, {**legs(-10, 20, 10, 30), "root": ("el", (0, 40, 0), (0.0, 0.05, -0.05)), "head": ("e", (25, 0, 0))}),
        (28, lying),
        (44, {**lying, "head": ("e", (20, 0, 0))}),
    ])
    return r
