"""
Recipe: ドリフトジェリー（水生） — ported from ranvora-kit (blender/build_monsters.py).

build() returns a finished Rig (geometry, armature, skin weights, clips Idle / Move / Attack / Hit / Die).
Front = -Y in Blender (= +Z in glTF / Three.js), origin at the feet. Sizes are authored with the hero at
about 1.1 units; the final size in tiles comes from creatures.json (scale).
Run through build_creatures.py, not directly.
"""
import math
from rigkit import *  # noqa: F401,F403


def build():
    reset()
    r = Rig("Driftjelly")
    r.bone("root", (0, 0, 0), (0, 0, 0.1), None, False)
    r.bone("bell", (0, 0, 0.78), (0, 0, 1.12), "root")
    ANG = [45, 135, 225, 315]   # 45, 315 が前（-Y 側）
    tents = []
    for i, a in enumerate(ANG):
        ra = math.radians(a)
        o = V((math.sin(ra), -math.cos(ra), 0))
        pts = [V((0, 0, 0.8)) + o * 0.17, V((0, 0, 0.6)) + o * 0.21, V((0, 0, 0.42)) + o * 0.2, V((0, 0, 0.24)) + o * 0.24]
        r.chain(f"tent{i}", [tuple(p) for p in pts], "bell")
        tents.append((i, o, pts))
    r.build_armature()

    bellm = mat("JellyBell", "6fd8e0", rough=0.15, emit="2fb8c4", strength=0.6, alpha=0.78)
    tent, core = mat("JellyTentacle", "4fb8c8", rough=0.2, emit="2fa0b0", strength=0.5, alpha=0.85), mat("GlowCore", "9ffff4", emit="9ffff4", strength=6)
    spot, ink, white = mat("JellySpot", "c9fbff", emit="c9fbff", strength=1.2), mat("Ink", "1b1d22"), mat("EyeHighlight", "ffffff", emit="ffffff", strength=2)

    bm = sphere((0, 0, 0.86), 0.30, (1, 1, 0.85), 16, 10)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.80], context="VERTS")
    r.add("Bell", bm, bellm, ["bell"])
    r.add("Rim", torus((0, 0, 0.82), 0.285, 0.03, seg=20, rseg=5), bellm, ["bell"])
    r.add("Core", ico((0, 0, 0.93), 0.11, sub=1), core, ["bell"])
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        r.add(f"Spot{k}", sphere((math.sin(a) * 0.19, -math.cos(a) * 0.19, 1.0), 0.03, (1, 1, 0.4), 8, 4), spot, ["bell"])
    for sx in (1, -1):
        r.add(f"Eye{sx}", sphere((0.09 * sx, -0.255, 0.9), 0.034, (1, 0.6, 1.1), 10, 6), ink, ["bell"])
        r.add(f"EyeHi{sx}", sphere((0.08 * sx, -0.275, 0.915), 0.011, seg=6, ring=4), white, ["bell"])
    for i, o, pts in tents:
        r.add(f"Tent{i}", tube([tuple(p) for p in pts], [0.045, 0.04, 0.03, 0.008], 7), tent, ["bell", f"tent{i}_1", f"tent{i}_2", f"tent{i}_3"])
    # 短いフリル触手（ベルに固定）
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        o = V((math.sin(a), -math.cos(a), 0))
        p0 = V((0, 0, 0.8)) + o * 0.24
        r.add(f"Frill{k}", tube([tuple(p0), tuple(p0 + o * 0.03 + V((0, 0, -0.12)))], [0.018, 0.004], 5), tent, ["bell"])
    r.skin()

    def wave(phase, amp=12, extra=None):
        p = {}
        for i, o, pts in tents:
            side = V((0, 0, 1)).cross(o)  # 触手の横方向
            for j in (1, 2, 3):
                ang = amp * math.sin(phase + i * 1.3 + j * 0.9)
                ax = side * ang + o * (amp * 0.5 * math.cos(phase + i + j))
                p[f"tent{i}_{j}"] = ("e", (ax.x, ax.y, ax.z))
        if extra: p.update(extra)
        return p
    r.clip("Idle", [
        (0, wave(0, extra={"bell": ("l", (0, 0, 0.0))})),
        (12, wave(1.57, extra={"bell": ("s", (1.06, 1.06, 0.9)), "root": ("l", (0, 0, 0.03))})),
        (24, wave(3.14, extra={"root": ("l", (0, 0, 0.05))})),
        (36, wave(4.71, extra={"bell": ("s", (0.96, 0.96, 1.06)), "root": ("l", (0, 0, 0.02))})),
        (48, wave(6.283, extra={"bell": ("l", (0, 0, 0.0))})),
    ])
    trail = lambda amt: {f"tent{i}_{j}": ("e", (amt * (1 if o.y < 0 else 0.7), 0, 0)) for i, o, _ in tents for j in (1, 2, 3)}
    r.clip("Move", [
        (0, {**wave(0, 8), **{k: v for k, v in trail(10).items()}, "bell": ("e", (14, 0, 0))}),
        (6, {**trail(25), "bell": ("el", (16, 0, 0), (0, 0, 0)), "root": ("l", (0, 0, 0.06))}),
        (8, {**trail(28), "bell": ("s", (0.9, 0.9, 1.12)), "root": ("l", (0, 0, 0.08))}),
        (16, {**trail(15), "bell": ("e", (12, 0, 0)), "root": ("l", (0, 0, 0.02))}),
        (24, {**wave(0, 8), **trail(10), "bell": ("e", (14, 0, 0))}),
    ])
    front = [i for i, o, _ in tents if o.y < 0]
    back = [i for i, o, _ in tents if o.y > 0]
    def lash(dirs, bell, root=(0, 0, 0)):
        p = {"bell": bell, "root": ("l", root)}
        for i, o, pts in tents:
            if i in front:
                for j, d in zip((1, 2, 3), dirs):
                    p[f"tent{i}_{j}"] = ("a", (o.x * 0.4 + d[0] * 0, d[1], d[2]))
            else:
                p[f"tent{i}_1"] = ("e", (20, 0, 0))
        return p
    r.clip("Attack", [
        (0, wave(0, 8)),
        (9, lash([(0, -0.6, 0.8), (0, -0.2, 1), (0, 0.3, 1)], ("e", (-15, 0, 0)), (0, 0.05, 0.08))),
        (14, lash([(0, -1, -0.1), (0, -1, -0.35), (0, -0.7, -0.7)], ("e", (22, 0, 0)), (0, -0.18, 0.0))),
        (18, lash([(0, -0.8, -0.6), (0, -0.4, -0.9), (0, -0.2, -1)], ("e", (18, 0, 0)), (0, -0.15, -0.03))),
        (30, wave(0, 8)),
    ])
    r.clip("Hit", [
        (0, wave(0, 8)),
        (3, {**wave(2, 25), "bell": ("el", (-22, 0, 0), (0, 0, 0)), "root": ("l", (0, 0.12, 0.06))}),
        (5, {**wave(2.5, 25), "bell": ("s", (1.15, 1.15, 0.8)), "root": ("l", (0, 0.12, 0.05))}),
        (16, wave(0, 8)),
    ])
    limp = {f"tent{i}_{j}": ("a", (o.x * 0.6, o.y * 0.6, -0.3)) for i, o, _ in tents for j in (1, 2, 3)}
    r.clip("Die", [
        (0, wave(0, 8)),
        (5, {**wave(2, 25), "bell": ("e", (-22, 0, 0)), "root": ("l", (0, 0.1, 0.05))}),
        (24, {**limp, "bell": ("el", (-10, 0, 25), (0, 0, 0)), "root": ("l", (0, 0.05, -0.45))}),
        (34, {**limp, "bell": ("s", (1.25, 1.25, 0.45)), "root": ("l", (0, 0.05, -0.62))}),
        (44, {**limp, "bell": ("s", (1.35, 1.35, 0.35)), "root": ("l", (0, 0.05, -0.66))}),
    ])
    return r
