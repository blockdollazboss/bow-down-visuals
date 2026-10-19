import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clapperboard, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  artistImageCost,
  buildArtistImagePayload,
  DEFAULT_ARTIST_IMAGE_MODEL,
  interpretTaskPoll,
} from "@/lib/world/create-desks";
import {
  STORYBOARD_FRAME_RATIO,
  buildPanelMovePayload,
  buildPanelPayload,
  buildStoryboardPlannerProjectPayload,
  framePromptForPanel,
  movePanelLocal,
  normalizeStoryboardList,
  panelOfResponse,
  storyboardOfResponse,
  storyboardPanelMovePath,
  storyboardPanelPath,
  storyboardPanelsPath,
  storyboardPath,
  STORYBOARDS_PATH,
  type StoryboardBoardDTO,
  type StoryboardPanelDTO,
} from "@/lib/world/storyboard-planner";
import { QuestProgressChip, useDeskAuthHeaders, useQuestProgressChip } from "./CreateDeskShared";

/* ─── STACK-20 R2 #19 (2.3, planner half) — the storyboard planner ──
   The bench above builds scenes FROM a song; this planner is the
   other half of 2.3: panels the member authors by hand — a frame
   (generated on the site's artist-image rail, or none yet), a title,
   their notes, in an order they control — saved on the server as
   THEIR storyboard (routes/storyboards) and handed into the video
   flow as a project whose scenes are the panels.

   Honesty rules: a panel without a frame is a notes-only panel and
   says so — no stand-in image is ever drawn for it; a failed frame
   generation leaves the panel exactly as it was, with the failure
   named and a retry offered; a failed text save keeps the words in
   the composer and says the save failed — "Saved" is claimed only
   when the server confirms it. Panel words live in a per-panel draft
   map, so structural moves (which adopt the server's board) can never
   eat words being typed in another panel. */

type SaveState = "idle" | "saving" | "saved" | "failed";
type FrameState = "idle" | "running" | "failed";

export function StoryboardPlanner(props: {
  isLight: boolean;
  /** Save-as-project + step through to the seeded editor. */
  onSendToEditor?: (payload: Record<string, unknown>) => void;
  editorBusy?: boolean;
}) {
  const { isLight } = props;
  const { refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();

  const [boards, setBoards] = useState<StoryboardBoardDTO[]>([]);
  const [board, setBoard] = useState<StoryboardBoardDTO | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedProject, setSavedProject] = useState(false);

  /* Per-panel words being typed (never clobbered by server boards). */
  const [drafts, setDrafts] = useState<Record<string, { title: string; notes: string }>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [frameStates, setFrameStates] = useState<Record<string, FrameState>>({});
  const [frameErrors, setFrameErrors] = useState<Record<string, string>>({});
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const framePolls = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => () => {
    for (const t of Object.values(framePolls.current)) clearInterval(t);
  }, []);

  const loadBoards = useCallback(async (openId?: string) => {
    setLoadState("loading");
    setError(null);
    try {
      const res = await fetch(STORYBOARDS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("Your storyboards didn't load.");
      const list = normalizeStoryboardList(await res.json());
      setBoards(list);
      const open = list.find((b) => b.id === openId) ?? list[0] ?? null;
      setBoard(open);
      setBoardTitleDraft(open?.title ?? "");
      setLoadState("ready");
    } catch {
      setLoadState("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadBoards(); }, [loadBoards]);

  const adoptBoard = useCallback((next: StoryboardBoardDTO) => {
    setBoard(next);
    setBoardTitleDraft(next.title);
    setBoards((prev) => {
      const others = prev.filter((b) => b.id !== next.id);
      return [next, ...others];
    });
    setDrafts((prev) => {
      const live = new Set(next.panels.map((p) => p.id));
      return Object.fromEntries(Object.entries(prev).filter(([id]) => live.has(id)));
    });
  }, []);

  const createBoard = async () => {
    if (busy) return;
    setBusy("create-board");
    setError(null);
    try {
      const res = await fetch(STORYBOARDS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ title: "Untitled storyboard" }),
      });
      const next = storyboardOfResponse(await res.json().catch(() => null));
      if (!res.ok || !next) throw new Error("The storyboard didn't start — try again.");
      adoptBoard(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The storyboard didn't start.");
    } finally {
      setBusy(null);
    }
  };

  const renameBoard = async () => {
    if (!board) return;
    const title = boardTitleDraft.trim();
    if (!title || title === board.title) { setBoardTitleDraft(board.title); return; }
    try {
      const res = await fetch(storyboardPath(board.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ title }),
      });
      const next = storyboardOfResponse(await res.json().catch(() => null));
      if (!res.ok || !next) throw new Error("The rename didn't land — the old title stands.");
      adoptBoard(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The rename didn't land.");
      setBoardTitleDraft(board.title);
    }
  };

  const deleteBoard = async () => {
    if (!board || busy) return;
    setBusy("delete-board");
    setError(null);
    try {
      const res = await fetch(storyboardPath(board.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("The storyboard didn't delete — it's still saved.");
      const remaining = boards.filter((b) => b.id !== board.id);
      setBoards(remaining);
      setBoard(remaining[0] ?? null);
      setBoardTitleDraft(remaining[0]?.title ?? "");
      setSavedProject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The storyboard didn't delete.");
    } finally {
      setBusy(null);
    }
  };

  const addPanel = async () => {
    if (!board || busy) return;
    setBusy("add-panel");
    setError(null);
    try {
      const res = await fetch(storyboardPanelsPath(board.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPanelPayload({})),
      });
      const data = await res.json().catch(() => null);
      const next = storyboardOfResponse(data);
      if (!res.ok || !next) throw new Error("The panel didn't land — the board is unchanged.");
      adoptBoard(next);
      setSavedProject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The panel didn't land.");
    } finally {
      setBusy(null);
    }
  };

  /** Commit a panel's drafted words. Failure keeps the words in the
      composer and says so — the panel is only marked saved on the
      server's own answer. */
  const savePanelWords = async (panel: StoryboardPanelDTO) => {
    if (!board) return;
    const draft = drafts[panel.id];
    if (!draft) return;
    if (draft.title === panel.title && draft.notes === panel.notes) return;
    setSaveStates((s) => ({ ...s, [panel.id]: "saving" }));
    try {
      const res = await fetch(storyboardPanelPath(board.id, panel.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPanelPayload({ title: draft.title, notes: draft.notes })),
      });
      const savedPanel = panelOfResponse(await res.json().catch(() => null));
      if (!res.ok || !savedPanel) throw new Error("save failed");
      setBoard((prev) => prev ? {
        ...prev,
        panels: prev.panels.map((p) => (p.id === savedPanel.id ? { ...p, title: savedPanel.title, notes: savedPanel.notes } : p)),
      } : prev);
      setSaveStates((s) => ({ ...s, [panel.id]: "saved" }));
    } catch {
      setSaveStates((s) => ({ ...s, [panel.id]: "failed" }));
    }
  };

  const movePanel = async (panel: StoryboardPanelDTO, direction: "up" | "down") => {
    if (!board || busy) return;
    /* Optimistic: the same one-step swap the server performs. */
    setBoard((prev) => prev ? { ...prev, panels: movePanelLocal(prev.panels, panel.id, direction) } : prev);
    try {
      const res = await fetch(storyboardPanelMovePath(board.id, panel.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPanelMovePayload(direction)),
      });
      const next = storyboardOfResponse(await res.json().catch(() => null));
      if (!res.ok || !next) throw new Error("move failed");
      adoptBoard(next);
    } catch {
      setError("That move didn't land — the order is back to the saved one.");
      void loadBoards(board.id);
    }
  };

  const deletePanel = async (panel: StoryboardPanelDTO) => {
    if (!board || busy) return;
    setBusy(`delete-${panel.id}`);
    setError(null);
    try {
      const res = await fetch(storyboardPanelPath(board.id, panel.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const next = storyboardOfResponse(await res.json().catch(() => null));
      if (!res.ok || !next) throw new Error("The panel didn't delete — it's still on the board.");
      adoptBoard(next);
      setSavedProject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The panel didn't delete.");
    } finally {
      setBusy(null);
    }
  };

  const clearFrame = async (panel: StoryboardPanelDTO) => {
    if (!board || busy) return;
    try {
      const res = await fetch(storyboardPanelPath(board.id, panel.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPanelPayload({ imageUrl: null, imagePrompt: null })),
      });
      const savedPanel = panelOfResponse(await res.json().catch(() => null));
      if (!res.ok || !savedPanel) throw new Error("clear failed");
      setBoard((prev) => prev ? {
        ...prev,
        panels: prev.panels.map((p) => (p.id === savedPanel.id ? savedPanel : p)),
      } : prev);
    } catch {
      setError("The frame didn't clear — it's still on the panel.");
    }
  };

  /** Generate the panel's frame on the site's artist-image rail, then
      save the rail's own URL back onto the panel. A failure charges
      nothing (the rail charges on success) and leaves the panel
      exactly as it was — notes-only until a frame truly lands. */
  const generateFrame = async (panel: StoryboardPanelDTO) => {
    if (!board || frameStates[panel.id] === "running") return;
    const draft = drafts[panel.id] ?? { title: panel.title, notes: panel.notes };
    const prompt = framePromptForPanel(draft);
    if (!prompt) {
      setFrameStates((s) => ({ ...s, [panel.id]: "failed" }));
      setFrameErrors((e) => ({ ...e, [panel.id]: "Give the panel a title or a few words first — the frame is made from them." }));
      return;
    }
    /* Words first: the frame is made from the panel's saved words. */
    await savePanelWords(panel);
    setFrameStates((s) => ({ ...s, [panel.id]: "running" }));
    setFrameErrors((e) => ({ ...e, [panel.id]: "" }));
    try {
      const res = await fetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildArtistImagePayload(prompt, DEFAULT_ARTIST_IMAGE_MODEL, STORYBOARD_FRAME_RATIO)),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; status?: string; url?: string | null; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? "The frame make didn't start.");

      const finishWithUrl = async (url: string) => {
        const save = await fetch(storyboardPanelPath(board.id, panel.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(buildPanelPayload({ imageUrl: url, imagePrompt: prompt })),
        });
        const savedPanel = panelOfResponse(await save.json().catch(() => null));
        if (!save.ok || !savedPanel) throw new Error("The frame was made but didn't save to the panel — generate again to retry the save.");
        setBoard((prev) => prev ? {
          ...prev,
          panels: prev.panels.map((p) => (p.id === savedPanel.id ? savedPanel : p)),
        } : prev);
        setFrameStates((s) => ({ ...s, [panel.id]: "idle" }));
        refreshProfile();
      };

      if (data.status === "succeeded" && data.url) {
        await finishWithUrl(data.url);
        return;
      }
      const taskId = data.taskId;
      framePolls.current[panel.id] = setInterval(async () => {
        try {
          const poll = await fetch(`/api/generate-artist-image/${taskId}`, { headers: await authHeaders() });
          const pdata = (await poll.json()) as Parameters<typeof interpretTaskPoll>[0];
          const read = interpretTaskPoll(pdata);
          if (read.done) {
            clearInterval(framePolls.current[panel.id]);
            delete framePolls.current[panel.id];
            if (read.failed || !read.url) {
              setFrameStates((s) => ({ ...s, [panel.id]: "failed" }));
              setFrameErrors((e) => ({ ...e, [panel.id]: read.error ?? "Frame generation failed — nothing was saved to the panel." }));
            } else {
              await finishWithUrl(read.url);
            }
          }
        } catch {
          clearInterval(framePolls.current[panel.id]);
          delete framePolls.current[panel.id];
          setFrameStates((s) => ({ ...s, [panel.id]: "failed" }));
          setFrameErrors((e) => ({ ...e, [panel.id]: "Network error while the frame was making — the panel is unchanged." }));
        }
      }, 5000);
    } catch (err) {
      setFrameStates((s) => ({ ...s, [panel.id]: "failed" }));
      setFrameErrors((e) => ({ ...e, [panel.id]: err instanceof Error ? err.message : "Frame generation failed." }));
    }
  };

  const handoff = async () => {
    if (!board || busy || board.panels.length === 0) return;
    setBusy("handoff");
    setError(null);
    /* Every panel's words ride — flush any unsaved drafts first. */
    for (const panel of board.panels) await savePanelWords(panel);
    const payload = buildStoryboardPlannerProjectPayload({ board, panels: board.panels });
    try {
      if (props.onSendToEditor) {
        props.onSendToEditor(payload);
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Saving the project didn't land — your storyboard is still saved here.");
      }
      setSavedProject(true);
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the project failed.");
    } finally {
      setBusy(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chipCls = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
  const inputCls = `w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`;
  const frameCost = artistImageCost(DEFAULT_ARTIST_IMAGE_MODEL);

  return (
    <div data-testid="world-storyboard-planner" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          <Clapperboard className="h-3.5 w-3.5" /> Storyboard planner — plan it panel by panel
        </p>
        {boards.length > 1 ? (
          <select
            data-testid="world-storyboard-planner-open"
            value={board?.id ?? ""}
            onChange={(e) => {
              const next = boards.find((b) => b.id === e.target.value) ?? null;
              setBoard(next);
              setBoardTitleDraft(next?.title ?? "");
              setSavedProject(false);
            }}
            className={`ml-auto rounded-lg border px-2 py-1 text-xs ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>{b.title} · {b.panelCount} panels</option>
            ))}
          </select>
        ) : null}
        <button type="button" data-testid="world-storyboard-planner-new" onClick={() => void createBoard()} disabled={busy !== null} className={`${chipCls} ${boards.length > 1 ? "" : "ml-auto"}`}>
          <Plus className="h-3.5 w-3.5" /> New storyboard
        </button>
      </div>

      {loadState === "loading" ? (
        <p className={`flex items-center gap-2 text-xs font-semibold ${muted}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your storyboards…</p>
      ) : loadState === "failed" ? (
        <div className="space-y-2">
          <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Your storyboards didn't load — nothing was changed.</p>
          <button type="button" data-testid="world-storyboard-planner-retry" onClick={() => void loadBoards(board?.id)} className={chipCls}>Try again</button>
        </div>
      ) : !board ? (
        <p className={`text-xs ${muted}`}>No storyboard yet. Start one and plan the video panel by panel — each panel is a shot: a frame, a title, your notes.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="world-storyboard-planner-title"
              value={boardTitleDraft}
              onChange={(e) => setBoardTitleDraft(e.target.value)}
              onBlur={() => void renameBoard()}
              placeholder="Storyboard title"
              className={`${inputCls} max-w-xs font-bold`}
            />
            <span className={`text-xs font-semibold ${muted}`}>{board.panels.length} {board.panels.length === 1 ? "panel" : "panels"} · saved on the server as you work</span>
            <button type="button" data-testid="world-storyboard-planner-delete" onClick={() => void deleteBoard()} disabled={busy !== null} className={`${chipCls} ml-auto`}>
              <Trash2 className="h-3.5 w-3.5" /> Delete storyboard
            </button>
          </div>

          {board.panels.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-1" data-testid="world-storyboard-planner-strip">
              {board.panels.map((panel, i) => {
                const draft = drafts[panel.id] ?? { title: panel.title, notes: panel.notes };
                const frameState = frameStates[panel.id] ?? "idle";
                const saveState = saveStates[panel.id] ?? "idle";
                return (
                  <div key={panel.id} data-testid="world-storyboard-panel" className={`w-[240px] shrink-0 space-y-2 rounded-xl border p-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black">Panel {i + 1}</span>
                      <span className={`ml-auto flex items-center gap-1`}>
                        <button type="button" data-testid="world-storyboard-panel-left" aria-label="Move panel earlier" onClick={() => void movePanel(panel, "up")} disabled={busy !== null || i === 0} className={chipCls}><ArrowLeft className="h-3 w-3" /></button>
                        <button type="button" data-testid="world-storyboard-panel-right" aria-label="Move panel later" onClick={() => void movePanel(panel, "down")} disabled={busy !== null || i === board.panels.length - 1} className={chipCls}><ArrowRight className="h-3 w-3" /></button>
                        <button type="button" data-testid="world-storyboard-panel-delete" aria-label="Delete panel" onClick={() => void deletePanel(panel)} disabled={busy !== null} className={chipCls}><Trash2 className="h-3 w-3" /></button>
                      </span>
                    </div>

                    {panel.imageUrl ? (
                      <img src={panel.imageUrl} alt={draft.title || `Panel ${i + 1} frame`} className="aspect-video w-full rounded-lg object-cover" />
                    ) : frameState === "running" ? (
                      <div className={`flex aspect-video w-full items-center justify-center gap-2 rounded-lg border border-dashed text-xs font-semibold ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-white/20 text-white/60"}`}>
                        <Loader2 className="h-4 w-4 animate-spin" /> Making the frame…
                      </div>
                    ) : (
                      <div data-testid="world-storyboard-panel-noframe" className={`flex aspect-video w-full items-center justify-center rounded-lg border border-dashed px-3 text-center text-xs font-semibold ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-white/20 text-white/60"}`}>
                        No frame yet — a notes-only panel. It still films from its words.
                      </div>
                    )}
                    {frameState === "failed" ? (
                      <p data-testid="world-storyboard-panel-frame-error" className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{frameErrors[panel.id] || "Frame generation failed."}</p>
                    ) : null}

                    <input
                      data-testid="world-storyboard-panel-title"
                      value={draft.title}
                      onChange={(e) => setDrafts((d) => ({ ...d, [panel.id]: { title: e.target.value, notes: draft.notes } }))}
                      onBlur={() => void savePanelWords(panel)}
                      placeholder="Panel title — the shot in a few words"
                      className={inputCls}
                    />
                    <textarea
                      data-testid="world-storyboard-panel-notes"
                      value={draft.notes}
                      onChange={(e) => setDrafts((d) => ({ ...d, [panel.id]: { title: draft.title, notes: e.target.value } }))}
                      onBlur={() => void savePanelWords(panel)}
                      rows={3}
                      placeholder="Notes — what happens, what it looks like, the line it covers"
                      className={inputCls}
                    />
                    {saveState === "saving" ? <p className={`text-[11px] font-semibold ${muted}`}>Saving…</p> : null}
                    {saveState === "saved" ? <p className={`text-[11px] font-semibold ${muted}`}>Saved.</p> : null}
                    {saveState === "failed" ? <p data-testid="world-storyboard-panel-save-error" className={`text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Couldn't save — your words are still here; tap out of the box to try again.</p> : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" data-testid="world-storyboard-panel-frame" onClick={() => void generateFrame(panel)} disabled={frameState === "running"} className={chipCls}>
                        {frameState === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                        {frameState === "failed" ? "Retry the frame" : panel.imageUrl ? "Remake the frame" : "Generate a frame"} · {frameCost.toLocaleString("en-US")} Visual Bucs
                      </button>
                      {panel.imageUrl ? (
                        <button type="button" data-testid="world-storyboard-panel-clearframe" onClick={() => void clearFrame(panel)} disabled={busy !== null} className={chipCls}>Remove frame</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={`text-xs ${muted}`}>An empty board. Add the first panel — a shot, a moment, a line to cover.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="world-storyboard-add-panel" onClick={() => void addPanel()} disabled={busy !== null} className={chipCls}>
              {busy === "add-panel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add a panel
            </button>
            <button type="button" data-testid="world-storyboard-handoff" onClick={() => void handoff()} disabled={busy !== null || props.editorBusy || board.panels.length === 0} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
              {props.onSendToEditor ? "Use in a video — save + open in the editor" : "Use in a video — save as a project"}
            </button>
            {savedProject ? (
              <span className={`text-xs font-semibold ${muted}`}>
                Saved as a project — its scenes are these panels, in this order.{" "}
                <a data-testid="world-storyboard-projects-link" href="/my-projects" className="underline">Open your projects on the website ↗</a>
              </span>
            ) : null}
          </div>
        </>
      )}

      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
      <p className={`text-[11px] ${muted}`}>Frames are made on the site's image rail from the panel's own words, wide (16:9). A panel without a frame is a plan card — the editor films it from its title and notes.</p>
    </div>
  );
}
