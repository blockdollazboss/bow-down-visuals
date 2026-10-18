import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { callGenerateApi } from "@/lib/generate-api";
import { fetchLibrarySongs, type LibrarySong } from "@/lib/song-library";
import {
  buildInspoAnalyzePayload,
  buildInspoGeneratePayload,
  buildInspoPresetPayload,
  buildMashupPayload,
  humAnalysisOfResponse,
  humAnalyzeFields,
  HUM_FORM_FIELD,
  humGenerateFields,
  humSongUrlOfResponse,
  humToSongCost,
  inspoAnalyzeCost,
  inspoGenerateCost,
  mashupCost,
  mashupResultOfResponse,
  styleDnaOfResponse,
} from "@/lib/world/create-desks";
import {
  AudioResult,
  DeskSelectField,
  DeskTextField,
  QuestProgressChip,
  TextResult,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";

/* ─── Ring 2 (2.5) — the Song Desk's other tabs ─────────────────────
   make-song.tsx's docked tabs, riding the same endpoints the page
   tabs ride: InspoTab (analyze free → style DNA → generate),
   SongMashup (POST /api/mashup), HumToSong (POST /api/hum-to-song,
   analyze free then generate). Prices from the registry, shown
   before each run. */

const tabBtn = (isLight: boolean, active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";

/* ─── Inspo ───────────────────────────────────────────────────────── */

export function SongInspoBench({ isLight }: { isLight: boolean }) {
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [playlistInput, setPlaylistInput] = useState("");
  const [notes, setNotes] = useState("");
  const [dna, setDna] = useState<Record<string, unknown> | null>(null);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; styleDna: Record<string, unknown> }>>([]);
  const [presetName, setPresetName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/song-inspo/presets", { headers: await authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as { presets?: Array<{ id: string; name: string; styleDna: Record<string, unknown> }> };
        if (!cancelled && Array.isArray(data.presets)) setPresets(data.presets);
      } catch {
        /* presets are a nice-to-have — inspo still works without them */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyze = async () => {
    if (busy || !playlistInput.trim()) return;
    setBusy("analyze");
    setError(null);
    try {
      const res = await fetch("/api/song-inspo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildInspoAnalyzePayload(playlistInput, notes)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Vibe analysis failed.");
      const parsed = styleDnaOfResponse(data);
      if (!parsed) throw new Error("The vibe came back without a style — try describing it another way.");
      setDna(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vibe analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (busy || !dna) return;
    setBusy("generate");
    setError(null);
    void quest.snapshot();
    try {
      const token = await getAccessToken();
      const result = await callGenerateApi(
        "/api/song-inspo/generate",
        buildInspoGeneratePayload({ styleDna: dna, notes, artistName, songTitle }),
        token,
      );
      if (!result) throw new Error("The inspo make didn't start.");
      setRawResult(result.rawResult);
      if (result.creditsRemaining !== undefined) refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inspo generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const savePreset = async () => {
    if (!dna || !presetName.trim() || busy) return;
    setBusy("preset");
    try {
      const res = await fetch("/api/song-inspo/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildInspoPresetPayload(presetName, dna)),
      });
      const data = (await res.json().catch(() => ({}))) as { preset?: { id: string; name: string; styleDna: Record<string, unknown> } };
      if (res.ok && data.preset) {
        setPresets((p) => [data.preset!, ...p]);
        setPresetName("");
      }
    } catch {
      /* best-effort, as the page treats it */
    } finally {
      setBusy(null);
    }
  };

  const dnaText = (k: string) => (typeof dna?.[k] === "string" ? (dna[k] as string) : Array.isArray(dna?.[k]) ? (dna[k] as string[]).join(", ") : "");
  const setDnaText = (k: string) => (v: string) =>
    setDna((d) => (d ? { ...d, [k]: k === "mood" || k === "instrumentation" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v } : d));

  return (
    <div data-testid="world-song-inspo-bench" className="space-y-3">
      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Drop the vibe — playlist links, artist names, or words</span>
        <textarea value={playlistInput} onChange={(e) => setPlaylistInput(e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`} />
      </label>
      <DeskTextField isLight={isLight} label="Notes for the vibe" value={notes} onChange={setNotes} />
      <button type="button" data-testid="world-song-inspo-analyze" onClick={() => void analyze()} disabled={busy !== null || !playlistInput.trim()} className={goldBtn}>
        {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Decode the vibe · {inspoAnalyzeCost() === 0 ? "Free" : `${inspoAnalyzeCost()} Visual Bucs`}
      </button>
      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.id} type="button" onClick={() => setDna(p.styleDna)} className={tabBtn(isLight, false)}>
              My Vibe: {p.name}
            </button>
          ))}
        </div>
      ) : null}
      {dna ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label="Genre" value={dnaText("genre")} onChange={setDnaText("genre")} />
            <DeskTextField isLight={isLight} label="Sub-genre" value={dnaText("subGenre")} onChange={setDnaText("subGenre")} />
            <DeskTextField isLight={isLight} label="BPM" value={dnaText("bpm")} onChange={setDnaText("bpm")} />
            <DeskTextField isLight={isLight} label="Key" value={dnaText("key")} onChange={setDnaText("key")} />
            <DeskTextField isLight={isLight} label="Mood (comma list)" value={dnaText("mood")} onChange={setDnaText("mood")} />
            <DeskTextField isLight={isLight} label="Vocal character" value={dnaText("vocalCharacter")} onChange={setDnaText("vocalCharacter")} />
          </div>
          <DeskTextField isLight={isLight} label="Vibe summary" value={dnaText("vibeSummary")} onChange={setDnaText("vibeSummary")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label="Artist name" value={artistName} onChange={setArtistName} />
            <DeskTextField isLight={isLight} label="Song title" value={songTitle} onChange={setSongTitle} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="world-song-inspo-generate" onClick={() => void generate()} disabled={busy !== null} className={goldBtn}>
              {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Make the song from this vibe · {inspoGenerateCost().toLocaleString("en-US")} Visual Bucs
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <DeskTextField isLight={isLight} label="Save this vibe as a preset" value={presetName} onChange={setPresetName} />
            <button type="button" onClick={() => void savePreset()} disabled={busy !== null || !presetName.trim()} className={tabBtn(isLight, false)}>
              Save preset · Free
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {rawResult ? <TextResult isLight={isLight} title={songTitle || "Your inspo song"} text={rawResult.slice(0, 600)} /> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}

/* ─── Mashup ──────────────────────────────────────────────────────── */

export function SongMashupBench({ isLight }: { isLight: boolean }) {
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [songs, setSongs] = useState<LibrarySong[] | null>(null);
  const [songA, setSongA] = useState("");
  const [songB, setSongB] = useState("");
  const [style, setStyle] = useState("blend");
  const [balance, setBalance] = useState(50);
  const [crossfadeSec, setCrossfadeSec] = useState(4);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ audioUrl: string; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchLibrarySongs(getAccessToken);
        if (!cancelled) setSongs(list);
      } catch {
        if (!cancelled) setSongs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (busy || !songA || !songB || songA === songB) return;
    setBusy(true);
    setError(null);
    void quest.snapshot();
    try {
      const res = await fetch("/api/mashup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildMashupPayload({ songAId: songA, songBId: songB, style, balance, crossfadeSec, title })),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "The mashup didn't land.");
      const parsed = mashupResultOfResponse(data);
      if (!parsed) throw new Error("The mashup came back without audio — nothing to play.");
      setResult(parsed);
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mashup failed.");
    } finally {
      setBusy(false);
    }
  };

  const songOptions = (songs ?? []).map((s) => ({ value: s.id, label: s.title }));
  return (
    <div data-testid="world-song-mashup-bench" className="space-y-3">
      {songs === null ? (
        <p className={`inline-flex items-center gap-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening your song library…</p>
      ) : songs.length < 2 ? (
        <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>A mashup needs two songs in your library — make or upload songs first, then blend them here.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField isLight={isLight} label="First song" value={songA} onChange={setSongA} options={[{ value: "", label: "Pick a song" }, ...songOptions]} />
            <DeskSelectField isLight={isLight} label="Second song" value={songB} onChange={setSongB} options={[{ value: "", label: "Pick a song" }, ...songOptions]} />
            <DeskSelectField isLight={isLight} label="Blend style" value={style} onChange={setStyle} options={["blend", "versus", "medley", "remix"].map((s) => ({ value: s, label: s }))} />
            <DeskTextField isLight={isLight} label="Mashup title" value={title} onChange={setTitle} />
          </div>
          <label className="block text-xs font-bold">
            Balance toward the first song — {balance}%
            <input type="range" min={0} max={100} value={balance} onChange={(e) => setBalance(Number(e.target.value))} className="w-full" />
          </label>
          <label className="block text-xs font-bold">
            Crossfade — {crossfadeSec}s
            <input type="range" min={0} max={12} value={crossfadeSec} onChange={(e) => setCrossfadeSec(Number(e.target.value))} className="w-full" />
          </label>
          <button type="button" data-testid="world-song-mashup-run" onClick={() => void run()} disabled={busy || !songA || !songB || songA === songB} className={goldBtn}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Blend them · {mashupCost().toLocaleString("en-US")} Visual Bucs
          </button>
        </>
      )}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {result ? <AudioResult url={result.audioUrl} title={result.title} /> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}

/* ─── Hum-to-Song ─────────────────────────────────────────────────── */

export function SongHumBench({ isLight }: { isLight: boolean }) {
  const { refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [file, setFile] = useState<File | null>(null);
  const [humRef, setHumRef] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState("simple");
  const [stylePrompt, setStylePrompt] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [songUrl, setSongUrl] = useState<string | null>(null);

  const analyze = async () => {
    if (!file || busy) return;
    setBusy("analyze");
    setError(null);
    try {
      const form = new FormData();
      form.append(HUM_FORM_FIELD, file);
      for (const [k, v] of humAnalyzeFields()) form.append(k, v);
      const res = await fetch("/api/hum-to-song", { method: "POST", headers: await authHeaders(), body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Could not analyze that audio.");
      const parsed = humAnalysisOfResponse(data);
      if (!parsed) throw new Error("Analysis came back incomplete — try again.");
      setHumRef(parsed.humRef);
      setAnalysis(parsed.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!humRef || busy) return;
    setBusy("generate");
    setError(null);
    void quest.snapshot();
    try {
      const form = new FormData();
      for (const [k, v] of humGenerateFields({ humRef, mode, stylePrompt, songTitle, artistName })) form.append(k, v);
      const res = await fetch("/api/hum-to-song", { method: "POST", headers: await authHeaders(), body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Song generation failed.");
      const url = humSongUrlOfResponse(data);
      if (!url) throw new Error("The song came back without audio — nothing to play.");
      setSongUrl(url);
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Song generation failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="world-song-hum-bench" className="space-y-3">
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
        {file ? `Hum file: ${file.name}` : "Upload or record your hum"}
        <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setHumRef(null); setAnalysis(null); } }} />
      </label>
      <button type="button" data-testid="world-song-hum-analyze" onClick={() => void analyze()} disabled={busy !== null || !file} className={goldBtn}>
        {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Hear my hum · Free
      </button>
      {analysis ? (
        <div className="space-y-3">
          <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            Heard it — {typeof analysis.tempoBpm === "number" ? `~${analysis.tempoBpm} BPM` : "tempo found"}
            {typeof analysis.keyEstimate === "string" ? `, key of ${analysis.keyEstimate}` : ""}. Now build the song around it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField isLight={isLight} label="Mode" value={mode} onChange={setMode} options={[{ value: "simple", label: "Turbo — we arrange it" }, { value: "custom", label: "Advanced — my style notes" }]} />
            <DeskTextField isLight={isLight} label="Song title" value={songTitle} onChange={setSongTitle} />
            <DeskTextField isLight={isLight} label="Artist name" value={artistName} onChange={setArtistName} />
            {mode === "custom" ? <DeskTextField isLight={isLight} label="Style notes" value={stylePrompt} onChange={setStylePrompt} /> : null}
          </div>
          <button type="button" data-testid="world-song-hum-generate" onClick={() => void generate()} disabled={busy !== null} className={goldBtn}>
            {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Build the song · {humToSongCost().toLocaleString("en-US")} Visual Bucs
          </button>
        </div>
      ) : null}
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {songUrl ? <AudioResult url={songUrl} title={songTitle || "Your hum, as a song"} /> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}
