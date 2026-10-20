import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { db, storyboardsTable, type StoryboardPanel } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { normalizeToStorageRef, refreshSupabaseStorageUrl } from "../lib/objectStorage";

const router = Router();

/* ─── Storyboards (STACK-20 R2 #19 — UPGRADE-PROGRAM 2.3, planner half) ──
   A member's own video plan: an ordered set of panels they author by
   hand — frame image, title, notes — saved server-side as THEIR
   storyboard and handed into the video flow as a project. The site
   already generates storyboards from scripts (routes/generate/
   storyboard) and locks AI production packs (preproduction_packs);
   neither is a planner: no member-authored panels, no reorder, no
   board that survives the session. This route is that missing bench.

   Every verb is owner-scoped: the routes only ever read or write the
   caller's own rows, and a foreign board answers 404 on every verb —
   panels included — so a board's existence never leaks.

   Panel images ride the mirror-on-save law: on write, an imageUrl
   pointing at our own storage is normalized to its permanent ref
   (normalizeToStorageRef — a stored signed URL can never expire under
   a saved plan); on read, refs are re-signed fresh
   (refreshSupabaseStorageUrl passes public/foreign values through
   unchanged). A panel with imageUrl null is a notes-only panel — a
   legitimate plan state the desk shows as one. */

export const STORYBOARD_MAX_PANELS = 60;
const TITLE_MAX = 160;
const PANEL_TITLE_MAX = 160;
const PANEL_NOTES_MAX = 2000;
const IMAGE_URL_MAX = 2048;
const IMAGE_PROMPT_MAX = 1000;

const TitleSchema = z.string().trim().max(TITLE_MAX);
const ImageUrlSchema = z
  .string()
  .trim()
  .max(IMAGE_URL_MAX)
  .regex(/^https?:\/\//, "imageUrl must be an http(s) URL");

const CreateBoardSchema = z.object({
  title: TitleSchema.optional(),
});

const RenameBoardSchema = z.object({
  title: TitleSchema.min(1),
});

const PanelCreateSchema = z.object({
  title: z.string().trim().max(PANEL_TITLE_MAX).optional(),
  notes: z.string().trim().max(PANEL_NOTES_MAX).optional(),
  imageUrl: ImageUrlSchema.nullable().optional(),
  imagePrompt: z.string().trim().max(IMAGE_PROMPT_MAX).nullable().optional(),
});

const PanelPatchSchema = z.object({
  title: z.string().trim().max(PANEL_TITLE_MAX).optional(),
  notes: z.string().trim().max(PANEL_NOTES_MAX).optional(),
  imageUrl: ImageUrlSchema.nullable().optional(),
  imagePrompt: z.string().trim().max(IMAGE_PROMPT_MAX).nullable().optional(),
});

const PanelMoveSchema = z.object({
  direction: z.enum(["up", "down"]),
});

interface StoryboardDTO {
  id: string;
  title: string;
  panels: StoryboardPanel[];
  panelCount: number;
  createdAt: string;
  updatedAt: string;
}

function toISOString(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? "");
}

/** Re-sign panel image refs for the wire; public/foreign URLs and
    notes-only panels pass through untouched. */
async function refreshPanels(panels: StoryboardPanel[]): Promise<StoryboardPanel[]> {
  return Promise.all(
    panels.map(async (p) => ({
      ...p,
      imageUrl: p.imageUrl ? await refreshSupabaseStorageUrl(p.imageUrl) : null,
    })),
  );
}

async function toDTO(row: typeof storyboardsTable.$inferSelect): Promise<StoryboardDTO> {
  const panels = await refreshPanels(Array.isArray(row.panels) ? row.panels : []);
  return {
    id: row.id,
    title: row.title,
    panels,
    panelCount: panels.length,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

/** The caller's own board row, or null — a foreign board and a missing
    board are the same answer (404) everywhere below. */
async function ownBoard(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(storyboardsTable)
    .where(and(eq(storyboardsTable.id, id), eq(storyboardsTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function savePanels(
  userId: string,
  id: string,
  panels: StoryboardPanel[],
) {
  const [row] = await db
    .update(storyboardsTable)
    .set({ panels, updatedAt: new Date() })
    .where(and(eq(storyboardsTable.id, id), eq(storyboardsTable.userId, userId)))
    .returning();
  return row ?? null;
}

function cleanPanel(raw: Partial<StoryboardPanel> & { id: string }): StoryboardPanel {
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    imageUrl: raw.imageUrl ? (normalizeToStorageRef(raw.imageUrl) ?? raw.imageUrl) : null,
    imagePrompt: typeof raw.imagePrompt === "string" ? raw.imagePrompt : null,
  };
}

/* ── Shared write paths ──────────────────────────────────────────────
   The create + panel-append cores live outside the route handlers
   so the operator's storyboard.save tool (Phase 2 Lane D) rides the
   exact same write path as the desk: same schemas, same owner
   scoping (a foreign board is a not_found, never a write), same
   panel cap, same write-time image normalization (cleanPanel). */

export async function createStoryboardBoard(userId: string, title?: string) {
  const [row] = await db
    .insert(storyboardsTable)
    .values({
      userId,
      title: title?.trim() || "Untitled storyboard",
      panels: [],
    })
    .returning();
  return row!;
}

export type AppendStoryboardPanelOutcome =
  | { kind: "added"; board: typeof storyboardsTable.$inferSelect; panel: StoryboardPanel }
  | { kind: "not_found" }
  | { kind: "invalid"; issues: z.ZodIssue[] }
  | { kind: "full"; max: number };

export async function appendStoryboardPanel(
  userId: string,
  boardId: string,
  input: unknown,
): Promise<AppendStoryboardPanelOutcome> {
  const parsed = PanelCreateSchema.safeParse(input ?? {});
  if (!parsed.success) return { kind: "invalid", issues: parsed.error.issues };
  const row = await ownBoard(userId, boardId);
  if (!row) return { kind: "not_found" };
  const panels = Array.isArray(row.panels) ? [...row.panels] : [];
  if (panels.length >= STORYBOARD_MAX_PANELS) return { kind: "full", max: STORYBOARD_MAX_PANELS };
  const panel = cleanPanel({
    id: randomUUID(),
    title: parsed.data.title ?? "",
    notes: parsed.data.notes ?? "",
    imageUrl: parsed.data.imageUrl ?? null,
    imagePrompt: parsed.data.imagePrompt ?? null,
  });
  panels.push(panel);
  const saved = await savePanels(userId, boardId, panels);
  if (!saved) return { kind: "not_found" };
  return { kind: "added", board: saved, panel };
}

/* GET /api/storyboards — my boards, newest-touched first (summaries). */
router.get("/storyboards", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(storyboardsTable)
      .where(eq(storyboardsTable.userId, req.userId!))
      .orderBy(desc(storyboardsTable.updatedAt));
    const storyboards = await Promise.all(rows.map(toDTO));
    res.json({ storyboards });
  } catch (err) {
    req.log.error({ err }, "[storyboards] list failed");
    res.status(500).json({ error: "Failed to load storyboards" });
  }
});

/* POST /api/storyboards — start a board (empty: panels are added next). */
router.post("/storyboards", requireAuth, async (req, res) => {
  const parsed = CreateBoardSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid storyboard", details: parsed.error.issues });
    return;
  }
  try {
    const row = await createStoryboardBoard(req.userId!, parsed.data.title);
    res.status(201).json({ storyboard: await toDTO(row) });
  } catch (err) {
    req.log.error({ err }, "[storyboards] create failed");
    res.status(500).json({ error: "Failed to create storyboard" });
  }
});

/* GET /api/storyboards/:id — one of my boards, full panels. */
router.get("/storyboards/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await ownBoard(req.userId!, id);
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    res.json({ storyboard: await toDTO(row) });
  } catch (err) {
    req.log.error({ err }, "[storyboards] get failed");
    res.status(500).json({ error: "Failed to load storyboard" });
  }
});

/* PATCH /api/storyboards/:id — rename my board. */
router.patch("/storyboards/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = RenameBoardSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid title", details: parsed.error.issues });
    return;
  }
  try {
    const [row] = await db
      .update(storyboardsTable)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(and(eq(storyboardsTable.id, id), eq(storyboardsTable.userId, req.userId!)))
      .returning();
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    res.json({ storyboard: await toDTO(row) });
  } catch (err) {
    req.log.error({ err }, "[storyboards] rename failed");
    res.status(500).json({ error: "Failed to rename storyboard" });
  }
});

/* DELETE /api/storyboards/:id — delete my board (panels live in the row). */
router.delete("/storyboards/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await ownBoard(req.userId!, id);
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    await db
      .delete(storyboardsTable)
      .where(and(eq(storyboardsTable.id, id), eq(storyboardsTable.userId, req.userId!)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "[storyboards] delete failed");
    res.status(500).json({ error: "Failed to delete storyboard" });
  }
});

/* POST /api/storyboards/:id/panels — append a panel to my board. */
router.post("/storyboards/:id/panels", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const outcome = await appendStoryboardPanel(req.userId!, id, req.body);
    if (outcome.kind === "invalid") {
      res.status(400).json({ error: "Invalid panel", details: outcome.issues });
      return;
    }
    if (outcome.kind === "not_found") { res.status(404).json({ error: "Storyboard not found" }); return; }
    if (outcome.kind === "full") {
      res.status(400).json({ error: `A storyboard holds at most ${outcome.max} panels.` });
      return;
    }
    const dto = await toDTO(outcome.board);
    res.status(201).json({ panel: dto.panels[dto.panels.length - 1], storyboard: dto });
  } catch (err) {
    req.log.error({ err }, "[storyboards] panel add failed");
    res.status(500).json({ error: "Failed to add panel" });
  }
});

/* PATCH /api/storyboards/:id/panels/:panelId — edit one of my panels.
   imageUrl: null clears the frame (back to a notes-only panel). */
router.patch("/storyboards/:id/panels/:panelId", requireAuth, async (req, res) => {
  const { id, panelId } = req.params as { id: string; panelId: string };
  const parsed = PanelPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid panel", details: parsed.error.issues });
    return;
  }
  try {
    const row = await ownBoard(req.userId!, id);
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    const panels = Array.isArray(row.panels) ? [...row.panels] : [];
    const idx = panels.findIndex((p) => p.id === panelId);
    if (idx < 0) { res.status(404).json({ error: "Panel not found" }); return; }
    const next: StoryboardPanel = { ...panels[idx]! };
    if (parsed.data.title !== undefined) next.title = parsed.data.title;
    if (parsed.data.notes !== undefined) next.notes = parsed.data.notes;
    if (parsed.data.imagePrompt !== undefined) next.imagePrompt = parsed.data.imagePrompt;
    if (parsed.data.imageUrl !== undefined) {
      next.imageUrl = parsed.data.imageUrl
        ? (normalizeToStorageRef(parsed.data.imageUrl) ?? parsed.data.imageUrl)
        : null;
    }
    panels[idx] = next;
    const saved = await savePanels(req.userId!, id, panels);
    if (!saved) { res.status(404).json({ error: "Storyboard not found" }); return; }
    const dto = await toDTO(saved);
    res.json({ panel: dto.panels[idx], storyboard: dto });
  } catch (err) {
    req.log.error({ err }, "[storyboards] panel edit failed");
    res.status(500).json({ error: "Failed to save panel" });
  }
});

/* DELETE /api/storyboards/:id/panels/:panelId — remove one of my panels. */
router.delete("/storyboards/:id/panels/:panelId", requireAuth, async (req, res) => {
  const { id, panelId } = req.params as { id: string; panelId: string };
  try {
    const row = await ownBoard(req.userId!, id);
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    const panels = Array.isArray(row.panels) ? [...row.panels] : [];
    const idx = panels.findIndex((p) => p.id === panelId);
    if (idx < 0) { res.status(404).json({ error: "Panel not found" }); return; }
    panels.splice(idx, 1);
    const saved = await savePanels(req.userId!, id, panels);
    if (!saved) { res.status(404).json({ error: "Storyboard not found" }); return; }
    res.json({ storyboard: await toDTO(saved) });
  } catch (err) {
    req.log.error({ err }, "[storyboards] panel delete failed");
    res.status(500).json({ error: "Failed to remove panel" });
  }
});

/* POST /api/storyboards/:id/panels/:panelId/move — swap with a neighbor.
   At either end the move is an honest no-op: the board comes back
   unchanged rather than the panel wrapping around or vanishing. */
router.post("/storyboards/:id/panels/:panelId/move", requireAuth, async (req, res) => {
  const { id, panelId } = req.params as { id: string; panelId: string };
  const parsed = PanelMoveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid move", details: parsed.error.issues });
    return;
  }
  try {
    const row = await ownBoard(req.userId!, id);
    if (!row) { res.status(404).json({ error: "Storyboard not found" }); return; }
    const panels = Array.isArray(row.panels) ? [...row.panels] : [];
    const idx = panels.findIndex((p) => p.id === panelId);
    if (idx < 0) { res.status(404).json({ error: "Panel not found" }); return; }
    const swap = parsed.data.direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= panels.length) {
      res.json({ storyboard: await toDTO(row), moved: false });
      return;
    }
    const [panel] = panels.splice(idx, 1);
    panels.splice(swap, 0, panel!);
    const saved = await savePanels(req.userId!, id, panels);
    if (!saved) { res.status(404).json({ error: "Storyboard not found" }); return; }
    res.json({ storyboard: await toDTO(saved), moved: true });
  } catch (err) {
    req.log.error({ err }, "[storyboards] panel move failed");
    res.status(500).json({ error: "Failed to move panel" });
  }
});

export default router;
