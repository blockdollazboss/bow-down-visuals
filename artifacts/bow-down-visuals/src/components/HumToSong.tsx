import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Mic, Upload, Loader2, Square, Music2, Share2, Wand2, Image as ImageIcon, Scissors, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject, type HubAsset } from "@/lib/hub-project";
import { AssetHandoffs } from "@/components/hub/AssetHandoffs";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const HUM_PRICE = 500;
const MAX_HUM_SECONDS = 65;

interface MelodyAnalysis {
  durationSec: number;
  tempoBpm: number | null;
  keyEstimate: string | null;
  pitchConfidence: number;
  noteCount: number;
  confidence: "high" | "medium" | "low";
}

interface SongResult {
  url: string;
  humRef: string;
  humUrl: string | null;
  analysis: MelodyAnalysis;
  influence: "audio-conditioning" | "text-reference";
  influenceNote: string;
}

const inputClass =
  "h-11 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] rounded-xl w-full";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{children}</Label>
  );
}

function AnalysisBadges({ analysis }: { analysis: MelodyAnalysis }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "Length", value: `${analysis.durationSec.toFixed(0)}s` },
    { label: "Tempo", value: analysis.tempoBpm ? `~${analysis.tempoBpm} BPM` : "n/a" },
    { label: "Key", value: analysis.keyEstimate ?? "n/a" },
    { label: "Notes", value: String(analysis.noteCount) },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-primary/25 bg-primary/[0.07] px-3 py-1.5 text-xs"
        >
          <span className="text-white/40 uppercase tracking-wider mr-1.5">{it.label}</span>
          <span className="text-primary font-bold">{it.value}</span>
        </div>
      ))}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs self-center">
        <span className="text-white/35">Detection: {analysis.confidence} — tempo &amp; key are estimates</span>
      </div>
    </div>
  );
}

export function HumToSong() {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const { refreshProfile } = useAuth();
  const [, setLocation] = useLocation();
  const { setProjectName, setProjectType, addAsset, latestOfKind, getShareLink } = useHubProject();

  const [phase, setPhase] = useState<"capture" | "analyzing" | "ready" | "generating" | "done">("capture");
  const [humFile, setHumFile] = useState<File | null>(null);
  const [humObjectUrl, setHumObjectUrl] = useState<string | null>(null);
  const [humRef, setHumRef] = useState<string | null>(null);
  const [humUrl, setHumUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MelodyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom-mode options
  const [mode, setMode] = useState<"simple" | "custom">("simple");
  const [stylePrompt, setStylePrompt] = useState("");
  const [vocalGender, setVocalGender] = useState<"" | "male" | "female">("");
  const [instrumental, setInstrumental] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");

  const [result, setResult] = useState<SongResult | null>(null);
  const [songAsset, setSongAsset] = useState<HubAsset | null>(null);

  // Extend
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extending, setExtending] = useState(false);
  const [extendedUrl, setExtendedUrl] = useState<string | null>(null);

  // Share
  const [shared, setShared] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (humObjectUrl) URL.revokeObjectURL(humObjectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(msg: string) {
    setError(msg);
    setPhase(humFile ? "ready" : "capture");
  }

  function pickMime(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const c of candidates) {
      try {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
      } catch {
        /* ignore */
      }
    }
    return "";
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) {
          fail("The recording came back empty — try again.");
          return;
        }
        const ext = (rec.mimeType || "").includes("mp4") ? "m4a" : "webm";
        acceptFile(new File([blob], `hum-${Date.now()}.${ext}`, { type: blob.type }));
      };
      recorderRef.current = rec;
      rec.start(250);
      setRecording(true);
      setRecSecs(0);
      timerRef.current = setInterval(() => {
        setRecSecs((s) => {
          if (s + 1 >= 60) {
            stopRecording();
            return 60;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access was blocked — allow it in your browser, or upload a voice memo instead.");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function acceptFile(file: File) {
    setError(null);
    setResult(null);
    setSongAsset(null);
    setExtendedUrl(null);
    setHumRef(null);
    setHumUrl(null);
    setAnalysis(null);
    if (humObjectUrl) URL.revokeObjectURL(humObjectUrl);
    const url = URL.createObjectURL(file);
    setHumFile(file);
    setHumObjectUrl(url);
    // Client-side duration guard (server also trims to 60s).
    const probe = document.createElement("audio");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const d = probe.duration;
      if (isFinite(d) && d > MAX_HUM_SECONDS) {
        URL.revokeObjectURL(url);
        setHumFile(null);
        setHumObjectUrl(null);
        setError(`That recording is ${Math.round(d)}s — keep your hum around 60 seconds or less.`);
        setPhase("capture");
      } else {
        analyze(file);
      }
    };
    probe.onerror = () => analyze(file); // let the server decide
    probe.src = url;
  }

  async function analyze(file: File) {
    setPhase("analyzing");
    setError(null);
    try {
      const form = new FormData();
      form.append("hum", file);
      form.append("analyzeOnly", "true");
      const res = await confirmedFetch("/api/hum-to-song", {
        method: "POST",
        body: form,
        skipConfirm: true, // analysis is free — no credit prompt
      });
      if (!res) {
        setPhase("capture");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        humRef?: string;
        humUrl?: string;
        analysis?: MelodyAnalysis;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Could not analyze that audio.");
      if (!data.humRef || !data.analysis) throw new Error("Analysis came back incomplete — try again.");
      setHumRef(data.humRef);
      setHumUrl(data.humUrl ?? null);
      setAnalysis(data.analysis);
      addAsset({
        kind: "hum",
        url: data.humUrl ?? "",
        label: songTitle.trim() || file.name.replace(/\.[^.]+$/, "") || "Hum recording",
        detail: "Hum melody reference",
        meta: {
          humRef: data.humRef,
          ...(data.analysis.tempoBpm ? { tempoBpm: String(data.analysis.tempoBpm) } : {}),
          ...(data.analysis.keyEstimate ? { key: data.analysis.keyEstimate } : {}),
        },
      });
      setPhase("ready");
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not analyze that audio.");
    }
  }

  async function generate() {
    if (!humRef || phase === "generating") return;
    setPhase("generating");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("humRef", humRef);
      form.append("mode", mode);
      if (mode === "custom") {
        if (stylePrompt.trim()) form.append("stylePrompt", stylePrompt.trim());
        if (vocalGender) form.append("vocalGender", vocalGender);
        if (instrumental) form.append("instrumental", "true");
        if (lyrics.trim()) form.append("lyrics", lyrics.trim());
      }
      if (songTitle.trim()) form.append("songTitle", songTitle.trim());
      if (artistName.trim()) form.append("artistName", artistName.trim());

      const res = await confirmedFetch("/api/hum-to-song", { method: "POST", body: form });
      if (!res) {
        setPhase("ready"); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json().catch(() => ({}))) as SongResult & {
        error?: string;
        message?: string;
        creditsRemaining?: number;
      };
      if (!res.ok) {
        if (data.error === "out_of_credits") {
          setOutOfCredits(true);
          refreshProfile();
          setPhase("ready");
          return;
        }
        throw new Error(data.error ?? data.message ?? "Song generation failed.");
      }
      const title = songTitle.trim() || "Hum Song";
      const asset = addAsset({
        kind: "song",
        url: data.url,
        label: title,
        detail: "Built from your hum",
        meta: {
          title,
          artist: artistName.trim(),
          humRef: data.humRef,
          influence: data.influence,
          ...(data.analysis.tempoBpm ? { tempoBpm: String(data.analysis.tempoBpm) } : {}),
          ...(data.analysis.keyEstimate ? { key: data.analysis.keyEstimate } : {}),
        },
      });
      setSongAsset(asset);
      setResult(data);
      setProjectName(title);
      setProjectType("song");
      if (data.creditsRemaining !== undefined) refreshProfile();
      setPhase("done");
      toast({ title: "Your song is ready", description: "Built around your hum — take it to video, cover art, or extend it." });
      setTimeout(() => {
        document.getElementById("hum-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Song generation failed.");
    }
  }

  async function extendSong() {
    if (!result || extending || !extendPrompt.trim()) return;
    setExtending(true);
    try {
      const res = await confirmedFetch("/api/generate-music-audio/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalAudioUrl: result.url,
          originalPrompt: `Hum-to-song arrangement (${result.analysis.keyEstimate ?? "unknown key"}, ~${result.analysis.tempoBpm ?? "?"} BPM)`,
          extendPrompt: extendPrompt.trim(),
          extendSeconds: 30,
          vocalGender: vocalGender || undefined,
          instrumental,
          songTitle: songTitle.trim() || undefined,
          artistName: artistName.trim() || undefined,
        }),
        overrideCost: 400,
        overrideFeature: "Extend Audio",
      });
      if (!res) {
        setExtending(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Extension failed.");
      if (!data.url) throw new Error("Extension came back empty.");
      setExtendedUrl(data.url);
      addAsset({
        kind: "song",
        url: data.url,
        label: `${songTitle.trim() || "Hum Song"} (Extended)`,
        detail: "Extended arrangement",
        meta: { sourceAsset: songAsset?.id ?? "", handoff: "extend" },
      });
      refreshProfile();
      toast({ title: "Extended", description: "Your 30-second extension is joined onto the song." });
    } catch (err) {
      toast({
        title: "Extension failed",
        description: err instanceof Error ? err.message : "Could not extend the song.",
        variant: "destructive",
      });
    } finally {
      setExtending(false);
    }
  }

  async function shareSong() {
    const link = getShareLink("hum-song");
    const text = `I hummed a melody and Bow Down Visuals turned it into a full song — ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My hum became a song", text, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        toast({ title: "Share link copied", description: "Your referral code is baked in — every signup earns you credits." });
      }
      setShared(true);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  function resetAll() {
    if (humObjectUrl) URL.revokeObjectURL(humObjectUrl);
    setHumFile(null);
    setHumObjectUrl(null);
    setHumRef(null);
    setHumUrl(null);
    setAnalysis(null);
    setResult(null);
    setSongAsset(null);
    setExtendedUrl(null);
    setError(null);
    setOutOfCredits(false);
    setPhase("capture");
  }

  const busy = phase === "analyzing" || phase === "generating";

  return (
    <div className="space-y-6">
      {/* Step 1 — capture */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Mic className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-white">1. Hum your melody</h3>
        </div>
        <p className="text-sm text-white/40 mb-4">
          Record up to 60 seconds right here, or upload a voice memo. We pull the tempo, key and
          phrasing out of it and build a full arrangement around your melody.
        </p>

        {phase === "capture" && !humFile && (
          <div className="flex flex-col sm:flex-row gap-3">
            {!recording ? (
              <Button
                type="button"
                onClick={startRecording}
                className="gold-glow font-bold gap-2 flex-1 h-12"
              >
                <Mic className="h-4 w-4" /> Record my hum
              </Button>
            ) : (
              <Button
                type="button"
                onClick={stopRecording}
                variant="destructive"
                className="font-bold gap-2 flex-1 h-12"
              >
                <Square className="h-4 w-4" />
                Stop — {recSecs}s / 60s
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                </span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2 flex-1 h-12 border-white/15 text-white/70 hover:text-white"
            >
              <Upload className="h-4 w-4" /> Upload voice memo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) acceptFile(f);
              }}
            />
          </div>
        )}

        {phase === "analyzing" && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-white/60">Listening to your hum — extracting tempo, key and melody…</p>
          </div>
        )}

        {(phase === "ready" || phase === "generating" || phase === "done") && humObjectUrl && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-white/40 shrink-0">
                <Music2 className="h-4 w-4 text-primary" />
                <span className="max-w-[180px] truncate">{humFile?.name ?? "Your hum"}</span>
              </div>
              <audio src={humObjectUrl} controls className="h-9 flex-1 min-w-0 w-full" />
              {phase === "ready" && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-xs text-white/40 hover:text-white underline underline-offset-2 shrink-0"
                >
                  Re-record
                </button>
              )}
            </div>
            {analysis && <AnalysisBadges analysis={analysis} />}
            {humUrl && (
              <p className="text-xs text-white/30">
                <Check className="h-3 w-3 inline mr-1 text-emerald-400" />
                Hum saved to your project — you can re-reference it anytime.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — options + generate */}
      {(phase === "ready" || phase === "generating" || phase === "done") && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-4 w-4 text-primary" />
            <h3 className="font-bold text-white">2. Make it a song</h3>
          </div>

          <div className="flex gap-2 mb-5">
            {(["simple", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={busy}
                className={`px-5 py-2.5 rounded-xl font-medium transition-all capitalize ${
                  mode === m ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "simple" ? (
            <p className="text-sm text-white/45 mb-5">
              One click — AI picks the style and builds a full 60-second arrangement around your hum.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div className="space-y-2">
                <FieldLabel>Song title</FieldLabel>
                <Input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Midnight Gold" className={inputClass} disabled={busy} />
              </div>
              <div className="space-y-2">
                <FieldLabel>Artist name</FieldLabel>
                <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="Your artist name" className={inputClass} disabled={busy} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <FieldLabel>Style direction</FieldLabel>
                <Input
                  value={stylePrompt}
                  onChange={(e) => setStylePrompt(e.target.value)}
                  placeholder="Dark R&B with 808s, silky pads, late-night energy"
                  className={inputClass}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <FieldLabel>Vocal gender</FieldLabel>
                <div className="flex gap-2">
                  {["", "male", "female"].map((g) => (
                    <button
                      key={g || "auto"}
                      type="button"
                      onClick={() => setVocalGender(g as "" | "male" | "female")}
                      disabled={busy}
                      className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium transition-all capitalize ${
                        vocalGender === g ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {g || "Auto"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <FieldLabel>Arrangement</FieldLabel>
                <button
                  type="button"
                  onClick={() => setInstrumental((v) => !v)}
                  disabled={busy}
                  className={`w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    instrumental ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {instrumental ? "Instrumental — no vocals" : "With vocals"}
                </button>
              </div>
              {!instrumental && (
                <div className="space-y-2 sm:col-span-2">
                  <FieldLabel>Lyrics (optional — unlocks the lyric-video handoff)</FieldLabel>
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    placeholder="Paste or write the lyrics for the vocal line…"
                    rows={3}
                    disabled={busy}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none text-sm"
                  />
                </div>
              )}
            </div>
          )}

          <Button
            type="button"
            onClick={generate}
            disabled={busy || !humRef}
            className="w-full gold-glow font-bold text-base h-13 gap-2"
            style={{ height: "52px" }}
          >
            {phase === "generating" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Building your arrangement…
              </>
            ) : (
              <>
                <Wand2 className="h-5 w-5" /> Turn my hum into a song — {HUM_PRICE} Visual Bucs
              </>
            )}
          </Button>
          <p className="text-white/25 text-xs mt-3">
            60-second full arrangement. If generation fails, your {HUM_PRICE} Visual Bucs are refunded automatically.
          </p>
        </div>
      )}

      {outOfCredits && <OutOfCredits />}

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Step 3 — result + handoffs */}
      {phase === "done" && result && (
        <div id="hum-result" className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 md:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-400" />
            <h3 className="font-bold text-white text-lg">Your song is ready</h3>
          </div>

          <audio src={result.url} controls className="w-full h-10" />

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-white/50 leading-relaxed">
              <span className="text-white/70 font-semibold">How your hum was used: </span>
              {result.influenceNote}
            </p>
          </div>

          {/* Handoff chain */}
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">Take it further</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-auto py-3.5 border-white/15 text-white/80 hover:text-white hover:border-primary/40 flex-col gap-1.5"
                onClick={() => {
                  if (!songTitle.trim() && mode === "custom") {
                    toast({ title: "Name it first", description: "Add a song title in Custom mode so the cover art brief is complete." });
                  }
                  setProjectName(songTitle.trim() || "Hum Song");
                  setLocation("/cover-art");
                }}
              >
                <ImageIcon className="h-5 w-5 text-primary" />
                <span className="text-sm font-bold">Design cover art</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExtendOpen((v) => !v)}
                className="h-auto py-3.5 border-white/15 text-white/80 hover:text-white hover:border-primary/40 flex-col gap-1.5"
              >
                <Scissors className="h-5 w-5 text-primary" />
                <span className="text-sm font-bold">Extend +30s</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={shareSong}
                className="h-auto py-3.5 border-white/15 text-white/80 hover:text-white hover:border-primary/40 flex-col gap-1.5"
              >
                <Share2 className="h-5 w-5 text-primary" />
                <span className="text-sm font-bold">{shared ? "Link ready to share" : "Share it"}</span>
              </Button>
            </div>
            <p className="text-xs text-white/30 mt-2">
              Shared links carry your referral code — every friend who joins earns you 25% of their credit buys.
            </p>
          </div>

          {extendOpen && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
              <p className="text-sm font-semibold text-white">Extend the arrangement</p>
              <Input
                value={extendPrompt}
                onChange={(e) => setExtendPrompt(e.target.value)}
                placeholder="Bigger drop, choir stacks, strip it back…"
                className={inputClass}
                disabled={extending}
              />
              <Button
                type="button"
                onClick={extendSong}
                disabled={extending || !extendPrompt.trim()}
                className="gold-glow font-bold gap-2"
              >
                {extending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                {extending ? "Extending…" : "Extend 30s — 400 Visual Bucs"}
              </Button>
              {extendedUrl && (
                <div className="pt-2">
                  <p className="text-xs text-white/40 mb-2">Extended version (crossfaded onto the original):</p>
                  <audio src={extendedUrl} controls className="w-full h-9" />
                </div>
              )}
            </div>
          )}

          {songAsset && (
            <AssetHandoffs
              asset={songAsset}
              handoffs={["karaoke", "audiogram"]}
              lyricsText={lyrics.trim() || undefined}
              coverUrl={latestOfKind("image")?.url}
              brandName={artistName.trim() || undefined}
              tagline={songTitle.trim() || undefined}
            />
          )}

          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white underline underline-offset-2"
          >
            <RefreshCw className="h-3 w-3" /> Start over with a new hum
          </button>
        </div>
      )}
    </div>
  );
}
