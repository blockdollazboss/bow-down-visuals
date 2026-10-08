import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Save, Eye, Wand2, Palette, LayoutGrid, ListVideo, Share2,
  Check, Plus, Trash2, ChevronUp, ChevronDown, EyeOff, GripVertical,
  Upload, Sparkles, Copy, ExternalLink, PartyPopper, X,
} from "lucide-react";
import type {
  CreatorProfile, ProfileSection, SectionType, ThemeConfig, VerticalId, FontId,
} from "@/lib/artist-profiles";
import {
  VERTICALS, THEME_PRESETS, SAFE_FONTS, SECTION_TYPE_LABELS,
  emptyProfile, fetchMyProfile, saveMyProfile, createProfile,
  presetById, themeVars, isValidHex, profileUrl,
} from "@/lib/artist-profiles";
import AiPageDesigner from "@/components/artist/ai-page-designer";
import { GetPaidChecklist } from "@/components/artist/get-paid-checklist";
import { HeroSection, ProfileSections } from "@/components/artist/profile-sections";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Profile editor — /artist-setup (coordinator wires the route) ─────────
   Tabs: AI Designer (DEFAULT), Basics, Theme, Sections, Content, Publish.
   Manual editing is the advanced path; the AI designer is the front door. */

/* Difficulty ladder (standing): the AI Designer IS the 1-star path —
   one sentence in, finished page out. 2–3 stars = theme presets + guided
   tweaks. 4–6 stars = full manual (colors, fonts, sections, custom blocks).
   Publish and Save are NEVER gated. */
const TABS = [
  { id: "designer", label: "AI Designer", icon: Wand2, stars: 1 },
  { id: "basics", label: "Basics", icon: Sparkles, stars: 1 },
  { id: "theme", label: "Theme", icon: Palette, stars: 2 },
  { id: "sections", label: "Sections", icon: LayoutGrid, stars: 4 },
  { id: "content", label: "Content", icon: ListVideo, stars: 4 },
  { id: "publish", label: "Publish", icon: Share2, stars: 1 },
] as const;

type TabId = (typeof TABS)[number]["id"];

async function uploadImage(kind: "avatar" | "banner" | "background", file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch("/api/ai-page-designer/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.url as string;
}

function ImageField({
  label, value, kind, onChange,
}: { label: string; value: string | null; kind: "avatar" | "banner" | "background"; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const url = await uploadImage(kind, f);
      onChange(url);
      toast({ title: "Uploaded", description: "Looking sharp." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className={`object-cover ${kind === "avatar" ? "h-16 w-16 rounded-full" : "h-16 w-28 rounded-lg"}`} />
        ) : (
          <span className={`flex items-center justify-center bg-white/5 text-white/30 ${kind === "avatar" ? "h-16 w-16 rounded-full" : "h-16 w-28 rounded-lg"}`}>
            <Upload className="h-5 w-5" />
          </span>
        )}
        <div className="flex flex-1 flex-col gap-2">
          <input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste an image URL…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-fit items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload image
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  );
}

/* ─── The reveal moment ─── */
function RevealOverlay({ profile, onClose }: { profile: CreatorProfile; onClose: () => void }) {
  const url = profileUrl(profile);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur">
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/50 hover:text-white">
        <X className="h-6 w-6" />
      </button>
      <div className="w-full max-w-lg rounded-3xl border border-amber-400/40 bg-gradient-to-b from-[#1a1408] to-black p-8 text-center shadow-[0_0_80px_rgba(212,175,55,0.25)]">
        <PartyPopper className="mx-auto h-12 w-12 text-amber-400" />
        <h2 className="mt-4 font-black text-3xl text-white" style={{ fontFamily: "'Cinzel', serif" }}>
          Your cheat code is LIVE.
        </h2>
        <p className="mt-3 text-white/70">
          Profile, catalog, store, tip jar — <strong className="text-amber-300">all in one place</strong>.
          How is all of this in one place? That's the cheat code. It should feel illegal. 🦈
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-2 pl-4">
          <span className="flex-1 truncate text-left text-sm text-white/70">{url}</span>
          <button onClick={() => void copy()} className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-black">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={`/artist/${profile.slug}`} className="flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
            <ExternalLink className="h-4 w-4" /> See it live
          </Link>
          <button onClick={onClose} className="rounded-full border border-white/15 px-6 py-2.5 text-sm font-semibold text-white/70">
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ArtistSetup() {
  usePageTitle("Artist Setup — Bow Down Visuals", "Build your creator profile: AI page designer, themes, sections, and publishing.");
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>("designer");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState(false);
  const wasPublic = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchMyProfile();
        if (cancelled) return;
        if (p) { setProfile(p); setExists(true); wasPublic.current = p.is_public; }
        else setProfile(emptyProfile());
      } catch {
        if (!cancelled) setProfile(emptyProfile());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = (p: Partial<CreatorProfile>) => setProfile((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async (p?: Partial<CreatorProfile>) => {
    if (!profile || saving) return;
    const next = { ...profile, ...(p ?? {}) };
    setSaving(true);
    try {
      const saved = exists ? await saveMyProfile(next) : await createProfile(next);
      setProfile(saved);
      setExists(true);
      const justPublished = saved.is_public && !wasPublic.current;
      wasPublic.current = saved.is_public;
      toast({ title: "Saved", description: justPublished ? "You're live. Go look at yourself." : "All changes saved." });
      if (justPublished) setReveal(true);
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setSaving(false);
    }
  };

  /* One-click setup from the artist vault: name + photo prefilled. */
  const importFromVault = async () => {
    try {
      const res = await fetch("/api/artist-vaults");
      const data = await res.json();
      const vaults = data.vaults ?? data ?? [];
      const v = Array.isArray(vaults) ? vaults[0] : null;
      if (!v) {
        toast({ title: "No vault yet", description: "Create an artist in the Artist Vault first, then import in one click." });
        return;
      }
      patch({
        display_name: profile?.display_name || v.artist_name || "",
        avatar_url: profile?.avatar_url || v.reference_image_url || null,
      });
      toast({ title: "Imported from your vault", description: "Name and photo dropped in. The rest is yours." });
    } catch {
      toast({ title: "Couldn't reach the vault", description: "Try again in a moment." });
    }
  };

  if (loading || !profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl" style={{ fontFamily: "'Cinzel', serif" }}>
            Your Page, Your Empire
          </h1>
          <p className="mt-1 text-sm text-white/60">
            The AI designer does the heavy lifting. Manual controls are here when you want them.
          </p>
        </div>
        <div className="flex gap-2">
          {!exists && (
            <button
              onClick={() => void importFromVault()}
              className="flex items-center gap-2 rounded-full border border-amber-400/40 px-4 py-2 text-sm font-bold text-amber-300 transition hover:scale-105"
            >
              <Sparkles className="h-4 w-4" /> One-click setup from vault
            </button>
          )}
          {profile.slug && (
            <Link href={`/artist/${profile.slug}`} className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition hover:text-white">
              <Eye className="h-4 w-4" /> View page
            </Link>
          )}
        </div>
      </div>

      {/* Tabs — mobile: horizontal scroll */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            {...(t.stars > 1 ? { "data-min-stars": t.stars } : {})}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              tab === t.id ? "bg-amber-400 text-black" : "text-white/60 hover:text-white"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
            {t.id === "designer" && <span className="rounded-full bg-black/20 px-1.5 text-[10px] font-black">AI</span>}
          </button>
        ))}
      </div>

      {tab === "designer" && (
        <AiPageDesigner profile={profile} onApply={(p) => void save(p)} onGoTab={(t) => setTab(t)} />
      )}
      {tab === "basics" && <BasicsTab profile={profile} patch={patch} />}
      {tab === "theme" && <ThemeTab profile={profile} patch={patch} />}
      {tab === "sections" && <SectionsTab profile={profile} patch={patch} />}
      {tab === "content" && <ContentTab profile={profile} patch={patch} />}
      {tab === "publish" && (
        <PublishTab
          profile={profile}
          patch={patch}
          onPublish={() => void save({ is_public: true })}
          onReveal={() => setReveal(true)}
          onGoTab={(t) => setTab(t)}
        />
      )}

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/80 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4">
          <span className="text-xs text-white/50">
            {profile.is_public ? "🟢 Public" : "⚪ Draft"} · {profile.slug ? `/artist/${profile.slug}` : "no link yet"}
          </span>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      </div>

      {reveal && <RevealOverlay profile={profile} onClose={() => setReveal(false)} />}
    </div>
  );
}

/* ─── BASICS ─── */
function BasicsTab({ profile, patch }: { profile: CreatorProfile; patch: (p: Partial<CreatorProfile>) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Display name</label>
          <input
            value={profile.display_name}
            onChange={(e) => patch({ display_name: e.target.value })}
            placeholder="Your stage name"
            maxLength={80}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Link slug</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-white/40">/artist/</span>
            <input
              value={profile.slug}
              onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              placeholder="your-name"
              maxLength={60}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Custom domain <span className="normal-case text-white/30">(optional)</span></label>
        <input
          value={profile.custom_domain ?? ""}
          onChange={(e) => patch({ custom_domain: e.target.value.trim() || null })}
          placeholder="you.com"
          maxLength={120}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
        />
        <p className="mt-1 text-xs text-white/40">Shares and badges point here first — your world, not ours.</p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-white/50">Your lane</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {VERTICALS.map((v) => (
            <button
              key={v.id}
              onClick={() => patch({ vertical: v.id as VerticalId })}
              className={`rounded-xl border p-2.5 text-center transition ${
                profile.vertical === v.id ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-white/5 hover:border-white/25"
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
          Bio — bold, <em>italic</em>, [links](https://…), and lists supported
        </label>
        <textarea
          value={profile.bio}
          onChange={(e) => patch({ bio: e.target.value })}
          rows={5}
          maxLength={1200}
          placeholder={"**" + (profile.display_name || "You") + "** doesn't do boring.\n\n- The wins\n- The vibe\n- What's next"}
          className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ImageField label="Profile photo" kind="avatar" value={profile.avatar_url} onChange={(url) => patch({ avatar_url: url })} />
        <ImageField label="Banner" kind="banner" value={profile.banner_url} onChange={(url) => patch({ banner_url: url })} />
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
        <span>
          <span className="block text-sm font-bold text-white">Tip jar</span>
          <span className="text-xs text-white/50">Let fans drop you something extra.</span>
        </span>
        <input
          type="checkbox"
          checked={profile.tip_jar_enabled}
          onChange={(e) => patch({ tip_jar_enabled: e.target.checked })}
          className="h-5 w-5 accent-amber-400"
        />
      </label>
    </div>
  );
}

/* ─── THEME ─── */
const COLOR_FIELDS: { key: keyof ThemeConfig["colors"]; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "primary", label: "Primary (gold)" },
  { key: "accent", label: "Accent" },
  { key: "text", label: "Text" },
  { key: "mutedText", label: "Muted text" },
  { key: "cardBg", label: "Card" },
  { key: "border", label: "Border" },
];

function ThemeTab({ profile, patch }: { profile: CreatorProfile; patch: (p: Partial<CreatorProfile>) => void }) {
  const theme = profile.theme_config;
  const setColor = (key: keyof ThemeConfig["colors"], v: string) => {
    if (!isValidHex(v)) return;
    patch({ theme_id: "custom", theme_config: { ...theme, themeId: "custom", colors: { ...theme.colors, [key]: v } } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Presets — gold/black luxury</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.themeId}
              onClick={() => patch({ theme_id: p.themeId, theme_config: { ...p } })}
              className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${
                theme.themeId === p.themeId ? "border-amber-400" : "border-white/10"
              }`}
              style={{ background: `linear-gradient(135deg, ${p.colors.background} 55%, ${p.colors.primary} 160%)` }}
            >
              <div className="mb-2 flex gap-1">
                {[p.colors.primary, p.colors.accent, p.colors.text].map((c) => (
                  <span key={c} className="h-5 w-5 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="text-sm font-bold text-white">{p.name}</div>
              <div className="text-xs text-white/50">{p.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 4+ stars: full manual color control */}
      <div data-min-stars="4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-white/50">Custom colors</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLOR_FIELDS.map(({ key, label }) => (
            <label key={key} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="mb-1 block text-xs text-white/60">{label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme.colors[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
                />
                <span className="font-mono text-xs text-white/70">{theme.colors[key]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* 4+ stars: full manual font control */}
      <div className="grid gap-4 sm:grid-cols-2" data-min-stars="4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Heading font</label>
          <select
            value={theme.fonts.heading}
            onChange={(e) => patch({ theme_id: "custom", theme_config: { ...theme, themeId: "custom", fonts: { ...theme.fonts, heading: e.target.value as FontId } } })}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none [&>option]:bg-black"
          >
            {SAFE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Body font</label>
          <select
            value={theme.fonts.body}
            onChange={(e) => patch({ theme_id: "custom", theme_config: { ...theme, themeId: "custom", fonts: { ...theme.fonts, body: e.target.value as FontId } } })}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none [&>option]:bg-black"
          >
            {SAFE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
          </select>
        </div>
      </div>

      {/* Guided tweaks (2-3 stars): banner layout */}
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Banner layout</label>
        <div className="flex max-w-xs gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          {(["full-bleed", "contained", "split"] as const).map((l) => (
            <button
              key={l}
              onClick={() => patch({ theme_config: { ...theme, banner: { ...theme.banner, layout: l } } })}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${theme.banner.layout === l ? "bg-amber-400 text-black" : "text-white/60"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 4+ stars: spacing + corners */}
      <div className="grid gap-4 sm:grid-cols-2" data-min-stars="4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Spacing</label>
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            {(["compact", "comfortable", "roomy"] as const).map((s) => (
              <button
                key={s}
                onClick={() => patch({ theme_config: { ...theme, spacing: s } })}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${theme.spacing === s ? "bg-amber-400 text-black" : "text-white/60"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Corners</label>
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
            {(["sharp", "rounded", "pill"] as const).map((c) => (
              <button
                key={c}
                onClick={() => patch({ theme_config: { ...theme, cornerRadius: c } })}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${theme.cornerRadius === c ? "bg-amber-400 text-black" : "text-white/60"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 flex justify-between text-xs font-bold uppercase tracking-widest text-white/50">
          <span>Banner overlay opacity</span>
          <span className="text-amber-300">{Math.round(theme.banner.overlayOpacity * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={85}
          value={Math.round(theme.banner.overlayOpacity * 100)}
          onChange={(e) => patch({ theme_config: { ...theme, banner: { ...theme.banner, overlayOpacity: Number(e.target.value) / 100 } } })}
          className="w-full accent-amber-400"
        />
      </div>

      {/* Live theme preview */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-white/50">Live preview</h3>
        <div className="overflow-hidden rounded-2xl border border-white/10" style={themeVars(theme)}>
          <div style={{ backgroundColor: "var(--ap-bg)", color: "var(--ap-text)", fontFamily: "var(--ap-body-font)" }}>
            <HeroSection profile={profile} />
            <ProfileSections profile={profile} mode="preview" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── SECTIONS — drag to reorder (HTML5) + up/down buttons (mobile-clean) ─── */
function SectionsTab({ profile, patch }: { profile: CreatorProfile; patch: (p: Partial<CreatorProfile>) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [newType, setNewType] = useState<SectionType>("videos");

  const move = (id: string, dir: -1 | 1) => {
    const sections = [...profile.sections];
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    [sections[i], sections[j]] = [sections[j]!, sections[i]!];
    patch({ sections });
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const sections = [...profile.sections];
    const from = sections.findIndex((s) => s.id === dragId);
    const to = sections.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = sections.splice(from, 1);
    sections.splice(to, 0, moved!);
    patch({ sections });
    setDragId(null);
  };

  const add = () => {
    const id = `${newType}-${Date.now()}`;
    patch({ sections: [...profile.sections, { id, type: newType, title: SECTION_TYPE_LABELS[newType], visible: true }] });
  };

  const remove = (id: string) => patch({ sections: profile.sections.filter((s) => s.id !== id) });
  const rename = (id: string, title: string) =>
    patch({ sections: profile.sections.map((s) => (s.id === id ? { ...s, title } : s)) });
  const toggle = (id: string) =>
    patch({ sections: profile.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)) });

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">
        Drag to reorder — or use the arrows. Every section type is available to every creator, no matter your lane.
      </p>
      <div className="space-y-2">
        {profile.sections.map((s: ProfileSection) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(s.id)}
            onDragEnd={() => setDragId(null)}
            className={`flex items-center gap-2 rounded-xl border bg-white/5 p-3 transition ${
              dragId === s.id ? "border-amber-400 opacity-60" : "border-white/10"
            } ${s.visible ? "" : "opacity-50"}`}
          >
            <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-white/30" />
            <div className="min-w-0 flex-1">
              <input
                value={s.title}
                onChange={(e) => rename(s.id, e.target.value)}
                maxLength={80}
                className="w-full bg-transparent text-sm font-bold text-white outline-none"
              />
              <span className="text-xs text-white/40">{SECTION_TYPE_LABELS[s.type]}{s.type === "hero" ? " · always first" : ""}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => move(s.id, -1)} aria-label="Move up" className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button onClick={() => move(s.id, 1)} aria-label="Move down" className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button onClick={() => toggle(s.id)} aria-label={s.visible ? "Hide" : "Show"} className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                {s.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              {s.type !== "hero" && (
                <button onClick={() => remove(s.id)} aria-label="Remove section" className="rounded p-1.5 text-white/50 hover:bg-red-500/20 hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as SectionType)}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none [&>option]:bg-black"
        >
          {(Object.keys(SECTION_TYPE_LABELS) as SectionType[])
            .filter((t) => t !== "hero")
            .map((t) => <option key={t} value={t}>{SECTION_TYPE_LABELS[t]}</option>)}
        </select>
        <button
          onClick={add}
          className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold text-black transition hover:scale-105"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
    </div>
  );
}

/* ─── CONTENT — featured media, socials, top creators, media kit, schedule ─── */
const SOCIAL_PLATFORMS = ["instagram", "tiktok", "youtube", "x", "twitch", "spotify", "website"];

function ContentTab({ profile, patch }: { profile: CreatorProfile; patch: (p: Partial<CreatorProfile>) => void }) {
  const fm = profile.featured_media;
  const [newCreator, setNewCreator] = useState("");
  const [newSlot, setNewSlot] = useState({ day: "", time: "" });

  const setFm = (p: Partial<NonNullable<CreatorProfile["featured_media"]>>) =>
    patch({ featured_media: { kind: "video", id: `featured-${Date.now()}`, ...(fm ?? {}), ...p } });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-white/50">Featured media — the hero</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/50">Kind</label>
            <select
              value={fm?.kind ?? "video"}
              onChange={(e) => setFm({ kind: e.target.value as "track" | "video" | "episode" })}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none [&>option]:bg-black"
            >
              <option value="track">Track</option>
              <option value="video">Video</option>
              <option value="episode">Episode</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Title</label>
            <input
              value={fm?.title ?? ""}
              onChange={(e) => setFm({ title: e.target.value })}
              placeholder="My latest drop"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Media URL</label>
            <input
              value={fm?.url ?? ""}
              onChange={(e) => setFm({ url: e.target.value })}
              placeholder="https://…"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Thumbnail URL</label>
            <input
              value={fm?.thumbnailUrl ?? ""}
              onChange={(e) => setFm({ thumbnailUrl: e.target.value })}
              placeholder="https://…"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-white/40">Fans tap to play — never autoplay with sound. That's the honest way.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Merch shelf — link every product</h3>
        <p className="mb-2 text-xs text-white/40">Each product links to its page. No link = falls back to your shop.</p>
        <div className="space-y-2">
          {(profile.merch_items ?? []).map((m, i) => (
            <div key={m.id} className="grid gap-2 rounded-lg bg-black/30 p-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={m.title}
                onChange={(e) => patch({ merch_items: (profile.merch_items ?? []).map((x, j) => j === i ? { ...x, title: e.target.value } : x) })}
                placeholder="Product name"
                className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              <input
                value={m.url ?? ""}
                onChange={(e) => patch({ merch_items: (profile.merch_items ?? []).map((x, j) => j === i ? { ...x, url: e.target.value } : x) })}
                placeholder="Product URL (https://… or /my-shop/…)"
                className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              <div className="flex gap-2">
                <input
                  value={m.price ?? ""}
                  onChange={(e) => patch({ merch_items: (profile.merch_items ?? []).map((x, j) => j === i ? { ...x, price: e.target.value } : x) })}
                  placeholder="$29"
                  className="w-20 rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
                />
                <button
                  onClick={() => patch({ merch_items: (profile.merch_items ?? []).filter((_, j) => j !== i) })}
                  aria-label="Remove product"
                  className="rounded p-1.5 text-white/40 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => patch({ merch_items: [...(profile.merch_items ?? []), { id: `merch-${Date.now()}`, title: "" }] })}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70"
        >
          <Plus className="h-3.5 w-3.5" /> Add product
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Events — every date links out</h3>
        <p className="mb-2 text-xs text-white/40">Each date links to its event page. No link = falls back to /tour.</p>
        <div className="space-y-2">
          {(profile.events ?? []).map((e, i) => (
            <div key={e.id} className="grid gap-2 rounded-lg bg-black/30 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input
                value={e.title}
                onChange={(e2) => patch({ events: (profile.events ?? []).map((x, j) => j === i ? { ...x, title: e2.target.value } : x) })}
                placeholder="Event name"
                className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              <input
                value={e.date ?? ""}
                onChange={(e2) => patch({ events: (profile.events ?? []).map((x, j) => j === i ? { ...x, date: e2.target.value } : x) })}
                placeholder="Oct 24 · 8pm"
                className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              <input
                value={e.url ?? ""}
                onChange={(e2) => patch({ events: (profile.events ?? []).map((x, j) => j === i ? { ...x, url: e2.target.value } : x) })}
                placeholder="Event URL"
                className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => patch({ events: (profile.events ?? []).filter((_, j) => j !== i) })}
                aria-label="Remove event"
                className="rounded p-1.5 text-white/40 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => patch({ events: [...(profile.events ?? []), { id: `event-${Date.now()}`, title: "" }] })}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70"
        >
          <Plus className="h-3.5 w-3.5" /> Add date
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Social links</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <div key={platform} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs capitalize text-white/50">{platform}</span>
              <input
                value={profile.social_links[platform] ?? ""}
                onChange={(e) => patch({ social_links: { ...profile.social_links, [platform]: e.target.value } })}
                placeholder="https://…"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Top creators — the MySpace strip</h3>
        <p className="mb-2 text-xs text-white/40">Their avatars link straight to their /artist pages. Rep your circle.</p>
        <div className="flex flex-wrap gap-2">
          {profile.top_creators.map((s) => (
            <span key={s} className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
              @{s}
              <button onClick={() => patch({ top_creators: profile.top_creators.filter((x) => x !== s) })} aria-label={`Remove ${s}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newCreator}
            onChange={(e) => setNewCreator(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCreator && !profile.top_creators.includes(newCreator)) {
                patch({ top_creators: [...profile.top_creators, newCreator] });
                setNewCreator("");
              }
            }}
            placeholder="their-slug"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
          <button
            onClick={() => {
              if (newCreator && !profile.top_creators.includes(newCreator)) {
                patch({ top_creators: [...profile.top_creators, newCreator] });
                setNewCreator("");
              }
            }}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black"
          >
            Add
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Media kit — for the influencer lane</h3>
        <p className="mb-2 text-xs text-white/40">Brands see this first. Numbers talk.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([["followers", "Followers"], ["avgViews", "Avg. views"], ["engagement", "Engagement"]] as const).map(([k, label]) => (
            <div key={k}>
              <label className="mb-1 block text-xs text-white/50">{label}</label>
              <input
                value={profile.media_kit?.[k] ?? ""}
                onChange={(e) => patch({ media_kit: { ...(profile.media_kit ?? {}), [k]: e.target.value } })}
                placeholder={k === "followers" ? "250K" : k === "avgViews" ? "48K" : "6.2%"}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs text-white/50">Audience note</label>
          <input
            value={profile.media_kit?.audienceNote ?? ""}
            onChange={(e) => patch({ media_kit: { ...(profile.media_kit ?? {}), audienceNote: e.target.value } })}
            placeholder="e.g. 68% US, 18–34, obsessed with streetwear drops"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs text-white/50">Rates (label — price, one per line)</label>
          <textarea
            value={(profile.media_kit?.rates ?? []).map((r) => `${r.label} — ${r.price}`).join("\n")}
            onChange={(e) => {
              const rates = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
                const [label, ...rest] = l.split("—");
                return { label: (label ?? "").trim(), price: rest.join("—").trim() };
              }).filter((r) => r.label);
              patch({ media_kit: { ...(profile.media_kit ?? {}), rates } });
            }}
            rows={3}
            placeholder={"Dedicated video — $1,500\n60s integration — $800"}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs text-white/50">Collab contact email</label>
          <input
            value={profile.media_kit?.contactEmail ?? ""}
            onChange={(e) => patch({ media_kit: { ...(profile.media_kit ?? {}), contactEmail: e.target.value } })}
            placeholder="collabs@you.com"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/50">Stream schedule — for the gaming lane</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={profile.stream_schedule?.isLive ?? false}
              onChange={(e) => patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), isLive: e.target.checked } })}
              className="h-4 w-4 accent-red-500"
            />
            I'm live right now
          </label>
          <div>
            <label className="mb-1 block text-xs text-white/50">Live URL</label>
            <input
              value={profile.stream_schedule?.liveUrl ?? ""}
              onChange={(e) => patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), liveUrl: e.target.value } })}
              placeholder="https://…"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Platform</label>
            <input
              value={profile.stream_schedule?.platform ?? ""}
              onChange={(e) => patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), platform: e.target.value } })}
              placeholder="Twitch"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
          </div>
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs text-white/50">Next stream</label>
          <input
            value={profile.stream_schedule?.nextStream ?? ""}
            onChange={(e) => patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), nextStream: e.target.value } })}
            placeholder="Friday 8pm ET — ranked grind"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <div className="mt-2 space-y-1">
          {(profile.stream_schedule?.schedule ?? []).map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-1.5 text-sm text-white/80">
              <span>{s.day} · {s.time}{s.label ? ` — ${s.label}` : ""}</span>
              <button
                onClick={() => patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), schedule: (profile.stream_schedule?.schedule ?? []).filter((_, j) => j !== i) } })}
                aria-label="Remove slot"
                className="text-white/40 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newSlot.day}
            onChange={(e) => setNewSlot({ ...newSlot, day: e.target.value })}
            placeholder="Friday"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
          <input
            value={newSlot.time}
            onChange={(e) => setNewSlot({ ...newSlot, time: e.target.value })}
            placeholder="8pm ET"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
          <button
            onClick={() => {
              if (newSlot.day && newSlot.time) {
                patch({ stream_schedule: { ...(profile.stream_schedule ?? {}), schedule: [...(profile.stream_schedule?.schedule ?? []), { ...newSlot }] } });
                setNewSlot({ day: "", time: "" });
              }
            }}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── PUBLISH ─── */
function PublishTab({
  profile, patch, onPublish, onReveal, onGoTab,
}: {
  profile: CreatorProfile;
  patch: (p: Partial<CreatorProfile>) => void;
  onPublish: () => void;
  onReveal: () => void;
  onGoTab: (tab: "content" | "publish" | "basics") => void;
}) {
  const url = profileUrl(profile);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };

  return (
    <div className="space-y-5">
      <GetPaidChecklist profile={profile} patch={patch} onGoTab={onGoTab} />

      <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-6 text-center">
        <h3 className="text-xl font-black text-white" style={{ fontFamily: "'Cinzel', serif" }}>
          {profile.is_public ? "You're live. Act like it." : "One tap from legendary."}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          {profile.is_public
            ? "Your page is out in the world. Share it like you mean it."
            : "Flip the switch and your profile, catalog, and tip jar go live — all in one place."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {!profile.is_public ? (
            <button
              onClick={onPublish}
              disabled={!profile.slug || !profile.display_name}
              className="flex items-center gap-2 rounded-full bg-amber-400 px-8 py-3 font-bold text-black transition hover:scale-105 disabled:opacity-40"
            >
              <Share2 className="h-4 w-4" /> Publish my page
            </button>
          ) : (
            <>
              <button
                onClick={() => patch({ is_public: false })}
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white/70"
              >
                Unpublish
              </button>
              <button
                onClick={onReveal}
                className="rounded-full bg-amber-400 px-6 py-3 text-sm font-bold text-black transition hover:scale-105"
              >
                Replay the reveal ✨
              </button>
            </>
          )}
        </div>
        {(!profile.slug || !profile.display_name) && !profile.is_public && (
          <p className="mt-2 text-xs text-red-300">Add a display name and link slug in Basics first.</p>
        )}
      </div>

      {profile.slug && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/50">Your link</label>
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-white/80">{url}</span>
            <button onClick={() => void copy()} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <Link href={`/artist/${profile.slug}`} className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-black">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Link>
          </div>
          {profile.referral_code && (
            <p className="mt-2 text-xs text-white/40">
              Shares carry <span className="font-mono text-amber-300">?ref={profile.referral_code}</span> — new fans earn you referral credit.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { n: profile.follower_count.toLocaleString(), l: "followers" },
          { n: profile.total_plays.toLocaleString(), l: "total plays" },
          { n: String(profile.sections.filter((s) => s.visible).length), l: "live sections" },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
            <div className="text-2xl font-black text-amber-300">{s.n}</div>
            <div className="text-xs uppercase tracking-widest text-white/50">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
