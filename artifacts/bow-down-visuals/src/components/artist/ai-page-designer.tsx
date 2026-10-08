import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Sparkles, Wand2, RefreshCw, Check, Loader2, Image as ImageIcon,
  Palette, ArrowRight, ArrowLeft, Zap,
} from "lucide-react";
import type {
  CreatorProfile, ThemeConfig, ProfileSection, VerticalId,
} from "@/lib/artist-profiles";
import {
  VERTICALS, starterTemplate, presetById, themeVars,
} from "@/lib/artist-profiles";
import { extractPalette } from "@/lib/palette";
import { HeroSection, ProfileSections } from "./profile-sections";
import { GetPaidChecklist } from "./get-paid-checklist";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── AI Page Designer — the DEFAULT setup path ───────────────────────────
   "Describe your vibe" → one click → full theme_config + sections layout,
   tuned to the creator's vertical. Preview before applying. Regenerate.
   Also: AI palette extraction from cover art (FREE, client-side), AI bio
   writer, AI banner art generator. Manual editing is the advanced option. */

interface DesignResult {
  themeConfig: ThemeConfig;
  sections: ProfileSection[];
  rationale: string;
}

export default function AiPageDesigner({
  profile,
  onApply,
  onGoTab,
}: {
  profile: CreatorProfile;
  onApply: (patch: Partial<CreatorProfile>) => void;
  onGoTab?: (tab: "content" | "publish" | "basics") => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [vertical, setVertical] = useState<VerticalId>(profile.vertical || "other");
  const [vibe, setVibe] = useState("");
  const [palette, setPalette] = useState<string[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [baseThemeId, setBaseThemeId] = useState(profile.theme_id || "midnight-gold");
  const [design, setDesign] = useState<DesignResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [bioFacts, setBioFacts] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [bioLoading, setBioLoading] = useState(false);
  const [bannerLoading, setBannerLoading] = useState(false);
  const [hint, setHint] = useState("");

  /* Free per-vertical layout hint for the instant starter-template path. */
  useEffect(() => {
    fetch(`/api/ai-page-designer/vertical-hints?vertical=${vertical}`)
      .then((r) => r.json())
      .then((j) => {
        const v = (j.verticals ?? []).find((x: { id: string }) => x.id === vertical);
        if (v?.tip) setHint(v.tip);
      })
      .catch(() => undefined);
  }, [vertical]);

  const verticalMeta = VERTICALS.find((v) => v.id === vertical)!;

  async function samplePalette() {
    const art = profile.avatar_url || profile.banner_url;
    if (!art) {
      toast({ title: "No art to sample yet", description: "Add a photo or cover art first, then steal its colors." });
      return;
    }
    setPaletteLoading(true);
    try {
      const colors = await extractPalette(art, 5);
      setPalette(colors);
      toast({ title: "Palette stolen", description: `${colors.length} colors pulled from your art — free.` });
    } catch {
      toast({ title: "Couldn't sample that image", description: "Try a different photo." });
    } finally {
      setPaletteLoading(false);
    }
  }

  function applyStarterTemplate() {
    const tpl = starterTemplate(vertical);
    onApply({
      vertical,
      theme_id: tpl.themeId,
      theme_config: { ...presetById(tpl.themeId) },
      sections: tpl.sections,
      ai_design: { ...(profile.ai_design ?? {}), starterTemplate: tpl.vertical, designedAt: new Date().toISOString() },
    });
    toast({ title: "Template dropped in", description: tpl.hint });
    setStep(4);
  }

  async function generate(regen = false) {
    if (vibe.trim().length < 10) {
      toast({ title: "Give me a little more", description: "A sentence or two about your vibe — that's all it takes." });
      return;
    }
    setGenerating(true);
    try {
      const res = await confirmedFetch("/api/ai-page-designer/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical,
          vibe: vibe.trim(),
          displayName: profile.display_name || "Creator",
          palette,
          baseThemeId,
          regenerate: regen,
        }),
      });
      if (!res) return; /* credit confirmation dismissed */
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Design failed");
      setDesign({ themeConfig: data.themeConfig, sections: data.sections, rationale: data.rationale });
      setStep(3);
    } catch (err) {
      toast({ title: "The designer stumbled", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setGenerating(false);
    }
  }

  function applyDesign() {
    if (!design) return;
    setApplying(true);
    onApply({
      vertical,
      theme_id: design.themeConfig.themeId,
      theme_config: design.themeConfig,
      sections: design.sections,
      ai_design: {
        ...(profile.ai_design ?? {}),
        vibe,
        palette,
        rationale: design.rationale,
        designedAt: new Date().toISOString(),
      },
    });
    setApplying(false);
    toast({ title: "Look at you.", description: "Your page just got the cheat-code treatment." });
    setStep(4);
  }

  async function writeBio() {
    if (bioFacts.trim().length < 10) {
      toast({ title: "Feed the writer", description: "A few facts — wins, style, what you're known for." });
      return;
    }
    setBioLoading(true);
    try {
      const res = await confirmedFetch("/api/ai-page-designer/bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical,
          displayName: profile.display_name || "Creator",
          facts: bioFacts.trim(),
        }),
      });
      if (!res) return; /* credit confirmation dismissed */
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bio failed");
      setBioDraft(data.bio);
    } catch (err) {
      toast({ title: "The writer stumbled", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBioLoading(false);
    }
  }

  async function generateBanner() {
    if (vibe.trim().length < 10) {
      toast({ title: "Describe your vibe first", description: "The banner artist needs your vibe on step 2." });
      return;
    }
    setBannerLoading(true);
    try {
      const res = await confirmedFetch("/api/ai-page-designer/banner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical, vibe: vibe.trim(), palette }),
      });
      if (!res) return; /* credit confirmation dismissed */
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Banner failed");
      onApply({ banner_url: data.url });
      toast({ title: "Banner landed", description: "Fresh art, straight onto your hero." });
    } catch (err) {
      toast({ title: "The banner artist stumbled", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBannerLoading(false);
    }
  }

  const previewProfile: CreatorProfile | null = design
    ? { ...profile, vertical, theme_config: design.themeConfig, sections: design.sections }
    : null;

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        {["Your lane", "Your vibe", "The magic", "The reveal", "Get paid"].map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition ${
              step === i ? "bg-amber-400 text-black" : "bg-white/5 text-white/50 hover:text-white"
            }`}
          >
            <span className="hidden sm:inline">{i + 1}. {label}</span>
            <span className="sm:hidden">{i + 1}</span>
          </button>
        ))}
      </div>

      {step === 0 && (
        <div>
          <h3 className="mb-1 text-lg font-bold text-white">What lane are you in?</h3>
          <p className="mb-4 text-sm text-white/60">
            Everything on this site is built for your kind of creator. Pick your lane — the whole page designs itself around it.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {VERTICALS.map((v) => (
              <button
                key={v.id}
                onClick={() => setVertical(v.id)}
                className={`rounded-xl border p-3 text-center transition hover:-translate-y-0.5 ${
                  vertical === v.id ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-white/5"
                }`}
              >
                <div className="text-2xl">{v.emoji}</div>
                <div className="mt-1 text-xs font-bold text-white">{v.label}</div>
                <div className="mt-0.5 hidden text-[10px] text-white/50 sm:block">{v.tagline}</div>
              </button>
            ))}
          </div>
          {hint && (
            <p className="mt-3 flex items-start gap-2 text-sm text-amber-200/80">
              <Zap className="mt-0.5 h-4 w-4 shrink-0" /> {hint}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={applyStarterTemplate}
              className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:text-white"
            >
              Skip it — drop in the {verticalMeta.label} starter template
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h3 className="mb-1 text-lg font-bold text-white">Describe your vibe.</h3>
          <p className="mb-4 text-sm text-white/60">
            Two sentences. "Dark luxury with neon energy, like a midnight drive through the city."
            The designer reads it like a creative director — then builds the whole page.
          </p>
          <textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            rows={4}
            maxLength={800}
            placeholder={vertical === "gaming"
              ? "e.g. High-octane neon arcade energy — clutch plays, loud chat, zero chill…"
              : vertical === "influencer"
                ? "e.g. Polished but real — aspirational mornings, honest reviews, brands love me…"
                : vertical === "podcast"
                  ? "e.g. Late-night conversation energy — curious, warm, the show everyone quotes…"
                  : "e.g. Dark luxury with gold accents — confident, cinematic, unforgettable…"}
            className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={samplePalette}
              disabled={paletteLoading}
              className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:text-white disabled:opacity-50"
            >
              {paletteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
              Steal colors from my art — free
            </button>
            {palette.length > 0 && (
              <span className="flex items-center gap-1">
                {palette.map((c) => (
                  <span key={c} title={c} className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                ))}
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setStep(0)}
              className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              onClick={() => void generate(false)}
              disabled={generating || vibe.trim().length < 10}
              className="flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Design my page — 400 Visual Bucs
            </button>
          </div>
          <p className="mt-2 text-xs text-white/40">
            One click, full page: theme, layout, section order — tuned for {verticalMeta.label.toLowerCase()}s.
            You'll preview before anything goes live.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-400" />
          <p className="mt-4 font-semibold text-white">The designer is cooking…</p>
          <p className="mt-1 text-sm text-white/50">Reading your vibe, tuning it for {verticalMeta.label.toLowerCase()}s.</p>
        </div>
      )}

      {step === 3 && design && previewProfile && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold text-white">The reveal. 👀</h3>
              {design.rationale && <p className="max-w-xl text-sm text-amber-200/80">"{design.rationale}"</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void generate(true)}
                disabled={generating}
                className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:text-white disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regenerate
              </button>
              <button
                onClick={applyDesign}
                disabled={applying}
                className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                This is the one — apply it
              </button>
            </div>
          </div>
          {/* Live preview in the generated theme */}
          <div className="overflow-hidden rounded-2xl border border-white/10" style={themeVars(design.themeConfig)}>
            <div style={{ backgroundColor: "var(--ap-bg)", color: "var(--ap-text)", fontFamily: "var(--ap-body-font)" }}>
              <HeroSection profile={previewProfile} />
              <ProfileSections profile={previewProfile} mode="preview" />
            </div>
          </div>
          <p className="mt-2 text-xs text-white/40">
            Preview only — nothing is live until you hit "apply it". Tweak anything afterward in the manual editor.
          </p>
        </div>
      )}

      {step === 4 && (
        <GetPaidChecklist
          profile={profile}
          patch={onApply}
          onGoTab={(t) => onGoTab?.(t)}
        />
      )}

      {/* ── Bio writer + banner generator: always available ── */}
      <div className="grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="h-4 w-4 text-amber-400" /> AI bio writer — 100 Visual Bucs
          </h4>
          <p className="mb-2 text-xs text-white/50">A few facts in, a {verticalMeta.label.toLowerCase()}-ready bio out.</p>
          <textarea
            value={bioFacts}
            onChange={(e) => setBioFacts(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Wins, style, what you're known for, where you're headed…"
            className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void writeBio()}
              disabled={bioLoading}
              className="rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              {bioLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Write my bio"}
            </button>
            {bioDraft && (
              <button
                onClick={() => { onApply({ bio: bioDraft }); toast({ title: "Bio set", description: "Looking sharp." }); }}
                className="rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-bold text-emerald-300"
              >
                Use this bio
              </button>
            )}
          </div>
          {bioDraft && <p className="mt-2 rounded-lg bg-black/30 p-3 text-sm text-white/80">{bioDraft}</p>}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-white">
            <ImageIcon className="h-4 w-4 text-amber-400" /> AI banner art — 200 Visual Bucs
          </h4>
          <p className="mb-2 text-xs text-white/50">
            Cinematic gold-and-black banner painted from your vibe{palette.length > 0 ? " and stolen palette" : ""}.
          </p>
          <button
            onClick={() => void generateBanner()}
            disabled={bannerLoading}
            className="flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-40"
          >
            {bannerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Generate banner
          </button>
          {profile.banner_url && (
            <img src={profile.banner_url} alt="Banner preview" className="mt-3 h-24 w-full rounded-lg object-cover" />
          )}
          <Link href="/artist-setup" className="mt-3 inline-block text-xs text-white/40 underline">
            Fine-tune everything in the manual editor →
          </Link>
        </div>
      </div>
    </div>
  );
}
