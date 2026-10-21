"""
RANVORA creature builder (Blender 4.2+ / 5.x). Rigged, animated GLBs for the ecosystem's species.

  species data (tools/blender/creatures/creatures.json)
    -> recipe (tools/blender/creatures/<recipe>.py: geometry, bones, skin weights, clips)
    -> checks inside Blender (triangles, bones, clips, unweighted vertices)
    -> public/models/<key>.glb
    -> tools/blender/validate.ts (scale, origin, facing, clips, joints, skin weights)

Run headless:
  blender --background --factory-startup --python tools/blender/build_creatures.py -- [--only mossling,hornfang]
or:  npm run creatures      (builds, then validates)

Static models (trees, houses, the hero...) keep using build_models.py and modelSpecs.json.
Each creature is built in a fresh scene; a failure is reported with its cause and the others still build.
The log is written to tools/blender/out/build-creatures.json.
"""

import importlib
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "creatures"))

import bpy  # noqa: E402
import rigkit  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CONFIG = os.path.join(HERE, "creatures", "creatures.json")
OUT_DIR = os.path.join(ROOT, "public", "models")
LOG_DIR = os.path.join(HERE, "out")


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    out = OUT_DIR
    for i, v in enumerate(a):
        if v == "--only" and i + 1 < len(a):
            only = [s.strip() for s in a[i + 1].split(",") if s.strip()]
        if v == "--out" and i + 1 < len(a):
            out = os.path.abspath(a[i + 1])
    return only, out


def blender_checks(rig, entry, clips):
    """Problems found in the Blender scene before export. Empty list = fine."""
    problems = []
    body = rig.body
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    if tris > entry["maxTriangles"]:
        problems.append(f"triangles {tris} > maxTriangles {entry['maxTriangles']}")
    deform = [b for b in rig.arm.data.bones if b.use_deform]
    if len(rig.arm.data.bones) > entry["maxJoints"]:
        problems.append(f"bones {len(rig.arm.data.bones)} > maxJoints {entry['maxJoints']}")
    names = {a.name for a in bpy.data.actions}
    missing = [c for c in clips if c not in names]
    if missing:
        problems.append(f"missing clips: {', '.join(missing)}")
    unweighted = sum(1 for v in body.data.vertices if not v.groups or sum(g.weight for g in v.groups) < 0.5)
    if unweighted:
        problems.append(f"{unweighted} vertices without skin weights")
    groups = {g.name for g in body.vertex_groups}
    stray = sorted(g for g in groups if g not in {b.name for b in deform})
    if stray:
        problems.append(f"vertex groups without a deform bone: {', '.join(stray)}")
    return problems, {"triangles": tris, "bones": len(rig.arm.data.bones), "deformBones": len(deform), "clips": sorted(names)}


def build_one(entry, clips, out_dir):
    started = time.time()
    rec = {"key": entry["key"], "recipe": entry["recipe"], "ok": False}
    try:
        rigkit.reset()
        mod = importlib.import_module(entry["recipe"])
        importlib.reload(mod)
        rig = mod.build()
        rig.finish(entry["scale"])
        problems, stats = blender_checks(rig, entry, clips)
        rec.update(stats)
        if problems:
            rec["errors"] = problems
            return rec
        path = os.path.join(out_dir, entry["key"] + ".glb")
        rigkit.export_glb(path, animations=True)
        rec.update(ok=True, file=os.path.relpath(path, ROOT), bytes=os.path.getsize(path))
    except Exception as e:  # report the cause, keep building the others
        rec["errors"] = [f"{type(e).__name__}: {e}"]
        rec["traceback"] = traceback.format_exc().splitlines()[-6:]
    finally:
        rec["seconds"] = round(time.time() - started, 2)
    return rec


def main():
    only, out_dir = args()
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    entries = [e for e in cfg["creatures"] if not only or e["key"] in only]
    if only:
        unknown = sorted(set(only) - {e["key"] for e in cfg["creatures"]})
        if unknown:
            print(f"Unknown creature key(s): {', '.join(unknown)}")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    results = [build_one(e, cfg["clips"], out_dir) for e in entries]
    json.dump({"blender": bpy.app.version_string, "results": results}, open(os.path.join(LOG_DIR, "build-creatures.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    for r in results:
        if r["ok"]:
            print(f"  OK   {r['key']:<12} {r['triangles']:>5} tris  {r['bones']:>3} bones  {r['bytes']:>7} bytes  {r['seconds']}s")
        else:
            print(f"  FAIL {r['key']:<12} " + " | ".join(r.get("errors", [])))
            for line in r.get("traceback", []):
                print(f"       {line}")
    failed = [r for r in results if not r["ok"]]
    print(f"{len(results) - len(failed)}/{len(results)} creatures built -> {os.path.relpath(out_dir, ROOT)}")
    sys.exit(1 if failed or not results else 0)


main()
