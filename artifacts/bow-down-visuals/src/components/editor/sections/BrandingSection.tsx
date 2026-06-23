import { useRef, useState } from "react";
import {
  ImagePlus, X, Loader2, Tv2, LogOut, Droplets, Type,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  INTRO_STYLE_DEFS, OUTRO_CTA_PRESETS,
  type EditorSettings,
  type IntroCardSettings, type OutroCardSettings,
  type BrandingWatermarkSettings, type TitleOverlaySettings,
  type IntroCardPreset, type CardDuration,
} from "@/lib/editor-settings";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";

interface Props {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  artistName?: string | null;
  songTitle?: string | null;
}

const DURATION_OPTIONS = [
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
];

const POSITION_OPTIONS = [
  { value: "top-left",     label: "↖ Top Left" },
  { value: "top-right",    label: "↗ Top Right" },
  { value: "bottom-left",  label: "↙ Bottom Left" },
  { value: "bottom-right", label: "↘ Bottom Right" },
];

const OPACITY_OPTIONS = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

const SIZE_OPTIONS = [
  { value: "small",  label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large",  label: "Large" },
];

const TITLE_STYLE_OPTIONS = [
  { value: "clean-white", label: "Clean White" },
  { value: "luxury-gold", label: "Luxury Gold" },
  { value: "minimal",     label: "Minimal" },
];

function StylePresetGrid({
  value,
  onChange,
}: {
  value: IntroCardPreset;
  onChange: (v: IntroCardPreset) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {INTRO_STYLE_DEFS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`text-left rounded-xl border bg-gradient-to-br p-3 transition-all ${
              active ? `${p.accent} opacity-100` : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`text-xs font-black ${active ? "text-white" : "text-white/60"}`}>{p.name}</p>
            <p className="text-[10px] text-white/35 mt-0.5 leading-relaxed">{p.description}</p>
          </button>
        );
      })}
    </div>
  );
}

export function BrandingSection({ settings, setSettings, artistName, songTitle }: Props) {
  const b = settings.branding;
  const { getAccessToken } = useAuth();
  const [wmUploading, setWmUploading] = useState(false);
  const [wmError, setWmError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showLogoPreview, setShowLogoPreview] = useState(true);

  function setBranding<K extends keyof typeof b>(key: K, value: (typeof b)[K]) {
    setSettings({ ...settings, branding: { ...b, [key]: value } });
  }
  function setIntro(patch: Partial<IntroCardSettings>) {
    setBranding("introCard", { ...b.introCard, ...patch });
  }
  function setOutro(patch: Partial<OutroCardSettings>) {
    setBranding("outroCard", { ...b.outroCard, ...patch });
  }
  function setWm(patch: Partial<BrandingWatermarkSettings>) {
    setBranding("watermark", { ...b.watermark, ...patch });
  }
  function setTitle(patch: Partial<TitleOverlaySettings>) {
    setBranding("titleOverlay", { ...b.titleOverlay, ...patch });
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) { setWmError("Upload a PNG, JPG, or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setWmError("Image must be under 5 MB."); return; }
    setWmUploading(true);
    setWmError(null);
    try {
      const token = await getAccessToken();
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/upload-watermark", {
        method: "POST",
        headers: { "Content-Type": file.type, Authorization: `Bearer ${token ?? ""}` },
        body: buf,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      setWm({ customLogoUrl: url });
    } catch (err) {
      setWmError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setWmUploading(false);
    }
  }

  const ic = b.introCard;
  const oc = b.outroCard;
  const wm = b.watermark;
  const to = b.titleOverlay;

  return (
    <div className="space-y-5">

      {/* ── Intro Card ── */}
      <EditorCard
        title="Intro Card"
        subtitle="Title card shown before the first clip"
        icon={<Tv2 className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white/80">Enable Intro Card</p>
              <p className="text-[11px] text-white/35">Prepends a branded title card to the video</p>
            </div>
            <Switch
              checked={ic.enabled}
              onCheckedChange={(v) => setIntro({ enabled: v })}
              data-testid="branding-intro-toggle"
            />
          </div>

          {ic.enabled && (
            <>
              <StylePresetGrid value={ic.stylePreset} onChange={(v) => setIntro({ stylePreset: v })} />

              <div className="space-y-3">
                <Field label="Artist Name">
                  <TextInput
                    value={ic.artistName || artistName || ""}
                    placeholder={artistName ?? "Artist name…"}
                    onChange={(v) => setIntro({ artistName: v })}
                    testId="branding-intro-artist"
                  />
                </Field>
                <Field label="Song Title">
                  <TextInput
                    value={ic.songTitle || songTitle || ""}
                    placeholder={songTitle ?? "Song title…"}
                    onChange={(v) => setIntro({ songTitle: v })}
                    testId="branding-intro-song"
                  />
                </Field>
                <Field label="Subtitle / Tagline">
                  <TextInput
                    value={ic.tagline}
                    placeholder="e.g. Off the upcoming EP · Out Now"
                    onChange={(v) => setIntro({ tagline: v })}
                    testId="branding-intro-tagline"
                  />
                </Field>
              </div>

              <Field label="Duration">
                <Segmented
                  value={String(ic.duration)}
                  options={DURATION_OPTIONS}
                  onChange={(v) => setIntro({ duration: Number(v) as CardDuration })}
                />
              </Field>
            </>
          )}
        </div>
      </EditorCard>

      {/* ── Outro Card ── */}
      <EditorCard
        title="Outro Card"
        subtitle="Closing card shown after the last clip"
        icon={<LogOut className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white/80">Enable Outro Card</p>
              <p className="text-[11px] text-white/35">Appends a branded closing card to the video</p>
            </div>
            <Switch
              checked={oc.enabled}
              onCheckedChange={(v) => setOutro({ enabled: v })}
              data-testid="branding-outro-toggle"
            />
          </div>

          {oc.enabled && (
            <>
              <StylePresetGrid value={oc.stylePreset} onChange={(v) => setOutro({ stylePreset: v })} />

              <div className="space-y-3">
                <Field label="Main Text">
                  <TextInput
                    value={oc.textLine1}
                    placeholder="e.g. Thank you for watching"
                    onChange={(v) => setOutro({ textLine1: v })}
                    testId="branding-outro-line1"
                  />
                </Field>
                <Field label="Second Line">
                  <TextInput
                    value={oc.textLine2}
                    placeholder="e.g. Follow @yourtag for more"
                    onChange={(v) => setOutro({ textLine2: v })}
                    testId="branding-outro-line2"
                  />
                </Field>
              </div>

              <Field label="Call to Action">
                <div className="grid grid-cols-2 gap-2">
                  {OUTRO_CTA_PRESETS.map((cta) => {
                    const active = oc.ctaPreset === cta.id;
                    return (
                      <button
                        key={cta.id}
                        type="button"
                        onClick={() => setOutro({ ctaPreset: cta.id })}
                        className={`text-left rounded-lg border px-3 py-2 text-xs transition-all ${
                          active
                            ? "border-primary/60 bg-primary/[0.07] text-white font-semibold"
                            : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20"
                        }`}
                      >
                        {cta.label}
                      </button>
                    );
                  })}
                </div>
                {oc.ctaPreset === "custom" && (
                  <TextInput
                    value={oc.customCtaText}
                    placeholder="Type your custom call-to-action…"
                    onChange={(v) => setOutro({ customCtaText: v })}
                    testId="branding-outro-cta-custom"
                  />
                )}
              </Field>

              <Field label="Duration">
                <Segmented
                  value={String(oc.duration)}
                  options={DURATION_OPTIONS}
                  onChange={(v) => setOutro({ duration: Number(v) as CardDuration })}
                />
              </Field>
            </>
          )}
        </div>
      </EditorCard>

      {/* ── Watermark & Logo ── */}
      <EditorCard
        title="Watermark & Logo"
        subtitle="Branded overlay burned into every frame of the video"
        icon={<Droplets className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white/80">Enable Watermark</p>
              <p className="text-[11px] text-white/35">Show a logo/watermark over the video</p>
            </div>
            <Switch
              checked={wm.enabled}
              onCheckedChange={(v) => setWm({ enabled: v })}
              data-testid="branding-wm-toggle"
            />
          </div>

          {wm.enabled && (
            <>
              {/* BDV watermark toggle */}
              <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-white/70">Bow Down Visuals watermark</p>
                  <p className="text-[10px] text-white/30">Use the official BDV logo</p>
                </div>
                <Switch
                  checked={wm.bdvWatermark}
                  onCheckedChange={(v) => setWm({ bdvWatermark: v })}
                  data-testid="branding-wm-bdv"
                />
              </div>

              {/* Custom logo upload */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/50">Custom Logo</p>
                {wm.customLogoUrl && showLogoPreview && (
                  <div className="relative inline-block">
                    <img
                      src={wm.customLogoUrl}
                      alt="Custom logo"
                      className="h-14 object-contain rounded-lg border border-white/10 bg-white/5 p-1"
                    />
                    <button
                      type="button"
                      onClick={() => setWm({ customLogoUrl: null })}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center hover:bg-red-500/20"
                    >
                      <X className="h-3 w-3 text-white/60" />
                    </button>
                  </div>
                )}
                {wmError && <p className="text-xs text-red-400">{wmError}</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={wmUploading}
                  className="gap-2 border-white/15"
                  data-testid="branding-wm-upload"
                >
                  {wmUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {wmUploading ? "Uploading…" : wm.customLogoUrl ? "Replace logo" : "Upload your logo"}
                </Button>
              </div>

              {/* Position */}
              <Field label="Position">
                <div className="grid grid-cols-2 gap-2">
                  {POSITION_OPTIONS.map((p) => {
                    const active = wm.position === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setWm({ position: p.value as typeof wm.position })}
                        className={`rounded-lg border px-3 py-2 text-xs text-left transition-all ${
                          active
                            ? "border-primary/60 bg-primary/[0.07] text-white font-semibold"
                            : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Opacity + Size in a grid */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Opacity">
                  <Segmented
                    value={wm.opacity}
                    options={OPACITY_OPTIONS}
                    onChange={(v) => setWm({ opacity: v as typeof wm.opacity })}
                  />
                </Field>
                <Field label="Size">
                  <Segmented
                    value={wm.size}
                    options={SIZE_OPTIONS}
                    onChange={(v) => setWm({ size: v as typeof wm.size })}
                  />
                </Field>
              </div>
            </>
          )}
        </div>
      </EditorCard>

      {/* ── Title Overlay ── */}
      <EditorCard
        title="Title Overlay"
        subtitle="Artist name and song title shown during the video"
        icon={<Type className="h-4 w-4" />}
      >
        <div className="space-y-4">
          {/* Artist name */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white/70">Show Artist Name</p>
                <p className="text-[10px] text-white/30">Displayed in the lower-left for the first 5s of video</p>
              </div>
              <Switch
                checked={to.showArtistName}
                onCheckedChange={(v) => setTitle({ showArtistName: v })}
                data-testid="branding-title-artist-toggle"
              />
            </div>
            {to.showArtistName && (
              <TextInput
                value={to.artistNameText || artistName || ""}
                placeholder={artistName ?? "Artist name…"}
                onChange={(v) => setTitle({ artistNameText: v })}
                testId="branding-title-artist-text"
              />
            )}
          </div>

          {/* Song title */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white/70">Show Song Title</p>
                <p className="text-[10px] text-white/30">Displayed below the artist name for the first 5s of video</p>
              </div>
              <Switch
                checked={to.showSongTitle}
                onCheckedChange={(v) => setTitle({ showSongTitle: v })}
                data-testid="branding-title-song-toggle"
              />
            </div>
            {to.showSongTitle && (
              <TextInput
                value={to.songTitleText || songTitle || ""}
                placeholder={songTitle ?? "Song title…"}
                onChange={(v) => setTitle({ songTitleText: v })}
                testId="branding-title-song-text"
              />
            )}
          </div>

          {/* Style preset */}
          {(to.showArtistName || to.showSongTitle) && (
            <Field label="Text Style">
              <Segmented
                value={to.stylePreset}
                options={TITLE_STYLE_OPTIONS}
                onChange={(v) => setTitle({ stylePreset: v as typeof to.stylePreset })}
              />
            </Field>
          )}
        </div>
      </EditorCard>

    </div>
  );
}
