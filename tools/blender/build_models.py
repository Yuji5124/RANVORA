"""
RANVORA low-poly model builder for Blender (4.x).

Builds every model described in src/render/modelSpecs.json with bmesh,
adds a small bevel to boxes, and exports one GLB per model to
public/models/<key>.glb.

Conventions (shared with src/render/models.ts):
  * 1 unit = 1 tile, origin at the feet centre
  * models face +Z in glTF / Three.js (= -Y in Blender)
  * part names are kept so the game can animate them (LegL, ArmR, Lid ...)

Run headless:
  blender --background --factory-startup --python tools/blender/build_models.py -- [--only hero,slime]
or simply: npm run models
It can also be run from Blender MCP's execute_blender_code tool.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPEC_PATH = os.path.join(ROOT, "src", "render", "modelSpecs.json")
OUT_DIR = os.path.join(ROOT, "public", "models")

# Three.js (Y up, +Z forward) -> Blender (Z up): (x, y, z) -> (x, -z, y).
# This is exactly what the glTF exporter undoes with export_yup=True.
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def to_blender(v):
    return C @ Vector(v)


_materials = {}


def clear_scene():
    _materials.clear()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def material(hex_color, emissive=False):
    key = (hex_color.lower(), emissive)
    if key in _materials:
        return _materials[key]
    h = hex_color.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    # Principled BSDF expects linear colour.
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    mat = bpy.data.materials.new(name=f"c{h}{'_e' if emissive else ''}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*lin, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 0.8
    _materials[key] = mat
    return mat


def build_mesh(part):
    """Geometry in Three.js space, converted to Blender space."""
    bm = bmesh.new()
    shape = part["shape"]
    if shape == "box":
        w, h, d = part["size"]
        bmesh.ops.create_cube(bm, size=1.0)
        # Scale in Three space (x=w, y=h, z=d) -> Blender (x=w, y=d, z=h)
        bmesh.ops.scale(bm, vec=Vector((w, d, h)), verts=bm.verts)
    elif shape == "sphere":
        bmesh.ops.create_icosphere(bm, subdivisions=part.get("detail", 1) + 1, radius=part.get("radius", 0.5))
    elif shape == "cyl":
        segs = part.get("segments", 8)
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=segs,
            radius1=part.get("radiusBottom", 0.5),
            radius2=part.get("radiusTop", 0.5),
            depth=part.get("height", 1.0),
        )
        # Match Three's CylinderGeometry start angle (first vertex on +Z three = -Y blender).
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "Z"))
    if "scale" in part:
        sx, sy, sz = part["scale"]
        bmesh.ops.scale(bm, vec=Vector((sx, sz, sy)), verts=bm.verts)
    if "offset" in part:
        bmesh.ops.translate(bm, vec=to_blender(part["offset"]), verts=bm.verts)
    for f in bm.faces:
        f.smooth = False
    me = bpy.data.meshes.new(part["name"])
    bm.to_mesh(me)
    bm.free()
    return me


def rotation_matrix(rot_deg):
    rx, ry, rz = (math.radians(a) for a in rot_deg)
    # Three.js Euler 'XYZ' => R = Rx * Ry * Rz (in Three space)
    r_three = Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(ry, 3, "Y") @ Matrix.Rotation(rz, 3, "Z")
    return C @ r_three @ C.transposed()


def build_model(key, spec):
    root = bpy.data.objects.new(key, None)
    bpy.context.scene.collection.objects.link(root)
    objs = {}
    for part in spec["parts"]:
        me = build_mesh(part)
        me.materials.append(material(part["color"], part.get("emissive", False)))
        ob = bpy.data.objects.new(part["name"], me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = objs.get(part.get("parent"), root)
        ob.location = to_blender(part["pos"])
        if "rot" in part:
            ob.rotation_mode = "XYZ"
            ob.rotation_euler = rotation_matrix(part["rot"]).to_euler("XYZ")
        # Game-side flags travel as glTF extras.
        for flag in ("cutout", "tint", "emissive"):
            if part.get(flag):
                ob[flag] = 1
        if part["shape"] == "box" and min(part["size"]) > 0.05:
            mod = ob.modifiers.new("Bevel", "BEVEL")
            mod.width = min(0.02, min(part["size"]) * 0.12)
            mod.segments = 1
            mod.limit_method = "ANGLE"
        objs[part["name"]] = ob
    return root


def export(key, root):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for ob in root.children_recursive:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT_DIR, f"{key}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_animations=False,
    )
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    with open(SPEC_PATH, encoding="utf-8") as f:
        specs = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    os.makedirs(OUT_DIR, exist_ok=True)
    # Order requested by the Phase 0 brief first, the rest after.
    order = ["hero", "slime", "deer", "wolf", "tree", "rock", "house", "chest"]
    keys = order + [k for k in specs if k not in order]
    for key in keys:
        if only and key not in only:
            continue
        clear_scene()
        root = build_model(key, specs[key])
        path = export(key, root)
        tris = sum(len(o.data.polygons) for o in root.children_recursive if o.type == "MESH")
        print(f"RANVORA_MODEL {key} -> {os.path.relpath(path, ROOT)} ({tris} faces before bevel)")
    print("RANVORA_DONE")


if __name__ == "__main__":
    main()
