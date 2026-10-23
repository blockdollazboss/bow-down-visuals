"""
build_guard_v2.py — PROOF v2 (branch world-3d-characters; not staging code).

The male palace guard modeled IN BLENDER (bpy, fully scripted) from the
approved guard art (public/world/default-character.png): a tailored black
military jacket with gold braid + buttons + epaulettes, a sculpted shark
head with muzzle / jaw / dorsal fin, claw hands, trousers with gold side
stripes, polished shoes, the floor-sweeping shark tail — and the guard's
own regalia ONLY: a plain gold medallion on a dark cord. NO crown, NO
bead chain (those are the King's character lock).

Run:  blender -b -noaudio --python build_guard_v2.py -- <out.glb>

Authoring convention: positions are written in THREE-space (x right,
y up, z BACK — the character's front is -Z, the hall's convention) and
converted to Blender space (x, -z, y) by B(). The house rig's bone
positions (rig.ts) are the measurements the body is built around, so
the proof-stage loader can skin it onto the same 20-bone rig and the
same clips play.
"""
import bpy
import math
import sys
from mathutils import Vector

# ── clean scene ──────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── coordinate conversion: three-space -> blender-space ─────────────
def B(p):
    x, y, z = p
    return Vector((x, -z, y))

def Bdir(d):
    x, y, z = d
    return Vector((x, -z, y))

# ── materials (Principled; export to glTF PBR) ───────────────────────
def mat(name, color, rough, metal):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m

CLOTH   = mat("clothBlack", (0.012, 0.010, 0.006), 0.82, 0.0)
GOLD    = mat("gold",       (0.62, 0.47, 0.16),    0.27, 1.0)
GOLD_D  = mat("goldDark",   (0.45, 0.33, 0.10),    0.38, 1.0)
SKIN    = mat("sharkSkin",  (0.125, 0.150, 0.180), 0.34, 0.05)
SKIN_P  = mat("sharkPale",  (0.78, 0.75, 0.68),    0.42, 0.0)
SHOE    = mat("shoeBlack",  (0.008, 0.008, 0.010), 0.16, 0.10)
EYE     = mat("eyeBlack",   (0.002, 0.002, 0.003), 0.05, 0.0)
MOUTH   = mat("mouthDark",  (0.05, 0.012, 0.010),  0.60, 0.0)
TEETH   = mat("teethWhite", (0.85, 0.83, 0.78),    0.35, 0.0)
CORD    = mat("cordBlack",  (0.006, 0.006, 0.006), 0.70, 0.0)

# The head wears the approved art itself, front-projected: the face
# (eyes, mouth, nostrils, wet-skin detail) is the one place a parametric
# sculpt can't match a portrait, and the palace reads faces front-on.
# Crop: guard-head-crop.png = art px (300..690, 0..680) of the 979x2167
# sheet. UV from three-space position (derived in the build notes):
#   u = 0.5 + x * 2.014 ; v = 1 - (1.94 - y) * 1.6176
import os
_head_img = bpy.data.images.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "guard-head-crop.png"))
HEAD_TEX = bpy.data.materials.new("sharkHeadTex")
HEAD_TEX.use_nodes = True
_hb = HEAD_TEX.node_tree.nodes["Principled BSDF"]
_hb.inputs["Roughness"].default_value = 0.42
_hb.inputs["Metallic"].default_value = 0.0
_tex = HEAD_TEX.node_tree.nodes.new("ShaderNodeTexImage")
_tex.image = _head_img
HEAD_TEX.node_tree.links.new(_tex.outputs["Color"], _hb.inputs["Base Color"])

def project_head_uv(ob):
    """Set per-loop UVs of a head part from its three-space positions."""
    me = ob.data
    uv = me.uv_layers.active.data
    # three-space position of a blender vertex: (x, z_up, -y_front)
    for loop in me.loops:
        vx, vy, vz = me.vertices[loop.vertex_index].co
        x, y = vx, vz
        if vy < -0.03:
            # back of the head (three-space z > 0.03): plain shark skin
            # from the crop's fin patch — never a second ghost face
            uv[loop.index].uv = (0.5, 0.985)
            continue
        u = min(0.99, max(0.01, 0.5 + x * 2.014))
        v = min(0.99, max(0.01, 1.0 - (1.94 - y) * 1.6176))
        uv[loop.index].uv = (u, v)

# ── mesh construction helpers (all authoring in three-space) ────────
def make_obj(name, verts3, faces, material, smooth=True):
    verts = [B(v) for v in verts3]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material:
        me.materials.append(material)
    return ob

def param_sphere(name, center, radii, material, nu=26, nv=18, shape=None):
    """UV sphere from parameters; shape(v, local) may displace a vertex."""
    cx, cy, cz = center
    rx, ry, rz = radii
    verts, faces = [], []
    # top pole
    verts.append((cx, cy + ry, cz))
    for j in range(1, nv):
        phi = math.pi * j / nv
        y = cy + ry * math.cos(phi)
        r = math.sin(phi)
        for i in range(nu):
            th = 2 * math.pi * i / nu
            v = (cx + rx * r * math.cos(th), y, cz + rz * r * math.sin(th))
            verts.append(v)
    verts.append((cx, cy - ry, cz))
    bot = len(verts) - 1
    # top cap
    for i in range(nu):
        faces.append((0, 1 + (i + 1) % nu, 1 + i))
    # middle bands
    for j in range(nv - 2):
        a0 = 1 + j * nu
        b0 = a0 + nu
        for i in range(nu):
            i2 = (i + 1) % nu
            faces.append((a0 + i, a0 + i2, b0 + i2, b0 + i))
    # bottom cap
    last = 1 + (nv - 2) * nu
    for i in range(nu):
        faces.append((bot, last + i, last + (i + 1) % nu))
    if shape:
        verts = [shape(v) for v in verts]
    return make_obj(name, verts, faces, material)

def _basis(tangent3):
    t = Vector(tangent3).normalized()
    up = Vector((0, 1, 0))
    if abs(t.dot(up)) > 0.93:
        up = Vector((1, 0, 0))
    n1 = t.cross(up).normalized()
    n2 = t.cross(n1).normalized()
    return t, n1, n2

def tube_along(name, points, radii, material, radial=18, ellipse=None, cap_ends=True):
    """Tube along a 3D path (three-space). radii: per-point radius or
    (rx, rz) pairs when ellipse='world' (cross-section axes = world X/Z)."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    n = len(pts)
    for k, p in enumerate(pts):
        if k == 0:
            tan = pts[1] - pts[0]
        elif k == n - 1:
            tan = pts[-1] - pts[-2]
        else:
            tan = pts[k + 1] - pts[k - 1]
        t, n1, n2 = _basis(tan)
        r = radii[k] if isinstance(radii, (list, tuple)) and radii and isinstance(radii[0], (list, tuple)) is False and len(radii) == n else radii
        for i in range(radial):
            a = 2 * math.pi * i / radial
            ca, sa = math.cos(a), math.sin(a)
            if ellipse == "world":
                rx, rz = radii[k]
                off = Vector((rx * ca, 0, rz * sa))
                verts.append(tuple(p + off))
            else:
                rk = radii[k] if isinstance(radii, list) else radii
                off = n1 * (ca * rk) + n2 * (sa * rk)
                verts.append(tuple(p + off))
    for k in range(n - 1):
        a0 = k * radial
        b0 = a0 + radial
        for i in range(radial):
            i2 = (i + 1) % radial
            faces.append((a0 + i, b0 + i, b0 + i2, a0 + i2))
    if cap_ends:
        c0 = len(verts); verts.append(tuple(pts[0]))
        c1 = len(verts); verts.append(tuple(pts[-1]))
        for i in range(radial):
            i2 = (i + 1) % radial
            faces.append((c0, i2, i))
            base = (n - 1) * radial
            faces.append((c1, base + i, base + i2))
    return make_obj(name, verts, faces, material)

def profile_tube(name, rings, material, radial=22):
    """Rings = [(center3, rx, rz)] with world-axis ellipse sections."""
    return tube_along(name, [r[0] for r in rings], [(r[1], r[2]) for r in rings],
                      material, radial=radial, ellipse="world")

def cone(name, base_center, direction, length, r_base, r_tip, material, radial=14):
    b = Vector(base_center)
    d = Vector(direction).normalized()
    tip = b + d * length
    return tube_along(name, [tuple(b), tuple(tip)], [r_base, r_tip], material, radial=radial)

def torus(name, center, axis, R, tube_r, material, nu=28, nv=10, arc=2 * math.pi, arc0=0.0):
    c = Vector(center)
    t, n1, n2 = _basis(axis)
    verts, faces = [], []
    steps = max(3, int(nu * arc / (2 * math.pi)))
    for j in range(steps + 1):
        a = arc0 + arc * j / steps
        ring_c = c + (n1 * math.cos(a) + n2 * math.sin(a)) * R
        for i in range(nv):
            b = 2 * math.pi * i / nv
            off = (n1 * math.cos(a) + n2 * math.sin(a)) * (tube_r * math.cos(b)) + t * (tube_r * math.sin(b))
            verts.append(tuple(ring_c + off))
    for j in range(steps):
        a0 = j * nv
        b0 = a0 + nv
        for i in range(nv):
            i2 = (i + 1) % nv
            faces.append((a0 + i, b0 + i, b0 + i2, a0 + i2))
    return make_obj(name, verts, faces, material)

def box(name, center, size, material):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    v = [(cx + dx, cy + dy, cz + dz) for dx in (-sx, sx) for dy in (-sy, sy) for dz in (-sz, sz)]
    # index layout: x-major, then y, then z
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return make_obj(name, v, f, material, smooth=False)

def fin(name, profile, thickness, material):
    """Flat fin from a 2D profile [(z_back, y_up)] in three-space, x-centred."""
    t = thickness / 2
    front = [(-t, y, z) for (z, y) in profile]
    back = [(t, y, z) for (z, y) in profile]
    verts = front + back
    n = len(profile)
    faces = []
    faces.append(tuple(range(n - 1, -1, -1)))            # front face
    faces.append(tuple(range(n, 2 * n)))                  # back face
    for i in range(n):
        i2 = (i + 1) % n
        faces.append((i, i2, n + i2, n + i))
    return make_obj(name, verts, faces, material)

def ring_tube(name, center, rx, rz, tube_r, material, steps=36):
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        pts.append((center[0] + rx * math.cos(a), center[1], center[2] + rz * math.sin(a)))
    pts.append(pts[0])
    return tube_along(name, pts, tube_r, material, radial=8, cap_ends=False)

# ══ TORSO — the tailored jacket ══════════════════════════════════════
# (y, rx, rz): hem flare -> waist -> chest -> shoulders -> collar base
TORSO_RINGS = [
    ((0, 0.845, 0), 0.240, 0.153),
    ((0, 0.900, 0), 0.233, 0.150),
    ((0, 0.980, 0), 0.209, 0.137),
    ((0, 1.080, 0), 0.215, 0.141),
    ((0, 1.180, 0), 0.235, 0.151),
    ((0, 1.300, 0), 0.257, 0.162),
    ((0, 1.400, 0), 0.267, 0.164),
    ((0, 1.480, 0), 0.253, 0.153),
    ((0, 1.540, 0), 0.197, 0.123),
    ((0, 1.585, 0), 0.149, 0.103),
    ((0, 1.605, 0), 0.122, 0.089),
]
profile_tube("Torso", TORSO_RINGS, CLOTH, radial=26)

def rz_at(y):
    """Front surface z (negative) of the torso at height y (interp)."""
    pts = [(r[0][1], r[2]) for r in TORSO_RINGS]
    for k in range(len(pts) - 1):
        if pts[k][0] <= y <= pts[k + 1][0]:
            t = (y - pts[k][0]) / (pts[k + 1][0] - pts[k][0])
            return pts[k][1] * (1 - t) + pts[k + 1][1] * t
    return pts[-1][1]

# collar band + gold collar edge
profile_tube("TorsoCollar", [((0, 1.575, 0), 0.126, 0.096), ((0, 1.620, 0), 0.116, 0.089)], CLOTH, radial=22)
ring_tube("TrimCollar", (0, 1.618, 0), 0.117, 0.090, 0.005, GOLD)

# gold braid down both placket edges + around the hem (the art's braid)
for s in (1, -1):
    path = []
    for y in (1.545, 1.46, 1.36, 1.26, 1.16, 1.06, 0.96, 0.885):
        path.append((0.021 * s, y, -(rz_at(y) + 0.003)))
    tube_along(f"TrimBraid.{'L' if s > 0 else 'R'}", path, 0.0062, GOLD, radial=8)
ring_tube("TrimHem", (0, 0.862, 0), 0.241, 0.154, 0.006, GOLD)

# gold buttons down the closure
for i, y in enumerate((1.455, 1.335, 1.215, 1.095, 0.975)):
    param_sphere(f"TrimButton{i}", (0, y, -(rz_at(y) + 0.004)), (0.0155, 0.0155, 0.010), GOLD, nu=12, nv=10)

# shoulder caps (cloth) blend torso into the sleeves
for s in (1, -1):
    tag = "L" if s > 0 else "R"
    param_sphere(f"TorsoShoulder.{tag}", (0.198 * s, 1.505, 0), (0.088, 0.052, 0.078), CLOTH, nu=18, nv=12)
    # epaulette: gold disc + hanging fringe — a guard's rank, house issue
    tube_along(f"TrimEpaulette.{tag}", [(0.238 * s, 1.540, 0), (0.238 * s, 1.558, 0)], [0.080, 0.080], GOLD, radial=20)
    cone(f"TrimFringe.{tag}", (0.246 * s, 1.542, 0), (0, -1, 0), 0.048, 0.084, 0.089, GOLD_D, radial=20)

# ══ ARMS — sleeves, cuff braid, claw hands ═══════════════════════════
for s in (1, -1):
    tag = "L" if s > 0 else "R"
    sleeve_path = [(0.220 * s, 1.545, 0), (0.258 * s, 1.385, -0.005), (0.292 * s, 1.238, -0.008),
                   (0.314 * s, 1.090, -0.012), (0.330 * s, 0.988, -0.015)]
    tube_along(f"Sleeve.{tag}", sleeve_path, [0.081, 0.073, 0.065, 0.057, 0.051], CLOTH, radial=18)
    # cuff braid: gold band + two rings near the wrist
    tube_along(f"TrimCuff.{tag}", [(0.318 * s, 1.062, -0.013), (0.326 * s, 1.016, -0.014)], [0.0595, 0.0575], GOLD, radial=18)
    arm_dir = (0.15 * s, -0.99, -0.03)
    torus(f"TrimCuffRing1.{tag}", (0.3135 * s, 1.098, -0.012), arm_dir, 0.0585, 0.0045, GOLD)
    torus(f"TrimCuffRing2.{tag}", (0.3305 * s, 0.972, -0.015), arm_dir, 0.0515, 0.0045, GOLD)

    # claw hand: palm + three fingers (two segments each) + thumb
    param_sphere(f"Hand.{tag}", (0.346 * s, 0.905, -0.020), (0.041, 0.069, 0.021), SKIN, nu=16, nv=12)
    for fi, fx in enumerate((-0.027, 0.0, 0.027)):
        bx = 0.346 * s + fx * s
        base = (bx, 0.852, -0.022 - abs(fx) * 0.15)
        mid = (bx + fx * 0.25, 0.806, -0.033)
        tip = (bx + fx * 0.35, 0.768, -0.052)
        tube_along(f"HandFinger{fi}.{tag}", [base, mid, tip], [0.0125, 0.0095, 0.0035], SKIN, radial=10)
    tube_along(f"HandThumb.{tag}",
               [(0.318 * s, 0.892, -0.026), (0.300 * s, 0.852, -0.040), (0.292 * s, 0.822, -0.058)],
               [0.011, 0.008, 0.003], SKIN, radial=10)

# ══ HEAD — the shark ═════════════════════════════════════════════════
def cranium_shape(v):
    x, y, z = v
    # widen the gill region (back-bottom of the skull)
    if z > 0.07 and y < 1.78:
        x *= 1.07
    # flatten the underside of the skull into the jaw line
    if y < 1.60:
        y = 1.60 - (1.60 - y) * 0.55
    return (x, y, z)

_head = param_sphere("Head", (0, 1.730, 0.010), (0.195, 0.168, 0.205), HEAD_TEX, shape=cranium_shape)
project_head_uv(_head)
param_sphere("HeadMuzzle", (0, 1.655, -0.128), (0.138, 0.082, 0.120), HEAD_TEX)
project_head_uv(bpy.data.objects["HeadMuzzle"])
_throat = param_sphere("HeadThroat", (0, 1.645, -0.032), (0.108, 0.092, 0.102), HEAD_TEX)
project_head_uv(_throat)
# the jaw — its own piece; the loader skins it 100% to the jaw bone
_jaw = param_sphere("Jaw", (0, 1.600, -0.060), (0.122, 0.052, 0.142), HEAD_TEX)
project_head_uv(_jaw)
# neck (shark skin above the collar)
profile_tube("Neck", [((0, 1.500, 0), 0.096, 0.092), ((0, 1.600, 0), 0.093, 0.089), ((0, 1.680, 0), 0.090, 0.086)], SKIN, radial=18)
# dorsal fin — swept-back profile fin on the crown
fin("HeadFin", [(0.020, 1.850), (0.100, 1.855), (0.125, 1.905), (0.075, 1.940), (0.022, 1.918)], 0.014, SKIN)
# face detail (eyes, nostrils, mouth, teeth) rides the projected art
# texture on Head/HeadMuzzle/HeadThroat/Jaw — geometry eyes doubled it.

# ══ LEGS — trousers, gold side stripes, polished shoes ═══════════════
for s in (1, -1):
    tag = "L" if s > 0 else "R"
    leg_path = [(0.110 * s, 0.960, 0), (0.110 * s, 0.700, 0.002), (0.110 * s, 0.470, 0),
                (0.110 * s, 0.240, -0.002), (0.110 * s, 0.095, -0.004)]
    tube_along(f"Trouser.{tag}", leg_path, [0.091, 0.081, 0.069, 0.059, 0.051], CLOTH, radial=18)
    box(f"TrimStripeT.{tag}", (0.1995 * s, 0.715, 0.001), (0.005, 0.47, 0.017), GOLD)
    box(f"TrimStripeS.{tag}", (0.1755 * s, 0.280, -0.003), (0.005, 0.40, 0.015), GOLD)
    # shoe: sole + upper + heel + toe cap, polished
    box(f"ShoeSole.{tag}", (0.110 * s, 0.014, -0.045), (0.088, 0.026, 0.270), SHOE)
    param_sphere(f"Shoe.{tag}", (0.110 * s, 0.048, -0.048), (0.047, 0.036, 0.108), SHOE, nu=16, nv=12)
    box(f"ShoeHeel.{tag}", (0.110 * s, 0.020, 0.062), (0.082, 0.040, 0.055), SHOE)
    param_sphere(f"ShoeToe.{tag}", (0.110 * s, 0.036, -0.148), (0.044, 0.029, 0.046), SHOE, nu=14, nv=10)

# ══ TAIL — sweeps from the lower back to the floor behind ════════════
tail_path = [(0, 0.880, 0.115), (0, 0.600, 0.265), (0, 0.300, 0.460),
             (0, 0.090, 0.720), (0, 0.055, 1.000), (0, 0.050, 1.180)]
tube_along("Tail", tail_path, [0.056, 0.048, 0.037, 0.027, 0.020, 0.015], SKIN, radial=16)
fin("TailFin", [(1.06, 0.045), (1.24, 0.028), (1.335, 0.150), (1.265, 0.175), (1.175, 0.085)], 0.011, SKIN)
fin("TailFinLow", [(1.08, 0.048), (1.22, 0.030), (1.315, 0.002), (1.19, 0.012)], 0.011, SKIN)

# ══ REGALIA — plain medallion on a dark cord (the guard's own) ═══════
cord_path = [(-0.052, 1.478, -0.150), (-0.036, 1.378, -0.169), (0, 1.332, -0.177),
             (0.036, 1.378, -0.169), (0.052, 1.478, -0.150)]
tube_along("Cord", cord_path, 0.0045, CORD, radial=8)
tube_along("Medallion", [(0, 1.300, -0.166), (0, 1.300, -0.179)], [0.042, 0.042], GOLD, radial=22)

# ── export ────────────────────────────────────────────────────────────
argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0] if argv else "/tmp/guard-v2-blender.glb"
tris = sum(len(o.data.polygons) and sum(p.loop_total - 2 for p in o.data.polygons)
           for o in bpy.data.objects if o.type == "MESH")
for o in bpy.data.objects:
    o.select_set(o.type == "MESH")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True,
                          export_apply=False, use_selection=True)
print(f"GUARD_V2_EXPORTED {out} objects={len(bpy.data.objects)} approx_tris={tris}")
