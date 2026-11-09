/**
 * Wave9SongBenches — the Wave9 music family's native benches
 * at the Song Desk (Stack 400 world parity, census B-18):
 * the Song Structure Builder and Lyrics-to-Timeline, stacked
 * under the desk they belong to.
 *
 * Each bench is its page's own flow on its own rail (lib/
 * world/wave9-benches.ts): the charged post rides the
 * registry-priced spend confirmation, a declined
 * confirmation runs nothing, and the result lands in the
 * hub project as a script asset — the World's form of the
 * pages' editor handoffs. Copy rides the pages' own catalog
 * namespaces (wave9.structure.* / wave9.timeline.*); the
 * few bench-only lines live in worldWave9Bench.*.
 */
import { useState } from "react";
import { CheckCircle2, ListMusic, Loader2, Music2, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  WAVE9_SECTION_DEFAULT_BARS,
  WAVE9_SECTION_TYPES,
  buildWave9LyricsPayload,
  buildWave9StructurePayload,
  wave9ArrangementOf,
  wave9LyricsCost,
  wave9StructureCost,
  wave9TimedLinesOf,
  type Wave9Arrangement,
  type Wave9StructureSectionInput,
  type Wave9TimedLine,
} from "@/lib/world/wave9-benches";

/* ─── Shared bench chrome (also the Video Desk benches') ──── */

export function BenchShell({
  isLight,
  testId,
  icon,
  title,
  cost,
  subtitle,
  children,
}: {
  isLight: boolean;
  testId: string;
  icon: React.ReactNode;
  title: string;
  cost: number;
  subtitle: string;
  children: React.ReactNode;
}) {
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>{icon}</span>
        <p className={`text-base font-black ${strong}`}>{title}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {cost} VB
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{subtitle}</p>
      {children}
    </div>
  );
}

export function BenchRunButton({
  testId,
  busy,
  busyLabel,
  label,
  disabled,
  onClick,
}: {
  testId: string;
  busy: boolean;
  busyLabel: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        disabled={busy || disabled}
        className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

export function BenchNotices({
  isLight,
  outOfCredits,
  feature,
  error,
  onRetry,
}: {
  isLight: boolean;
  outOfCredits: boolean;
  feature: string;
  error: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature })}
        </p>
      )}
      {error &&
        (onRetry ? (
          <NativeErrorState isLight={isLight} message={error} onRetry={onRetry} />
        ) : (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        ))}
    </>
  );
}

/* ─── Song Structure Builder ───────────────────────────────── */

interface BenchSection extends Wave9StructureSectionInput {
  key: number;
}

let benchSectionKey = 0;
function newBenchSection(type: string): BenchSection {
  return { type, bars: WAVE9_SECTION_DEFAULT_BARS[type] ?? 8, label: "", key: ++benchSectionKey };
}

export function Wave9StructureBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [sections, setSections] = useState<BenchSection[]>(() => [
    newBenchSection("Intro"),
    newBenchSection("Verse"),
    newBenchSection("Chorus"),
    newBenchSection("Verse"),
    newBenchSection("Chorus"),
    newBenchSection("Outro"),
  ]);
  const [title, setTitle] = useState("");
  const [vibe, setVibe] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave9Arrangement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9StructureCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const totalBars = sections.reduce((sum, s) => sum + (s.bars || 0), 0);

  async function generate() {
    if (busy || sections.length === 0) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9a/structure/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Song Structure Builder",
        body: JSON.stringify(buildWave9StructurePayload({ sections, lyrics, vibe, title })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const arrangement = wave9ArrangementOf(data);
      if (!res.ok || !arrangement) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave9.structure.errorGeneric")));
        return;
      }
      setResult(arrangement);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: title.trim() ? `Song structure — ${title.trim()}` : "Song structure",
          detail: arrangement.arrangement.map((s) => `${s.type} (${s.bars})`).join(" · "),
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave9.structure.errorGeneric"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-structure-bench"
      icon={<ListMusic className="h-4 w-4" />}
      title={t("wave9.structure.title")}
      cost={cost}
      subtitle={t("wave9.structure.subtitle")}
    >
      <div className="space-y-2">
        {sections.map((s, i) => (
          <div key={s.key} className={`flex items-center gap-2 rounded-xl border p-2 ${cardCls}`}>
            <div className="min-w-0 flex-1">
              <DeskSelectField
                isLight={isLight}
                label={t("worldWave9Bench.sectionTypeLabel")}
                value={s.type}
                onChange={(v) =>
                  setSections((prev) => prev.map((p, j) => (j === i ? { ...p, type: v, bars: WAVE9_SECTION_DEFAULT_BARS[v] ?? p.bars } : p)))
                }
                options={WAVE9_SECTION_TYPES.map((type) => ({ value: type, label: type }))}
              />
            </div>
            <div className="w-24">
              <DeskTextField
                isLight={isLight}
                label={t("wave9.structure.bars")}
                value={String(s.bars)}
                onChange={(v) => {
                  const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
                  setSections((prev) => prev.map((p, j) => (j === i ? { ...p, bars: isFinite(n) ? n : 0 } : p)));
                }}
              />
            </div>
            <button
              type="button"
              aria-label={t("wave9.structure.remove")}
              onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
              className={`mt-4 rounded-lg p-2 ${isLight ? "text-[#92600a]" : "text-white/50"} bdv-touch-target`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DeskSelectField
          isLight={isLight}
          label={t("wave9.structure.addSection")}
          value=""
          onChange={(v) => { if (v) setSections((prev) => [...prev, newBenchSection(v)]); }}
          options={[
            { value: "", label: t("worldWave9Bench.addSectionPick") },
            ...WAVE9_SECTION_TYPES.map((type) => ({ value: type, label: type })),
          ]}
        />
        <span className={`ml-auto text-xs font-semibold ${muted}`}>{t("wave9.structure.totalBars", { count: totalBars })}</span>
      </div>

      <DeskTextField
        isLight={isLight}
        label={t("worldWave9Bench.songTitleLabel")}
        value={title}
        onChange={setTitle}
        placeholder={t("worldWave9Bench.songTitlePlaceholder")}
      />
      <DeskTextField
        isLight={isLight}
        label={t("wave9.structure.vibeLabel")}
        value={vibe}
        onChange={setVibe}
        placeholder={t("wave9.structure.vibePlaceholder")}
      />
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("wave9.structure.lyricsLabel")}
        </span>
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={t("wave9.structure.lyricsPlaceholder")}
          rows={4}
          className={deskInputCls(isLight)}
        />
      </label>

      <BenchRunButton
        testId="world-wave9-structure-run"
        busy={busy}
        busyLabel={t("wave9.structure.generating")}
        label={t("wave9.structure.generate")}
        disabled={sections.length === 0}
        onClick={() => void generate()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Song Structure Builder" error={error} />

      {busy && <NativeLoadingState isLight={isLight} message={t("wave9.structure.generating")} />}
      {phase === "done" && result && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-structure-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("wave9.structure.arrangementHeading")}
          </p>
          <div className="mt-2 space-y-1.5">
            {result.arrangement.map((s, i) => (
              <p key={i} className={`text-xs ${muted}`}>
                <span className={`font-bold ${strong}`}>{s.type}</span>{" "}
                {t("wave9.structure.barRange", { start: s.startsAtBar, bars: s.bars })}
                {s.energy ? ` · ${s.energy}` : ""}
                {s.direction ? ` — ${s.direction}` : ""}
                {s.lyricMap ? ` · ${s.lyricMap}` : ""}
              </p>
            ))}
          </div>
          {result.notes && <p className={`mt-2 text-xs ${muted}`}>{result.notes}</p>}
          {result.creditsRemaining !== null && (
            <p className={`mt-2 text-[11px] ${muted}`}>{t("worldWave9Bench.creditsRemaining", { n: result.creditsRemaining })}</p>
          )}
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Lyrics-to-Timeline ───────────────────────────────────── */

export function Wave9LyricsBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState("180");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [lines, setLines] = useState<Wave9TimedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave9LyricsCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const durationSec = Math.max(0, parseInt(duration.replace(/[^0-9]/g, ""), 10) || 0);

  async function place() {
    if (busy || !lyrics.trim()) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave9a/lyrics/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Lyrics-to-Timeline",
        body: JSON.stringify(buildWave9LyricsPayload({ lyrics, durationSec, title })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const timed = wave9TimedLinesOf(data);
      if (!res.ok || !timed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave9.timeline.errorGeneric")));
        return;
      }
      setLines(timed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: title.trim() ? `Timed lyrics — ${title.trim()}` : "Timed lyrics",
          detail: timed.map((l) => `${l.start.toFixed(1)}–${l.end.toFixed(1)}s ${l.text}`).join("\n"),
        });
      } catch { /* non-fatal */ }
    } catch {
      setPhase("idle");
      setError(t("wave9.timeline.errorGeneric"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave9-lyrics-bench"
      icon={<Music2 className="h-4 w-4" />}
      title={t("wave9.timeline.title")}
      cost={cost}
      subtitle={t("wave9.timeline.subtitle")}
    >
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("wave9.timeline.lyricsLabel")}
        </span>
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={t("wave9.timeline.lyricsPlaceholder")}
          rows={5}
          className={deskInputCls(isLight)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={`${t("wave9.timeline.durationLabel")} (${t("wave9.timeline.seconds")})`}
          value={duration}
          onChange={setDuration}
        />
        <DeskTextField
          isLight={isLight}
          label={t("worldWave9Bench.songTitleLabel")}
          value={title}
          onChange={setTitle}
          placeholder={t("worldWave9Bench.songTitlePlaceholder")}
        />
      </div>

      <BenchRunButton
        testId="world-wave9-lyrics-run"
        busy={busy}
        busyLabel={t("wave9.timeline.placing")}
        label={t("wave9.timeline.place")}
        disabled={!lyrics.trim()}
        onClick={() => void place()}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Lyrics-to-Timeline" error={error} />

      {busy && <NativeLoadingState isLight={isLight} message={t("wave9.timeline.placing")} />}
      {phase === "idle" && lines.length === 0 && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave9Bench.lyricsEmpty")} />
      )}
      {phase === "done" && lines.length > 0 && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave9-lyrics-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("wave9.timeline.timedHeading", { count: lines.length })}
          </p>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {lines.map((l, i) => (
              <p key={i} className={`text-xs ${muted}`}>
                <span className={`font-bold ${strong}`}>{l.start.toFixed(1)}–{l.end.toFixed(1)}s</span> {l.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </BenchShell>
  );
}
