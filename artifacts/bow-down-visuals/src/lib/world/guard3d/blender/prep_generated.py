"""
prep_generated.py — PROOF v2 (branch world-3d-characters).

Prepares a generated statue GLB for the showdown stage:
  mode=inspect : import, print bbox/tris, render 4 workbench thumbnails
                 (from blender -Y/+Y/+X/-X) so a human can pick the
                 facing rotation.
  mode=prep    : rotate (around up) by --rot degrees, scale to 1.92 m,
                 ground at y=0, decimate to ~--faces, optionally
                 front-project the approved art as the texture
                 (--project-art), export GLB.

Run: blender -b -noaudio --python prep_generated.py -- <mode> <in.glb> <out-or-dir> [options]
"""
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MODE = argv[0]
SRC = argv[1]
DST = argv[2]
opts = {}
for a in argv[3:]:
    if a.startswith("--") and "=" in a:
        k, v = a[2:].split("=", 1)
        opts[k] = v

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("IMPORTED objects:", [(o.name, len(o.data.polygons)) for o in meshes])
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = meshes[0] if meshes else None
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
xs = [c.x for c in bb]; ys = [c.y for c in bb]; zs = [c.z for c in bb]
tris = sum(p.loop_total - 2 for p in obj.data.polygons)
print(f"BBOX blender-space: x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] z[{min(zs):.3f},{max(zs):.3f}] tris={tris}")

if MODE == "inspect":
    os.makedirs(DST, exist_ok=True)
    # workbench shading shows pure form
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.55, 0.6, 0.65)
    scene.render.resolution_x = 360
    scene.render.resolution_y = 540
    center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    size = max(max(xs) - min(xs), max(zs) - min(zs)) * 1.9
    cam_data = bpy.data.cameras.new("c")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new("s", "SUN")
    sun_data.energy = 3
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    views = {"from-negY": (0, -1, 0.25), "from-posY": (0, 1, 0.25), "from-posX": (1, 0, 0.25), "from-negX": (-1, 0, 0.25)}
    for name, d in views.items():
        dv = Vector(d).normalized()
        cam.location = center + dv * 5
        cam.rotation_euler = dv.to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (dv * 0.8).to_track_quat("-Z", "Y").to_euler() if False else (0.6, 0.2, 0.8)
        scene.render.filepath = os.path.join(DST, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", name)
    sys.exit(0)

# ── prep ────────────────────────────────────────────────────────────
rot = math.radians(float(opts.get("rot", "0")))
obj.rotation_euler = (0, 0, rot)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
xs = [c.x for c in bb]; ys = [c.y for c in bb]; zs = [c.z for c in bb]
height = max(zs) - min(zs)
scale = 1.92 / height
obj.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
zs = [c.z for c in bb]; xs = [c.x for c in bb]; ys = [c.y for c in bb]
# ground (z -> 0) and centre x/y on the origin (blender z is up;
# the stage's three-space ground is y=0 after export)
obj.location.x -= (min(xs) + max(xs)) / 2
obj.location.y -= (min(ys) + max(ys)) / 2
obj.location.z -= min(zs)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

target = int(opts.get("faces", "19000"))
cur = sum(p.loop_total - 2 for p in obj.data.polygons)
if cur > target:
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = target / cur
    bpy.ops.object.modifier_apply(modifier="dec")
    print(f"DECIMATED {cur} -> {sum(p.loop_total - 2 for p in obj.data.polygons)}")

if opts.get("project-art"):
    art_path = opts["project-art"]
    img = bpy.data.images.load(art_path)
    # front-projection UVs in three-space: blender (x, y_front, z_up)
    # three x = blender x ; three y = blender z ; front = blender +y
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for loop in me.loops:
        vx, vy, vz = me.vertices[loop.vertex_index].co
        u = min(0.99, max(0.01, 0.5 + vx * 0.92))
        v = min(0.99, max(0.01, (vz / 1.92) * 0.99 + 0.005))
        uv[loop.index].uv = (u, v)
    m = bpy.data.materials.new("artProjected")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.5
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.clear()
    me.materials.append(m)
    print("ART PROJECTED", art_path)

obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_yup=True, use_selection=True)
print("PREP_EXPORTED", DST)
