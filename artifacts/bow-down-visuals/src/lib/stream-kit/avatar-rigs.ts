/**
 * avatar-rigs.ts — the Avatar source's characters: emblem-grade flat
 * illustration drawn in code on the studio canvas, in the house
 * gold/onyx palette. Every rig is a pure draw function of DriveValues
 * (avatar-drive.ts): head pose, blinks, gaze, brow and jaw come from
 * the drive, never from hidden state, so a rig renders the same pose
 * for the same values in the studio, the preview, and a test.
 *
 * The art direction is mascot-emblem, not clip-art: bold keylines,
 * three-tone shading (base gradient + clipped form shade + rim
 * light), a gold halo medallion behind the head, and grounded
 * shadows. Starters: King Shark, Gold Mask, Golden Mic — plus
 * "upload", the creator's own picture (PNG with transparency reads
 * best), which bobs, breathes and bounces as they talk.
 */

import type { DriveValues } from "./avatar-drive";

export const AVATAR_CHARACTERS = [
  { id: "shark", label: "King Shark" },
  { id: "mask", label: "Gold Mask" },
  { id: "mic", label: "Golden Mic" },
  { id: "upload", label: "Your picture" },
] as const;

export type AvatarCharacterId = (typeof AVATAR_CHARACTERS)[number]["id"];

export function isAvatarCharacterId(v: unknown): v is AvatarCharacterId {
  return AVATAR_CHARACTERS.some((c) => c.id === v);
}

/* Palette — house gold/onyx with character accents. */
const GOLD = "#C9A84C";
const GOLD_BRIGHT = "#EFD887";
const GOLD_PALE = "#F7ECD2";
const GOLD_DEEP = "#7A5A12";
const KEYLINE = "#171106";
const INK = "#241A08";
const CRIMSON = "#8E2434";
const MOUTH_DARK = "#3D1017";

function metalGold(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#F2DC9B");
  g.addColorStop(0.45, GOLD);
  g.addColorStop(0.78, "#A37F2A");
  g.addColorStop(1, GOLD_DEEP);
  return g;
}

/** The shared head rig transform: pivot at the neck, roll tilts, yaw
 *  slides + foreshortens (the standard 2D-rig cheat), pitch nods,
 *  breathing bob on top. */
function headTransform(
  ctx: CanvasRenderingContext2D,
  cx: number,
  neckY: number,
  drive: DriveValues,
  u: number,
  tSec: number,
): void {
  const breath = Math.sin(tSec * Math.PI * 2 * 0.21) * u * 0.006;
  ctx.translate(cx + drive.yaw * u * 0.055, neckY + drive.pitch * u * 0.045 + breath);
  ctx.rotate(drive.roll * 0.16);
  ctx.scale(1 - Math.abs(drive.yaw) * 0.16, 1);
  ctx.translate(-cx, -neckY);
}

/** The emblem language shared by the starters: a double gold halo
 *  behind the head (with a whisper of parallax against the yaw) and
 *  a soft ground shadow that grounds the figure. */
function emblemBackdrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  haloY: number,
  haloR: number,
  groundY: number,
  drive: DriveValues,
  u: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(201,168,76,0.5)";
  ctx.lineWidth = u * 0.007;
  ctx.beginPath();
  ctx.ellipse(cx + drive.yaw * u * 0.012, haloY, haloR, haloR, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(201,168,76,0.22)";
  ctx.lineWidth = u * 0.003;
  ctx.beginPath();
  ctx.ellipse(cx + drive.yaw * u * 0.012, haloY, haloR * 1.07, haloR * 1.07, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY, u * 0.3, u * 0.026, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * An almond eye with a gold-ringed iris, gaze tracking, and a
 * skin-tone lid shutter for blinks. `lidTone` is the surrounding
 * surface colour so a closed eye disappears INTO the face.
 */
function almondEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  drive: DriveValues,
  blink: number,
  lidTone: string,
  iris = "#8A6420",
): void {
  ctx.save();
  // Almond outline.
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y - h * 0.95, x + w / 2, y);
  ctx.quadraticCurveTo(x, y + h * 0.72, x - w / 2, y);
  ctx.closePath();
  ctx.fillStyle = "#FBF6E9";
  ctx.fill();
  ctx.clip();
  // Iris + pupil, tracking the gaze.
  const px = x + drive.lookX * w * 0.16 + drive.yaw * w * 0.1;
  const py = y + drive.lookY * h * 0.16 + drive.pitch * h * 0.1;
  const irisGrad = ctx.createRadialGradient(px - w * 0.05, py - h * 0.1, w * 0.02, px, py, w * 0.24);
  irisGrad.addColorStop(0, GOLD_BRIGHT);
  irisGrad.addColorStop(0.55, iris);
  irisGrad.addColorStop(1, "#3A2A08");
  ctx.beginPath();
  ctx.ellipse(px, py, w * 0.21, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = irisGrad;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px, py, w * 0.1, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#120C04";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px - w * 0.05, py - h * 0.1, w * 0.045, h * 0.07, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  // Bottom waterline shadow.
  ctx.fillStyle = "rgba(23,17,6,0.12)";
  ctx.fillRect(x - w / 2, y + h * 0.28, w, h * 0.2);
  ctx.restore();
  // Upper lash keyline (re-drawn over the clip).
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y - h * 0.95, x + w / 2, y);
  ctx.strokeStyle = KEYLINE;
  ctx.lineWidth = Math.max(1.6, h * 0.14);
  ctx.lineCap = "round";
  ctx.stroke();
  if (blink > 0.02) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y - h * 0.95, x + w / 2, y);
    ctx.quadraticCurveTo(x, y + h * 0.72, x - w / 2, y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lidTone;
    ctx.fillRect(x - w / 2 - 2, y - h, w + 4, h * 1.35 * blink);
    if (blink > 0.7) {
      ctx.strokeStyle = "rgba(23,17,6,0.65)";
      ctx.lineWidth = Math.max(1.4, h * 0.1);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.34, y + h * 0.12);
      ctx.quadraticCurveTo(x, y + h * 0.3, x + w * 0.34, y + h * 0.12);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ── King Shark ───────────────────────────────────────────────────────── */

function sharkHeadPath(ctx: CanvasRenderingContext2D, cx: number, H: number, u: number): void {
  // Broad, low cranium; strong jaw. Front-facing emblem proportions.
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.648);
  ctx.bezierCurveTo(cx - u * 0.115, H * 0.648, cx - u * 0.192, H * 0.6, cx - u * 0.216, H * 0.52);
  ctx.bezierCurveTo(cx - u * 0.238, H * 0.44, cx - u * 0.24, H * 0.35, cx - u * 0.212, H * 0.262);
  ctx.bezierCurveTo(cx - u * 0.18, H * 0.168, cx - u * 0.1, H * 0.128, cx, H * 0.126);
  ctx.bezierCurveTo(cx + u * 0.1, H * 0.128, cx + u * 0.18, H * 0.168, cx + u * 0.212, H * 0.262);
  ctx.bezierCurveTo(cx + u * 0.24, H * 0.35, cx + u * 0.238, H * 0.44, cx + u * 0.216, H * 0.52);
  ctx.bezierCurveTo(cx + u * 0.192, H * 0.6, cx + u * 0.115, H * 0.648, cx, H * 0.648);
  ctx.closePath();
}

function drawShark(ctx: CanvasRenderingContext2D, drive: DriveValues, W: number, H: number, tSec: number): void {
  const u = Math.min(W, H);
  const cx = W / 2;
  const neckY = H * 0.645;

  emblemBackdrop(ctx, cx, H * 0.385, u * 0.325, H * 0.955, drive, u);

  // Robe — visible structure: shoulders, lapels, placket.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.38, H);
  ctx.bezierCurveTo(cx - u * 0.37, H * 0.82, cx - u * 0.315, H * 0.725, cx - u * 0.19, H * 0.685);
  ctx.lineTo(cx + u * 0.19, H * 0.685);
  ctx.bezierCurveTo(cx + u * 0.315, H * 0.725, cx + u * 0.37, H * 0.82, cx + u * 0.38, H);
  ctx.closePath();
  const robeGrad = ctx.createLinearGradient(cx, H * 0.66, cx, H);
  robeGrad.addColorStop(0, "#2C2110");
  robeGrad.addColorStop(0.35, "#1B1306");
  robeGrad.addColorStop(1, "#0C0803");
  ctx.fillStyle = robeGrad;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.685, u * 0.17, H * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  // Lapels: two deep folds falling from the neckline.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.028, H * 0.7);
    ctx.lineTo(cx + s * u * 0.145, H * 0.7);
    ctx.lineTo(cx + s * u * 0.062, H * 0.86);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fill();
    ctx.strokeStyle = "rgba(201,168,76,0.75)";
    ctx.lineWidth = u * 0.005;
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.145, H * 0.7);
    ctx.lineTo(cx + s * u * 0.062, H * 0.86);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();

  // Chain resting on the chest + shark-tooth pendant.
  ctx.save();
  const chainTop = H * 0.738;
  for (let i = -6; i <= 6; i++) {
    const a = (i / 6) * 0.78;
    ctx.beginPath();
    ctx.ellipse(cx + Math.sin(a) * u * 0.148, chainTop + (1 - Math.cos(a)) * u * 0.055, u * 0.0105, u * 0.0105, 0, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? GOLD : GOLD_BRIGHT;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.02, chainTop + u * 0.055);
  ctx.lineTo(cx + u * 0.02, chainTop + u * 0.055);
  ctx.lineTo(cx, chainTop + u * 0.112);
  ctx.closePath();
  ctx.fillStyle = metalGold(ctx, cx, chainTop + u * 0.05, u * 0.065);
  ctx.fill();
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.003;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  headTransform(ctx, cx, neckY, drive, u, tSec);

  // Pectoral fins sweeping off the jaw over the robe.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.185, H * 0.565);
    ctx.bezierCurveTo(cx + s * u * 0.255, H * 0.595, cx + s * u * 0.272, H * 0.65, cx + s * u * 0.258, H * 0.695);
    ctx.bezierCurveTo(cx + s * u * 0.21, H * 0.65, cx + s * u * 0.192, H * 0.608, cx + s * u * 0.185, H * 0.565);
    ctx.closePath();
    const pect = ctx.createLinearGradient(cx + s * u * 0.18, H * 0.56, cx + s * u * 0.3, H * 0.72);
    pect.addColorStop(0, "#3A5A70");
    pect.addColorStop(1, "#1D3242");
    ctx.fillStyle = pect;
    ctx.fill();
    ctx.strokeStyle = "rgba(214,232,240,0.35)";
    ctx.lineWidth = u * 0.0035;
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.195, H * 0.575);
    ctx.bezierCurveTo(cx + s * u * 0.265, H * 0.61, cx + s * u * 0.29, H * 0.66, cx + s * u * 0.28, H * 0.7);
    ctx.stroke();
  }

  // Head base + shading.
  sharkHeadPath(ctx, cx, H, u);
  const skinGrad = ctx.createLinearGradient(cx - u * 0.1, H * 0.12, cx + u * 0.08, H * 0.66);
  skinGrad.addColorStop(0, "#82A2B6");
  skinGrad.addColorStop(0.55, "#5A768E");
  skinGrad.addColorStop(1, "#3C5D75");
  ctx.fillStyle = skinGrad;
  ctx.fill();
  ctx.save();
  sharkHeadPath(ctx, cx, H, u);
  ctx.clip();
  const shade = ctx.createRadialGradient(cx + u * 0.18, H * 0.52, u * 0.05, cx + u * 0.18, H * 0.52, u * 0.36);
  shade.addColorStop(0, "rgba(24,44,58,0.5)");
  shade.addColorStop(1, "rgba(24,44,58,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(cx - u * 0.25, H * 0.11, u * 0.5, H * 0.56);
  const light = ctx.createRadialGradient(cx - u * 0.1, H * 0.19, u * 0.02, cx - u * 0.1, H * 0.19, u * 0.27);
  light.addColorStop(0, "rgba(230,242,248,0.28)");
  light.addColorStop(1, "rgba(230,242,248,0)");
  ctx.fillStyle = light;
  ctx.fillRect(cx - u * 0.25, H * 0.11, u * 0.5, H * 0.56);
  // Scale texture across the cranium.
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = u * 0.0035;
  for (let row = 0; row < 6; row++) {
    const y = H * 0.15 + row * u * 0.027;
    for (let col = -4; col <= 4; col++) {
      const x = cx + col * u * 0.038 + (row % 2 ? u * 0.019 : 0);
      ctx.beginPath();
      ctx.arc(x, y, u * 0.0195, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }
  // Belly/muzzle: one soft radial blend (no hard patch edge).
  const muzzle = ctx.createRadialGradient(cx, H * 0.53, u * 0.03, cx, H * 0.54, u * 0.16);
  muzzle.addColorStop(0, "rgba(230,240,243,0.82)");
  muzzle.addColorStop(0.55, "rgba(205,220,226,0.6)");
  muzzle.addColorStop(1, "rgba(205,220,226,0)");
  ctx.fillStyle = muzzle;
  ctx.fillRect(cx - u * 0.2, H * 0.36, u * 0.4, H * 0.31);
  ctx.restore();
  sharkHeadPath(ctx, cx, H, u);
  ctx.strokeStyle = KEYLINE;
  ctx.lineWidth = u * 0.0075;
  ctx.stroke();

  // Gill slits.
  ctx.strokeStyle = "rgba(26,46,60,0.6)";
  ctx.lineWidth = u * 0.007;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    for (let g = 0; g < 3; g++) {
      const gx = cx + s * (u * 0.168 + g * u * 0.018);
      ctx.beginPath();
      ctx.moveTo(gx, H * 0.4 + g * u * 0.004);
      ctx.quadraticCurveTo(gx + s * u * 0.013, H * 0.445, gx, H * 0.49);
      ctx.stroke();
    }
  }

  // Crown — seated on the dome.
  ctx.save();
  ctx.translate(cx - u * 0.012, H * 0.132);
  ctx.rotate(-0.05 - drive.roll * 0.06);
  ctx.beginPath();
  ctx.moveTo(-u * 0.09, u * 0.012);
  ctx.quadraticCurveTo(0, -u * 0.012, u * 0.09, u * 0.012);
  ctx.lineTo(u * 0.082, -u * 0.054);
  ctx.lineTo(u * 0.046, -u * 0.027);
  ctx.lineTo(u * 0.021, -u * 0.07);
  ctx.lineTo(0, -u * 0.035);
  ctx.lineTo(-u * 0.021, -u * 0.07);
  ctx.lineTo(-u * 0.046, -u * 0.027);
  ctx.lineTo(-u * 0.082, -u * 0.054);
  ctx.closePath();
  ctx.fillStyle = metalGold(ctx, 0, -u * 0.07, u * 0.085);
  ctx.fill();
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.0035;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -u * 0.012, u * 0.0085, u * 0.011, 0, 0, Math.PI * 2);
  ctx.fillStyle = CRIMSON;
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * u * 0.049, -u * 0.01, u * 0.0055, u * 0.007, 0, 0, Math.PI * 2);
    ctx.fillStyle = GOLD_PALE;
    ctx.fill();
  }
  ctx.restore();

  // Brow shadow bands (clean arcs, lifted by the brow drive).
  const browLift = drive.brow * u * 0.013;
  ctx.strokeStyle = "rgba(30,52,66,0.55)";
  ctx.lineWidth = u * 0.013;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.036, H * 0.308 - browLift);
    ctx.quadraticCurveTo(cx + s * u * 0.082, H * 0.288 - browLift, cx + s * u * 0.126, H * 0.306 - browLift);
    ctx.stroke();
  }

  // Eyes — bigger, set closer to the muzzle.
  almondEye(ctx, cx - u * 0.078, H * 0.338, u * 0.07, u * 0.055, drive, drive.blinkL, "#5A768E");
  almondEye(ctx, cx + u * 0.078, H * 0.338, u * 0.07, u * 0.055, drive, drive.blinkR, "#5A768E");

  // Nostrils.
  ctx.strokeStyle = "rgba(23,17,6,0.55)";
  ctx.lineWidth = u * 0.005;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.015, H * 0.472);
    ctx.lineTo(cx + s * u * 0.032, H * 0.478);
    ctx.stroke();
  }

  // Mouth — an arc that follows the muzzle. The jaw sags at the
  // centre as it opens; teeth grow into view with the opening.
  const open = drive.mouthOpen;
  const mouthHW = u * 0.135;
  const lipCenterY = H * 0.522;
  const arcY = (t: number) => lipCenterY + (1 - t * t) * u * -0.006 + Math.abs(t) * u * 0.012;
  const jawSag = u * (0.004 + open * 0.052);
  const jawY = (t: number) => arcY(t) + jawSag * (1 - 0.35 * t * t);
  // Interior.
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const t = -1 + (i / 12) * 2;
    const x = cx + t * mouthHW;
    const y = arcY(t);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = 12; i >= 0; i--) {
    const t = -1 + (i / 12) * 2;
    ctx.lineTo(cx + t * mouthHW * 0.97, jawY(t));
  }
  ctx.closePath();
  ctx.fillStyle = MOUTH_DARK;
  ctx.fill();
  // Tongue hint at the back of an open mouth.
  if (open > 0.25) {
    ctx.beginPath();
    ctx.ellipse(cx, jawY(0) - u * 0.004, mouthHW * 0.42, u * 0.008 + open * u * 0.006, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(150,60,70,0.55)";
    ctx.fill();
  }
  // Lower teeth ride the jaw edge (visible once the jaw drops).
  if (open > 0.12) {
    ctx.fillStyle = "#FFFFFF";
    for (let i = 0; i < 5; i++) {
      const t = -0.6 + i * 0.3;
      const tx = cx + t * mouthHW * 0.97;
      const ty = jawY(t);
      ctx.beginPath();
      ctx.moveTo(tx - u * 0.009, ty + u * 0.002);
      ctx.lineTo(tx + u * 0.009, ty + u * 0.002);
      ctx.lineTo(tx, ty - u * 0.012);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Upper teeth — length scales with the opening; one gold.
  const toothLen = u * (0.009 + open * 0.022);
  for (let i = 0; i < 7; i++) {
    const t = -0.86 + i * 0.287;
    const tx = cx + t * mouthHW;
    const ty = arcY(t);
    ctx.beginPath();
    ctx.moveTo(tx - u * 0.0115, ty - u * 0.002);
    ctx.lineTo(tx + u * 0.0115, ty - u * 0.002);
    ctx.lineTo(tx, ty + toothLen);
    ctx.closePath();
    ctx.fillStyle = i === 4 ? metalGold(ctx, tx, ty, toothLen) : "#FFFFFF";
    ctx.fill();
  }
  // Lip line over the seam + corner creases.
  ctx.strokeStyle = KEYLINE;
  ctx.lineWidth = u * 0.0065;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const t = -1.06 + (i / 12) * 2.12;
    const x = cx + t * mouthHW;
    const y = arcY(Math.max(-1, Math.min(1, t))) - u * 0.002;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.restore();
}

/* ── Gold Mask ────────────────────────────────────────────────────────── */

function maskFacePath(ctx: CanvasRenderingContext2D, cx: number, H: number, u: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.665);
  ctx.bezierCurveTo(cx - u * 0.078, H * 0.665, cx - u * 0.132, H * 0.612, cx - u * 0.156, H * 0.525);
  ctx.bezierCurveTo(cx - u * 0.176, H * 0.435, cx - u * 0.172, H * 0.325, cx - u * 0.13, H * 0.232);
  ctx.bezierCurveTo(cx - u * 0.092, H * 0.152, cx - u * 0.046, H * 0.126, cx, H * 0.126);
  ctx.bezierCurveTo(cx + u * 0.046, H * 0.126, cx + u * 0.092, H * 0.152, cx + u * 0.13, H * 0.232);
  ctx.bezierCurveTo(cx + u * 0.172, H * 0.325, cx + u * 0.176, H * 0.435, cx + u * 0.156, H * 0.525);
  ctx.bezierCurveTo(cx + u * 0.132, H * 0.612, cx + u * 0.078, H * 0.665, cx, H * 0.665);
  ctx.closePath();
}

function drawMask(ctx: CanvasRenderingContext2D, drive: DriveValues, W: number, H: number, tSec: number): void {
  const u = Math.min(W, H);
  const cx = W / 2;
  const neckY = H * 0.665;

  emblemBackdrop(ctx, cx, H * 0.4, u * 0.315, H * 0.955, drive, u);

  // Neck + gold choker (the head group draws over its top).
  ctx.save();
  const neckGrad = ctx.createLinearGradient(cx, H * 0.62, cx, H * 0.73);
  neckGrad.addColorStop(0, "#D9B983");
  neckGrad.addColorStop(1, "#C4A068");
  ctx.fillStyle = neckGrad;
  ctx.fillRect(cx - u * 0.042, H * 0.62, u * 0.084, H * 0.115);
  ctx.strokeStyle = metalGold(ctx, cx, H * 0.685, u * 0.018);
  ctx.lineWidth = u * 0.009;
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.046, H * 0.692);
  ctx.quadraticCurveTo(cx, H * 0.706, cx + u * 0.046, H * 0.692);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.7, u * 0.005, u * 0.0065, 0, 0, Math.PI * 2);
  ctx.fillStyle = CRIMSON;
  ctx.fill();
  ctx.restore();

  // Velvet shoulders + gold neckline.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.35, H);
  ctx.bezierCurveTo(cx - u * 0.34, H * 0.84, cx - u * 0.28, H * 0.76, cx - u * 0.16, H * 0.715);
  ctx.lineTo(cx + u * 0.16, H * 0.715);
  ctx.bezierCurveTo(cx + u * 0.28, H * 0.76, cx + u * 0.34, H * 0.84, cx + u * 0.35, H);
  ctx.closePath();
  const dress = ctx.createLinearGradient(cx, H * 0.7, cx, H);
  dress.addColorStop(0, "#471522");
  dress.addColorStop(1, "#20060D");
  ctx.fillStyle = dress;
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = u * 0.006;
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.088, H * 0.718);
  ctx.lineTo(cx, H * 0.775);
  ctx.lineTo(cx + u * 0.088, H * 0.718);
  ctx.stroke();
  // Pendant.
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.775);
  ctx.lineTo(cx + u * 0.013, H * 0.8);
  ctx.lineTo(cx, H * 0.826);
  ctx.lineTo(cx - u * 0.013, H * 0.8);
  ctx.closePath();
  ctx.fillStyle = CRIMSON;
  ctx.fill();
  ctx.restore();

  ctx.save();
  headTransform(ctx, cx, neckY, drive, u, tSec);

  // Hair mass behind the face.
  ctx.beginPath();
  ctx.moveTo(cx, H * 0.085);
  ctx.bezierCurveTo(cx - u * 0.19, H * 0.085, cx - u * 0.235, H * 0.28, cx - u * 0.225, H * 0.47);
  ctx.bezierCurveTo(cx - u * 0.218, H * 0.6, cx - u * 0.2, H * 0.68, cx - u * 0.185, H * 0.72);
  ctx.lineTo(cx - u * 0.128, H * 0.72);
  ctx.bezierCurveTo(cx - u * 0.15, H * 0.55, cx - u * 0.148, H * 0.3, cx - u * 0.1, H * 0.19);
  ctx.bezierCurveTo(cx - u * 0.06, H * 0.125, cx + u * 0.06, H * 0.125, cx + u * 0.1, H * 0.19);
  ctx.bezierCurveTo(cx + u * 0.148, H * 0.3, cx + u * 0.15, H * 0.55, cx + u * 0.128, H * 0.72);
  ctx.lineTo(cx + u * 0.185, H * 0.72);
  ctx.bezierCurveTo(cx + u * 0.2, H * 0.68, cx + u * 0.218, H * 0.6, cx + u * 0.225, H * 0.47);
  ctx.bezierCurveTo(cx + u * 0.235, H * 0.28, cx + u * 0.19, H * 0.085, cx, H * 0.085);
  ctx.closePath();
  const hair = ctx.createLinearGradient(cx, H * 0.08, cx, H * 0.73);
  hair.addColorStop(0, "#3A1D0C");
  hair.addColorStop(0.5, "#241105");
  hair.addColorStop(1, "#120802");
  ctx.fillStyle = hair;
  ctx.fill();
  // Hair strands.
  ctx.strokeStyle = "rgba(201,168,76,0.13)";
  ctx.lineWidth = u * 0.0035;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + s * (u * 0.155 + i * u * 0.02), H * 0.2);
      ctx.bezierCurveTo(
        cx + s * (u * 0.2 + i * u * 0.012), H * 0.38,
        cx + s * (u * 0.195 + i * u * 0.012), H * 0.55,
        cx + s * (u * 0.175 + i * u * 0.014), H * 0.68,
      );
      ctx.stroke();
    }
  }

  // Face.
  maskFacePath(ctx, cx, H, u);
  const skin = ctx.createLinearGradient(cx - u * 0.05, H * 0.12, cx + u * 0.04, H * 0.72);
  skin.addColorStop(0, "#F6E5C6");
  skin.addColorStop(0.6, "#EACFA2");
  skin.addColorStop(1, "#D9B983");
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.save();
  maskFacePath(ctx, cx, H, u);
  ctx.clip();
  // Form shade + blush.
  const fshade = ctx.createRadialGradient(cx + u * 0.15, H * 0.5, u * 0.04, cx + u * 0.15, H * 0.5, u * 0.3);
  fshade.addColorStop(0, "rgba(166,116,64,0.30)");
  fshade.addColorStop(1, "rgba(166,116,64,0)");
  ctx.fillStyle = fshade;
  ctx.fillRect(cx - u * 0.18, H * 0.12, u * 0.36, H * 0.6);
  // Centre-face light (forehead + nose bridge catch the light).
  const fLight = ctx.createRadialGradient(cx, H * 0.34, u * 0.02, cx, H * 0.4, u * 0.17);
  fLight.addColorStop(0, "rgba(255,248,228,0.34)");
  fLight.addColorStop(1, "rgba(255,248,228,0)");
  ctx.fillStyle = fLight;
  ctx.fillRect(cx - u * 0.18, H * 0.12, u * 0.36, H * 0.56);
  // Jaw modelling: two soft arcs tracing the jaw's turn.
  ctx.strokeStyle = "rgba(150,100,50,0.13)";
  ctx.lineWidth = u * 0.016;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.145, H * 0.47);
    ctx.bezierCurveTo(cx + s * u * 0.128, H * 0.56, cx + s * u * 0.085, H * 0.625, cx + s * u * 0.03, H * 0.648);
    ctx.stroke();
  }
  for (const s of [-1, 1]) {
    const blush = ctx.createRadialGradient(cx + s * u * 0.095, H * 0.5, 1, cx + s * u * 0.095, H * 0.5, u * 0.055);
    blush.addColorStop(0, "rgba(196,90,80,0.20)");
    blush.addColorStop(1, "rgba(196,90,80,0)");
    ctx.fillStyle = blush;
    ctx.fillRect(cx + s * u * 0.095 - u * 0.06, H * 0.44, u * 0.12, H * 0.12);
  }
  ctx.restore();

  // Gold hoop earrings at the jaw line (drawn over the hair edge).
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * u * 0.163, H * 0.545, u * 0.015, u * 0.019, 0, 0, Math.PI * 2);
    ctx.strokeStyle = metalGold(ctx, cx, H * 0.52, u * 0.04);
    ctx.lineWidth = u * 0.0055;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx + s * u * 0.163 - u * 0.006, H * 0.532, u * 0.003, u * 0.004, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,250,230,0.8)";
    ctx.fill();
  }

  // Nose.
  ctx.strokeStyle = "rgba(122,84,40,0.5)";
  ctx.lineWidth = u * 0.0045;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + u * 0.004, H * 0.408);
  ctx.quadraticCurveTo(cx + u * 0.014, H * 0.468, cx + u * 0.002, H * 0.498);
  ctx.stroke();
  ctx.fillStyle = "rgba(122,84,40,0.55)";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * u * 0.014, H * 0.503, u * 0.0038, u * 0.0028, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lips: upper + lower; the lower group drops as the mouth opens.
  const open = drive.mouthOpen;
  const lipY = H * 0.566;
  if (open > 0.05) {
    ctx.beginPath();
    ctx.ellipse(cx, lipY + open * u * 0.016, u * 0.026, u * 0.005 + open * u * 0.017, 0, 0, Math.PI * 2);
    ctx.fillStyle = MOUTH_DARK;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.034, lipY);
  ctx.quadraticCurveTo(cx - u * 0.012, lipY - u * 0.011, cx, lipY - u * 0.004);
  ctx.quadraticCurveTo(cx + u * 0.012, lipY - u * 0.011, cx + u * 0.034, lipY);
  ctx.quadraticCurveTo(cx, lipY + u * 0.006, cx - u * 0.034, lipY);
  ctx.closePath();
  ctx.fillStyle = "#A04A3C";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.026, lipY + u * 0.002 + open * u * 0.02);
  ctx.quadraticCurveTo(cx, lipY + u * 0.016 + open * u * 0.02, cx + u * 0.026, lipY + u * 0.002 + open * u * 0.02);
  ctx.quadraticCurveTo(cx, lipY + u * 0.007 + open * u * 0.02, cx - u * 0.026, lipY + u * 0.002 + open * u * 0.02);
  ctx.closePath();
  ctx.fillStyle = "#C06A54";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - u * 0.008, lipY + u * 0.008 + open * u * 0.02, u * 0.007, u * 0.0022, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,235,220,0.5)";
  ctx.fill();

  // The shadow the mask casts on the face (drawn just under it).
  ctx.save();
  ctx.translate(0, u * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.168, H * 0.315);
  ctx.bezierCurveTo(cx - u * 0.15, H * 0.235, cx - u * 0.08, H * 0.205, cx, H * 0.212);
  ctx.bezierCurveTo(cx + u * 0.08, H * 0.205, cx + u * 0.15, H * 0.235, cx + u * 0.168, H * 0.315);
  ctx.bezierCurveTo(cx + u * 0.155, H * 0.375, cx + u * 0.115, H * 0.415, cx + u * 0.062, H * 0.428);
  ctx.quadraticCurveTo(cx + u * 0.03, H * 0.4, cx, H * 0.43);
  ctx.quadraticCurveTo(cx - u * 0.03, H * 0.4, cx - u * 0.062, H * 0.428);
  ctx.bezierCurveTo(cx - u * 0.115, H * 0.415, cx - u * 0.155, H * 0.375, cx - u * 0.168, H * 0.315);
  ctx.closePath();
  ctx.fillStyle = "rgba(101,67,33,0.28)";
  ctx.fill();
  ctx.restore();

  // The mask: scalloped band over the upper face.
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.168, H * 0.315);
  ctx.bezierCurveTo(cx - u * 0.15, H * 0.235, cx - u * 0.08, H * 0.205, cx, H * 0.212);
  ctx.bezierCurveTo(cx + u * 0.08, H * 0.205, cx + u * 0.15, H * 0.235, cx + u * 0.168, H * 0.315);
  ctx.bezierCurveTo(cx + u * 0.155, H * 0.375, cx + u * 0.115, H * 0.415, cx + u * 0.062, H * 0.428);
  ctx.quadraticCurveTo(cx + u * 0.03, H * 0.4, cx, H * 0.43);
  ctx.quadraticCurveTo(cx - u * 0.03, H * 0.4, cx - u * 0.062, H * 0.428);
  ctx.bezierCurveTo(cx - u * 0.115, H * 0.415, cx - u * 0.155, H * 0.375, cx - u * 0.168, H * 0.315);
  ctx.closePath();
  ctx.fillStyle = metalGold(ctx, cx, H * 0.2, H * 0.24);
  ctx.fill();
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.004;
  ctx.stroke();
  // Mask shading: shadow pooled at the lower edge, a darker brow
  // band, a sheen line, and the top light line.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(122,90,18,0.5)";
  ctx.fillRect(cx - u * 0.17, H * 0.385, u * 0.34, H * 0.05);
  ctx.fillStyle = "rgba(101,74,16,0.30)";
  ctx.fillRect(cx - u * 0.17, H * 0.2, u * 0.34, H * 0.045);
  const sheen = ctx.createLinearGradient(cx - u * 0.17, 0, cx + u * 0.17, 0);
  sheen.addColorStop(0, "rgba(255,250,230,0)");
  sheen.addColorStop(0.5, "rgba(255,250,230,0.28)");
  sheen.addColorStop(1, "rgba(255,250,230,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - u * 0.17, H * 0.27, u * 0.34, H * 0.05);
  ctx.strokeStyle = "rgba(255,246,220,0.65)";
  ctx.lineWidth = u * 0.004;
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.13, H * 0.245);
  ctx.bezierCurveTo(cx - u * 0.07, H * 0.218, cx + u * 0.07, H * 0.218, cx + u * 0.13, H * 0.245);
  ctx.stroke();
  ctx.restore();
  // Filigree scrolls at the temples.
  ctx.strokeStyle = "rgba(90,66,14,0.8)";
  ctx.lineWidth = u * 0.004;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * u * 0.128, H * 0.295, u * 0.014, s > 0 ? Math.PI * 0.4 : Math.PI * 1.3, s > 0 ? Math.PI * 2.1 : Math.PI * 3.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * u * 0.143, H * 0.322, u * 0.008, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Center jewel in a bezel.
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.238, u * 0.013, u * 0.017, 0, 0, Math.PI * 2);
  ctx.fillStyle = metalGold(ctx, cx, H * 0.22, u * 0.035);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.238, u * 0.008, u * 0.011, 0, 0, Math.PI * 2);
  ctx.fillStyle = CRIMSON;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - u * 0.003, H * 0.233, u * 0.0025, u * 0.0035, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fill();

  // Eyes through the mask: shadowed almond holes with a smoky bronze
  // wash above the eye, then the eyes themselves.
  for (const s of [-1, 1]) {
    const ex = cx + s * u * 0.079;
    const ey = H * 0.335;
    ctx.beginPath();
    ctx.moveTo(ex - u * 0.037, ey);
    ctx.quadraticCurveTo(ex, ey - u * 0.03, ex + u * 0.037, ey);
    ctx.quadraticCurveTo(ex, ey + u * 0.023, ex - u * 0.037, ey);
    ctx.closePath();
    ctx.fillStyle = "rgba(122,90,18,0.55)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const wash = ctx.createLinearGradient(ex, ey - u * 0.03, ex, ey + u * 0.01);
    wash.addColorStop(0, "rgba(84,54,18,0.5)");
    wash.addColorStop(1, "rgba(84,54,18,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(ex - u * 0.04, ey - u * 0.032, u * 0.08, u * 0.045);
    ctx.restore();
    ctx.strokeStyle = "rgba(60,42,6,0.8)";
    ctx.lineWidth = u * 0.0035;
    ctx.stroke();
  }
  almondEye(ctx, cx - u * 0.079, H * 0.335, u * 0.062, u * 0.042, drive, drive.blinkL, "#D9B983", "#5A3A14");
  almondEye(ctx, cx + u * 0.079, H * 0.335, u * 0.062, u * 0.042, drive, drive.blinkR, "#D9B983", "#5A3A14");
  // Winged liner flicks at the outer corners (painted on the mask).
  ctx.strokeStyle = KEYLINE;
  ctx.lineWidth = u * 0.005;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * u * 0.112, H * 0.328);
    ctx.quadraticCurveTo(cx + s * u * 0.128, H * 0.32, cx + s * u * 0.138, H * 0.308);
    ctx.stroke();
  }

  // Feather cluster at the mask's left temple (lifts with the brow).
  ctx.save();
  ctx.translate(cx - u * 0.155, H * 0.235);
  ctx.rotate(-0.5 - drive.brow * 0.1);
  for (let f = 0; f < 3; f++) {
    ctx.save();
    ctx.rotate(-f * 0.34);
    const len = u * (0.13 - f * 0.016);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-len * 0.24, -len * 0.4, -len * 0.2, -len * 0.8, 0, -len);
    ctx.bezierCurveTo(len * 0.2, -len * 0.8, len * 0.24, -len * 0.4, 0, 0);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, 0, 0, -len);
    fg.addColorStop(0, GOLD_DEEP);
    fg.addColorStop(0.6, GOLD);
    fg.addColorStop(1, GOLD_PALE);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = "rgba(90,66,14,0.65)";
    ctx.lineWidth = u * 0.0028;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.06);
    ctx.lineTo(0, -len * 0.94);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.011, u * 0.011, 0, 0, Math.PI * 2);
  ctx.fillStyle = CRIMSON;
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ── Golden Mic ───────────────────────────────────────────────────────── */

function drawMic(ctx: CanvasRenderingContext2D, drive: DriveValues, W: number, H: number, tSec: number): void {
  const u = Math.min(W, H);
  const cx = W / 2;
  const neckY = H * 0.62;

  emblemBackdrop(ctx, cx, H * 0.36, u * 0.30, H * 0.955, drive, u);

  // Stand: column + heavy round base (stays grounded while the head moves).
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.93, u * 0.19, H * 0.032, 0, 0, Math.PI * 2);
  ctx.fillStyle = metalGold(ctx, cx, H * 0.9, H * 0.06);
  ctx.fill();
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.004;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.922, u * 0.115, H * 0.018, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#241A08";
  ctx.fill();
  const colGrad = ctx.createLinearGradient(cx - u * 0.02, 0, cx + u * 0.02, 0);
  colGrad.addColorStop(0, "#3A2C10");
  colGrad.addColorStop(0.5, GOLD);
  colGrad.addColorStop(1, "#3A2C10");
  ctx.fillStyle = colGrad;
  ctx.fillRect(cx - u * 0.02, H * 0.6, u * 0.04, H * 0.325);
  ctx.restore();

  ctx.save();
  headTransform(ctx, cx, neckY, drive, u, tSec);

  const headCY = H * 0.345;
  const headR = u * 0.205;

  // Yoke arms cradling the sphere — bolted at the equator, sweeping
  // out and down to the column.
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.02;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * headR * 1.04, headCY + headR * 0.05);
    ctx.quadraticCurveTo(cx + s * headR * 1.3, headCY + headR * 0.8, cx + s * u * 0.055, H * 0.615);
    ctx.stroke();
  }
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = u * 0.011;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * headR * 1.04, headCY + headR * 0.05);
    ctx.quadraticCurveTo(cx + s * headR * 1.3, headCY + headR * 0.8, cx + s * u * 0.055, H * 0.615);
    ctx.stroke();
  }
  // Pivot bolts.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * headR * 1.03, headCY + headR * 0.03, u * 0.016, u * 0.016, 0, 0, Math.PI * 2);
    ctx.fillStyle = metalGold(ctx, cx, headCY, u * 0.03);
    ctx.fill();
    ctx.strokeStyle = GOLD_DEEP;
    ctx.lineWidth = u * 0.003;
    ctx.stroke();
  }

  // The grille sphere.
  ctx.beginPath();
  ctx.ellipse(cx, headCY, headR, headR * 1.08, 0, 0, Math.PI * 2);
  const sphere = ctx.createRadialGradient(cx - headR * 0.35, headCY - headR * 0.4, headR * 0.1, cx, headCY, headR * 1.25);
  sphere.addColorStop(0, "#F4E3B2");
  sphere.addColorStop(0.45, "#D9B968");
  sphere.addColorStop(0.8, "#A37F2A");
  sphere.addColorStop(1, "#6E5410");
  ctx.fillStyle = sphere;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Mesh: fine crosshatch.
  ctx.strokeStyle = "rgba(46,34,6,0.28)";
  ctx.lineWidth = u * 0.0022;
  const step = u * 0.016;
  for (let x = cx - headR; x <= cx + headR; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, headCY - headR * 1.1);
    ctx.lineTo(x, headCY + headR * 1.1);
    ctx.stroke();
  }
  for (let y = headCY - headR * 1.1; y <= headCY + headR * 1.1; y += step) {
    ctx.beginPath();
    ctx.moveTo(cx - headR, y);
    ctx.lineTo(cx + headR, y);
    ctx.stroke();
  }
  // Form shade bottom + specular crescent.
  const mshade = ctx.createRadialGradient(cx + headR * 0.4, headCY + headR * 0.75, headR * 0.1, cx + headR * 0.4, headCY + headR * 0.75, headR * 1.05);
  mshade.addColorStop(0, "rgba(70,52,8,0.42)");
  mshade.addColorStop(1, "rgba(70,52,8,0)");
  ctx.fillStyle = mshade;
  ctx.fillRect(cx - headR, headCY - headR * 1.1, headR * 2, headR * 2.2);
  ctx.strokeStyle = "rgba(255,250,230,0.5)";
  ctx.lineWidth = u * 0.009;
  ctx.beginPath();
  ctx.ellipse(cx, headCY, headR * 0.82, headR * 0.9, 0, Math.PI * 1.15, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(cx, headCY, headR, headR * 1.08, 0, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.006;
  ctx.stroke();

  // Equator band with the ON AIR jewel.
  ctx.beginPath();
  ctx.ellipse(cx, headCY + headR * 0.52, headR * 0.94, headR * 0.2, 0, 0, Math.PI);
  ctx.strokeStyle = "rgba(60,44,8,0.65)";
  ctx.lineWidth = u * 0.012;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, headCY + headR * 0.52, u * 0.02, u * 0.02, 0, 0, Math.PI * 2);
  const jewelGlow = 0.45 + drive.talk * 0.55;
  ctx.fillStyle = `rgba(255,${Math.round(120 + jewelGlow * 100)},80,1)`;
  ctx.fill();
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = u * 0.003;
  ctx.stroke();

  // Eyes: warm glowing slits in the mesh (narrow to lines on blink).
  for (const s of [-1, 1]) {
    const ex = cx + s * headR * 0.34 + drive.lookX * u * 0.008 + drive.yaw * u * 0.01;
    const ey = headCY - headR * 0.18 + drive.lookY * u * 0.006;
    const blink = s < 0 ? drive.blinkL : drive.blinkR;
    const eh = u * 0.02 * (1 - blink * 0.88);
    const glow = ctx.createRadialGradient(ex, ey, 1, ex, ey, u * 0.035);
    glow.addColorStop(0, "rgba(255,246,220,0.95)");
    glow.addColorStop(0.5, "rgba(255,214,120,0.55)");
    glow.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(ex, ey, u * 0.034, Math.max(u * 0.004, eh + u * 0.012), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex, ey, u * 0.016, Math.max(u * 0.0025, eh), 0, 0, Math.PI * 2);
    ctx.fillStyle = "#FFF6DC";
    ctx.fill();
  }

  // Mouth: a glowing level-bar that blooms with the voice.
  const mw = u * (0.05 + drive.mouthOpen * 0.075);
  const mh = u * (0.008 + drive.mouthOpen * 0.02);
  const my = headCY + headR * 0.3;
  const mGlow = ctx.createRadialGradient(cx, my, 1, cx, my, mw);
  mGlow.addColorStop(0, "rgba(255,240,200,0.9)");
  mGlow.addColorStop(1, "rgba(255,220,130,0)");
  ctx.fillStyle = mGlow;
  ctx.beginPath();
  ctx.ellipse(cx, my, mw * 1.25, mh * 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - mw / 2, my - mh / 2, mw, mh, mh / 2);
  ctx.fillStyle = "#FFF3D0";
  ctx.fill();

  ctx.restore();
}

/* ── Uploaded picture ─────────────────────────────────────────────────── */

export interface AvatarImageLike {
  el: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * The creator's own picture as the character: contain-fit, anchored
 * bottom-center; it breathes (idle bob), bounces a touch while they
 * talk, and dips on blinks. Returns false when there is no usable
 * image yet (the runtime shows its placeholder instead).
 */
export function drawUploadedAvatar(
  ctx: CanvasRenderingContext2D,
  image: AvatarImageLike | null,
  drive: DriveValues,
  W: number,
  H: number,
  tSec: number,
): boolean {
  if (!image || !image.width || !image.height) return false;
  const scale = Math.min(W / image.width, H / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  const bob = Math.sin(tSec * Math.PI * 2 * 0.21) * H * 0.006 + drive.talk * Math.sin(tSec * Math.PI * 2 * 5.2) * H * 0.004;
  const pop = 1 + drive.talk * 0.018 + drive.mouthOpen * 0.012;
  const dip = 1 - Math.max(drive.blinkL, drive.blinkR) * 0.025;
  ctx.save();
  ctx.translate(W / 2, H + bob);
  ctx.scale(pop, pop * dip);
  ctx.drawImage(image.el, -dw / 2, -dh, dw, dh);
  ctx.restore();
  return true;
}

/* ── Dispatcher ───────────────────────────────────────────────────────── */

/** Draw one frame of a character. Returns false only for 'upload'
 *  without a usable image. */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  character: AvatarCharacterId,
  drive: DriveValues,
  W: number,
  H: number,
  tSec: number,
  image?: AvatarImageLike | null,
): boolean {
  switch (character) {
    case "shark":
      drawShark(ctx, drive, W, H, tSec);
      return true;
    case "mask":
      drawMask(ctx, drive, W, H, tSec);
      return true;
    case "mic":
      drawMic(ctx, drive, W, H, tSec);
      return true;
    case "upload":
      return drawUploadedAvatar(ctx, image ?? null, drive, W, H, tSec);
    default:
      drawShark(ctx, drive, W, H, tSec);
      return true;
  }
}
