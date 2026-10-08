import { useEffect, useState } from "react";
import {
  ListMusic, Loader2, AlertTriangle, ChevronDown, ChevronUp,
  Plus, Trash2, GripVertical, Wand2, Save, ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

export interface StructureSection {
  type: string;
  bars: number;
  label?: string;
}

interface ArrangementSection {
  type: string;
  bars: number;
  startsAtBar: number;
  energy: string;
  direction: string;
  lyricMap?: string;
}

interface ArrangementResult {
  arrangement: ArrangementSection[];
  totalBars: number;
  notes?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
}

interface SavedStructure {
  id: string;
  name: string;
  sections: StructureSection[];
  created_at: string;
}

interface SongStructureBuilderProps {
  lyrics?: string | null;
  songTitle?: string | null;
  songId?: string | null;
}

const SECTION_TYPES = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"] as const;
const DEFAULT_BARS: Record<string, number> = {
  Intro: 4, Verse: 16, "Pre-Chorus": 8, Chorus: 16, Bridge: 8, Outro: 8,
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

let sectionKey = 0;
function newSection(type: string): StructureSection & { key: number } {
  return { type, bars: DEFAULT_BARS[type] ?? 8, label: "", key: ++sectionKey };
}

export function SongStructureBuilder({ lyrics, songTitle, songId }: SongStructureBuilderProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile, getAccessToken } = useAuth();

  const [open, setOpen] = useState(true);
  const [sections, setSections] = useState<Array<StructureSection & { key: number }>>(() => [
    newSection("Intro"), newSection("Verse"), newSection("Chorus"), newSection("Verse"), newSection("Chorus"), newSection("Outro"),
  ]);
  const [vibe, setVibe] = useState("");
  const [lyricsText, setLyricsText] = useState(lyrics ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<ArrangementResult | null>(null);
  const [savedName, setSavedName] = useState("");
  const [saved, setSaved] = useState<SavedStructure[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [handoffSent, setHandoffSent] = useState(false);

  useEffect(() => {
    if (lyrics && !lyricsText) setLyricsText(lyrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics]);

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadSaved() {
    setSavedLoading(true);
    try {
      const res = await fetch("/api/wave9a/structures", { headers: await authHeaders() });
      const data = (await res.json()) as { structures?: SavedStructure[] };
      if (res.ok) setSaved(data.structures ?? []);
    } catch {
      /* empty state */
    } finally {
      setSavedLoading(false);
    }
  }

  useEffect(() => {
    void loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addSection(type: string) {
    setSections((s) => [...s, newSection(type)]);
  }

  function removeSection(key: number) {
    setSections((s) => (s.length > 1 ? s.filter((x) => x.key !== key) : s));
  }

  function updateSection(key: number, patch: Partial<StructureSection>) {
    setSections((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  /* HTML5 drag reorder */
  function onDragStart(i: number) {
    setDragIdx(i);
  }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    setSections((s) => {
      const next = [...s];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIdx(i);
  }
  function onDrop() {
    setDragIdx(null);
  }

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9a/structure/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: 200,
        overrideFeature: "Song Structure Builder",
        body: JSON.stringify({
          sections: sections.map(({ type, bars, label }) => ({ type, bars, label: label ?? "" })),
          lyrics: lyricsText.trim(),
          vibe: vibe.trim(),
          title: (songTitle ?? "").trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as ArrangementResult & { error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.arrangement) || data.arrangement.length === 0) {
        throw new Error(data.message || data.error || t("wave9.structure.errorGeneric"));
      }
      setResult(data);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave9.structure.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function saveStructure() {
    if (!savedName.trim()) return;
    setSavedLoading(true);
    try {
      const res = await fetch("/api/wave9a/structures", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savedName.trim(),
          sections: sections.map(({ type, bars, label }) => ({ type, bars, label: label ?? "" })),
          song_id: songId ?? null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedName("");
      await loadSaved();
    } catch {
      setError(t("wave9.structure.saveError"));
    } finally {
      setSavedLoading(false);
    }
  }

  async function deleteSaved(id: string) {
    try {
      await fetch(`/api/wave9a/structures/${id}`, { method: "DELETE", headers: await authHeaders() });
      setSaved((s) => s.filter((x) => x.id !== id));
    } catch {
      /* non-fatal */
    }
  }

  function loadIntoBuilder(s: SavedStructure) {
    setSections(s.sections.map((sec) => ({ ...sec, key: ++sectionKey })));
  }

  /* Handoff: Send to Remix Chain — stores the structure id for the songs page. */
  async function sendToRemixChain() {
    const target = saved[saved.length - 1];
    if (!target) return;
    localStorage.setItem(
      "wave9a_structure_handoff",
      JSON.stringify({
        structureId: target.id,
        name: target.name,
        sections: target.sections,
        songId: songId ?? null,
        createdAt: new Date().toISOString(),
      })
    );
    setHandoffSent(true);
  }

  /* Handoff: Send lyrics to Timeline — sibling LyricsToTimeline panel. */
  function sendLyricsToTimeline() {
    localStorage.setItem(
      "wave9a_lyrics_handoff",
      JSON.stringify({ lyrics: lyricsText, createdAt: new Date().toISOString() })
    );
    window.dispatchEvent(new CustomEvent("wave9a:lyrics", { detail: { lyrics: lyricsText } }));
  }

  const totalBars = sections.reduce((a, s) => a + s.bars, 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden" data-testid="song-structure-builder">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <ListMusic className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-black text-white">{t("wave9.structure.title")}</p>
          <p className="text-[11px] text-white/40">{t("wave9.structure.subtitle")}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          {/* Add section buttons */}
          <div className="pt-3">
            <p className="mb-2 text-xs font-black uppercase tracking-widest text-white/50">
              {t("wave9.structure.addSection")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SECTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addSection(type)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] font-bold text-white/60 hover:border-primary/40 hover:text-primary transition"
                >
                  <Plus className="h-3 w-3" /> {type}
                </button>
              ))}
            </div>
          </div>

          {/* Drag-drop section list */}
          <div className="space-y-1.5" data-testid="structure-section-list">
            {sections.map((s, i) => (
              <div
                key={s.key}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={onDrop}
                onDragEnd={onDrop}
                className={`flex items-center gap-2 rounded-xl border bg-black/40 px-3 py-2 transition ${
                  dragIdx === i ? "border-primary/60 opacity-60" : "border-white/10"
                }`}
              >
                <GripVertical className="h-4 w-4 text-white/25 cursor-grab shrink-0" />
                <span className="text-[10px] font-black text-white/30 w-5 shrink-0">{i + 1}</span>
                <span className="text-[13px] font-black text-white flex-1 truncate">{s.type}</span>
                <label className="flex items-center gap-1.5 text-[11px] text-white/45 shrink-0">
                  {t("wave9.structure.bars")}
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={s.bars}
                    onChange={(e) => updateSection(s.key, { bars: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-center text-xs text-white outline-none focus:border-primary/50"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeSection(s.key)}
                  disabled={sections.length <= 1}
                  className="text-white/25 hover:text-red-300 disabled:opacity-20 transition shrink-0"
                  aria-label={t("wave9.structure.remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-white/35">
            {t("wave9.structure.totalBars", { count: totalBars })}
          </p>

          {/* Vibe + lyrics */}
          <div>
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave9.structure.vibeLabel")}
            </label>
            <input
              className={inputClass}
              placeholder={t("wave9.structure.vibePlaceholder")}
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave9.structure.lyricsLabel")}
            </label>
            <textarea
              className={`${inputClass} min-h-[90px] resize-y`}
              placeholder={t("wave9.structure.lyricsPlaceholder")}
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {loading ? t("wave9.structure.generating") : t("wave9.structure.generate")}
          </button>

          {outOfCredits && <OutOfCredits />}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Arrangement result */}
          {result && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-black uppercase tracking-widest text-white/50">
                {t("wave9.structure.arrangementHeading")}
              </p>
              {result.arrangement.map((a, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-black text-primary">{a.type}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                      {t("wave9.structure.barRange", { start: a.startsAtBar, bars: a.bars })}
                    </span>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary/80">{a.energy}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/55 leading-relaxed">{a.direction}</p>
                  {a.lyricMap && (
                    <p className="mt-1 text-[11px] text-white/35 italic">{a.lyricMap}</p>
                  )}
                </div>
              ))}
              {result.notes && (
                <p className="text-xs text-white/45 leading-relaxed rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                  {result.notes}
                </p>
              )}
            </div>
          )}

          {/* Save / saved structures */}
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2.5">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">{t("wave9.structure.saveHeading")}</p>
            <div className="flex gap-2">
              <input
                className={`${inputClass} !py-2.5`}
                placeholder={t("wave9.structure.namePlaceholder")}
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
              />
              <button
                type="button"
                onClick={saveStructure}
                disabled={!savedName.trim() || savedLoading}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-black text-primary hover:bg-primary/20 transition disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" /> {t("wave9.structure.save")}
              </button>
            </div>
            {savedLoading ? (
              <p className="text-xs text-white/40 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("wave9.structure.loading")}
              </p>
            ) : saved.length > 0 ? (
              <div className="space-y-1.5">
                {saved.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg bg-black/40 border border-white/[0.07] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => loadIntoBuilder(s)}
                      className="flex-1 text-left text-xs font-bold text-white/80 hover:text-primary truncate transition"
                    >
                      {s.name}
                    </button>
                    <span className="text-[10px] text-white/30 shrink-0">{s.sections.length} sections</span>
                    <button
                      type="button"
                      onClick={() => void deleteSaved(s.id)}
                      className="text-white/25 hover:text-red-300 transition shrink-0"
                      aria-label={t("wave9.structure.remove")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-white/30">{t("wave9.structure.noSaved")}</p>
            )}
          </div>

          {/* Handoffs */}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={sendLyricsToTimeline}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-xs font-black text-white/75 hover:border-white/30 hover:text-white transition"
            >
              {t("wave9.structure.sendLyrics")} <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void sendToRemixChain()}
              disabled={saved.length === 0}
              className="flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-xs font-black text-primary hover:bg-primary/20 transition disabled:opacity-40"
            >
              {t("wave9.structure.sendRemix")} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {handoffSent && <p className="text-center text-xs text-emerald-300">{t("wave9.structure.sentHint")}</p>}
        </div>
      )}
    </div>
  );
}
