import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { vaultToPayload } from "@/lib/prompt-improve";
import {
  Sparkles, Wand2, Video, Image as ImageIcon, MousePointerClick,
  Music, User, Copy, Check, Loader2, ArrowLeft, ArrowRight, Lightbulb,
} from "lucide-react";

type Target = "video" | "image" | "thumbnail" | "song" | "artist";
type Mode = "generate" | "improve";

const TARGETS: { id: Target; label: string; hint: string; icon: typeof Video }[] = [
  { id: "video",     label: "Video Scene",     hint: "Runway / Seedance prompts", icon: Video },
  { id: "image",     label: "Image",           hint: "GPT Image 2 prompts",      icon: ImageIcon },
  { id: "thumbnail", label: "Thumbnail",      hint: "Click-magnet prompts",     icon: MousePointerClick },
  { id: "song",      label: "Song",            hint: "Music generation prompts", icon: Music },
  { id: "artist",    label: "Artist Portrait", hint: "Identity-locked prompts",  icon: User },
];

const VAULT_TARGETS: Target[] = ["video", "image", "thumbnail", "artist"];

const inputClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";

export default function PromptStudio() {
  const { getAccessToken } = useAuth();
  const [, navigate] = useLocation();
  const [target, setTarget] = useState<Target>("video");
  const [mode, setMode] = useState<Mode>("generate");
  const [text, setText] = useState("");
  const [vault, setVault] = useState<ArtistVault | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [fixes, setFixes] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | null>(null);

  async function handleGenerate() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setPrompts([]);
    setFixes([]);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/prompt-studio/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          mode,
          target,
          ...(mode === "improve" ? { prompt: text.trim() } : { idea: text.trim() }),
          artistVault: VAULT_TARGETS.includes(target) && vault ? vaultToPayload(vault) : null,
        }),
      });
      const data = (await res.json()) as { prompts?: string[]; fixes?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Prompt generation failed");
      setPrompts((data.prompts ?? []).slice(0, 3));
      setFixes(data.fixes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prompt generation failed");
    } finally {
      setLoading(false);
    }
  }

  function copyPrompt(p: string, i: number) {
    navigator.clipboard.writeText(p).catch(() => {});
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
  }

  function sendToImageStudio(p: string) {
    sessionStorage.setItem("image-studio-prefill", p);
    navigate("/image-studio");
  }

  const canSendToImage = target === "image" || target === "thumbnail" || target === "artist";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/15 border border-primary/30">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Prompt Studio</h1>
            <p className="text-sm text-white/50">The best prompts for everything — generate from an idea, or improve what you have.</p>
          </div>
        </div>

        {/* Target picker */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-6">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                target === t.id
                  ? "border-primary/60 bg-primary/10"
                  : "border-white/[0.08] bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <t.icon className={`h-5 w-5 mb-1.5 ${target === t.id ? "text-primary" : "text-white/50"}`} />
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-[11px] text-white/40">{t.hint}</div>
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mt-6">
          {(
            [
              { id: "generate", label: "Generate from idea", icon: Lightbulb },
              { id: "improve", label: "Improve my prompt", icon: Wand2 },
            ] as { id: Mode; label: string; icon: typeof Wand2 }[]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm border transition-colors ${
                mode === m.id
                  ? "border-primary/60 bg-primary/15 text-white"
                  : "border-white/[0.08] text-white/50 hover:border-white/20"
              }`}
            >
              <m.icon className="h-4 w-4" /> {m.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="mt-4">
          <Label className="text-sm text-white/60">
            {mode === "improve" ? "Your prompt" : "Your idea"}
          </Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={
              mode === "improve"
                ? "Paste the prompt you want leveled up…"
                : "Describe what you want — a sentence or two is plenty…"
            }
            className={`${inputClass} mt-2`}
          />
        </div>

        {VAULT_TARGETS.includes(target) && (
          <div className="mt-4">
            <ArtistVaultSelector value={vault} onChange={setVault} />
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <Button
          onClick={handleGenerate}
          disabled={!text.trim() || loading}
          className="mt-4 w-full sm:w-auto"
          size="lg"
        >
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {loading ? "Crafting prompts…" : mode === "improve" ? "Improve my prompt" : "Generate prompts"}
        </Button>
        <p className="text-[11px] text-white/30 mt-2">Free to use — no credits spent.</p>

        {/* What was fixed */}
        {fixes.length > 0 && (
          <div className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" /> What got fixed
            </h3>
            <ul className="list-disc list-inside text-sm text-white/60 space-y-1">
              {fixes.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}

        {/* Results */}
        {prompts.length > 0 && (
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold">Your pro prompts</h2>
            {prompts.map((p, i) => (
              <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-primary">Variation {i + 1}</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => copyPrompt(p, i)}>
                      {copied === i ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                      <span className="ml-1 text-xs">{copied === i ? "Copied" : "Copy"}</span>
                    </Button>
                    {canSendToImage && (
                      <Button variant="ghost" size="sm" onClick={() => sendToImageStudio(p)}>
                        <ArrowRight className="h-4 w-4" />
                        <span className="ml-1 text-xs">Image Studio</span>
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{p}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
