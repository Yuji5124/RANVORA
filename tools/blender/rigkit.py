"""
RANVORA rigging helpers for creature recipes (Blender 4.2+ / 5.x).
Ported from ranvora-kit (blender/rigkit.py). Used by build_creatures.py.

RANVORA 用の小さなリギング・ライブラリ（Blender 4.2+ / 5.x）
- 形状をパーツで組み、各パーツに「影響してよいボーン」を指定 → 距離ベースで自動ウェイト
- ポーズは「親から見たワールド軸の回転」で指定（ボーンのロールを意識しなくてよい）
- 色は lowpoly-starter と同じく LP_ マテリアル（フラットシェーディング）
"""
import bpy, bmesh, math, os, json, struct, base64, random
from mathutils import Vector as V, Matrix, Quaternion, Euler


def reset(fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = fps


def srgb(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


_MATS = {}
def mat(name, hexcolor, rough=0.8, metal=0.0, emit=None, strength=3.0, alpha=1.0):
    """LP_ で始まるマテリアル（lowpoly-starter のルール）。emit で発光"""
    key = "LP_" + name
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    m.use_backface_culling = False
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexcolor), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
    return m


class Rig:
    def __init__(self, name):
        self.name = name
        self.bones = {}      # name -> (head, tail, parent, deform)
        self.parts = []      # (obj, candidates)
        self.loose = []      # 武器など（ボーンに子付け）
        self.scene = bpy.context.scene

    # ------------------------------------------------ skeleton
    def bone(self, name, head, tail, parent=None, deform=True):
        self.bones[name] = (V(head), V(tail), parent, deform)

    def side(self, name, head, tail, parent=None, deform=True):
        for s, k in (("L", 1), ("R", -1)):
            p = parent.replace("$", s) if parent else None
            self.bone(f"{name}_{s}", (head[0] * k, head[1], head[2]), (tail[0] * k, tail[1], tail[2]), p, deform)

    def chain(self, prefix, points, parent, deform=True):
        """points: [p0, p1, ... pn] → prefix_1..prefix_n"""
        prev = parent
        for i in range(len(points) - 1):
            n = f"{prefix}_{i + 1}"
            self.bone(n, points[i], points[i + 1], prev, deform)
            prev = n
        return prev

    def build_armature(self):
        # Orientation marker for the validator: a non-deform bone pointing to the front (-Y in Blender = +Z in glTF).
        if "facing" not in self.bones and "root" in self.bones:
            self.bone("facing", (0, 0, 0.02), (0, -0.25, 0.02), "root", False)
        ad = bpy.data.armatures.new(self.name + "Rig")
        self.arm = bpy.data.objects.new(self.name, ad)
        self.scene.collection.objects.link(self.arm)
        bpy.context.view_layer.objects.active = self.arm
        self.arm.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        for n, (h, t, p, d) in self.bones.items():
            eb = ad.edit_bones.new(n)
            eb.head, eb.tail, eb.roll, eb.use_deform = h, t, 0, d
            if p:
                eb.parent = ad.edit_bones[p]
                eb.use_connect = (ad.edit_bones[p].tail - h).length < 1e-5
        bpy.ops.object.mode_set(mode="OBJECT")
        ad.display_type = "STICK"
        self.pb = self.arm.pose.bones
        self.REST = {n: ad.bones[n].matrix_local.to_quaternion() for n in self.bones}
        self.DIR = {n: (t - h).normalized() for n, (h, t, p, d) in self.bones.items()}
        for p in self.pb:
            p.rotation_mode = "QUATERNION"

    # ------------------------------------------------ geometry
    def add(self, name, bm, material, bones, smooth=False):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        self.scene.collection.objects.link(ob)
        if bones is not None:
            self.parts.append((ob, bones))
        return ob

    def attach(self, name, parts, origin, bone):
        """複数パーツを1オブジェクトにまとめ、ボーンに子付け（武器・装飾用）"""
        objs = [self.add(n, bm, m, None) for n, bm, m in parts]
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = ob.data.name = name
        bpy.context.view_layer.update()
        mw = ob.matrix_world.copy()
        ob.parent, ob.parent_type, ob.parent_bone = self.arm, "BONE", bone
        bpy.context.view_layer.update()
        ob.matrix_world = mw
        return ob

    def skin(self):
        def seg(p, a, b):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            return (a + ab * t - p).length
        for ob, cands in self.parts:
            groups = {b: ob.vertex_groups.new(name=b) for b in cands}
            for v in ob.data.vertices:
                ws = sorted(((1.0 / (seg(v.co, self.bones[b][0], self.bones[b][1]) ** 2 + 2e-4) ** 2, b) for b in cands), reverse=True)[:2]
                s = sum(w for w, _ in ws)
                for w, b in ws:
                    if w / s > 0.02:
                        groups[b].add([v.index], w / s, "REPLACE")
        bpy.ops.object.select_all(action="DESELECT")
        for ob, _ in self.parts:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0][0]
        bpy.ops.object.join()
        body = bpy.context.view_layer.objects.active
        body.name = body.data.name = self.name + "Body"
        body.parent = self.arm
        body.modifiers.new("Armature", "ARMATURE").object = self.arm
        self.body = body
        return body

    # ------------------------------------------------ animation
    def _qlocal(self, n, qw):
        r = self.REST[n]
        return r.inverted() @ qw @ r

    def key(self, frame, pose):
        for p in self.pb:
            p.rotation_quaternion = Quaternion(); p.location = V((0, 0, 0)); p.scale = V((1, 1, 1))
        for n, spec in pose.items():
            k = spec[0]
            if k == "e":
                self.pb[n].rotation_quaternion = self._qlocal(n, E(*spec[1]))
            elif k == "a":
                t = V(spec[1]).normalized()
                q = self.DIR[n].rotation_difference(t)
                if len(spec) > 2 and spec[2]:
                    q = Quaternion(t, math.radians(spec[2])) @ q
                self.pb[n].rotation_quaternion = self._qlocal(n, q)
            elif k == "l":
                self.pb[n].location = self.REST[n].inverted() @ V(spec[1])
            elif k == "s":
                s = spec[1]
                self.pb[n].scale = V(s) if isinstance(s, (tuple, list)) else V((s, s, s))
            elif k == "el":
                self.pb[n].rotation_quaternion = self._qlocal(n, E(*spec[1]))
                self.pb[n].location = self.REST[n].inverted() @ V(spec[2])
        for p in self.pb:
            q = p.rotation_quaternion
            if p.name in self._prev and self._prev[p.name].dot(q) < 0:
                p.rotation_quaternion = -q
            self._prev[p.name] = p.rotation_quaternion.copy()
            for path in ("rotation_quaternion", "location", "scale"):
                p.keyframe_insert(path, frame=frame)

    def clip(self, name, frames):
        """frames: [(frame, pose), ...]"""
        self.arm.animation_data_create()
        act = bpy.data.actions.new(name)
        self.arm.animation_data.action = act
        self._prev = {}
        for f, pose in frames:
            self.key(f, pose)
        act.use_fake_user = True
        tr = self.arm.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, int(frames[0][0]), act)
        self.arm.animation_data.action = None
        return act

    # ------------------------------------------------ export
    def finish(self, scale=1.0):
        """Rest pose, and the final size in tiles as the armature's object scale (kept on export)."""
        for p in self.pb:
            p.rotation_quaternion = Quaternion(); p.location = V((0, 0, 0)); p.scale = V((1, 1, 1))
        self.arm.scale = (scale, scale, scale)
        bpy.context.view_layer.update()


def E(x=0, y=0, z=0):
    return Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_quaternion()


def export_glb(path, animations=True):
    kw = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=False)
    if animations:
        kw.update(export_animations=True, export_animation_mode="ACTIONS", export_skins=True,
                  export_def_bones=False, export_force_sampling=True, export_anim_slide_to_zero=True)
    else:
        kw.update(export_animations=False)
    bpy.ops.export_scene.gltf(**kw)


def glb_to_gltf_json(glb, out):
    """lowpoly-starter の Hero と同じ形式：glTF(JSON) にバイナリを base64 で埋め込む"""
    d = open(glb, "rb").read()
    l = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + l])
    o = 20 + l
    bl = struct.unpack("<I", d[o:o + 4])[0]
    j["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(d[o + 8:o + 8 + bl]).decode()
    open(out, "w").write(json.dumps(j, separators=(",", ":")))


# ---------------------------------------------------------------- shapes
def _mx(c, r=None, s=(1, 1, 1)):
    R = r.to_matrix().to_4x4() if r else Matrix.Identity(4)
    return Matrix.Translation(V(c)) @ R @ Matrix.Diagonal((*s, 1))

def sphere(c, r, scale=(1, 1, 1), seg=12, ring=8, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1)
    bmesh.ops.transform(bm, matrix=_mx(c, rot, (r * scale[0], r * scale[1], r * scale[2])), verts=bm.verts)
    return bm

def ico(c, r, scale=(1, 1, 1), sub=1, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1)
    bmesh.ops.transform(bm, matrix=_mx(c, rot, (r * scale[0], r * scale[1], r * scale[2])), verts=bm.verts)
    return bm

def box(c, size, rot=None, bevel=0.2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.transform(bm, matrix=_mx(c, rot, size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(size) * bevel, segments=1, affect="EDGES")
    return bm

def tube(points, radii, seg=8, cap=True):
    bm = bmesh.new()
    pts = [V(p) for p in points]
    rings = []
    n = len(pts)
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = V((0, 0, 1)) if abs(d.z) < 0.9 else V((0, 1, 0))
        a = d.cross(up).normalized(); b = d.cross(a).normalized()
        rx, ry = (r, r) if not isinstance(r, (tuple, list)) else r
        rings.append([bm.verts.new(p + a * math.cos(2 * math.pi * k / seg) * rx + b * math.sin(2 * math.pi * k / seg) * ry) for k in range(seg)])
    for i in range(n - 1):
        for k in range(seg):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
    if cap:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def cone(base, tip, r, seg=6):
    return tube([base, tip], [r, 0.0005], seg)

def crystal(c, h, r, tilt=(0, 0, 0)):
    """6角柱の先を尖らせた結晶"""
    bm = bmesh.new()
    q = Euler(tuple(math.radians(a) for a in tilt)).to_quaternion()
    ring0, ring1 = [], []
    for k in range(6):
        a = 2 * math.pi * k / 6
        ring0.append(bm.verts.new(V(c) + q @ V((math.cos(a) * r, math.sin(a) * r, 0))))
        ring1.append(bm.verts.new(V(c) + q @ V((math.cos(a) * r, math.sin(a) * r, h * 0.7))))
    tip = bm.verts.new(V(c) + q @ V((0, 0, h)))
    for k in range(6):
        bm.faces.new((ring0[k], ring0[(k + 1) % 6], ring1[(k + 1) % 6], ring1[k]))
        bm.faces.new((ring1[k], ring1[(k + 1) % 6], tip))
    bm.faces.new(list(reversed(ring0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def torus(c, R, r, normal=(0, 0, 1), seg=16, rseg=6):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        u = 2 * math.pi * i / seg
        rings.append([bm.verts.new(V(((R + r * math.cos(2 * math.pi * j / rseg)) * math.cos(u),
                                       (R + r * math.cos(2 * math.pi * j / rseg)) * math.sin(u),
                                       r * math.sin(2 * math.pi * j / rseg)))) for j in range(rseg)])
    for i in range(seg):
        for j in range(rseg):
            bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]))
    q = V((0, 0, 1)).rotation_difference(V(normal).normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(c)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def leaf(base, direction, length, width, up=(0, 0, 1)):
    """平たい葉（両面）"""
    bm = bmesh.new()
    d = V(direction).normalized()
    side = d.cross(V(up)).normalized() * width
    b = V(base)
    v0 = bm.verts.new(b)
    v1 = bm.verts.new(b + d * length * 0.45 + side)
    v2 = bm.verts.new(b + d * length)
    v3 = bm.verts.new(b + d * length * 0.45 - side)
    v4 = bm.verts.new(b + d * length * 0.45 + V(up) * width * 0.25)
    bm.faces.new((v0, v1, v4)); bm.faces.new((v1, v2, v4)); bm.faces.new((v2, v3, v4)); bm.faces.new((v3, v0, v4))
    return bm

def jitter(bm, amount, seed=0):
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co += V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    return bm
