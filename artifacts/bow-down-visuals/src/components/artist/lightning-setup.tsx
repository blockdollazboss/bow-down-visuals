import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, ArrowLeft, Check, Copy, ExternalLink, Loader2, Share2,
  Sparkles, Wand2, Zap, Code2, Megaphone,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import type { CreatorProfile, VerticalId } from "@/lib/artist-profiles";
import {
  VERTICALS, starterTemplate, presetById, createProfile, saveMyProfile, profileUrl,
} from "@/lib/artist-profiles";
import ConfettiBurst from "./confetti-burst";
import { GetPaidChecklist } from "./get-paid-checklist";

/* ─── LightningSetup — signup-to-live-profile in 60 seconds ────────────────
   First-run express path inside /artist-setup. Rendered instead of the full
   6-tab editor when the user has no profile yet. Three steps:

     1. You    — name + lane prefilled, slug auto-checked
     2. Vibe   — AI design (default, paid) or instant free starter template
     3. LIVE   — confetti celebration + instant share actions + Get Paid

   Ruthless prefill: auth display name, Google avatar, vault name/photo/lane.
   One POST creates the profile PUBLIC — no draft limbo, no save-then-publish
   round trip. "Manual mode" escapes to the full editor anytime. */

const STEP_LABELS = ["You", "Vibe", "LIVE"] as const;

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return s.length >= 3 ? s : `creator-${Math.floor(1000 + Math.random() * 9000)}`;
}

function laneFromVault(artistType?: string | null, genre?: string | null): VerticalId | null {
  const hay = `${artistType ?? ""} ${genre ?? ""}`.toLowerCase();
  if (/gamer|streamer|twitch|esports|gaming/.test(hay)) return "gaming";
  if (/podcast/.test(hay)) return "podcast";
  if (/film|director|cinema/.test(hay)) return "film";
  if (/influencer|content creator|tiktok/.test(hay)) return "influencer";
  if (/dj|producer|rapper|singer|music|band|artist/.test(hay)) return "music";
  return null;
}

export default function LightningSetup({
  onCreated,
  onOpenEditor,
  onManual,
}: {
  /** Profile went live — parent syncs its editor state; the wizard keeps celebrating. */
  onCreated: (profile: CreatorProfile) => void;
  onOpenEditor: (tab: "content" | "publish" | "basics" | "designer") => void;
  /** Escape hatch to the full manual editor. */
  onManual: () => void;
}) {
  const { profile: authProfile, user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [lane, setLane] = useState<VerticalId>("music");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [vibe, setVibe] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [live, setLive] = useState<CreatorProfile | null>(null);
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const debounceRef = useRef<number>(0);

  /* ── Ruthless prefill: auth → vault → nothing. Runs once on mount. ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
      const authName = authProfile?.display_name || meta.full_name || meta.name || "";
      const authAvatar = meta.avatar_url || meta.picture || null;
      if (!cancelled) {
        if (authName) setName((n) => n || authName);
        if (authAvatar) setAvatarUrl((a) => a || authAvatar);
      }
      try {
        const res = await fetch("/api/artist-vaults");
        const data = await res.json();
        const vaults = data.vaults ?? data ?? [];
        const v = Array.isArray(vaults) ? vaults[0] : null;
        if (!v || cancelled) return;
        if (v.artist_name) setName((n) => n || v.artist_name);
        if (v.reference_image_url) setAvatarUrl((a) => a || v.reference_image_url);
        const vaultLane = laneFromVault(v.artist_type, v.genre);
        if (vaultLane) setLane(vaultLane);
      } catch { /* vault is best-effort prefill */ }
    })();
    return () => { cancelled = true; };
  }, [user, authProfile]);

  /* ── Slug auto-derives from name until the user edits it by hand. ── */
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  /* ── Live slug availability check (debounced). ── */
  useEffect(() => {
    if (!slug) { setSlugState("idle"); return; }
    window.clearTimeout(debounceRef.current);
    setSlugState("checking");
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/creator-profiles/check-slug?slug=${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (data.valid === false) { setSlugState("taken"); return; }
        setSlugState(data.available ? "ok" : "taken");
      } catch {
        setSlugState("idle");
      }
    }, 400);
    return () => window.clearTimeout(debounceRef.current);
  }, [slug]);

  const suggestSlug = () => {
    const alt = `${slugify(name)}-${Math.floor(10 + Math.random() * 89)}`;
    setSlug(alt);
    setSlugTouched(true);
  };

  const canContinueStep0 = name.trim().length >= 2 && slugState === "ok";

  const createPayload = (overrides: Partial<CreatorProfile>): Partial<CreatorProfile> => ({
    display_name: name.trim(),
    slug,
    vertical: lane,
    avatar_url: avatarUrl,
    tip_jar_enabled: true,
    is_public: true,
    ...overrides,
  });

  /* Instant free path: starter template, public in one POST. */
  async function goLiveInstant() {
    if (!canContinueStep0 || busy) return;
    setBusy(true);
    try {
      const tpl = starterTemplate(lane);
      const p = await createProfile(
        createPayload({
          theme_id: tpl.themeId,
          theme_config: { ...presetById(tpl.themeId) },
          sections: tpl.sections,
          ai_design: {
            lightning: true,
            starterTemplate: tpl.vertical,
            designedAt: new Date().toISOString(),
          },
        })
      );
      setLive(p);
      setStep(2);
      onCreated(p);
    } catch (err) {
      toast({ title: "Couldn't go live", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  /* AI path (default): "describe your vibe" → live page. */
  async function goLiveWithAi() {
    if (!canContinueStep0 || vibe.trim().length < 10 || busy || generating) return;
    setGenerating(true);
    try {
      const res = await confirmedFetch("/api/ai-page-designer/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical: lane,
          vibe: vibe.trim(),
          displayName: name.trim() || "Creator",
          palette: [],
          baseThemeId: "midnight-gold",
          regenerate: false,
        }),
      });
      if (!res) { setGenerating(false); return; } /* credit confirmation dismissed */
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Design failed");
      setBusy(true);
      const p = await createProfile(
        createPayload({
          theme_id: data.themeConfig.themeId,
          theme_config: data.themeConfig,
          sections: data.sections,
          ai_design: {
            lightning: true,
            vibe: vibe.trim(),
            rationale: data.rationale,
            designedAt: new Date().toISOString(),
          },
        })
      );
      setLive(p);
      setStep(2);
      onCreated(p);
    } catch (err) {
      toast({ title: "The designer stumbled", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setGenerating(false);
      setBusy(false);
    }
  }

  /* ── Share actions (celebration step) ── */
  const url = live ? profileUrl(live) : "";

  /* Get Paid checklist actions save against the live profile for real. */
  const patchLive = (p: Partial<CreatorProfile>) => {
    setLive((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...p };
      void saveMyProfile(next)
        .then((saved) => setLive(saved))
        .catch(() => toast({ title: "Couldn't save that", description: "Try again in the editor." }));
      return next;
    });
  };
  const embedSnippet = live
    ? `<!-- Your page, powered by Bow Down Visuals — share the cheat code -->\n<iframe src="${url}" width="100%" height="640" style="border:0;border-radius:16px" loading="lazy" title="${live.display_name} — Bow Down Visuals"></iframe>`
    : "";

  const copyText = async (text: string, which: "link" | "embed") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: "Copy didn't work", description: "Long-press the link to copy it manually." });
    }
  };

  const nativeShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${live?.display_name} — Bow Down Visuals`, url });
      } else {
        await copyText(url, "link");
      }
    } catch { /* user cancelled */ }
  };

  const laneMeta = VERTICALS.find((v) => v.id === lane)!;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      {step < 2 && (
        <p className="mb-6 text-center text-xs text-white/40">
          Prefer full manual control?{" "}
          <button onClick={onManual} className="text-amber-300 underline">
            Open the editor →
          </button>
        </p>
      )}
      {/* Progress — momentum copy keeps the clock honest */}
      {step < 2 && (
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-xs font-bold">
            <span className="text-white/50">
              Step {step + 1} of 3 · {STEP_LABELS[step]}
            </span>
            <span className="text-amber-300">
              {2 - step} {2 - step === 1 ? "step" : "steps"} left — your page is almost live
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
              style={{ width: `${((step + 1) / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {step === 0 && (
        <div>
          <h1 className="font-black text-3xl text-white sm:text-4xl" style={{ fontFamily: "'Cinzel', serif" }}>
            Your page goes live in 60 seconds.
          </h1>
          <p className="mt-2 text-white/60">
            We prefilled everything we could. Confirm it, pick your lane, hit continue.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">
                Your name
              </label>
              <div className="flex items-center gap-3">
                {avatarUrl && (
                  <img src={avatarUrl} alt="" className="h-12 w-12 rounded-full border border-amber-400/40 object-cover" />
                )}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your stage name"
                  maxLength={80}
                  autoFocus
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-bold text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
                />
              </div>
              {avatarUrl && (
                <p className="mt-1 text-xs text-white/40">
                  Photo pulled from your account — swap it anytime in the editor.
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-white/50">
                Your lane
              </label>
              <div className="grid grid-cols-3 gap-2">
                {VERTICALS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setLane(v.id)}
                    className={`rounded-xl border p-2.5 text-center transition ${
                      lane === v.id
                        ? "border-amber-400 bg-amber-400/10"
                        : "border-white/10 bg-white/5 hover:border-white/25"
                    }`}
                  >
                    <div className="text-xl">{v.emoji}</div>
                    <div className="mt-1 text-[11px] font-bold text-white">{v.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">
                Your link
              </label>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-sm text-white/40">/artist/</span>
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    setSlugTouched(true);
                  }}
                  placeholder="your-name"
                  maxLength={40}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
                />
                <span className="w-8 shrink-0 text-center">
                  {slugState === "checking" && <Loader2 className="mx-auto h-4 w-4 animate-spin text-white/40" />}
                  {slugState === "ok" && <Check className="mx-auto h-4 w-4 text-emerald-400" />}
                </span>
              </div>
              {slugState === "taken" && slug && (
                <button onClick={suggestSlug} className="mt-1 text-xs text-amber-300 underline">
                  Taken — try {slugify(name)}-{Math.floor(10 + Math.random() * 89)}?
                </button>
              )}
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => setStep(1)}
              disabled={!canContinueStep0}
              className="flex items-center gap-2 rounded-full bg-amber-400 px-8 py-3 font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
            {slugState === "checking" && (
              <span className="text-xs text-white/40">Checking your link…</span>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h1 className="font-black text-3xl text-white sm:text-4xl" style={{ fontFamily: "'Cinzel', serif" }}>
            Describe your vibe.
          </h1>
          <p className="mt-2 text-white/60">
            Two sentences. The AI reads it like a creative director and builds your whole{" "}
            {laneMeta.label.toLowerCase()} page — theme, layout, sections. One step left after this.
          </p>

          <textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            rows={4}
            maxLength={800}
            autoFocus
            placeholder={
              lane === "gaming"
                ? "e.g. High-octane neon arcade energy — clutch plays, loud chat, zero chill…"
                : lane === "influencer"
                  ? "e.g. Polished but real — aspirational mornings, honest reviews, brands love me…"
                  : lane === "podcast"
                    ? "e.g. Late-night conversation energy — curious, warm, the show everyone quotes…"
                    : "e.g. Dark luxury with gold accents — confident, cinematic, unforgettable…"
            }
            className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={() => setStep(0)}
              className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white/70"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {/* AI path — the DEFAULT. Paid, because it's the full creative-director treatment. */}
            <button
              onClick={() => void goLiveWithAi()}
              disabled={generating || busy || vibe.trim().length < 10 || !canContinueStep0}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-amber-400 px-6 py-3 font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              {generating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> The designer is cooking…</>
              ) : (
                <><Wand2 className="h-4 w-4" /> Design my page with AI — 400 Visual Bucs</>
              )}
            </button>
          </div>
          <button
            onClick={() => void goLiveInstant()}
            disabled={busy || generating || !canContinueStep0}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white/70 transition hover:text-white disabled:opacity-40"
          >
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Going live…</>
            ) : (
              <><Zap className="h-4 w-4 text-amber-400" /> Skip the wait — go live instantly with the {laneMeta.label} template (free)</>
            )}
          </button>
          <p className="mt-2 text-center text-xs text-white/40">
            The AI designs theme, layout, and sections. The template is the same skeleton, styled in gold and black — upgrade with AI anytime after.
          </p>
        </div>
      )}

      {step === 2 && live && (
        <div>
          <ConfettiBurst />
          <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-b from-[#1a1408] to-black p-8 text-center shadow-[0_0_80px_rgba(212,175,55,0.25)]">
            <Sparkles className="mx-auto h-12 w-12 text-amber-400" />
            <h1 className="mt-4 font-black text-4xl text-white" style={{ fontFamily: "'Cinzel', serif" }}>
              Your profile is LIVE.
            </h1>
            <p className="mx-auto mt-3 max-w-md text-white/70">
              {live.display_name}'s page is out in the world — profile, catalog, tip jar,{" "}
              <strong className="text-amber-300">all in one place</strong>. That was the cheat code. 🦈
            </p>

            <div className="mx-auto mt-6 flex max-w-md items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-2 pl-4">
              <span className="flex-1 truncate text-left text-sm text-white/70">{url}</span>
              <button
                onClick={() => void copyText(url, "link")}
                className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-black"
              >
                {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "link" ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Instant share actions */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => void nativeShare()}
                className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105"
              >
                <Share2 className="h-4 w-4" /> Share my page
              </button>
              <button
                onClick={() => void copyText(embedSnippet, "embed")}
                className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
                title="Copy an embed snippet for your site or blog"
              >
                {copied === "embed" ? <Check className="h-4 w-4 text-emerald-400" /> : <Code2 className="h-4 w-4" />}
                {copied === "embed" ? "Embed copied" : "Embed code"}
              </button>
              <Link
                href="/home"
                className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
              >
                <Megaphone className="h-4 w-4" /> Post your first update
              </Link>
              <Link
                href={`/artist/${live.slug}`}
                className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
              >
                <ExternalLink className="h-4 w-4" /> See it live
              </Link>
            </div>
          </div>

          {/* First-session checklist — publish → share → earn */}
          <div className="mt-6">
            <GetPaidChecklist
              profile={live}
              patch={patchLive}
              onGoTab={(t) => onOpenEditor(t)}
            />
            <p className="mt-3 text-center text-xs text-white/40">
              Everything else — themes, sections, bio — lives in the full editor.{" "}
              <button onClick={() => onOpenEditor("designer")} className="text-amber-300 underline">
                Open it
              </button>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
