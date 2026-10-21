import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Gauge, ListMusic, Sparkles, Download, Trash2,
  ChevronUp, ChevronDown, X, Plus, Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── DJ Set-Prep Pack (docked as the "DJ Sets" tab of the song library) ──
   Reads the creator's own tracks for the booth: BPM + musical key +
   Camelot, all ESTIMATES that carry their confidence with them — a low-
   confidence read is labeled a rough guess in the UI, and a track with
   no solid read says "no key found" instead of wearing an invented one.
   Thy Cheat Code proposes a harmonic crate order as a DRAFT; the saved
   crate only changes when the creator taps "Use this order".
   Exports: rekordbox XML + M3U, in the crate's saved play order. Free —
   it rides the creator's own library. */

export interface DjAnalysis {
  bpm: number | null;
  bpmConfidence: "high" | "medium" | "low" | null;
  keyLabel: string | null;
  camelot: string | null;
  keyConfidence: "high" | "medium" | "low" | null;
  keyScore: number | null;
  durationSec: number | null;
  analyzedAt: string | null;
}

interface DjLibraryTrack {
  id: string;
  title: string;
  audioUrl: string;
  source: string;
  durationSec: string | null;
  createdAt: string;
  analysis: DjAnalysis | null;
}

interface DjCrateTrack {
  songId: string;
  title: string;
  audioUrl: string;
  durationSec: number | null;
  bpm: number | null;
  keyLabel: string | null;
  camelot: string | null;
  tonality: string | null;
  keyConfidence: "high" | "medium" | "low" | null;
  position: number;
  analysis: DjAnalysis | null;
}

interface DjCrate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tracks: DjCrateTrack[];
}

interface TransitionNote {
  fromSongId: string;
  toSongId: string;
  note: string;
}

interface SetProposal {
  order: string[];
  transitions: TransitionNote[];
  unanalyzed: string[];
}

type AuthHeaders = () => Promise<HeadersInit>;

/** The BPM · key · Camelot chip row, shared with the song cards.
 *  Renders nothing when there's no analysis — callers show the
 *  "DJ analysis" button in that case instead. */
export function DjChips({ analysis }: { analysis: DjAnalysis }) {
  const { t } = useTranslation();
  const rough = analysis.keyConfidence === "low" || analysis.bpmConfidence === "low";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
        <Gauge className="h-3 w-3" />
        {analysis.bpm != null ? `${analysis.bpm} ${t("djSets.bpm")}` : t("djSets.bpmUnknown")}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-white/80">
        {analysis.keyLabel ?? t("djSets.keyUnknown")}
        {analysis.camelot && <span className="text-primary">· {analysis.camelot}</span>}
      </span>
      {rough && (
        <span className="text-[11px] italic text-amber-300/90">{t("djSets.roughGuess")}</span>
      )}
    </div>
  );
}

export default function DjSetPrep({ authHeaders }: { authHeaders: AuthHeaders }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<DjLibraryTrack[]>([]);
  const [crates, setCrates] = useState<DjCrate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [analyzeErrors, setAnalyzeErrors] = useState<Record<string, string>>({});
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [newCrateName, setNewCrateName] = useState("");
  const [creatingCrate, setCreatingCrate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ crateId: string; proposal: SetProposal } | null>(null);
  const [proposing, setProposing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const panelCls = `rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`;

  const loadAll = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [libRes, crateRes] = await Promise.all([
        fetch("/api/dj/library", { headers }),
        fetch("/api/dj/crates", { headers }),
      ]);
      const lib = (await libRes.json()) as { tracks?: DjLibraryTrack[]; error?: string };
      const cr = (await crateRes.json()) as { crates?: DjCrate[]; error?: string };
      if (!libRes.ok) throw new Error(lib.error || t("djSets.errorLoad"));
      if (!crateRes.ok) throw new Error(cr.error || t("djSets.errorLoad"));
      setTracks(lib.tracks ?? []);
      setCrates(cr.crates ?? []);
      setSelectedCrateId((prev) => prev ?? (cr.crates ?? [])[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedCrate = crates.find((c) => c.id === selectedCrateId) ?? null;
  const crateSongIds = new Set((selectedCrate?.tracks ?? []).map((tr) => tr.songId));

  async function analyze(songIds: string[]) {
    if (songIds.length === 0) return;
    setAnalyzing((prev) => new Set([...prev, ...songIds]));
    try {
      const res = await fetch("/api/dj/analyze", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ songIds }),
      });
      const data = (await res.json()) as {
        results?: Array<{ songId: string; status: string; analysis?: DjAnalysis; error?: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t("djSets.errorAnalyze"));
      const byId = new Map((data.results ?? []).map((r) => [r.songId, r]));
      setTracks((prev) =>
        prev.map((tr) => {
          const r = byId.get(tr.id);
          return r?.analysis ? { ...tr, analysis: r.analysis } : tr;
        }),
      );
      setAnalyzeErrors((prev) => {
        const next = { ...prev };
        for (const r of data.results ?? []) {
          if (r.status === "failed") next[r.songId] = r.error || t("djSets.errorAnalyze");
          else delete next[r.songId];
        }
        return next;
      });
      // Crate rows embed analysis too — refresh them quietly.
      const crateRes = await fetch("/api/dj/crates", { headers: await authHeaders() });
      if (crateRes.ok) {
        const cr = (await crateRes.json()) as { crates?: DjCrate[] };
        setCrates(cr.crates ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorAnalyze"));
    } finally {
      setAnalyzing((prev) => {
        const next = new Set(prev);
        for (const id of songIds) next.delete(id);
        return next;
      });
    }
  }

  async function createCrate() {
    const name = newCrateName.trim();
    if (!name || creatingCrate) return;
    setCreatingCrate(true);
    setError(null);
    try {
      const res = await fetch("/api/dj/crates", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { crate?: DjCrate; error?: string };
      if (!res.ok || !data.crate) throw new Error(data.error || t("djSets.errorSave"));
      setCrates((prev) => [data.crate!, ...prev]);
      setSelectedCrateId(data.crate.id);
      setNewCrateName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorSave"));
    } finally {
      setCreatingCrate(false);
    }
  }

  /** PATCH the crate's membership/order; the response is the new truth. */
  async function patchCrate(crateId: string, body: { name?: string; songIds?: string[] }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dj/crates/${crateId}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { crate?: DjCrate; error?: string };
      if (!res.ok || !data.crate) throw new Error(data.error || t("djSets.errorSave"));
      setCrates((prev) => prev.map((c) => (c.id === crateId ? data.crate! : c)));
      return data.crate;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorSave"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function proposeOrder() {
    if (!selectedCrate || proposing) return;
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(`/api/dj/crates/${selectedCrate.id}/propose-order`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { proposal?: SetProposal; error?: string };
      if (!res.ok || !data.proposal) throw new Error(data.error || t("djSets.errorSave"));
      setDraft({ crateId: selectedCrate.id, proposal: data.proposal });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorSave"));
    } finally {
      setProposing(false);
    }
  }

  async function useDraft() {
    if (!draft) return;
    const saved = await patchCrate(draft.crateId, { songIds: draft.proposal.order });
    if (saved) setDraft(null);
  }

  async function deleteCrate() {
    if (!selectedCrate) return;
    if (!window.confirm(t("djSets.deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/dj/crates/${selectedCrate.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(t("djSets.errorSave"));
      setCrates((prev) => prev.filter((c) => c.id !== selectedCrate.id));
      setSelectedCrateId(null);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorSave"));
    }
  }

  async function exportCrate(format: "rekordbox" | "m3u") {
    if (!selectedCrate || exporting) return;
    setExporting(format);
    setError(null);
    try {
      const res = await fetch(`/api/dj/crates/${selectedCrate.id}/export?format=${format}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || t("djSets.errorSave"));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fallback = `${selectedCrate.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "crate"}.${format === "rekordbox" ? "rekordbox.xml" : "m3u"}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? fallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("djSets.errorSave"));
    } finally {
      setExporting(null);
    }
  }

  const unanalyzedTracks = tracks.filter((tr) => !tr.analysis);
  const draftForSelected = draft && selectedCrate && draft.crateId === selectedCrate.id ? draft : null;
  const titleById = new Map((selectedCrate?.tracks ?? []).map((tr) => [tr.songId, tr.title]));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <div>
      <div className={`${panelCls} mb-6`}>
        <p className="flex items-center gap-2 text-sm font-bold mb-1">
          <ListMusic className="h-4 w-4 text-primary" />
          {t("djSets.title")}
        </p>
        <p className="text-sm text-white/60">{t("djSets.intro")}</p>
        <p className="mt-2 text-xs text-white/40">{t("djSets.estimatesNote")}</p>
        <p className="mt-1 text-xs text-primary/80">{t("djSets.freeNote")}</p>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Library: tracks + analysis ─────────────────────────── */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white/60">
              {t("djSets.yourTracks")}
            </h3>
            {unanalyzedTracks.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-primary/40 text-primary"
                disabled={analyzing.size > 0}
                onClick={() => void analyze(unanalyzedTracks.slice(0, 20).map((tr) => tr.id))}
              >
                {analyzing.size > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("djSets.analyzeAll")}
              </Button>
            )}
          </div>
          {tracks.length === 0 ? (
            <p className="text-sm text-white/40 py-8 text-center">{t("djSets.noTracks")}</p>
          ) : (
            <div className="space-y-2">
              {tracks.map((tr) => (
                <div key={tr.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">{tr.title}</p>
                    {selectedCrate &&
                      (crateSongIds.has(tr.id) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
                          <Check className="h-3.5 w-3.5" /> {t("djSets.inCrate")}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 rounded-lg border-white/15 px-2 text-xs text-white/80"
                          disabled={saving}
                          onClick={() =>
                            void patchCrate(selectedCrate.id, {
                              songIds: [...(selectedCrate.tracks.map((x) => x.songId)), tr.id],
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> {t("djSets.addToCrate")}
                        </Button>
                      ))}
                  </div>
                  {tr.analysis ? (
                    <DjChips analysis={tr.analysis} />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-lg border-primary/40 px-2 text-xs text-primary"
                      disabled={analyzing.has(tr.id)}
                      onClick={() => void analyze([tr.id])}
                    >
                      {analyzing.has(tr.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Gauge className="h-3.5 w-3.5" />
                      )}
                      {analyzing.has(tr.id) ? t("djSets.analyzing") : t("djSets.analyze")}
                    </Button>
                  )}
                  {analyzeErrors[tr.id] && (
                    <p className="mt-1 text-xs text-red-400">{analyzeErrors[tr.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Crates: build, order, export ───────────────────────── */}
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-white/60">
            {t("djSets.yourCrates")}
          </h3>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={newCrateName}
              onChange={(e) => setNewCrateName(e.target.value)}
              placeholder={t("djSets.newCratePlaceholder")}
              maxLength={80}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
              onKeyDown={(e) => {
                if (e.key === "Enter") void createCrate();
              }}
            />
            <Button
              size="sm"
              className="shrink-0 rounded-xl"
              disabled={creatingCrate || !newCrateName.trim()}
              onClick={() => void createCrate()}
            >
              {creatingCrate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("djSets.createCrate")}
            </Button>
          </div>

          {crates.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {crates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCrateId(c.id);
                    setDraft(null);
                    setRenaming(false);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    c.id === selectedCrateId
                      ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
                      : "border border-white/15 text-white/60 hover:text-white"
                  }`}
                >
                  {c.name} · {c.tracks.length}
                </button>
              ))}
            </div>
          )}

          {!selectedCrate ? (
            <p className="text-sm text-white/40 py-8 text-center">{t("djSets.noCrates")}</p>
          ) : (
            <div className={panelCls}>
              <div className="mb-3 flex items-center justify-between gap-2">
                {renaming ? (
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      setRenaming(false);
                      const name = renameValue.trim();
                      if (name && name !== selectedCrate.name) {
                        void patchCrate(selectedCrate.id, { name });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-sm font-bold text-white outline-none focus:border-white/30"
                  />
                ) : (
                  <p className="min-w-0 flex-1 truncate text-sm font-bold">{selectedCrate.name}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(selectedCrate.name);
                    setRenaming(true);
                  }}
                  className="shrink-0 text-xs font-semibold text-white/50 hover:text-primary"
                >
                  {t("djSets.rename")}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteCrate()}
                  className="shrink-0 text-white/40 hover:text-red-400"
                  title={t("djSets.deleteCrate")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {selectedCrate.tracks.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/40">{t("djSets.emptyCrate")}</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {selectedCrate.tracks.map((tr, i) => (
                      <div
                        key={tr.songId}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2"
                      >
                        <span className="w-5 shrink-0 text-center text-xs font-bold text-primary">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{tr.title}</p>
                          <p className="text-[11px] text-white/45">
                            {tr.bpm != null ? `${tr.bpm} ${t("djSets.bpm")}` : t("djSets.bpmUnknown")}
                            {" · "}
                            {tr.keyLabel ?? t("djSets.keyUnknown")}
                            {tr.camelot ? ` · ${tr.camelot}` : ""}
                            {tr.keyConfidence === "low" ? ` · ${t("djSets.roughGuess")}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={saving || i === 0}
                          onClick={() => {
                            const ids = selectedCrate.tracks.map((x) => x.songId);
                            [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
                            void patchCrate(selectedCrate.id, { songIds: ids });
                          }}
                          className="shrink-0 text-white/40 hover:text-white disabled:opacity-25"
                          title={t("djSets.moveUp")}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={saving || i === selectedCrate.tracks.length - 1}
                          onClick={() => {
                            const ids = selectedCrate.tracks.map((x) => x.songId);
                            [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!];
                            void patchCrate(selectedCrate.id, { songIds: ids });
                          }}
                          className="shrink-0 text-white/40 hover:text-white disabled:opacity-25"
                          title={t("djSets.moveDown")}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void patchCrate(selectedCrate.id, {
                              songIds: selectedCrate.tracks
                                .map((x) => x.songId)
                                .filter((id) => id !== tr.songId),
                            })
                          }
                          className="shrink-0 text-white/40 hover:text-red-400 disabled:opacity-25"
                          title={t("djSets.removeFromCrate")}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-primary/40 text-primary"
                      disabled={proposing || saving}
                      onClick={() => void proposeOrder()}
                    >
                      {proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {proposing ? t("djSets.thinking") : t("djSets.askOrder")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-white/15 text-white/80"
                      disabled={exporting !== null}
                      onClick={() => void exportCrate("rekordbox")}
                    >
                      {exporting === "rekordbox" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {t("djSets.exportRekordbox")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-white/15 text-white/80"
                      disabled={exporting !== null}
                      onClick={() => void exportCrate("m3u")}
                    >
                      {exporting === "m3u" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {t("djSets.exportM3u")}
                    </Button>
                  </div>

                  {draftForSelected && (
                    <div className="mt-4 rounded-xl border border-primary/50 bg-primary/[0.06] p-3">
                      <p className="mb-1 text-sm font-bold text-primary">{t("djSets.draftTitle")}</p>
                      <p className="mb-3 text-xs text-white/50">{t("djSets.draftNote")}</p>
                      <div className="space-y-1">
                        {draftForSelected.proposal.order.map((songId, i) => (
                          <div key={songId}>
                            <p className="text-sm">
                              <span className="mr-2 font-bold text-primary">{i + 1}</span>
                              {titleById.get(songId) ?? songId}
                            </p>
                            {draftForSelected.proposal.transitions[i] && (
                              <p className="mb-1 ml-6 text-[11px] italic text-white/45">
                                ↓ {draftForSelected.proposal.transitions[i]!.note}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      {draftForSelected.proposal.unanalyzed.length > 0 && (
                        <p className="mt-2 text-xs text-amber-300/90">
                          {t("djSets.unanalyzedNote")}{" "}
                          {draftForSelected.proposal.unanalyzed
                            .map((id) => titleById.get(id) ?? id)
                            .join(", ")}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="rounded-xl"
                          disabled={saving}
                          onClick={() => void useDraft()}
                        >
                          <Check className="h-4 w-4" /> {t("djSets.useOrder")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-xl text-white/60"
                          onClick={() => setDraft(null)}
                        >
                          {t("djSets.keepMine")}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
