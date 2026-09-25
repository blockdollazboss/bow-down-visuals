import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  Image as ImageIcon, ArrowLeft, Loader2, Download, Sparkles, Zap, BadgeCheck, RefreshCw,
} from "lucide-react";

type Model = "gpt-image-2" | "gen4_image" | "gen4_image_turbo";
type Ratio = "1080:1080" | "1080:1920" | "1920:1080";

const MODELS: { id: Model; name: string; badge: string; credits: number; note: string; icon: typeof Sparkles }[] = [
  { id: "gpt-image-2",     name: "GPT Image 2", badge: "Newest — Best", credits: 2, note: "OpenAI's best image model. Stunning detail & text.", icon: Sparkles },
  { id: "gen4_image",      name: "Gen4 Image",  badge: "Pro",           credits: 3, note: "Runway pro quality with face-reference lock.",       icon: BadgeCheck },
  { id: "gen4_image_turbo", name: "Gen4 Turbo", badge: "Fast",          credits: 2, note: "Quick drafts. Needs your artist photo.",             icon: Zap },
];

const RATIOS: { id: Ratio; label: string }[] = [
  { id: "1080:1080", label: "Square" },
  { id: "1080:1920", label: "Portrait" },
  { id: "1920:1080", label: "Landscape" },
];

interface StudioImage { url: string; prompt: string; model: string }

const inputClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";

export default function ImageStudio() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [text, setText] = useState("");
  const [enhance, setEnhance] = useState(true);
  const [model, setModel] = useState<Model>("gpt-image-2");
  const [ratio, setRatio] = useState<Ratio>("1080:1080");
  const [vault, setVault] = useState<ArtistVault | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [images, setImages] = useState<StudioImage[]>([]);

  /* Prefill from the Prompt Studio's "Image Studio" handoff. */
  useEffect(() => {
    const prefill = sessionStorage.getItem("image-studio-prefill");
    if (prefill) {
      sessionStorage.removeItem("image-studio-prefill");
      setText(prefill);
      setEnhance(false);
    }
  }, []);

  async function authedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data: data as Record<string, unknown> };
  }

  function identityDescription(v: ArtistVault | null): string | null {
    if (!v) return null;
    const parts = [
      v.personality, v.hair, v.tattoos, v.jewelry, v.clothing_style, v.visual_style,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  async function pollRunway(taskId: string, promptUsed: string, modelUsed: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const { res, data } = await authedFetch(`/api/image-studio/${taskId}`);
      if (!res.ok) throw new Error((data.error as string) ?? "Polling failed");
      const st = data.status as string;
      if (st === "succeeded") {
        if (data.url) setImages((prev) => [{ url: data.url as string, prompt: promptUsed, model: modelUsed }, ...prev]);
        setStatus(null);
        refreshProfile().catch(() => {});
        return;
      }
      if (st === "failed" || st === "cancelled") {
        throw new Error((data.error as string) ?? "Image generation failed");
      }
      setStatus(`Creating your image… (${i + 1})`);
    }
    throw new Error("Timed out waiting for the image. It may still finish — try again in a bit.");
  }

  async function handleGenerate() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setStatus(model === "gpt-image-2" ? "Creating your image…" : "Submitting…");
    try {
      const idDesc = identityDescription(vault);
      const { res, data } = await authedFetch("/api/image-studio/generate", {
        method: "POST",
        body: JSON.stringify({
          ...(enhance ? { idea: text.trim() } : { prompt: text.trim() }),
          model,
          ratio,
          referenceImageUrl: vault?.reference_image_url ?? null,
          identityDescription: idDesc,
        }),
      });
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus(null);
        return;
      }
      if (!res.ok) throw new Error((data.error as string) ?? "Image generation failed");

      const promptUsed = (data.prompt as string) ?? text.trim();
      const modelUsed = (data.model as string) ?? model;

      if (data.status === "succeeded" && data.url) {
        setImages((prev) => [{ url: data.url as string, prompt: promptUsed, model: modelUsed }, ...prev]);
        setStatus(null);
        refreshProfile().catch(() => {});
      } else if (data.taskId) {
        await pollRunway(data.taskId as string, promptUsed, modelUsed);
      } else {
        throw new Error("Unexpected response from the image server");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image generation failed");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  const needsPhoto = model === "gen4_image_turbo" && !vault?.reference_image_url;
  const selectedModel = MODELS.find((m) => m.id === model)!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/15 border border-primary/30">
            <ImageIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Image Studio</h1>
            <p className="text-sm text-white/50">The best image generator for content creators — powered by the newest models.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {/* Controls */}
          <div>
            <Label className="text-sm text-white/60">Describe your image</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="A gold shark king on a throne in a dark studio, cinematic light…"
              className={`${inputClass} mt-2`}
            />
            <label className="flex items-center gap-2 mt-2 text-sm text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enhance}
                onChange={(e) => setEnhance(e.target.checked)}
                className="h-4 w-4 accent-yellow-500"
              />
              <Sparkles className="h-4 w-4 text-primary" />
              Enhance my description into a pro prompt
            </label>

            <Label className="text-sm text-white/60 mt-5 block">Model</Label>
            <div className="grid gap-2 mt-2">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`rounded-xl border p-3 text-left transition-colors flex items-start gap-3 ${
                    model === m.id ? "border-primary/60 bg-primary/10" : "border-white/[0.08] bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <m.icon className={`h-5 w-5 mt-0.5 shrink-0 ${model === m.id ? "text-primary" : "text-white/40"}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{m.name}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">{m.badge}</span>
                      <span className="text-[11px] text-white/40 ml-auto">{m.credits} credits</span>
                    </div>
                    <div className="text-xs text-white/45 mt-0.5">{m.note}</div>
                  </div>
                </button>
              ))}
            </div>

            <Label className="text-sm text-white/60 mt-5 block">Shape</Label>
            <div className="flex gap-2 mt-2">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRatio(r.id)}
                  className={`rounded-full px-4 py-2 text-sm border transition-colors ${
                    ratio === r.id ? "border-primary/60 bg-primary/15 text-white" : "border-white/[0.08] text-white/50 hover:border-white/20"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <ArtistVaultSelector value={vault} onChange={setVault} />
              <p className="text-[11px] text-white/30 mt-1">Locks your artist's face & identity into the image.</p>
            </div>

            {needsPhoto && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Gen4 Turbo needs your artist photo as a face reference — pick a vault with a photo, or use GPT Image 2.
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
            )}
            {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

            <Button onClick={handleGenerate} disabled={!text.trim() || loading || needsPhoto} className="mt-4 w-full" size="lg">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-2" />}
              {loading ? (status ?? "Creating…") : `Generate — ${selectedModel.credits} credits`}
            </Button>
          </div>

          {/* Results */}
          <div>
            <Label className="text-sm text-white/60">Your images</Label>
            {images.length === 0 && !loading && (
              <div className="mt-2 rounded-xl border border-dashed border-white/[0.12] p-10 text-center text-sm text-white/35">
                Your generated images will appear here.
              </div>
            )}
            {loading && images.length === 0 && (
              <div className="mt-2 rounded-xl border border-white/[0.08] p-10 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                <p className="text-sm text-white/50 mt-3">{status ?? "Creating your image…"}</p>
              </div>
            )}
            <div className="grid gap-4 mt-2">
              {images.map((img, i) => (
                <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
                  <img src={img.url} alt={img.prompt} className="w-full" />
                  <div className="p-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-white/45 line-clamp-2 flex-1">{img.prompt}</p>
                    <a href={img.url} download target="_blank" rel="noreferrer" className="shrink-0">
                      <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
            {images.length > 0 && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setImages([])}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Clear gallery
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
