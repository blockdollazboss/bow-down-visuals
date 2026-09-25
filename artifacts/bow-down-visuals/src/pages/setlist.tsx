import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ListMusic, Plus, GripVertical, ChevronUp, ChevronDown, Trash2,
  Sparkles, Loader2, Printer, Clock, Music2, StickyNote, X,
  CheckCircle2, AlertTriangle, Library,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  newSongId,
  formatDuration,
  parseDurationInput,
  totalRuntime,
  knownDurationCount,
  moveSong,
  applyFlowOrder,
  clearFlowAnnotations,
  SLOT_LABELS,
  SLOT_STYLES,
  ENERGY_LABELS,
  type SetSong,
  type FlowOrderItem,
} from "@/lib/setlist";

/* ─── Thy Cheat Code's Setlist Builder ───────────────────────────────────────
   Plan a live show: pull songs from the user's library or add them manually,
   drag to reorder, set energy + stage notes, and get an AI-suggested flow
   (opener → peaks → closer → encore). Building the setlist is pure UI and
   free — only the AI flow suggestion costs 1 credit (POST /api/setlist/flow). */

const CREDIT_COST = 1;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

interface LibrarySong {
  id: string;
  title: string;
  duration_sec?: string | null;
}

interface FlowResponse {
  order?: FlowOrderItem[];
  flowNotes?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

export default function SetlistBuilder() {
  const { getAccessToken, refreshProfile } = useAuth();

  const [songs, setSongs] = useState<SetSong[]>([]);
  const [showTitle, setShowTitle] = useState("");

  /* add-song form */
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newEnergy, setNewEnergy] = useState(0);

  /* library picker */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  /* AI flow */
  const [showNotes, setShowNotes] = useState("");
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowNotes, setFlowNotes] = useState<string | null>(null);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* drag state */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  /* which rows have their stage-note editor open */
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  const printRef = useRef<HTMLDivElement>(null);

  function addSong(title: string, artist = "", durationSec = 0, energy = 0) {
    const t = title.trim();
    if (!t) return;
    setSongs((prev) => [
      ...prev,
      { id: newSongId(), title: t, artist: artist.trim(), durationSec, energy, stageNote: "" },
    ]);
    setFlowNotes(null);
  }

  function handleAddManual() {
    if (!newTitle.trim()) {
      setError("Give the song a title first.");
      return;
    }
    setError(null);
    addSong(newTitle, newArtist, parseDurationInput(newDuration), newEnergy);
    setNewTitle("");
    setNewArtist("");
    setNewDuration("");
    setNewEnergy(0);
  }

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/songs", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Couldn't load your song library.");
      const data = (await res.json()) as { songs?: LibrarySong[] };
      const inSet = new Set(songs.map((s) => s.title.toLowerCase()));
      setLibrarySongs(
        (data.songs ?? []).filter((s) => s.title && !inSet.has(s.title.toLowerCase()))
      );
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "Couldn't load your song library.");
    } finally {
      setLibraryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  useEffect(() => {
    if (libraryOpen) void loadLibrary();
  }, [libraryOpen, loadLibrary]);

  function addFromLibrary(ls: LibrarySong) {
    const dur = ls.duration_sec ? parseDurationInput(ls.duration_sec) : 0;
    addSong(ls.title, "", dur, 0);
    setLibrarySongs((prev) => prev.filter((s) => s.id !== ls.id));
  }

  function removeSong(id: string) {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    setFlowNotes(null);
  }

  function updateSong(id: string, patch: Partial<SetSong>) {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function handleMove(from: number, to: number) {
    setSongs((prev) => clearFlowAnnotations(moveSong(prev, from, to)));
    setFlowNotes(null);
  }

  function handleDrop(dropIndex: number) {
    if (dragIndex === null) return;
    handleMove(dragIndex, dropIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  }

  async function handleAiFlow() {
    if (songs.length === 0) {
      setError("Add at least one song before asking for a flow.");
      return;
    }
    setError(null);
    setNotice(null);
    setOutOfCredits(false);
    setFlowLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/setlist/flow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          songs: songs.map((s) => ({
            title: s.title,
            artist: s.artist,
            durationSec: s.durationSec,
            energy: s.energy,
          })),
          showNotes,
        }),
      });
      const data = (await res.json()) as FlowResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        void refreshProfile();
        return;
      }
      if (!res.ok || !data.order || !data.flowNotes) {
        throw new Error(data.error || data.message || "The AI fumbled the setlist — try again.");
      }
      setSongs((prev) => applyFlowOrder(prev, data.order!));
      setFlowNotes(data.flowNotes!);
      setNotice(`Flow applied — ${data.order!.length} songs placed. ${CREDIT_COST} credit used.`);
      void refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI fumbled the setlist — try again.");
    } finally {
      setFlowLoading(false);
    }
  }

  const runtime = totalRuntime(songs);
  const known = knownDurationCount(songs);

  return (
    <div className="min-h-screen bg-black text-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { background: #fff !important; color: #000 !important; }
          .print-area * { color: #000 !important; border-color: #ddd !important; background: transparent !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print">
        <MarketingNav />
      </div>

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10 md:py-14">
        <Link href="/dashboard" className="no-print inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8">
          ← Back to Dashboard
        </Link>

        {/* hero */}
        <div className="mb-10">
          <div className="no-print flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <ListMusic className="h-5 w-5 text-primary" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-primary/80 border border-primary/25 rounded-full px-3 py-1">
              Free to plan · 1 credit for AI flow
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            {showTitle.trim() || "Setlist Builder"}
          </h1>
          <p className="no-print text-white/50 text-lg max-w-2xl">
            Build your live show like a director — order the arc, time the runtime, and let AI place
            your opener, peaks, and closer.
          </p>
          <div className="no-print mt-4 max-w-md">
            <input
              value={showTitle}
              onChange={(e) => setShowTitle(e.target.value)}
              placeholder="Name this show (e.g. Summer Fest — Main Stage)"
              className={inputClass}
              maxLength={120}
            />
          </div>
        </div>

        {/* runtime bar */}
        <div className="no-print mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm text-white/60">Runtime</span>
            <span className="text-lg font-bold text-white">{formatDuration(runtime)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Music2 className="h-4 w-4 text-primary" />
            <span className="text-sm text-white/60">{songs.length} song{songs.length === 1 ? "" : "s"}</span>
          </div>
          {songs.length > 0 && known < songs.length && (
            <span className="text-xs text-amber-300/80">
              {songs.length - known} song{songs.length - known === 1 ? "" : "s"} missing duration — runtime is partial
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setLibraryOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
            >
              <Library className="h-4 w-4" /> From my songs
            </button>
            <button
              onClick={() => printRef.current && window.print()}
              disabled={songs.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
            >
              <Printer className="h-4 w-4" /> Print setlist
            </button>
          </div>
        </div>

        {error && (
          <div className="no-print mb-6 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}
        {notice && (
          <div className="no-print mb-6 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-emerald-300 text-sm">{notice}</p>
          </div>
        )}
        {outOfCredits && (
          <div className="no-print mb-6">
            <OutOfCredits />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-8 items-start">
          {/* ── left column: add songs + AI flow ── */}
          <div className="no-print space-y-6">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <h2 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-4">Add a song</h2>
              <div className="space-y-3">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Song title *"
                  className={inputClass}
                  maxLength={200}
                />
                <input
                  value={newArtist}
                  onChange={(e) => setNewArtist(e.target.value)}
                  placeholder="Artist (optional)"
                  className={inputClass}
                  maxLength={200}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    placeholder="Length (3:30)"
                    className={inputClass}
                    maxLength={10}
                  />
                  <select
                    value={newEnergy}
                    onChange={(e) => setNewEnergy(Number(e.target.value))}
                    className={inputClass + " cursor-pointer"}
                    aria-label="Energy level"
                  >
                    <option value={0} className="bg-black">Energy…</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n} className="bg-black">
                        {n} — {ENERGY_LABELS[n]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAddManual}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition"
                >
                  <Plus className="h-4 w-4" /> Add to setlist
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/80 mb-2">
                <Sparkles className="h-4 w-4 text-primary" /> AI flow director
              </h2>
              <p className="text-xs text-white/45 mb-4">
                AI orders your songs into a real arc — opener, build, peaks, breather, closer, encore —
                with stage notes for each placement. {CREDIT_COST} credit per suggestion.
              </p>
              <textarea
                value={showNotes}
                onChange={(e) => setShowNotes(e.target.value)}
                placeholder="Show context (optional): venue, crowd, slot time…"
                className={inputClass + " resize-none mb-3"}
                style={{ minHeight: "64px" }}
                maxLength={500}
              />
              <button
                onClick={handleAiFlow}
                disabled={flowLoading || songs.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition disabled:opacity-40"
              >
                {flowLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Directing…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Suggest flow ({CREDIT_COST} credit)</>
                )}
              </button>
              {flowNotes && (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Director's notes</p>
                  <p className="text-sm text-white/70 leading-relaxed">{flowNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── right column: the setlist ── */}
          <div ref={printRef} className="print-area">
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold">{showTitle.trim() || "Setlist"}</h1>
              <p className="text-sm">
                {songs.length} songs · {formatDuration(runtime)} runtime
                {known < songs.length ? " (partial — some durations unknown)" : ""}
              </p>
            </div>

            {songs.length === 0 ? (
              <div className="no-print rounded-2xl border border-dashed border-white/15 bg-white/[0.01] p-12 text-center">
                <ListMusic className="h-10 w-10 text-white/15 mx-auto mb-4" />
                <p className="text-white/50 font-semibold mb-1">Your setlist is empty</p>
                <p className="text-white/30 text-sm">Add songs manually or pull them from your library.</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {songs.map((s, i) => (
                  <li
                    key={s.id}
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(i);
                    }}
                    onDragLeave={() => setDragOverIndex(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(i);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`rounded-2xl border bg-white/[0.02] p-4 transition-colors ${
                      dragOverIndex === i && dragIndex !== i
                        ? "border-primary/60 bg-primary/[0.06]"
                        : "border-white/[0.07]"
                    } ${dragIndex === i ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="no-print cursor-grab active:cursor-grabbing text-white/25 hover:text-white/60 shrink-0"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-5 w-5" />
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/25 text-sm font-bold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white truncate">
                          {s.title}
                          {s.artist && <span className="text-white/40 font-normal"> — {s.artist}</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {s.slot && SLOT_LABELS[s.slot] && (
                            <span className={`text-[11px] font-bold uppercase tracking-wider border rounded-full px-2.5 py-0.5 ${SLOT_STYLES[s.slot] ?? ""}`}>
                              {SLOT_LABELS[s.slot]}
                            </span>
                          )}
                          {s.energy > 0 && (
                            <span className="text-[11px] text-white/40">
                              Energy {s.energy}/5 · {ENERGY_LABELS[s.energy]}
                            </span>
                          )}
                          <span className="text-[11px] text-white/40">{formatDuration(s.durationSec)}</span>
                        </div>
                        {s.aiNote && (
                          <p className="mt-1.5 text-xs text-white/55 italic leading-relaxed">🎙 {s.aiNote}</p>
                        )}
                        {s.stageNote && (
                          <p className="print:block mt-1.5 text-xs text-amber-200/80 leading-relaxed">
                            📝 {s.stageNote}
                          </p>
                        )}
                      </div>

                      {/* per-song controls */}
                      <div className="no-print flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setNotesOpen((p) => ({ ...p, [s.id]: !p[s.id] }))}
                          className="rounded-lg p-1.5 text-white/30 hover:text-white hover:bg-white/10 transition"
                          title="Stage notes"
                        >
                          <StickyNote className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleMove(i, i - 1)}
                          disabled={i === 0}
                          className="rounded-lg p-1.5 text-white/30 hover:text-white hover:bg-white/10 transition disabled:opacity-20"
                          title="Move up"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleMove(i, i + 1)}
                          disabled={i === songs.length - 1}
                          className="rounded-lg p-1.5 text-white/30 hover:text-white hover:bg-white/10 transition disabled:opacity-20"
                          title="Move down"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeSong(s.id)}
                          className="rounded-lg p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 transition"
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* editable details */}
                    <div className="no-print mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                      <input
                        value={s.durationSec > 0 ? formatDuration(s.durationSec) : ""}
                        onChange={(e) => {
                          const v = parseDurationInput(e.target.value);
                          updateSong(s.id, { durationSec: v });
                        }}
                        placeholder="3:30"
                        className={inputClass + " !py-1.5 !text-xs"}
                        aria-label={`Duration for ${s.title}`}
                        maxLength={10}
                      />
                      <select
                        value={s.energy}
                        onChange={(e) => updateSong(s.id, { energy: Number(e.target.value) })}
                        className={inputClass + " !py-1.5 !text-xs cursor-pointer"}
                        aria-label={`Energy for ${s.title}`}
                      >
                        <option value={0} className="bg-black">Energy…</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n} className="bg-black">
                            {n} — {ENERGY_LABELS[n]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {notesOpen[s.id] && (
                      <div className="no-print mt-2">
                        <textarea
                          value={s.stageNote}
                          onChange={(e) => updateSong(s.id, { stageNote: e.target.value })}
                          placeholder="Stage notes: cues, talk points, transitions…"
                          className={inputClass + " !text-xs resize-none"}
                          style={{ minHeight: "56px" }}
                          maxLength={500}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {/* print footer */}
            <div className="hidden print:block mt-6 text-xs">
              {flowNotes && (
                <div className="mb-4">
                  <p className="font-bold mb-1">Director's notes</p>
                  <p>{flowNotes}</p>
                </div>
              )}
              <p>Built with Bow Down Visuals — bowdownvisuals.com</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── library picker modal ── */}
      {libraryOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLibraryOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c0c] p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Your songs</h2>
              <button onClick={() => setLibraryOpen(false)} className="rounded-lg p-1.5 text-white/40 hover:text-white hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            {libraryLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : libraryError ? (
              <p className="text-sm text-red-300">{libraryError}</p>
            ) : librarySongs.length === 0 ? (
              <div className="py-8 text-center">
                <Music2 className="h-8 w-8 text-white/15 mx-auto mb-3" />
                <p className="text-white/50 text-sm">No more songs to add — they're all in the setlist already.</p>
                <Link href="/songs" className="text-primary text-sm font-semibold hover:underline mt-2 inline-block">
                  Manage your song library →
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {librarySongs.map((ls) => (
                  <li key={ls.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{ls.title}</p>
                      <p className="text-xs text-white/35">{ls.duration_sec ? formatDuration(parseDurationInput(ls.duration_sec)) : "Unknown length"}</p>
                    </div>
                    <button
                      onClick={() => addFromLibrary(ls)}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary/15 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/25 transition"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="no-print">
        <SiteFooter />
      </div>
    </div>
  );
}
