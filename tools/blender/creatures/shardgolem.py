"""
Recipe: シャードゴーレム（鉱物） — ported from ranvora-kit (blender/build_monsters.py).

build() returns a finished Rig (geometry, armature, skin weights, clips Idle / Move / Attack / Hit / Die).
Front = -Y in Blender (= +Z in glTF / Three.js), origin at the feet. Sizes are authored with the hero at
about 1.1 units; the final size in tiles comes from creatures.json (scale).
Run through build_creatures.py, not directly.
"""
import math
from rigkit import *  # noqa: F401,F403


def build():
    reset()
    r = Rig("Shardgolem")
    r.bone("root", (0, 0, 0), (0, 0, 0.1), None, False)
    r.bone("hips", (0, 0, 0.55), (0, 0, 0.70), "root")
    r.bone("torso", (0, 0, 0.70), (0, 0, 1.15), "hips")
    r.bone("head", (0, -0.06, 1.15), (0, -0.06, 1.36), "torso")
    r.side("upperarm", (0.36, 0, 1.06), (0.47, 0, 0.78), "torso")
    r.side("lowerarm", (0.47, 0, 0.78), (0.52, -0.04, 0.50), "upperarm_$")
    r.side("hand", (0.52, -0.04, 0.50), (0.53, -0.06, 0.32), "lowerarm_$")
    r.side("upperleg", (0.17, 0, 0.55), (0.18, 0, 0.30), "hips")
    r.side("lowerleg", (0.18, 0, 0.30), (0.18, 0, 0.08), "upperleg_$")
    r.side("foot", (0.18, 0, 0.08), (0.18, -0.13, 0.03), "lowerleg_$")
    r.build_armature()

    rock, rockD, mossm = mat("Rock", "77716a"), mat("RockDark", "4b4744"), mat("MossDark", "4f6e33")
    cry, eye = mat("CrystalTeal", "49e6d6", rough=0.2, emit="49e6d6", strength=2.5), mat("GlowAmber", "ffcf6a", emit="ffcf6a", strength=6)

    r.add("Torso", jitter(box((0, 0, 0.94), (0.64, 0.46, 0.52), bevel=0.18), 0.012, 2), rock, ["torso", "hips"])
    r.add("Belly", jitter(box((0, -0.01, 0.65), (0.46, 0.36, 0.22)), 0.01, 3), rockD, ["hips", "torso"])
    r.add("ShoulderL", jitter(ico((0.34, 0, 1.08), 0.14, (1, 1, 0.8), 1), 0.01, 4), rock, ["torso"])
    r.add("ShoulderR", jitter(ico((-0.34, 0, 1.08), 0.14, (1, 1, 0.8), 1), 0.01, 5), rock, ["torso"])
    r.add("Head", jitter(box((0, -0.08, 1.25), (0.26, 0.26, 0.22)), 0.01, 6), rock, ["head"])
    r.add("Brow", box((0, -0.2, 1.31), (0.24, 0.05, 0.05)), rockD, ["head"])
    r.add("Eye", sphere((0, -0.215, 1.25), 0.045, (1.7, 0.5, 0.7), 10, 6), eye, ["head"])
    r.add("HeadMoss", jitter(ico((0.02, -0.06, 1.37), 0.11, (1.2, 1.1, 0.35), 1), 0.01, 7), mossm, ["head"])
    r.add("BackMoss", jitter(ico((-0.18, 0.18, 1.18), 0.13, (1.2, 0.6, 0.4), 1), 0.01, 8), mossm, ["torso"])
    for i, (c, h, rr, t) in enumerate([((0.12, 0.2, 1.08), 0.38, 0.07, (-28, 12, 0)), ((-0.12, 0.22, 1.02), 0.3, 0.06, (-35, -18, 0)),
                                       ((0.0, 0.18, 1.16), 0.46, 0.08, (-16, 0, 0)), ((0.38, 0.05, 1.14), 0.2, 0.05, (0, 25, 0)),
                                       ((0.22, 0.2, 0.9), 0.22, 0.05, (-45, 20, 0))]):
        r.add(f"Crystal{i}", crystal(c, h, rr, t), cry, ["torso"])
    for sx, s in ((1, "L"), (-1, "R")):
        r.add(f"UpperArm{s}", jitter(ico((0.43 * sx, 0, 0.92), 0.13, (1, 1, 1.3), 1), 0.01, 10), rock, [f"upperarm_{s}"])
        r.add(f"LowerArm{s}", jitter(ico((0.5 * sx, -0.02, 0.63), 0.145, (1, 1, 1.2), 1), 0.01, 11), rock, [f"lowerarm_{s}"])
        r.add(f"Fist{s}", jitter(box((0.53 * sx, -0.06, 0.38), (0.25, 0.25, 0.24)), 0.01, 12), rockD, [f"hand_{s}"])
        r.add(f"FistCry{s}", crystal((0.6 * sx, -0.06, 0.42), 0.14, 0.035, (0, 60 * sx, 0)), cry, [f"hand_{s}"])
        r.add(f"Thigh{s}", jitter(ico((0.18 * sx, 0, 0.43), 0.12, (1, 1, 1.1), 1), 0.01, 13), rock, [f"upperleg_{s}"])
        r.add(f"Shin{s}", jitter(box((0.18 * sx, 0, 0.19), (0.2, 0.22, 0.26)), 0.01, 14), rock, [f"lowerleg_{s}"])
        r.add(f"Foot{s}", box((0.18 * sx, -0.06, 0.05), (0.25, 0.33, 0.1)), rockD, [f"foot_{s}"])
    r.skin()

    ARMS = {"upperarm_L": ("a", (0.35, 0.05, -1)), "upperarm_R": ("a", (-0.35, 0.05, -1)),
            "lowerarm_L": ("a", (0.15, -0.15, -1)), "lowerarm_R": ("a", (-0.15, -0.15, -1))}
    r.clip("Idle", [
        (0, {**ARMS, "torso": ("e", (2, 0, 0))}),
        (30, {**ARMS, "torso": ("e", (-1, 0, 2)), "hips": ("l", (0, 0, -0.012)), "head": ("e", (0, 0, -8)),
              "upperarm_L": ("a", (0.4, 0.08, -1)), "upperarm_R": ("a", (-0.4, 0.08, -1))}),
        (60, {**ARMS, "torso": ("e", (2, 0, 0))}),
    ])
    W0 = {"upperleg_L": ("e", (-22, 0, 0)), "lowerleg_L": ("e", (8, 0, 0)), "upperleg_R": ("e", (18, 0, 0)), "lowerleg_R": ("e", (20, 0, 0)),
          "hips": ("el", (0, 0, 5), (0, 0, -0.02)), "torso": ("e", (6, 0, -8)),
          "upperarm_L": ("a", (0.35, 0.4, -1)), "upperarm_R": ("a", (-0.35, -0.45, -1)),
          "lowerarm_L": ("a", (0.15, 0.1, -1)), "lowerarm_R": ("a", (-0.15, -0.5, -1))}
    W1 = {"upperleg_L": ("e", (0, 0, 0)), "upperleg_R": ("e", (-12, 0, 0)), "lowerleg_R": ("e", (45, 0, 0)),
          "hips": ("el", (0, 0, 0), (0, 0, 0.02)), "torso": ("e", (6, 0, 0)), **ARMS}
    def mir(p):
        o = {}
        for n, s in p.items():
            m = n[:-1] + ("R" if n.endswith("_L") else "L") if n[-2:] in ("_L", "_R") else n
            if s[0] == "e": o[m] = ("e", (s[1][0], -s[1][1], -s[1][2]))
            elif s[0] == "a": o[m] = ("a", (-s[1][0], s[1][1], s[1][2]))
            elif s[0] == "el": o[m] = ("el", (s[1][0], -s[1][1], -s[1][2]), (-s[2][0], s[2][1], s[2][2]))
            else: o[m] = s
        return o
    r.clip("Move", [(0, W0), (10, W1), (20, mir(W0)), (30, mir(W1)), (40, W0)])
    r.clip("Attack", [
        (0, {**ARMS}),
        (12, {"upperarm_L": ("a", (0.25, 0.25, 1)), "upperarm_R": ("a", (-0.25, 0.25, 1)), "lowerarm_L": ("a", (0.05, 0.4, 1)), "lowerarm_R": ("a", (-0.05, 0.4, 1)),
              "torso": ("e", (-18, 0, 0)), "head": ("e", (10, 0, 0)), "hips": ("l", (0, 0.03, 0.02)), "upperleg_L": ("e", (-10, 0, 0))}),
        (18, {"upperarm_L": ("a", (0.18, -1, -0.25)), "upperarm_R": ("a", (-0.18, -1, -0.25)), "lowerarm_L": ("a", (0.05, -0.6, -0.8)), "lowerarm_R": ("a", (-0.05, -0.6, -0.8)),
              "torso": ("e", (28, 0, 0)), "head": ("e", (-12, 0, 0)), "hips": ("l", (0, -0.05, -0.08)),
              "upperleg_L": ("e", (-30, 0, 0)), "lowerleg_L": ("e", (35, 0, 0)), "upperleg_R": ("e", (15, 0, 0)), "lowerleg_R": ("e", (25, 0, 0))}),
        (26, {"upperarm_L": ("a", (0.2, -1, -0.35)), "upperarm_R": ("a", (-0.2, -1, -0.35)), "lowerarm_L": ("a", (0.05, -0.55, -0.85)), "lowerarm_R": ("a", (-0.05, -0.55, -0.85)),
              "torso": ("e", (25, 0, 0)), "hips": ("l", (0, -0.05, -0.07)),
              "upperleg_L": ("e", (-28, 0, 0)), "lowerleg_L": ("e", (33, 0, 0)), "upperleg_R": ("e", (14, 0, 0)), "lowerleg_R": ("e", (24, 0, 0))}),
        (42, {**ARMS}),
    ])
    r.clip("Hit", [
        (0, {**ARMS}),
        (4, {**ARMS, "torso": ("e", (-14, 0, 6)), "head": ("e", (-10, 0, 10)), "hips": ("l", (0, 0.06, 0)),
             "upperarm_L": ("a", (0.6, 0.3, -0.8)), "upperarm_R": ("a", (-0.6, 0.3, -0.8))}),
        (16, {**ARMS}),
    ])
    r.clip("Die", [
        (0, {**ARMS}),
        (10, {**ARMS, "hips": ("l", (0, 0, -0.18)), "upperleg_L": ("e", (-50, 0, 0)), "lowerleg_L": ("e", (90, 0, 0)), "foot_L": ("e", (-40, 0, 0)),
              "upperleg_R": ("e", (-50, 0, 0)), "lowerleg_R": ("e", (90, 0, 0)), "foot_R": ("e", (-40, 0, 0)), "torso": ("e", (15, 0, 0)), "head": ("e", (20, 0, 0))}),
        (26, {"root": ("el", (82, 0, 0), (0, -0.12, 0.05)), "hips": ("l", (0, 0, -0.18)), "upperleg_L": ("e", (-20, 0, 0)), "lowerleg_L": ("e", (40, 0, 0)),
              "upperleg_R": ("e", (-20, 0, 0)), "lowerleg_R": ("e", (40, 0, 0)), "torso": ("e", (5, 0, 0)), "head": ("e", (20, 0, 0)),
              "upperarm_L": ("a", (0.8, -0.2, 0.5)), "upperarm_R": ("a", (-0.8, -0.2, 0.5))}),
        (44, {"root": ("el", (88, 0, 0), (0, -0.12, -0.02)), "hips": ("l", (0, 0, -0.18)), "upperleg_L": ("e", (-20, 0, 0)), "lowerleg_L": ("e", (40, 0, 0)),
              "upperleg_R": ("e", (-20, 0, 0)), "lowerleg_R": ("e", (40, 0, 0)), "torso": ("e", (5, 0, 0)), "head": ("e", (25, 0, 0)),
              "upperarm_L": ("a", (0.85, -0.2, 0.5)), "upperarm_R": ("a", (-0.85, -0.2, 0.5))}),
    ])
    return r
