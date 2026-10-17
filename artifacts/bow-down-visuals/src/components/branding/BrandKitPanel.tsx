import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Check, ImagePlus, Loader2, Plus, RefreshCw, Save, Sparkles, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  applyBrandKit,
  BrandKitRequestError,
  fetchBrandKit,
  generateBrandKit,
  saveBrandKit,
  type BrandKit,
} from "@/lib/brand-kit";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "@/lib/asset-library";

/* ─── Brand Kit panel — the creator's ONE brand record ─────────────────────
   Docked as the first tab of the Branding hub. Generation (200 Visual
   Bucs) persists the kit server-side; the logo, chosen tagline, bio lines
   and press facts are saved on the same record, and every other surface —
   the editor's branding picker, Intros, the press kit, link-in-bio —
   reads from it instead of asking for re-uploads and re-typing. */

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#d4af37]/60 focus:outline-none";
const labelCls = "mb-1.5 block text-[11px] font-black uppercase tracking-widest text-white/40";

export function BrandKitPanel() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();

  const [kit, setKit] = useState<BrandKit | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* generation form */
  const [brandName, setBrandName] = useState("");
  const [vibe, setVibe] = useState("");
  const [industry, setIndustry] = useState("");
  const [generating, setGenerating] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* manual fields */
  const [logoUrl, setLogoUrl] = useState("");
  const [selectedTagline, setSelectedTagline] = useState<string | null>(null);
  const [bioLines, setBioLines] = useState<string[]>([]);
  const [pressFacts, setPressFacts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* library logo picker */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libraryImages, setLibraryImages] = useState<LibraryAsset[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  function hydrate(record: BrandKit | null) {
    setKit(record);
    if (record) {
      setBrandName((v) => v || record.brandName);
      setVibe((v) => v || record.vibe);
      setIndustry((v) => v || record.industry || "");
      setLogoUrl(record.logoUrl ?? "");
      setSelectedTagline(record.selectedTagline);
      setBioLines(record.bioLines);
      setPressFacts(record.pressFacts);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      hydrate(await fetchBrandKit(getAccessToken));
    } catch {
      setLoadError(t("brandingKit.brand.loadFailed", { defaultValue: "Couldn't load your brand kit — check your connection and try again." }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    if (!brandName.trim() || vibe.trim().length < 3) {
      setError(t("brandingKit.brand.needBrief", { defaultValue: "Give your brand a name and a vibe (a few words) first." }));
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    setOutOfCredits(false);
    try {
      const result = await generateBrandKit(getAccessToken, {
        brandName: brandName.trim(),
        vibe: vibe.trim(),
        industry: industry.trim() || undefined,
      });
      if (result.brandKit) hydrate(result.brandKit);
      setNotice(
        result.saved
          ? t("brandingKit.brand.generatedSaved", { defaultValue: "Brand kit generated and saved — it's now the one your editor, intros, press kit and bio page read from." })
          : t("brandingKit.brand.generatedUnsaved", { defaultValue: "Kit generated. Create your creator profile and it will save as your brand record." }),
      );
    } catch (err) {
      if (err instanceof BrandKitRequestError && err.outOfCredits) setOutOfCredits(true);
      else setError(err instanceof Error ? err.message : t("brandingKit.brand.generateFailed", { defaultValue: "Brand kit generation failed. Please try again." }));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveBrandKit(getAccessToken, {
        brandName: brandName.trim() || undefined,
        logoUrl: logoUrl.trim() || null,
        selectedTagline,
        bioLines: bioLines.map((l) => l.trim()).filter(Boolean),
        pressFacts: pressFacts.map((l) => l.trim()).filter(Boolean),
      });
      hydrate(saved);
      setNotice(t("brandingKit.brand.saved", { defaultValue: "Brand kit saved — every surface that reads your brand now uses this." }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingKit.brand.saveFailed", { defaultValue: "Couldn't save your brand kit. Please try again." }));
    } finally {
      setSaving(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      await applyBrandKit(getAccessToken);
      setNotice(t("brandingKit.brand.applied", { defaultValue: "Applied — your profile now wears your brand kit's colors and fonts." }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingKit.brand.applyFailed", { defaultValue: "Couldn't apply your brand kit. Please try again." }));
    } finally {
      setApplying(false);
    }
  }

  async function openPicker() {
    setPickerOpen((open) => !open);
    if (libraryImages !== null) return;
    setPickerError(null);
    try {
      const assets = await fetchAssetLibrary(getAccessToken);
      setLibraryImages(libraryAssetsOfKind(assets, "image"));
    } catch {
      setPickerError(t("brandingKit.brand.libraryFailed", { defaultValue: "Couldn't load your library. Paste a logo URL instead." }));
    }
  }

  const lineEditors = (
    lines: string[],
    setLines: (next: string[]) => void,
    placeholder: string,
    addLabel: string,
    max: number,
  ) => (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls}
            value={line}
            maxLength={400}
            placeholder={placeholder}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))}
          />
          <button
            type="button"
            aria-label="Remove line"
            className="shrink-0 rounded-lg border border-white/10 p-2 text-white/40 transition hover:border-white/30 hover:text-white"
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {lines.length < max && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-xs font-bold text-white/50 transition hover:border-primary/50 hover:text-primary"
          onClick={() => setLines([...lines, ""])}
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("brandingKit.brand.loading", { defaultValue: "Loading your brand kit…" })}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4">
      <div className="text-center">
        <h2 className="text-xl font-black text-white">
          {t("brandingKit.brand.title", { defaultValue: "Your brand, in one place" })}
        </h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-white/45">
          {t("brandingKit.brand.subtitle", {
            defaultValue:
              "Generate your kit once — logo, colors, fonts, tagline, bio lines and press facts live here, and your editor, intros, press kit and bio page all read from it. No re-uploading, no re-typing.",
          })}
        </p>
        <span
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest ${
            kit ? "border-primary/40 bg-primary/10 text-primary" : "border-white/15 bg-white/[0.03] text-white/40"
          }`}
        >
          {kit ? <Check className="h-3.5 w-3.5" /> : null}
          {kit
            ? t("brandingKit.brand.statusSaved", { defaultValue: "Saved as your brand record" })
            : t("brandingKit.brand.statusNone", { defaultValue: "No brand kit yet" })}
        </span>
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{loadError}</span>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-bold text-white">
            <RefreshCw className="h-3.5 w-3.5" /> {t("brandingKit.brand.retry", { defaultValue: "Try again" })}
          </button>
        </div>
      )}

      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/[0.07] p-4 text-sm text-primary">
          <Check className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      {/* ── Generate ── */}
      <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white/70">
          <Sparkles className="h-4 w-4 text-primary" />
          {kit
            ? t("brandingKit.brand.regenerateTitle", { defaultValue: "Refresh the kit" })
            : t("brandingKit.brand.generateTitle", { defaultValue: "Generate your brand kit" })}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("brandingKit.brand.brandName", { defaultValue: "Brand name" })}</label>
            <input className={inputCls} value={brandName} maxLength={80} onChange={(e) => setBrandName(e.target.value)} placeholder="Bow Down Visuals" />
          </div>
          <div>
            <label className={labelCls}>{t("brandingKit.brand.industry", { defaultValue: "Industry (optional)" })}</label>
            <input className={inputCls} value={industry} maxLength={80} onChange={(e) => setIndustry(e.target.value)} placeholder="Music, gaming, fitness…" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t("brandingKit.brand.vibe", { defaultValue: "The vibe" })}</label>
            <textarea className={inputCls} value={vibe} maxLength={500} rows={2} onChange={(e) => setVibe(e.target.value)} placeholder="Royal, bold, gold-on-black luxury with a street edge" />
          </div>
        </div>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {kit
            ? t("brandingKit.brand.regenerate", { defaultValue: "Regenerate — 200 Visual Bucs" })
            : t("brandingKit.brand.generate", { defaultValue: "Generate my brand kit — 200 Visual Bucs" })}
        </button>
        {kit && (
          <p className="mt-2 text-xs text-white/35">
            {t("brandingKit.brand.regenerateNote", { defaultValue: "Regenerating refreshes colors, fonts and taglines — your logo, bio lines and press facts below are kept." })}
          </p>
        )}
      </section>

      {/* ── The kit itself ── */}
      {kit && kit.colors.length > 0 && (
        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
          <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-white/70">
            {t("brandingKit.brand.kitTitle", { defaultValue: "Colors, fonts & taglines" })}
          </h3>
          <div className="flex flex-wrap gap-2">
            {kit.colors.map((c) => (
              <div key={c.role} className="flex items-center gap-2 rounded-xl border border-white/10 py-1.5 pl-1.5 pr-3">
                <span className="h-7 w-7 rounded-lg border border-white/15" style={{ backgroundColor: c.hex }} />
                <span className="text-xs">
                  <span className="block font-bold text-white">{c.name}</span>
                  <span className="block text-white/40">{c.role} · {c.hex}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {kit.fonts.map((f, i) => (
              <div key={i} className="rounded-xl border border-white/10 p-3">
                <p className="text-sm font-bold text-white" style={{ fontFamily: f.heading }}>{f.heading}</p>
                <p className="text-xs text-white/50" style={{ fontFamily: f.body }}>{f.body} — body</p>
                <p className="mt-1 text-[11px] text-white/35">{f.usage}</p>
              </div>
            ))}
          </div>
          {kit.logoPrompt && (
            <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/45">
              <span className="font-bold text-white/60">{t("brandingKit.brand.logoConcept", { defaultValue: "Logo concept:" })} </span>
              {kit.logoPrompt}
            </p>
          )}
          <div className="mt-4">
            <p className={labelCls}>{t("brandingKit.brand.pickTagline", { defaultValue: "Your tagline — the one your surfaces use" })}</p>
            <div className="space-y-1.5">
              {kit.taglines.map((line) => (
                <label key={line} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.07] px-3 py-2 text-sm text-white/70 transition hover:border-primary/40">
                  <input
                    type="radio"
                    name="brand-tagline"
                    checked={selectedTagline === line}
                    onChange={() => setSelectedTagline(line)}
                    className="accent-[#d4af37]"
                  />
                  {line}
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Identity: logo, bio lines, press facts ── */}
      <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-white/70">
          {t("brandingKit.brand.identityTitle", { defaultValue: "Logo, bio & press facts" })}
        </h3>
        <label className={labelCls}>{t("brandingKit.brand.logo", { defaultValue: "Your logo" })}</label>
        <div className="flex flex-wrap items-start gap-3">
          {logoUrl.trim() && (
            <img src={logoUrl.trim()} alt="" className="h-16 w-16 rounded-xl border border-white/15 object-contain bg-white/[0.03]" />
          )}
          <div className="min-w-[220px] flex-1">
            <input className={inputCls} value={logoUrl} maxLength={2000} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/my-logo.png" />
            <button
              type="button"
              onClick={() => void openPicker()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-primary"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {t("brandingKit.brand.pickFromLibrary", { defaultValue: "Choose from my library" })}
            </button>
          </div>
        </div>
        {pickerOpen && (
          <div className="mt-3 rounded-2xl border border-white/10 p-3">
            {pickerError && <p className="text-xs text-red-300">{pickerError}</p>}
            {!pickerError && libraryImages === null && (
              <p className="flex items-center gap-2 text-xs text-white/40"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your library…</p>
            )}
            {libraryImages !== null && libraryImages.length === 0 && (
              <p className="text-xs text-white/40">{t("brandingKit.brand.libraryEmpty", { defaultValue: "No images in your library yet — make one in Logo Studio, or paste a URL above." })}</p>
            )}
            {libraryImages !== null && libraryImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {libraryImages.slice(0, 24).map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    title={asset.label}
                    onClick={() => { setLogoUrl(asset.url); setPickerOpen(false); }}
                    className="h-14 w-14 overflow-hidden rounded-lg border border-white/15 transition hover:border-primary"
                  >
                    <img src={asset.url} alt={asset.label} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5">
          <label className={labelCls}>{t("brandingKit.brand.bioLines", { defaultValue: "Bio lines — the short version of you" })}</label>
          {lineEditors(bioLines, setBioLines, "e.g. Gold-standard creator studio.", t("brandingKit.brand.addBioLine", { defaultValue: "Add a bio line" }), 8)}
        </div>
        <div className="mt-5">
          <label className={labelCls}>{t("brandingKit.brand.pressFacts", { defaultValue: "Press facts — achievements the press kit can quote" })}</label>
          {lineEditors(pressFacts, setPressFacts, "e.g. 100k streams in year one", t("brandingKit.brand.addPressFact", { defaultValue: "Add a press fact" }), 16)}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("brandingKit.brand.save", { defaultValue: "Save my brand kit" })}
          </button>
          <button
            onClick={() => void handleApply()}
            disabled={applying || !kit || kit.colors.length === 0}
            title={!kit || kit.colors.length === 0 ? "Generate a kit first" : undefined}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-5 py-2.5 text-sm font-black text-primary transition hover:bg-primary/10 disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("brandingKit.brand.apply", { defaultValue: "Apply to my profile theme" })}
          </button>
        </div>
      </section>
    </div>
  );
}
