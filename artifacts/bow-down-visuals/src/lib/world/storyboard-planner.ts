/**
 * storyboard-planner.ts — the pure seam for the Video Desk's storyboard
 * PLANNER (STACK-20 R2 #19 — UPGRADE-PROGRAM 2.3, planner half).
 *
 * The desk already had the Ring 2 storyboard BENCH (lib/world/
 * create-desks: lyrics → AI scenes → clips → project). What it never
 * had is a plan the member authors by hand: panels with a frame, a
 * title and their own notes, in an order they control, saved on the
 * server as their storyboard (routes/storyboards, migration 0161).
 * This file is the client half of that bench: paths, payload builders,
 * defensive normalizers for the wire DTO, the local move math (the
 * same swap the server performs), and the handoff — panels become the
 * scenes of a make-video project, riding buildStoryboardProjectPayload
 * so the editor step-through seeds from a planner project exactly as
 * it seeds from a bench project.
 *
 * Honesty rules baked in:
 * - A panel with imageUrl null is a NOTES-ONLY panel. Nothing here
 *   invents an image for it — the scene it hands off carries
 *   thumbnailUrl null too.
 * - A frame is generated ONLY on the site's artist-image rail
 *   (buildArtistImagePayload at FRAME_RATIO) and saved back through
 *   the panel PATCH — the URL the rail returns is the URL that lands;
 *   no crops, no stand-ins.
 */

import { buildStoryboardProjectPayload } from "./create-desks";
import type { SceneData } from "../scene-parser";

export interface StoryboardPanelDTO {
  id: string;
  title: string;
  notes: string;
  /** Permanent image ref, or null for a notes-only panel. */
  imageUrl: string | null;
  imagePrompt: string | null;
}

export interface StoryboardBoardDTO {
  id: string;
  title: string;
  panels: StoryboardPanelDTO[];
  panelCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Storyboard frames are 16:9 — the artist-image rail's wide ratio. */
export const STORYBOARD_FRAME_RATIO = "1920:1080";

/* ─── Paths ──────────────────────────────────────────────────────── */

export const STORYBOARDS_PATH = "/api/storyboards";

export function storyboardPath(id: string): string {
  return `${STORYBOARDS_PATH}/${encodeURIComponent(id)}`;
}

export function storyboardPanelsPath(id: string): string {
  return `${storyboardPath(id)}/panels`;
}

export function storyboardPanelPath(id: string, panelId: string): string {
  return `${storyboardPanelsPath(id)}/${encodeURIComponent(panelId)}`;
}

export function storyboardPanelMovePath(id: string, panelId: string): string {
  return `${storyboardPanelPath(id, panelId)}/move`;
}

/* ─── Payload builders ───────────────────────────────────────────── */

export function buildPanelPayload(input: {
  title?: string;
  notes?: string;
  imageUrl?: string | null;
  imagePrompt?: string | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined) out["title"] = input.title;
  if (input.notes !== undefined) out["notes"] = input.notes;
  if (input.imageUrl !== undefined) out["imageUrl"] = input.imageUrl;
  if (input.imagePrompt !== undefined) out["imagePrompt"] = input.imagePrompt;
  return out;
}

export function buildPanelMovePayload(direction: "up" | "down"): Record<string, unknown> {
  return { direction };
}

/* ─── Normalizers (the wire is never trusted) ────────────────────── */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function normalizePanel(raw: unknown): StoryboardPanelDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]);
  if (!id) return null;
  return {
    id,
    title: str(r["title"]),
    notes: str(r["notes"]),
    imageUrl: strOrNull(r["imageUrl"]),
    imagePrompt: strOrNull(r["imagePrompt"]),
  };
}

export function normalizeStoryboard(raw: unknown): StoryboardBoardDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]);
  if (!id) return null;
  const rawPanels = Array.isArray(r["panels"]) ? r["panels"] : [];
  const panels = rawPanels
    .map(normalizePanel)
    .filter((p): p is StoryboardPanelDTO => p !== null);
  return {
    id,
    title: str(r["title"]) || "Untitled storyboard",
    panels,
    panelCount: panels.length,
    createdAt: str(r["createdAt"]),
    updatedAt: str(r["updatedAt"]),
  };
}

export function normalizeStoryboardList(raw: unknown): StoryboardBoardDTO[] {
  const rows =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["storyboards"])
      ? ((raw as Record<string, unknown>)["storyboards"] as unknown[])
      : Array.isArray(raw)
        ? raw
        : [];
  return rows
    .map(normalizeStoryboard)
    .filter((b): b is StoryboardBoardDTO => b !== null);
}

/** Pull the board out of a `{ storyboard }` response (null when the
    response carries none — never a fabricated board). */
export function storyboardOfResponse(raw: unknown): StoryboardBoardDTO | null {
  if (!raw || typeof raw !== "object") return null;
  return normalizeStoryboard((raw as Record<string, unknown>)["storyboard"]);
}

/** Pull the panel out of a `{ panel }` response. */
export function panelOfResponse(raw: unknown): StoryboardPanelDTO | null {
  if (!raw || typeof raw !== "object") return null;
  return normalizePanel((raw as Record<string, unknown>)["panel"]);
}

/* ─── Local move math (mirrors the server's one-step swap) ───────── */

export function movePanelLocal<T extends { id: string }>(
  panels: readonly T[],
  panelId: string,
  direction: "up" | "down",
): T[] {
  const idx = panels.findIndex((p) => p.id === panelId);
  if (idx < 0) return [...panels];
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= panels.length) return [...panels];
  const next = [...panels];
  const [panel] = next.splice(idx, 1);
  next.splice(swap, 0, panel!);
  return next;
}

/* ─── Frame generation ───────────────────────────────────────────── */

/** The prompt a panel's frame is generated from: its title leading,
    its notes as the scene description. Empty when the panel has no
    words at all — the desk asks for words before it charges for a
    frame, instead of generating from nothing. */
export function framePromptForPanel(panel: Pick<StoryboardPanelDTO, "title" | "notes">): string {
  const title = panel.title.trim();
  const notes = panel.notes.trim();
  if (title && notes) return `${title} — ${notes}`;
  return title || notes;
}

/* ─── The handoff: panels → a make-video project ─────────────────── */

/** One panel as the scene the editor step-through films. The panel's
    words become the scene's action + film prompt verbatim; its frame
    rides as the scene's thumbnail (null for a notes-only panel — the
    plan card films from its words). Panels are the member's chosen
    shots, so they land approved; nothing is pre-filmed. */
export function panelToScene(panel: StoryboardPanelDTO, index: number): SceneData {
  const words = [panel.title.trim(), panel.notes.trim()].filter(Boolean).join(" — ");
  return {
    id: `storyboard-panel-${panel.id}`,
    sceneNumber: index + 1,
    timestamp: "",
    section: "Storyboard",
    lyricLine: "",
    location: "",
    action: words,
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: words,
    negativePrompt: "",
    approved: true,
    demoClipUrl: null,
    thumbnailUrl: panel.imageUrl,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: null,
    promptUsed: panel.imagePrompt,
    generatedAt: null,
    referenceSource: panel.imageUrl ? "none" : null,
  };
}

export function panelsToScenes(panels: readonly StoryboardPanelDTO[]): SceneData[] {
  return panels.map((p, i) => panelToScene(p, i));
}

/** The project body the handoff saves (POST /api/projects) or hands to
    the in-world editor — make-video's own performSave shape via
    buildStoryboardProjectPayload, with the plan riding in inputData
    so the saved project names where its scenes came from. */
export function buildStoryboardPlannerProjectPayload(input: {
  board: Pick<StoryboardBoardDTO, "id" | "title">;
  panels: readonly StoryboardPanelDTO[];
}): Record<string, unknown> {
  return buildStoryboardProjectPayload({
    title: input.board.title || "Video Desk storyboard",
    inputData: {
      source: "storyboard-planner",
      storyboardId: input.board.id,
    },
    resultText: "",
    scenes: panelsToScenes(input.panels) as unknown as unknown[],
  });
}
