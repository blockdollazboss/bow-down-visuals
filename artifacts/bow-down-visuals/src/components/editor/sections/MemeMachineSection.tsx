import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Laugh, Loader2, Sparkles, Check, Upload, X, ImageIcon } from "lucide-react";
import type { CaptionStylePreset, EditorSettings } from "@/lib/editor-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useFileUpload } from "@/hooks/use-file-upload";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Meme Machine ─────────────────────────────────────────────────────────
   Visual Vibes editor rail tab. Describe the clip moment, pick a meme
   format — AI writes punchy meme captions (1 VB). One-click applies the
   winner to the timeline via the EXISTING caption system (bold meme style,
   timed to the opening seconds). Format presets tune caption style +
   suggested clip length; cutting stays manual on the timeline. */

const COST = 1;

interface MemeFormat {
  id: string;
  captionStyle: CaptionStylePreset;
  clipSecs: number;
  hint: string;
}

const MEME_FORMATS: MemeFormat[] = [
  { id: "top-bottom", captionStyle: "brutalist", clipSecs: 7, hint: "Classic top/bottom text" },
  { id: "reaction", captionStyle: "boxed", clipSecs: 5, hint: "Reaction zoom + punchline" },
  { id: "caption-pop", captionStyle: "viral-shorts", clipSecs: 8, hint: "Pop-word captions" },
  { id: "narrator", captionStyle: "clean-white", clipSecs: 10, hint: "Dry narrator voice" },
];

interface MemeMachineSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** When true, skips the internal header (a shell provides it). */
  bare?: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export function MemeMachineSection({ settings, setSettings, bare }: MemeMachineSectionProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [formatId, setFormatId] = useState("top-bottom");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);

  /* ── Custom meme template upload ── */
  const { upload, uploading: templateUploading, error: templateError, clearError: clearTemplateError } = useFileUpload();
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateLocalError, setTemplateLocalError] = useState<string | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const CUSTOM_FORMAT: MemeFormat = {
    id: "custom",
    captionStyle: "viral-shorts",
    clipSecs: 7,
    hint: "Custom uploaded template",
  };
  const allFormats = templateUrl ? [...MEME_FORMATS, CUSTOM_FORMAT] : MEME_FORMATS;

  const format = allFormats.find((f) => f.id === formatId) ?? MEME_FORMATS[0];

  async function handleTemplateFile(file: File) {
    clearTemplateError();
    setTemplateLocalError(null);
    if (!file.type.startsWith("image/")) {
      setTemplateLocalError("Please choose an image file (JPG, PNG, WebP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setTemplateLocalError("Image must be 10 MB or smaller.");
      return;
    }
    const url = await upload(file);
    if (url) {
      setTemplateUrl(url);
      setTemplateName(file.name);
      setFormatId("custom");
      setPicked(null);
      setApplied(false);
    }
  }

  function removeTemplate() {
    setTemplateUrl(null);
    setTemplateName("");
    if (formatId === "custom") setFormatId("top-bottom");
    if (templateInputRef.current) templateInputRef.current.value = "";
  }

  async function generate() {
    if (!context.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setPicked(null);
    setApplied(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/meme-machine/captions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Meme Machine",
        body: JSON.stringify({ context: context.trim(), format: format.hint }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        captions?: string[]; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.captions?.length) throw new Error(data.message || "Caption generation failed.");
      setCaptions(data.captions.slice(0, 5));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Caption generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function applyMeme() {
    if (picked === null) return;
    const text = captions[picked];
    const line = {
      id: `meme-${Date.now().toString(36)}`,
      startSec: 0,
      endSec: format.clipSecs,
      text,
    };
    setSettings({
      ...settings,
      captions: {
        ...settings.captions,
        enabled: true,
        stylePreset: format.captionStyle,
        lines: [line, ...settings.captions.lines],
      },
    });
    setApplied(true);
  }

  return (
    <div className="space-y-4">
      {!bare && (
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Laugh className="h-4 w-4 text-primary" />
          {t("videoEditor.memeMachineTitle", { defaultValue: "Meme Machine" })}
        </h3>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          {t("videoEditor.memeMachineDesc", {
            defaultValue: "Describe the moment, pick a meme format — AI writes the punchlines (1 VB). Apply drops the winner onto your timeline as styled captions.",
          })}
        </p>
      </div>
      )}

      {/* ── Upload your own meme template ── */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2 flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5" />
          {t("videoEditor.memeMachineUploadTitle", { defaultValue: "Upload your own template" })}
        </p>
        {templateUrl ? (
          <div className="flex items-center gap-3">
            <img
              src={templateUrl}
              alt={templateName}
              className="h-16 w-16 rounded-lg border border-primary/30 object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{templateName}</p>
              <p className="text-[10px] text-white/40 mt-0.5">
                {t("videoEditor.memeMachineCustomActive", { defaultValue: "Custom format selected — pick it below or keep a preset." })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => templateInputRef.current?.click()}
              className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-bold text-white/70 hover:border-primary/50 hover:text-white transition"
            >
              {t("videoEditor.memeMachineReplace", { defaultValue: "Replace" })}
            </button>
            <button
              type="button"
              onClick={removeTemplate}
              className="shrink-0 rounded-lg border border-white/15 p-1.5 text-white/50 hover:border-red-400/50 hover:text-red-300 transition"
              title={t("videoEditor.memeMachineRemove", { defaultValue: "Remove template" })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => templateInputRef.current?.click()}
            disabled={templateUploading}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-black/30 px-4 py-5 text-sm text-white/60 hover:border-primary/60 hover:text-white transition disabled:opacity-50"
          >
            {templateUploading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <ImageIcon className="h-4 w-4 text-primary" />
            )}
            {templateUploading
              ? t("videoEditor.memeMachineUploading", { defaultValue: "Uploading…" })
              : t("videoEditor.memeMachineUploadCta", { defaultValue: "Choose a meme image (JPG/PNG, ≤ 10 MB)" })}
          </button>
        )}
        <input
          ref={templateInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleTemplateFile(f);
          }}
        />
        {(templateError || templateLocalError) && (
          <p className="text-xs text-red-400 mt-2">{templateError ?? templateLocalError}</p>
        )}
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
          {t("videoEditor.memeMachineFormat", { defaultValue: "Meme format" })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {allFormats.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormatId(f.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${formatId === f.id ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/30"}`}
            >
              <span className="flex items-center gap-2">
                {f.id === "custom" && templateUrl && (
                  <img src={templateUrl} alt="" className="h-8 w-8 rounded-md object-cover border border-primary/30 shrink-0" />
                )}
                <p className={`text-xs font-black ${formatId === f.id ? "text-primary" : "text-white"}`}>
                  {f.id === "custom"
                    ? t("videoEditor.memeFormat_custom", { defaultValue: "My Upload" })
                    : t(`videoEditor.memeFormat_${f.id}`, { defaultValue: f.hint })}
                </p>
              </span>
              <p className="text-[10px] text-white/40 mt-0.5">~{f.clipSecs}s · {f.captionStyle}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("videoEditor.memeMachineContext", { defaultValue: "Describe the clip moment *" })}
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={t("videoEditor.memeMachinePh", { defaultValue: "e.g. Me realizing the take was muted the whole time…" })}
          className={`${inputClass} mt-1 min-h-[70px] resize-y`}
          maxLength={500}
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {outOfCredits && <OutOfCredits />}

      <button
        type="button"
        onClick={generate}
        disabled={loading || !context.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("videoEditor.memeMachineGenerate", { defaultValue: "Write Meme Captions" })}
      </button>

      {captions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("videoEditor.memeMachinePick", { defaultValue: "Pick your punchline" })}
          </p>
          {captions.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setPicked(i); setApplied(false); }}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${picked === i ? "border-primary bg-primary/10 text-white" : "border-white/10 text-white/75 hover:border-white/30"}`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={applyMeme}
            disabled={picked === null || applied}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-black text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {applied ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {applied
              ? t("videoEditor.memeMachineApplied", { defaultValue: "On your timeline" })
              : t("videoEditor.memeMachineApply", { defaultValue: "Apply to timeline" })}
          </button>
        </div>
      )}
    </div>
  );
}
