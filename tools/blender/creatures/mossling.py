"""
Recipe: モスリング（植物） — ported from ranvora-kit (blender/build_monsters.py).

build() returns a finished Rig (geometry, armature, skin weights, clips Idle / Move / Attack / Hit / Die).
Front = -Y in Blender (= +Z in glTF / Three.js), origin at the feet. Sizes are authored with the hero at
about 1.1 units; the final size in tiles comes from creatures.json (scale).
Run through build_creatures.py, not directly.
"""
import math
from rigkit import *  # noqa: F401,F403


def build():
    reset()
    r = Rig("Mossling")
    r.bone("root", (0, 0, 0), (0, 0, 0.1), None, False)
    r.bone("body", (0, 0, 0.12), (0, 0, 0.44), "root")
    r.chain("sprout", [(0, 0, 0.47), (0, 0.01, 0.58), (0, 0.02, 0.68)], "body")
    r.side("ear", (0.17, 0, 0.40), (0.31, 0.02, 0.50), "body")
    r.side("arm", (0.19, -0.02, 0.25), (0.27, -0.05, 0.14), "body")
    r.side("leg", (0.085, 0, 0.13), (0.085, -0.01, 0.03), "body")
    r.build_armature()

    moss, mossD, belly = mat("MossGreen", "5e8f3e"), mat("MossDark", "3f6b2a"), mat("MossBelly", "c9d99a")
    leafc, bark = mat("LeafLight", "8cc456"), mat("Bark", "5a4330")
    eye, bud, mouth = mat("GlowYellow", "ffe27a", emit="ffe27a", strength=5), mat("GlowTeal", "5ff2e2", emit="5ff2e2", strength=4), mat("Ink", "1b1d22")

    r.add("Body", jitter(sphere((0, 0, 0.28), 0.22, (1.06, 1.0, 0.95), 14, 10), 0.008, 1), moss, ["body"])
    r.add("Belly", sphere((0, -0.11, 0.25), 0.16, (1.0, 0.55, 0.85), 12, 8), belly, ["body"])
    for i, (x, y, z, s) in enumerate([(0.08, 0.06, 0.47, 0.07), (-0.09, 0.08, 0.46, 0.06), (0.0, 0.15, 0.42, 0.08), (0.15, 0.12, 0.36, 0.06), (-0.16, 0.10, 0.37, 0.07), (0, 0.2, 0.28, 0.07)]):
        r.add(f"Tuft{i}", jitter(ico((x, y, z), s, (1, 1, 0.7), 1), 0.006, i), mossD, ["body"])
    for sx in (1, -1):
        r.add(f"Eye{sx}", sphere((0.065 * sx, -0.2, 0.31), 0.036, (1, 0.6, 1.15), 10, 8), eye, ["body"])
        s = "L" if sx > 0 else "R"
        r.add(f"Ear{s}", leaf((0.17 * sx, 0, 0.40), (0.8 * sx, 0.05, 0.55), 0.19, 0.055), leafc, [f"ear_{s}"])
        r.add(f"Arm{s}", tube([(0.17 * sx, -0.02, 0.27), (0.24 * sx, -0.04, 0.2), (0.27 * sx, -0.05, 0.14)], [0.025, 0.02, 0.018], 6), leafc, [f"arm_{s}"])
        r.add(f"Hand{s}", ico((0.275 * sx, -0.055, 0.13), 0.03, sub=1), moss, [f"arm_{s}"])
        r.add(f"Leg{s}", tube([(0.085 * sx, 0, 0.15), (0.085 * sx, 0, 0.05)], [0.05, 0.048], 8), bark, [f"leg_{s}"])
        r.add(f"Foot{s}", sphere((0.085 * sx, -0.025, 0.035), 0.055, (1, 1.3, 0.6), 10, 6), bark, [f"leg_{s}"])
    r.add("Mouth", sphere((0, -0.205, 0.235), 0.022, (1.3, 0.5, 0.7), 8, 6), mouth, ["body"])
    r.add("Stem", tube([(0, 0, 0.45), (0, 0.01, 0.58), (0, 0.02, 0.68)], [0.014, 0.012, 0.01], 6), leafc, ["sprout_1", "sprout_2"])
    r.add("SproutLeafA", leaf((0, 0.02, 0.66), (0.75, 0, 0.45), 0.13, 0.05), leafc, ["sprout_2"])
    r.add("SproutLeafB", leaf((0, 0.02, 0.66), (-0.75, 0, 0.45), 0.13, 0.05), leafc, ["sprout_2"])
    r.add("Bud", ico((0, 0.02, 0.70), 0.03, (1, 1, 1.3), 1), bud, ["sprout_2"])
    r.skin()

    sway = lambda a: {"sprout_1": ("e", (0, a, 0)), "sprout_2": ("e", (0, a * 1.2, 0))}
    r.clip("Idle", [
        (0, {**sway(8)}),
        (20, {"body": ("s", (1.04, 1.04, 0.95)), **sway(-8), "ear_L": ("e", (0, 12, 0)), "ear_R": ("e", (0, -12, 0)),
              "arm_L": ("e", (0, -10, 0)), "arm_R": ("e", (0, 10, 0))}),
        (40, {**sway(8)}),
    ])
    r.clip("Move", [
        (0, {"body": ("s", (1.1, 1.1, 0.86)), "sprout_1": ("e", (-15, 0, 0)), "ear_L": ("e", (0, -15, 0)), "ear_R": ("e", (0, 15, 0))}),
        (4, {"root": ("l", (0, 0, 0.1)), "body": ("s", (0.93, 0.93, 1.1)), "leg_L": ("e", (-25, 0, 0)), "leg_R": ("e", (-25, 0, 0)),
             "sprout_1": ("e", (20, 0, 0)), "sprout_2": ("e", (15, 0, 0)), "ear_L": ("e", (0, 25, 0)), "ear_R": ("e", (0, -25, 0))}),
        (8, {"root": ("l", (0, 0, 0.14)), "leg_L": ("e", (-35, 0, 0)), "leg_R": ("e", (-35, 0, 0)), "sprout_1": ("e", (10, 0, 0)),
             "ear_L": ("e", (0, 30, 0)), "ear_R": ("e", (0, -30, 0)), "arm_L": ("e", (0, -40, 0)), "arm_R": ("e", (0, 40, 0))}),
        (12, {"root": ("l", (0, 0, 0.05)), "body": ("s", (0.96, 0.96, 1.05)), "sprout_1": ("e", (-10, 0, 0))}),
        (16, {"body": ("s", (1.1, 1.1, 0.86)), "sprout_1": ("e", (-15, 0, 0)), "ear_L": ("e", (0, -15, 0)), "ear_R": ("e", (0, 15, 0))}),
    ])
    r.clip("Attack", [
        (0, {}),
        (8, {"body": ("el", (-28, 0, 0), (0, 0.06, -0.03)), "sprout_1": ("e", (-25, 0, 0)), "arm_L": ("e", (-40, 0, -20)), "arm_R": ("e", (-40, 0, 20)),
             "leg_L": ("e", (20, 0, 0)), "leg_R": ("e", (20, 0, 0))}),
        (12, {"root": ("l", (0, -0.3, 0.06)), "body": ("e", (35, 0, 0)), "sprout_1": ("e", (30, 0, 0)), "sprout_2": ("e", (20, 0, 0)),
              "arm_L": ("e", (-80, 0, 0)), "arm_R": ("e", (-80, 0, 0)), "leg_L": ("e", (-30, 0, 0)), "leg_R": ("e", (25, 0, 0))}),
        (15, {"root": ("l", (0, -0.28, 0)), "body": ("s", (1.12, 1.12, 0.85)), "sprout_1": ("e", (15, 0, 0))}),
        (26, {}),
    ])
    r.clip("Hit", [
        (0, {}),
        (3, {"root": ("l", (0, 0.1, 0)), "body": ("el", (-22, 0, 0), (0, 0, 0)), "sprout_1": ("e", (30, 0, 0)), "ear_L": ("e", (0, -35, 0)), "ear_R": ("e", (0, 35, 0))}),
        (5, {"root": ("l", (0, 0.12, 0)), "body": ("s", (1.15, 1.15, 0.82))}),
        (14, {}),
    ])
    r.clip("Die", [
        (0, {}),
        (5, {"root": ("l", (0, 0.1, 0)), "body": ("el", (-22, 0, 0), (0, 0, 0)), "sprout_1": ("e", (30, 0, 0))}),
        (18, {"root": ("el", (-75, 0, 0), (0, 0.18, 0.06)), "sprout_1": ("e", (40, 0, 0)), "sprout_2": ("e", (35, 0, 0)),
              "ear_L": ("e", (0, -40, 0)), "ear_R": ("e", (0, 40, 0)), "leg_L": ("e", (-50, 0, 0)), "leg_R": ("e", (-40, 0, 0))}),
        (24, {"root": ("el", (-90, 0, 0), (0, 0.22, 0.0)), "body": ("s", (1.08, 1.08, 0.92)), "sprout_1": ("e", (55, 0, 0)), "sprout_2": ("e", (45, 0, 0)),
              "ear_L": ("e", (0, -50, 0)), "ear_R": ("e", (0, 50, 0)), "leg_L": ("e", (-50, 0, 0)), "leg_R": ("e", (-40, 0, 0))}),
        (40, {"root": ("el", (-90, 0, 0), (0, 0.22, -0.02)), "body": ("s", (1.0, 1.0, 0.95)), "sprout_1": ("e", (70, 0, 0)), "sprout_2": ("e", (60, 0, 0)),
              "ear_L": ("e", (0, -55, 0)), "ear_R": ("e", (0, 55, 0)), "leg_L": ("e", (-50, 0, 0)), "leg_R": ("e", (-40, 0, 0))}),
    ])
    return r
