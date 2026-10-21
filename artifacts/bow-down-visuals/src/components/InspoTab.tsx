import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sparkles, Loader2, Link2, Dna, Save, Trash2, Wand2,
  Share2, Check, ChevronDown, ChevronUp, Music4, Disc3,
} from "lucide-react";
import { callGenerateApi, type GenerateResult } from "@/lib/generate-api";
import { useHubProject } from "@/lib/hub-project";
import type { FetchImpl } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── Inspo Mode — Suno parity: playlist vibe → song ───────────────────
   Step 1 (FREE): paste playlist links / artist names / vibe words →
   AI extracts the style DNA → editable DNA card.
   Step 2 (200 Visual Bucs): "Generate song" through the existing song
   pipeline. DNA cards save as "My Vibes" presets for future songs. */

export interface StyleDna {
  genre: string;
  subGenre: string;
  bpm: string;
  key: string;
  mood: string[];
  vocalCharacter: string;
  instrumentation: string[];
  arrangementNotes: string;
  vibeSummary: string;
  eraReferences: string;
  cleanOrExplicit: "clean" | "explicit";
}

const EMPTY_DNA: StyleDna = {
  genre: "", subGenre: "", bpm: "", key: "", mood: [],
  vocalCharacter: "", instrumentation: [], arrangementNotes: "",
  vibeSummary: "", eraReferences: "", cleanOrExplicit: "clean",
};

interface VibePreset {
  id: string;
  name: string;
  styleDna: StyleDna;
}

export interface InspoGeneratedData {
  rawResult: string;
  creditsRemaining?: number;
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
}

interface InspoTabProps {
  getAccessToken: () => Promise<string | null>;
  confirmedFetch: FetchImpl;
  refreshProfile: () => void;
  onGenerated: (data: InspoGeneratedData) => void;
  onOutOfCredits: () => void;
}

const cardClass =
  "rounded-2xl border border-white/[0.10] bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] p-5 md:p-6";

function DnaField({
  label, value, onChange, placeholder, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean;
}) {
  const cls =
    "w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 " +
    "focus:outline-none focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15)] transition-all";
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-bold text-white/50 uppercase tracking-widest">{label}</Label>
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cls + " resize-none"} />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}

export default function InspoTab({
  getAccessToken, confirmedFetch, refreshProfile, onGenerated, onOutOfCredits,
}: InspoTabProps) {
  const { toast } = useToast();
  const { getShareLink } = useHubProject();

  const [playlistInput, setPlaylistInput] = useState("");
  const [notes, setNotes] = useState("");
  const [artistName, setArtistName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [dna, setDna] = useState<StyleDna | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dnaOpen, setDnaOpen] = useState(true);

  const [presets, setPresets] = useState<VibePreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [copied, setCopied] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  /* ── My Vibes presets ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/song-inspo/presets", { headers: await authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as { presets?: VibePreset[] };
        if (Array.isArray(data.presets)) setPresets(data.presets);
      } catch {
        /* presets are a nice-to-have — inspo still works without them */
      } finally {
        setPresetsLoading(false);
      }
    })();
  }, [authHeaders]);

  async function analyzeVibe() {
    if (!playlistInput.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/song-inspo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ playlistInput: playlistInput.trim(), notes: notes.trim() }),
      });
      const data = (await res.json()) as { styleDna?: StyleDna; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Vibe analysis failed.");
      setDna({ ...EMPTY_DNA, ...(data.styleDna ?? {}) });
      setDnaOpen(true);
      toast({ title: "Vibe decoded", description: "Review the style DNA, tweak anything, then generate your song." });
      setTimeout(() => {
        document.getElementById("inspo-dna-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vibe analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function generateFromDna() {
    if (!dna || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const result: GenerateResult | null = await callGenerateApi(
        "/api/song-inspo/generate",
        {
          styleDna: dna,
          notes: notes.trim(),
          artistName: artistName.trim(),
          songTitle: songTitle.trim(),
        },
        token,
        confirmedFetch,
      );
      if (!result) return; // user cancelled the credit confirmation
      if (result.creditsRemaining !== undefined) refreshProfile();
      onGenerated({
        rawResult: result.rawResult,
        creditsRemaining: result.creditsRemaining,
        artistName: artistName.trim(),
        songTitle: songTitle.trim(),
        genre: dna.genre,
        mood: dna.mood.join(", "),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed.";
      if (msg === "out_of_credits") onOutOfCredits();
      else setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function savePreset() {
    if (!dna || !presetName.trim() || savingPreset) return;
    setSavingPreset(true);
    try {
      const res = await fetch("/api/song-inspo/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ name: presetName.trim(), styleDna: dna }),
      });
      const data = (await res.json()) as { preset?: VibePreset; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save preset.");
      if (data.preset) setPresets((p) => [data.preset!, ...p]);
      setPresetName("");
      toast({ title: "Vibe saved", description: `"${data.preset?.name}" is now in My Vibes.` });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSavingPreset(false);
    }
  }

  async function deletePreset(id: string) {
    try {
      await fetch(`/api/song-inspo/presets/${id}`, { method: "DELETE", headers: await authHeaders() });
      setPresets((p) => p.filter((x) => x.id !== id));
    } catch {
      /* best-effort */
    }
  }

  function shareVibe() {
    const link = getShareLink();
    const text = dna
      ? `Check the vibe I'm cooking with on Bow Down Visuals 🎶 ${dna.genre}${dna.subGenre ? ` / ${dna.subGenre}` : ""}${dna.bpm ? ` at ${dna.bpm} BPM` : ""}\n${link}`
      : `Make songs from any vibe on Bow Down Visuals 🎶\n${link}`;
    const share = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: "Bow Down Visuals — Inspo Mode", text }); return; } catch { /* fall through to copy */ }
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    share().catch(() => toast({ title: "Share failed", description: "Copy the link manually.", variant: "destructive" }));
  }

  const set = (k: keyof StyleDna) => (v: string | string[]) =>
    setDna((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="space-y-6">
      {/* Step 1 — drop the vibe */}
      <div className={cardClass}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <Link2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Step 1 — Drop the vibe</p>
            <p className="text-xs text-white/40">Spotify / YouTube links, artist or track names, or just describe it in words.</p>
          </div>
        </div>

        <Textarea
          value={playlistInput}
          onChange={(e) => setPlaylistInput(e.target.value)}
          placeholder={"Paste playlist links, e.g. open.spotify.com/playlist/…\n…or type names: \"Drake, PartyNextDoor, late-night Toronto R&B\"\n…or describe it: \"late-night drive R&B, smooth, 90s slow jam energy\""}
          rows={4}
          className="mt-4 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none text-sm leading-relaxed"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <Label className="text-xs font-medium text-white/60 mb-1.5 block">Artist name (optional)</Label>
            <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="e.g. Lil Nova"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs font-medium text-white/60 mb-1.5 block">Song title (optional)</Label>
            <Input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="e.g. Midnight Runway"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
        </div>

        <div className="mt-4">
          <Label className="text-xs font-medium text-white/60 mb-1.5 block">Notes for the AI (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the vibe description misses — a story, a person, what to avoid…"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none text-sm" />
        </div>

        <Button
          type="button"
          onClick={analyzeVibe}
          disabled={!playlistInput.trim() || analyzing}
          className="mt-5 gold-glow font-bold gap-2"
        >
          {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" /> Decoding your vibe…</> : <><Sparkles className="h-4 w-4" /> Analyze my vibe — free</>}
        </Button>
        <p className="text-white/25 text-xs mt-2">Vibe analysis is free. You only spend Visual Bucs when you generate the song.</p>
      </div>

      {/* My Vibes presets */}
      <div className={cardClass}>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
            <Disc3 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">My Vibes</p>
            <p className="text-xs text-white/40">Saved style DNA — one tap to reuse on a future song.</p>
          </div>
        </div>
        {presetsLoading ? (
          <p className="text-xs text-white/30 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your vibes…</p>
        ) : presets.length === 0 ? (
          <p className="text-xs text-white/30">No saved vibes yet — analyze a vibe above, then save its style DNA here.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <div key={p.id} className="group flex items-center gap-1.5 pl-3.5 pr-1.5 py-1.5 bg-white/5 border border-white/10 rounded-full hover:border-primary/50 transition-all">
                <button
                  type="button"
                  onClick={() => { setDna({ ...EMPTY_DNA, ...p.styleDna }); setDnaOpen(true); document.getElementById("inspo-dna-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  className="text-sm text-white/80 hover:text-white font-medium"
                  title={`Apply "${p.name}"`}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => deletePreset(p.id)}
                  className="h-6 w-6 rounded-full flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                  title={`Delete "${p.name}"`}
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 2 — style DNA card */}
      {dna && (
        <div id="inspo-dna-card" className="rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.08] to-transparent p-5 md:p-6 scroll-mt-24">
          <button
            type="button"
            onClick={() => setDnaOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2.5">
              <span className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <Dna className="h-4 w-4 text-primary" />
              </span>
              <span className="text-left">
                <span className="block text-sm font-bold text-white">Step 2 — Your style DNA</span>
                <span className="block text-xs text-white/40">Review it, tweak anything, then generate.</span>
              </span>
            </span>
            {dnaOpen ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
          </button>

          {dnaOpen && (
            <div className="mt-5 space-y-4">
              {dna.vibeSummary && (
                <p className="text-sm text-white/70 leading-relaxed border-l-2 border-primary/50 pl-3">{dna.vibeSummary}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <DnaField label="Genre" value={dna.genre} onChange={set("genre")} placeholder="e.g. R&B" />
                <DnaField label="Sub-genre" value={dna.subGenre} onChange={set("subGenre")} placeholder="e.g. alt-R&B" />
                <DnaField label="BPM" value={dna.bpm} onChange={set("bpm")} placeholder="e.g. 92" />
                <DnaField label="Key" value={dna.key} onChange={set("key")} placeholder="e.g. A minor" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DnaField label="Mood (comma-separated)" value={dna.mood.join(", ")} onChange={(v) => set("mood")(v.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="smooth, late-night, romantic" />
                <DnaField label="Era / scene" value={dna.eraReferences} onChange={set("eraReferences")} placeholder="e.g. late-2010s Toronto R&B" />
              </div>
              <DnaField label="Vocal character" value={dna.vocalCharacter} onChange={set("vocalCharacter")} multiline
                placeholder="How the vocal should sound and perform…" />
              <DnaField label="Instrumentation (comma-separated)" value={dna.instrumentation.join(", ")}
                onChange={(v) => set("instrumentation")(v.split(",").map((s) => s.trim()).filter(Boolean))}
                placeholder="808s, Rhodes piano, airy pads…" />
              <DnaField label="Arrangement notes" value={dna.arrangementNotes} onChange={set("arrangementNotes")} multiline
                placeholder="Energy arc, drum feel, drops…" />
              <div className="flex items-center gap-3">
                <Label className="text-[11px] font-bold text-white/50 uppercase tracking-widest">Content rating</Label>
                <div className="flex gap-2">
                  {(["clean", "explicit"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setDna((d) => (d ? { ...d, cleanOrExplicit: r } : d))}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${dna.cleanOrExplicit === r ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save to My Vibes */}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Name this vibe, e.g. Midnight Drive"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 flex-1"
                />
                <Button type="button" onClick={savePreset} disabled={!presetName.trim() || savingPreset} variant="outline"
                  className="border-primary/40 text-primary hover:bg-primary/10 gap-2 whitespace-nowrap">
                  {savingPreset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save to My Vibes
                </Button>
              </div>

              {/* Generate + share */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
                <Button
                  type="button"
                  onClick={generateFromDna}
                  disabled={generating}
                  className="flex-1 gold-glow font-bold text-base gap-2"
                  style={{ height: "52px" }}
                >
                  {generating ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your song…</> : <><Wand2 className="h-5 w-5" /> Generate song — 200 Visual Bucs</>}
                </Button>
                <Button
                  type="button"
                  onClick={shareVibe}
                  variant="outline"
                  className="border-white/15 text-white/70 hover:border-primary/50 hover:text-primary gap-2"
                  style={{ height: "52px" }}
                  title="Share this vibe"
                >
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Share2 className="h-4 w-4" />}
                  {copied ? "Copied!" : "Share vibe"}
                </Button>
              </div>
              <p className="text-white/25 text-xs">
                <Music4 className="h-3 w-3 inline mr-1 -mt-0.5" />
                Generates the full song package — lyrics, hook, AI music prompt, beat & vocal direction, cover art prompt, video idea, captions — and flows straight into lyric video and cover art.
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}
    </div>
  );
}
