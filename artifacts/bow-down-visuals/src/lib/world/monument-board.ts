/**
 * monument-board.ts — the Kingdom Board monument's REAL words
 * (overhaul stage B, board item 16; audit geometry #11, T11).
 *
 * The stele at the plaza's heart used to wear a plate with six
 * grey rectangles "ruled, never lettered" — a sign pretending to
 * be a board. This module gives the monument the board's actual
 * headlines: the same three reads the Kingdom Board station panel
 * shows (KingdomBoardBlocks.tsx) —
 *   WHO'S HERE          from the palace directory (who stands in
 *                       which room, off the socket/HTTP directory
 *                       the page already holds);
 *   TODAY AT THE PALACE from the palace slate (objective-strip's
 *                       eventsToday over the merged REST +
 *                       directory slates, the panel's own merge);
 *   STANDINGS           this week's creators, from the retention
 *                       leaderboard shaped by kingdomStandings —
 *                       the panel's rail and the panel's shaping.
 * Nothing here invents a row: an empty read letters its honest
 * empty line (the panel's own words, shortened for stone), and a
 * guest's monument names the standings as members' business
 * exactly as the panel does — the leaderboard is simply absent
 * (null), never fabricated.
 *
 * The shaping is pure; the painting is a canvas painter over a
 * minimal 2D-context surface, at the plate's real resolution
 * (1024×1408 — the audit's ask, up from 640×896). hall-scene.ts
 * owns the THREE.CanvasTexture around it and repaints when the
 * page hands it fresh data (setMonumentBoardData), on the same
 * reads the panel makes.
 */

import { PALACE_LAYOUT } from "./palace-layout";
import { eventsToday, formatEventTime, kingdomStandings, type PalaceSlateEvent } from "./objective-strip";
import type { Leaderboard } from "./treasury-quests";
import type { PalaceDirectoryEntry } from "./world-client";

export const MONUMENT_PLATE_W = 1024;
export const MONUMENT_PLATE_H = 1408;

export interface MonumentBoardData {
  /** Rooms with someone in them, busiest first. */
  here: Array<{ room: string; count: number; members: string[] }>;
  /** Today's palace slate, live first, soonest first. */
  today: Array<{ title: string; meta: string }>;
  /** The week's top creators. Null = no leaderboard read (a
   *  guest, or the rail hasn't answered) — lettered honestly,
   *  never filled in. */
  standings: Array<{ rank: number; name: string; score: number }> | null;
}

/** The monument before any read lands — honest empty lines, so
 *  even the first frame never shows a fake posting. */
export const EMPTY_MONUMENT_BOARD: MonumentBoardData = { here: [], today: [], standings: null };

const MAX_ROWS = 4;

function roomName(roomId: string, directory: PalaceDirectoryEntry[]): string {
  if (roomId.startsWith("creator:")) return "A creator's room";
  return directory.find((r) => r.id === roomId)?.name ?? PALACE_LAYOUT[roomId]?.name ?? "The palace";
}

/** Shape the panel's three reads into the monument's headlines. */
export function monumentBoardData(input: {
  directory: PalaceDirectoryEntry[];
  leaderboard: Leaderboard | null;
  events: PalaceSlateEvent[];
  nowMs: number;
}): MonumentBoardData {
  const here = input.directory
    .filter((r) => r.count > 0)
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ROWS)
    .map((r) => ({ room: r.name, count: r.count, members: r.members.slice(0, 3) }));
  const today = eventsToday(input.events, input.nowMs)
    .slice(0, MAX_ROWS)
    .map((e) => ({
      title: e.title,
      meta: e.status === "live"
        ? `LIVE now · ${roomName(e.roomId, input.directory)}`
        : `${formatEventTime(e.startsAt)} · ${roomName(e.roomId, input.directory)}`,
    }));
  const standings = input.leaderboard
    ? kingdomStandings(input.leaderboard).top.slice(0, MAX_ROWS).map((r) => ({
        rank: r.rank, name: r.name, score: r.score,
      }))
    : null;
  return { here, today, standings };
}

/* ─── The lettered lines ─────────────────────────────────────────── */

export interface MonumentPlateSection {
  heading: string;
  lines: string[];
}

/** The plate as lines — the painter letters exactly this, and the
 *  tests pin exactly this, so words and stone can never drift. */
export function monumentPlateSections(data: MonumentBoardData): MonumentPlateSection[] {
  const hereLines = data.here.length
    ? data.here.map((r) => {
        const names = r.members.length ? ` — ${r.members.join(", ")}${r.count > r.members.length ? "…" : ""}` : "";
        return `${r.room}: ${r.count} here${names}`;
      })
    : ["The palace is quiet just now."];
  const todayLines = data.today.length
    ? data.today.map((e) => `${e.title} — ${e.meta}`)
    : ["Nothing on today's slate at the palace."];
  const standingsLines = data.standings === null
    ? ["The week's standings are members' business —", "sign in and read them at the board."]
    : data.standings.length
      ? data.standings.map((r) => `#${r.rank}  ${r.name} — ${r.score}`)
      : ["No creations on the board yet this week —", "the first one takes the crown."];
  return [
    { heading: "WHO'S HERE", lines: hereLines },
    { heading: "TODAY AT THE PALACE", lines: todayLines },
    { heading: "STANDINGS — THIS WEEK", lines: standingsLines },
  ];
}

/** A stable signature of what the plate shows — the scene
 *  repaints only when this changes. */
export function monumentBoardSignature(data: MonumentBoardData): string {
  return JSON.stringify(monumentPlateSections(data));
}

/* ─── The painter ────────────────────────────────────────────────── */

/** The slice of CanvasRenderingContext2D the painter uses — a
 *  structural surface so tests can letter onto a recording fake. */
export interface MonumentPlateCtx {
  canvas: { width: number; height: number };
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(at: number, color: string): void };
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/** Shrink-then-ellipsize one line to its measure. */
function fitLine(g: MonumentPlateCtx, text: string, maxWidth: number): string {
  if (g.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 4 && g.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/**
 * Letter the plate at MONUMENT_PLATE_W × MONUMENT_PLATE_H: crown
 * mark, the board's name, then the three sections of real
 * headlines — on all four faces (the scene hangs this same canvas
 * on every face of the monument's plate drum; the words are the
 * board's, whichever way a walker approaches).
 */
export function drawMonumentBoardPlate(g: MonumentPlateCtx, theme: "light" | "dark", data: MonumentBoardData): void {
  const W = MONUMENT_PLATE_W;
  const H = MONUMENT_PLATE_H;
  const light = theme === "light";
  const grad = g.createLinearGradient(0, 0, 0, H);
  if (light) {
    grad.addColorStop(0, "#f7ecd0");
    grad.addColorStop(0.5, "#f0e2bd");
    grad.addColorStop(1, "#e6d3a4");
  } else {
    grad.addColorStop(0, "#2b1f0c");
    grad.addColorStop(0.5, "#1c1408");
    grad.addColorStop(1, "#120d05");
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const ink = light ? "#4a3410" : "#e8c86a";
  const accent = light ? "#8a6a1f" : "#d4af37";
  const faint = light ? "rgba(74,52,16,0.75)" : "rgba(232,200,106,0.78)";
  g.strokeStyle = light ? "rgba(138,106,31,0.9)" : "rgba(212,175,55,0.9)";
  g.lineWidth = 8;
  g.strokeRect(26, 26, W - 52, H - 52);
  g.strokeStyle = light ? "rgba(138,106,31,0.35)" : "rgba(212,175,55,0.35)";
  g.lineWidth = 2;
  g.strokeRect(48, 48, W - 96, H - 96);

  /* The crown mark: three points on a band, drawn plain. */
  const cx = W / 2;
  g.fillStyle = accent;
  g.beginPath();
  g.moveTo(cx - 130, 250);
  g.lineTo(cx - 130, 150);
  g.lineTo(cx - 58, 198);
  g.lineTo(cx, 128);
  g.lineTo(cx + 58, 198);
  g.lineTo(cx + 130, 150);
  g.lineTo(cx + 130, 250);
  g.closePath();
  g.fill();
  g.fillRect(cx - 130, 264, 260, 18);
  for (const [px, py] of [[cx - 130, 140], [cx, 116], [cx + 130, 140]] as Array<[number, number]>) {
    g.beginPath();
    g.arc(px, py, 15, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 96px Georgia, 'Times New Roman', serif";
  g.fillText("THE KINGDOM BOARD", cx, 380);
  g.fillStyle = accent;
  g.font = "600 34px Georgia, serif";
  g.fillText("T H E   W O R D   A R O U N D   T H E   P A L A C E", cx, 462);

  /* The sections: heading in letterspaced caps, lines in a
   * readable serif, each fitted to the stone's width. */
  let y = 580;
  for (const section of monumentPlateSections(data)) {
    g.fillStyle = accent;
    g.font = "600 38px Georgia, serif";
    g.textAlign = "center";
    g.fillText(fitLine(g, section.heading, W - 190), cx, y);
    y += 62;
    g.fillStyle = faint;
    g.font = "44px Georgia, serif";
    for (const line of section.lines.slice(0, MAX_ROWS)) {
      g.fillText(fitLine(g, line, W - 190), cx, y);
      y += 64;
    }
    y += 44;
  }
}
