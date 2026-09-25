import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Disc3, Loader2, Download, Play, Pause, ArrowLeft, Sparkles,
  CheckCircle2, AlertTriangle, FileArchive, Music4, AudioWaveform,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  PACK_SIZE_OPTIONS, creditsForSize, originBadge, formatDuration,
  type SampleOrigin,
} from "@/lib/sample-pack";

/* ─── Sample Pack Generator ────────────────────────────────────────────────
   Producers build custom packs: pick genre, BPM, key, size — get drum
   one-shots, melodic loops, basslines, and FX as downloadable WAVs.
   Honest labeling: drums + FX are synthesized with DSP ("Synth"), melodies
   + bass are AI-composed ("AI"). Every file is really rendered. 5 credits
   per 10-sample pack. Royalty-free license included. */

interface CatalogType {
  key: string;
  label: string;
  origin: SampleOrigin;
  blurb: string;
}

interface Catalog {
  genres: string[];
  keys: string[];
  packSizes: Array<{ size: number; credits: number }>;
  types: CatalogType[];
  license: string;
}

interface Sample {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  origin: SampleOrigin;
  url: string;
  durationSec: number;
  bpm: number;
  musicalKey: string;
  genre: string;
}

const GENRE_LABELS: Record<string, string> = {
  trap: "Trap", "hip-hop": "Hip-Hop", drill: "Drill", rnb: "R&B",
  afrobeats: "Afrobeats", house: "House", techno: "Techno",
  "drum-and-bass": "Drum & Bass", lofi: "Lo-Fi", pop: "Pop",
};

function genreLabel(g: string): string {
  return GENRE_LABELS[g] ?? g;
}

export default function SamplePack() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [genre, setGenre] = useState("trap");
  const [bpm, setBpm] = useState(140);
  const [musicalKey, setMusicalKey] = useState("A");
  const [packSize, setPackSize] = useState<10 | 25 | 50>(10);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [packName, setPackName] = useState("");
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sample-pack/catalog");
        if (!res.ok) return;
        const data = (await res.json()) as Catalog;
        if (!cancelled) {
          setCatalog(data);
          setGenre(data.genres[0] ?? "trap");
          setMusicalKey(data.keys[0] ?? "A");
        }
      } catch { /* catalog is progressive enhancement */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePlay = (s: Sample) => {
    if (playingId === s.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }
    audioRef.current.src = s.url;
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(s.id);
  };

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setSamples([]);
    setProgress("Charging credits and warming up the studio…");
    try {
      const res = await fetch("/api/sample-pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre,
          bpm,
          musicalKey,
          packSize,
          types: selectedTypes.size > 0 ? [...selectedTypes] : undefined,
        }),
      });
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }
      setSamples(data.samples ?? []);
      setCreditsRemaining(data.creditsRemaining ?? null);
      setPackName(`${genre}-${bpm}bpm-${musicalKey}`.toLowerCase().replace(/[^a-z0-9-]/g, ""));
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setProgress("");
    } finally {
      setGenerating(false);
    }
  };

  const downloadZip = async () => {
    if (samples.length === 0) return;
    setZipping(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-pack/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: samples.map((s) => s.url),
          packName: packName || "sample-pack",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "ZIP failed");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${packName || "sample-pack"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ZIP download failed");
    } finally {
      setZipping(false);
    }
  };

  const cost = creditsForSize(packSize);
  const grouped = samples.reduce<Record<string, Sample[]>>((acc, s) => {
    (acc[s.typeLabel] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Disc3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Sample Pack Generator</h1>
            <p className="text-sm text-white/45">
              Custom drum kits, loops &amp; FX in your genre, BPM, and key — {cost} credits for {packSize} samples
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            Drums and FX are <span className="text-white/80 font-semibold">synthesized with DSP</span> (labeled
            Synth); melodies and basslines are <span className="text-white/80 font-semibold">AI-composed</span> (labeled
            AI). Every file is really rendered as a 44.1kHz WAV — nothing faked.
            Royalty-free: use them in your own productions.
          </p>
        </div>

        {outOfCredits && (
          <div className="mt-4">
            <OutOfCredits />
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* ── Builder ── */}
        <section className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-5">Build your pack</h2>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Genre</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(catalog?.genres ?? ["trap"]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenre(g)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                      genre === g
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                    }`}
                  >
                    {genreLabel(g)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                Key <span className="text-white/30 normal-case">(melodies &amp; bass follow this)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(catalog?.keys ?? ["A"]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setMusicalKey(k)}
                    className={`h-8 w-9 rounded-lg text-xs font-bold border transition ${
                      musicalKey === k
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                Tempo — <span className="text-primary font-bold">{bpm} BPM</span>
              </label>
              <input
                type="range" min={60} max={180} value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="mt-3 w-full accent-amber-400"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-1">
                <span>60</span><span>120</span><span>180</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Pack size</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {PACK_SIZE_OPTIONS.map((o) => (
                  <button
                    key={o.size}
                    onClick={() => setPackSize(o.size)}
                    className={`rounded-xl border px-3 py-2.5 text-center transition ${
                      packSize === o.size
                        ? "border-primary bg-primary/15"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    }`}
                  >
                    <div className={`text-lg font-black ${packSize === o.size ? "text-primary" : "text-white/80"}`}>{o.size}</div>
                    <div className="text-[10px] text-white/40">{o.credits} credits</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {catalog && (
            <div className="mt-6">
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                Sample types <span className="text-white/30 normal-case">(leave empty for a balanced mix)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {catalog.types.map((t) => {
                  const active = selectedTypes.has(t.key);
                  const badge = originBadge(t.origin);
                  return (
                    <button
                      key={t.key}
                      onClick={() => toggleType(t.key)}
                      title={t.blurb}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                        active
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                      }`}
                    >
                      {t.label}
                      <span className={`rounded border px-1 text-[9px] font-bold ${badge.className}`}>{badge.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={generate}
            disabled={generating || !user}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioWaveform className="h-4 w-4" />}
            {generating ? "Cooking your pack…" : `Generate pack · ${cost} credits`}
          </button>
          {generating && progress && (
            <p className="mt-3 text-xs text-white/45">{progress}</p>
          )}
          {!user && (
            <p className="mt-3 text-xs text-white/45">
              <Link href="/login" className="text-primary underline">Sign in</Link> to generate packs.
            </p>
          )}
        </section>

        {/* ── Results ── */}
        {samples.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-black">
                  Your pack — {samples.length} samples
                  {creditsRemaining !== null && (
                    <span className="ml-2 text-xs font-normal text-white/40">{creditsRemaining} credits left</span>
                  )}
                </h2>
              </div>
              <button
                onClick={downloadZip}
                disabled={zipping}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {zipping ? "Zipping…" : "Download pack ZIP"}
              </button>
            </div>

            {Object.entries(grouped).map(([label, list]) => (
              <div key={label} className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                  <Music4 className="h-3.5 w-3.5" /> {label}
                  <span className={`rounded border px-1.5 text-[9px] font-bold ${originBadge(list[0].origin).className}`}>
                    {originBadge(list[0].origin).label === "AI" ? "AI-generated" : "Synthesized"}
                  </span>
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"
                    >
                      <button
                        onClick={() => togglePlay(s)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25"
                      >
                        {playingId === s.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white/85">{s.name}</div>
                        <div className="text-[10px] text-white/35">
                          {s.bpm} BPM · {s.musicalKey} · {formatDuration(s.durationSec)} · WAV
                        </div>
                      </div>
                      <a
                        href={s.url}
                        download={`${s.name}.wav`}
                        className="shrink-0 rounded-lg border border-white/10 p-2 text-white/50 hover:border-white/30 hover:text-white"
                        title="Download WAV"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="mt-4 text-[11px] text-white/30">
              {catalog?.license ?? "Royalty-free — use in your own productions, no attribution required."}
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
