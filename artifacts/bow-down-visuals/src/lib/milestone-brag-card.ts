/* ─── Milestone brag card renderer ─────────────────────────────────────────
   Client-side canvas → PNG (1080×1080), gold/black luxury. No paid
   provider, no server render — the card is drawn in the browser, then
   downloaded, natively shared, or uploaded for a BDV feed post.

   Baked into every card: the milestone, creator name + avatar, "Made with
   Bow Down Visuals" attribution, and a bowdownvisuals.com signup CTA. */

import { tierColor, VERTICAL_META, type MilestoneAchievement } from "./milestone-thresholds";

export interface BragCardOpts {
  achievement: MilestoneAchievement;
  creatorName: string;
  avatarUrl?: string | null;
  siteUrl?: string;
}

const W = 1080;
const H = 1080;

function setSpacing(ctx: CanvasRenderingContext2D, v: string): void {
  try {
    (ctx as unknown as Record<string, unknown>)["letterSpacing"] = v;
  } catch {
    /* older canvas — letterspacing just won't apply */
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "★";
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok ? img : null);
    };
    const timer = window.setTimeout(() => done(false), 6000);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
}

/** Render the brag card. Throws only on canvas failure — avatar load
    failures fall back to a gold monogram. */
export async function renderBragCard(opts: BragCardOpts): Promise<HTMLCanvasElement> {
  const { achievement: a, creatorName } = opts;
  const siteUrl = (opts.siteUrl ?? "bowdownvisuals.com").replace(/^https?:\/\//, "");
  const gold = tierColor(a.tier);
  const meta = VERTICAL_META[a.vertical];

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  /* — background: near-black with a gold glow from the top — */
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 280, 40, W / 2, 280, 720);
  glow.addColorStop(0, "rgba(212,175,55,0.22)");
  glow.addColorStop(1, "rgba(212,175,55,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* — double gold frame — */
  const frame = ctx.createLinearGradient(0, 0, W, H);
  frame.addColorStop(0, "#f6d47c");
  frame.addColorStop(0.5, "#d4af37");
  frame.addColorStop(1, "#9c7c1e");
  ctx.strokeStyle = frame;
  ctx.lineWidth = 6;
  roundRect(ctx, 34, 34, W - 68, H - 68, 36);
  ctx.stroke();
  ctx.strokeStyle = "rgba(212,175,55,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, 54, 54, W - 108, H - 108, 26);
  ctx.stroke();

  const cx = W / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = 172;

  /* — trophy — */
  ctx.font = "92px serif";
  ctx.fillText("🏆", cx, y);
  y += 96;

  /* — MILESTONE UNLOCKED — */
  setSpacing(ctx, "12px");
  ctx.font = "600 30px Arial, sans-serif";
  ctx.fillStyle = "#d4af37";
  ctx.fillText("MILESTONE UNLOCKED", cx, y);
  y += 66;
  setSpacing(ctx, "0px");

  /* — tier pill — */
  const tierText = `${a.tierLabel.toUpperCase()}${a.vertical === "streams" ? " AWARD" : " MILESTONE"}`;
  ctx.font = "700 28px Arial, sans-serif";
  const pillW = Math.min(ctx.measureText(tierText).width + 64, W - 240);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2;
  roundRect(ctx, cx - pillW / 2, y - 30, pillW, 60, 30);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = gold;
  setSpacing(ctx, "6px");
  ctx.fillText(tierText, cx, y + 2);
  y += 100;
  setSpacing(ctx, "0px");

  /* — the big number — */
  const numGrad = ctx.createLinearGradient(0, y - 120, 0, y + 12);
  numGrad.addColorStop(0, "#f8dd8a");
  numGrad.addColorStop(1, "#b8912a");
  ctx.fillStyle = numGrad;
  let size = 168;
  ctx.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
  while (ctx.measureText(a.displayValue).width > W - 220 && size > 56) {
    size -= 8;
    ctx.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
  }
  ctx.fillText(a.displayValue, cx, y);
  y += Math.round(size * 0.72);

  /* — unit label — */
  setSpacing(ctx, "14px");
  ctx.font = "700 36px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(meta.unit, cx, y);
  y += 72;
  setSpacing(ctx, "0px");

  /* — context: "Midnight Run · spotify" — */
  ctx.font = "400 40px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  for (const line of wrapText(ctx, a.context, W - 280)) {
    ctx.fillText(line, cx, y);
    y += 54;
  }
  y += 12;

  /* — divider — */
  ctx.strokeStyle = "rgba(212,175,55,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 180, y);
  ctx.lineTo(cx + 180, y);
  ctx.stroke();
  y += 58;

  /* — creator row — */
  const avatar = opts.avatarUrl ? await loadImage(opts.avatarUrl) : null;
  const ax = cx - 300;
  const ay = y + 34;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, 44, 0, Math.PI * 2);
  if (avatar) {
    ctx.clip();
    const s = Math.max(88 / avatar.width, 88 / avatar.height);
    const dw = avatar.width * s;
    const dh = avatar.height * s;
    ctx.drawImage(avatar, ax - dw / 2, ay - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();
    ctx.fillStyle = "#d4af37";
    ctx.font = "700 44px Georgia, serif";
    ctx.fillText(initial(creatorName), ax, ay + 2);
  }
  ctx.restore();
  ctx.strokeStyle = frame;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ax, ay, 44, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 44px Arial, sans-serif";
  ctx.fillText(truncate(ctx, creatorName, 560), ax + 62, ay - 8);
  setSpacing(ctx, "4px");
  ctx.fillStyle = "rgba(212,175,55,0.85)";
  ctx.font = "600 24px Arial, sans-serif";
  ctx.fillText("CREATOR ON BOW DOWN VISUALS", ax + 62, ay + 32);
  setSpacing(ctx, "0px");
  ctx.textAlign = "center";
  y = ay + 112;

  /* — footer: attribution + signup CTA baked in — */
  setSpacing(ctx, "8px");
  ctx.fillStyle = "#d4af37";
  ctx.font = "700 30px Arial, sans-serif";
  ctx.fillText("MADE WITH BOW DOWN VISUALS", cx, y);
  y += 52;
  setSpacing(ctx, "2px");
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "400 27px Arial, sans-serif";
  ctx.fillText(`${siteUrl} — start creating free`, cx, y);
  setSpacing(ctx, "0px");

  return canvas;
}

export function bragCardToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Card render failed"))),
      "image/png",
    ),
  );
}

export function bragCardDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export async function downloadBragCard(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await bragCardToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function canNativeShareFile(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}
