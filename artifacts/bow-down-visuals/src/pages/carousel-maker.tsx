import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useHubProject } from "@/lib/hub-project";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutGrid, Plus, Trash2, ChevronLeft, ChevronRight, Download,
  CalendarClock, Sparkles, Check, GripVertical, Type, Palette, Layers,
} from "lucide-react";
import {
  CAROUSEL_TEMPLATES, renderCarouselSlide, downloadCanvas,
  type CarouselSlide, type CarouselFormat, type CarouselTemplate,
} from "@/lib/carousel-renderer";

const FONTS = [
  { id: "serif" as const, labelKey: "carouselMaker.fontSerif" },
  { id: "sans" as const, labelKey: "carouselMaker.fontSans" },
  { id: "display" as const, labelKey: "carouselMaker.fontDisplay" },
];

const BG_CHOICES = ["gold-glow", "midnight", "split", "framed", "gradient-wash", "bold-band", "paper", "neon-edge"] as const;

function newSlide(n: number): CarouselSlide {
  return { id: `slide-${Date.now()}-${n}`, title: "", body: "", bg: null };
}

export default function CarouselMaker() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { activeArtist } = useActiveArtist();
  const { project, addAsset } = useHubProject();
  const { refreshProfile } = useAuth();

  usePageTitle(t("carouselMaker.pageTitle"), t("carouselMaker.pageDescription"));

  const [templateId, setTemplateId] = useState(CAROUSEL_TEMPLATES[0].id);

  /* Deep link from Thy Library: ?template=<slug> pre-selects the template. */
  useEffect(() => {
    try {
      const slug = new URLSearchParams(window.location.search).get("template");
      if (!slug) return;
      // Library slugs are prefixed (e.g. "carousel-bold-statement"); strip prefix and fuzzy-match
      const needle = slug.replace(/^carousel-/, "").toLowerCase();
      const match =
        CAROUSEL_TEMPLATES.find((x) => x.id === slug) ??
        CAROUSEL_TEMPLATES.find((x) => x.id.toLowerCase() === needle) ??
        CAROUSEL_TEMPLATES.find((x) => x.id.toLowerCase().startsWith(needle.split("-")[0])) ??
        CAROUSEL_TEMPLATES.find((x) => needle.startsWith(x.id.toLowerCase().split("-")[0]));
      if (match) {
        setTemplateId(match.id);
        setStep("edit");
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [slides, setSlides] = useState<CarouselSlide[]>([newSlide(1), newSlide(2), newSlide(3)]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [format, setFormat] = useState<CarouselFormat>("square");
  const [font, setFont] = useState<"serif" | "sans" | "display">("serif");
  const [brandColors, setBrandColors] = useState("");
  const [exporting, setExporting] = useState(false);
  const [step, setStep] = useState<"templates" | "edit">("templates");

  const template: CarouselTemplate = useMemo(
    () => CAROUSEL_TEMPLATES.find((x) => x.id === templateId) ?? CAROUSEL_TEMPLATES[0],
    [templateId],
  );

  /* ── Creative Vault: brand colors + artist identity flow in automatically ── */
  const applyVault = useCallback(() => {
    if (!activeArtist) return;
    if (activeArtist.brand_colors) setBrandColors(activeArtist.brand_colors);
    toast({ title: t("carouselMaker.vaultApplied") });
  }, [activeArtist, t, toast]);

  /* ── Active project: pull text/content in ── */
  const pullFromProject = useCallback(() => {
    if (!project?.concept) return;
    // Split the project concept into slide-sized chunks
    const sentences = project.concept.split(/(?<=[.!?])\s+/).filter(Boolean);
    const fresh: CarouselSlide[] = [];
    const title = project.name || "";
    sentences.slice(0, 10).forEach((s, i) => {
      fresh.push({
        id: `slide-proj-${Date.now()}-${i}`,
        title: i === 0 ? title : "",
        body: s.slice(0, 280),
        bg: null,
      });
    });
    if (fresh.length === 0) return;
    setSlides(fresh);
    setActiveIdx(0);
    setStep("edit");
    toast({ title: t("carouselMaker.projectPulled") });
  }, [project, t, toast]);

  const updateSlide = useCallback((idx: number, patch: Partial<CarouselSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const addSlide = useCallback(() => {
    setSlides((prev) => {
      if (prev.length >= 10) return prev;
      return [...prev, newSlide(prev.length + 1)];
    });
    setActiveIdx(slides.length);
  }, [slides.length]);

  const removeSlide = useCallback((idx: number) => {
    setSlides((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setActiveIdx((a) => Math.max(0, Math.min(a, slides.length - 2)));
  }, [slides.length]);

  const moveSlide = useCallback((idx: number, dir: -1 | 1) => {
    setSlides((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setActiveIdx((a) => a + dir);
  }, []);

  /* ── Live DOM preview (CSS mirror of the canvas renderer) ── */
  const activeSlide = slides[activeIdx] ?? slides[0];
  const slideBg: CarouselTemplate["bgStyle"] =
    (activeSlide?.bg as CarouselTemplate["bgStyle"]) ?? template.bgStyle;

  /* ── Export: charge 100 VB, render all slides, download PNGs, save to hub ── */
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await confirmedFetch("/api/carousel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideCount: slides.length }),
      });
      if (!res) return; // user cancelled the VB confirm
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? t("carouselMaker.exportFailed"));
      }
      // Render + download each slide
      for (let i = 0; i < slides.length; i++) {
        const canvas = renderCarouselSlide({
          slide: slides[i],
          template,
          slideIndex: i,
          totalSlides: slides.length,
          format,
          brandColors: brandColors || activeArtist?.brand_colors || null,
          artistName: activeArtist?.artist_name || null,
          fontFamily: font,
        });
        // eslint-disable-next-line no-await-in-loop
        await downloadCanvas(canvas, `carousel-slide-${i + 1}.png`);
      }
      // Save to Thy Vision (hub project → My Projects)
      addAsset({
        kind: "image",
        url: "",
        label: t("carouselMaker.assetLabel", { count: slides.length }),
        detail: slides[0]?.title || undefined,
        meta: { tool: "carousel-maker", template: template.id, format },
      });
      await refreshProfile().catch(() => undefined);
      toast({ title: t("carouselMaker.exportDone", { count: slides.length }) });
    } catch (err) {
      toast({
        title: t("carouselMaker.exportFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, confirmedFetch, slides, template, format, brandColors, activeArtist, font, addAsset, refreshProfile, toast, t]);

  /* ── Hand off to the War Room (scheduler) ── */
  const handleSchedule = useCallback(() => {
    const caption = slides.map((s) => s.title).filter(Boolean).join(" · ").slice(0, 200)
      || t("carouselMaker.defaultCaption");
    const params = new URLSearchParams({
      schedule: "1",
      caption,
      platform: "instagram,tiktok,linkedin",
    });
    window.location.href = `/scheduler?${params.toString()}`;
  }, [slides, t]);

  const filledCount = slides.filter((s) => s.title.trim() || s.body.trim()).length;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-yellow-600/10 rounded-full blur-[110px]" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 pt-10 pb-6 text-center">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-primary border border-primary/30 rounded-full px-3 py-1 bg-primary/5">
            <LayoutGrid className="h-3 w-3" /> {t("carouselMaker.kicker")}
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-black tracking-tight mt-4">
            {t("carouselMaker.heroTitleA")} <span className="text-primary">{t("carouselMaker.heroTitleB")}</span>
          </h1>
          <p className="text-white/55 mt-3 max-w-xl mx-auto">{t("carouselMaker.heroSub")}</p>

          {/* workflow strip: vault → project → schedule */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
            {activeArtist && (
              <Button variant="outline" size="sm" onClick={applyVault} className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 h-8 text-xs gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> {t("carouselMaker.useVault", { name: activeArtist.artist_name })}
              </Button>
            )}
            {project?.concept && (
              <Button variant="outline" size="sm" onClick={pullFromProject} className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 h-8 text-xs gap-1.5">
                <Layers className="h-3.5 w-3.5" /> {t("carouselMaker.pullProject")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-16">
        {step === "templates" ? (
          /* ── STEP 1: template gallery ── */
          <div>
            <h2 className="text-lg font-bold mb-4">{t("carouselMaker.pickTemplate")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CAROUSEL_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => { setTemplateId(tpl.id); setStep("edit"); }}
                  className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-1 ${
                    templateId === tpl.id
                      ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_24px_rgba(212,175,55,0.15)]"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-primary/30"
                  }`}
                >
                  <div
                    className="h-20 rounded-xl mb-3 flex items-center justify-center text-2xl font-black"
                    style={{
                      background: tpl.bgStyle === "paper"
                        ? "linear-gradient(135deg,#f5f0e6,#e8e0cf)"
                        : tpl.bgStyle === "bold-band"
                          ? `linear-gradient(135deg, ${tpl.accent}, #9c7c1e)`
                          : "linear-gradient(135deg,#141414,#0a0a0a)",
                      color: tpl.bgStyle === "paper" ? "#1a1a1a" : tpl.accent,
                      border: `1px solid ${tpl.accent}44`,
                    }}
                  >
                    Aa
                  </div>
                  <p className="text-sm font-bold">{t(tpl.nameKey)}</p>
                  <p className="text-[11px] text-white/40 mt-1 line-clamp-2">{t(tpl.descKey)}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── STEP 2: editor ── */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* left: preview */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold">{t("carouselMaker.preview")}</h2>
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
                  {(["square", "portrait"] as CarouselFormat[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                        format === f ? "bg-primary text-black" : "text-white/50 hover:text-white"
                      }`}
                    >
                      {t(f === "square" ? "carouselMaker.fmtSquare" : "carouselMaker.fmtPortrait")}
                    </button>
                  ))}
                </div>
              </div>

              {/* swipeable preview */}
              <div
                className={`relative rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0a] mx-auto ${
                  format === "square" ? "aspect-square max-w-[420px]" : "aspect-[9/16] max-w-[300px]"
                }`}
              >
                <SlidePreview
                  slide={activeSlide}
                  bgStyle={slideBg}
                  accent={template.accent}
                  numberStyle={template.numberStyle}
                  index={activeIdx}
                  total={slides.length}
                  font={font}
                  artistName={activeArtist?.artist_name ?? null}
                />
                {/* swipe zones */}
                <button
                  aria-label={t("carouselMaker.prevSlide")}
                  onClick={() => setActiveIdx((a) => (a - 1 + slides.length) % slides.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center text-white/70 hover:text-white"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  aria-label={t("carouselMaker.nextSlide")}
                  onClick={() => setActiveIdx((a) => (a + 1) % slides.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center text-white/70 hover:text-white"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* dots */}
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    aria-label={t("carouselMaker.goSlide", { n: i + 1 })}
                    onClick={() => setActiveIdx(i)}
                    className={`h-2 rounded-full transition-all ${i === activeIdx ? "w-6 bg-primary" : "w-2 bg-white/20 hover:bg-white/40"}`}
                  />
                ))}
              </div>

              {/* slide filmstrip: reorder / delete */}
              <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-2">
                {slides.map((s, i) => (
                  <div
                    key={s.id}
                    className={`shrink-0 w-16 h-16 rounded-xl border flex flex-col items-center justify-center text-[10px] font-bold cursor-pointer transition ${
                      i === activeIdx ? "border-primary bg-primary/10 text-primary" : "border-white/10 bg-white/[0.03] text-white/40 hover:border-white/25"
                    }`}
                    onClick={() => setActiveIdx(i)}
                  >
                    <GripVertical className="h-3 w-3 mb-0.5 opacity-50" />
                    {i + 1}
                    <span className="flex gap-0.5 mt-0.5">
                      <button
                        aria-label="move left"
                        onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }}
                        className="hover:text-white px-0.5"
                      >‹</button>
                      <button
                        aria-label="move right"
                        onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }}
                        className="hover:text-white px-0.5"
                      >›</button>
                    </span>
                  </div>
                ))}
                {slides.length < 10 && (
                  <button
                    onClick={addSlide}
                    className="shrink-0 w-16 h-16 rounded-xl border border-dashed border-white/15 text-white/40 hover:text-primary hover:border-primary/40 flex items-center justify-center"
                    aria-label={t("carouselMaker.addSlide")}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            {/* right: editor */}
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">
                  {t("carouselMaker.editSlide", { n: activeIdx + 1, total: slides.length })}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setStep("templates")} className="text-white/50 hover:text-white h-8 text-xs">
                  {t("carouselMaker.changeTemplate")}
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                  <Type className="h-3 w-3 inline mr-1" />{t("carouselMaker.titleLabel")}
                </Label>
                <Input
                  value={activeSlide?.title ?? ""}
                  onChange={(e) => updateSlide(activeIdx, { title: e.target.value })}
                  placeholder={t("carouselMaker.titlePlaceholder")}
                  className="bg-white/[0.04] border-white/10 text-white"
                  maxLength={120}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50">{t("carouselMaker.bodyLabel")}</Label>
                <Textarea
                  value={activeSlide?.body ?? ""}
                  onChange={(e) => updateSlide(activeIdx, { body: e.target.value })}
                  placeholder={t("carouselMaker.bodyPlaceholder")}
                  className="bg-white/[0.04] border-white/10 text-white min-h-[100px]"
                  maxLength={400}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/50">
                  <Palette className="h-3 w-3 inline mr-1" />{t("carouselMaker.slideBgLabel")}
                </Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => updateSlide(activeIdx, { bg: null })}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                      !activeSlide?.bg ? "border-primary bg-primary/10 text-primary" : "border-white/10 text-white/50 hover:text-white"
                    }`}
                  >
                    {t("carouselMaker.bgTemplate")}
                  </button>
                  {BG_CHOICES.map((bg) => (
                    <button
                      key={bg}
                      onClick={() => updateSlide(activeIdx, { bg })}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                        activeSlide?.bg === bg ? "border-primary bg-primary/10 text-primary" : "border-white/10 text-white/50 hover:text-white"
                      }`}
                    >
                      {bg}
                    </button>
                  ))}
                </div>
              </div>

              {slides.length > 1 && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => removeSlide(activeIdx)}
                  className="text-red-400/70 hover:text-red-400 hover:bg-red-500/5 h-8 text-xs gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t("carouselMaker.deleteSlide")}
                </Button>
              )}

              {/* brand */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                <h3 className="text-sm font-bold">{t("carouselMaker.brandTitle")}</h3>
                <div className="space-y-2">
                  <Label className="text-xs text-white/50">{t("carouselMaker.brandColorsLabel")}</Label>
                  <Input
                    value={brandColors}
                    onChange={(e) => setBrandColors(e.target.value)}
                    placeholder={activeArtist?.brand_colors || t("carouselMaker.brandColorsPlaceholder")}
                    className="bg-white/[0.04] border-white/10 text-white text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-white/50">{t("carouselMaker.fontLabel")}</Label>
                  <div className="flex gap-2">
                    {FONTS.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFont(f.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                          font === f.id ? "border-primary bg-primary/10 text-primary" : "border-white/10 text-white/50 hover:text-white"
                        }`}
                      >
                        {t(f.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* actions */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleExport}
                  disabled={exporting || filledCount === 0}
                  className="bg-primary hover:bg-primary/90 text-black font-bold h-11 gap-2"
                >
                  {exporting ? t("carouselMaker.exporting") : <><Download className="h-4 w-4" /> {t("carouselMaker.exportBtn", { cost: 100 })}</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSchedule}
                  disabled={filledCount === 0}
                  className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 h-11 gap-2"
                >
                  <CalendarClock className="h-4 w-4" /> {t("carouselMaker.scheduleBtn")}
                </Button>
                {filledCount === 0 && (
                  <p className="text-xs text-white/35 text-center">{t("carouselMaker.fillHint")}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CSS preview mirror of the canvas slide ─── */
function SlidePreview({ slide, bgStyle, accent, numberStyle, index, total, font, artistName }: {
  slide: CarouselSlide | undefined;
  bgStyle: CarouselTemplate["bgStyle"];
  accent: string;
  numberStyle: CarouselTemplate["numberStyle"];
  index: number;
  total: number;
  font: "serif" | "sans" | "display";
  artistName: string | null;
}) {
  const fontCls = font === "serif" ? "font-serif" : font === "display" ? "font-black" : "font-sans";
  const isPaper = bgStyle === "paper";
  const bgCls: Record<string, string> = {
    "gold-glow": "bg-[#0a0a0a]",
    "midnight": "bg-gradient-to-b from-[#101010] to-[#050505]",
    "split": "bg-[#0a0a0a]",
    "framed": "bg-[#0c0c0c]",
    "gradient-wash": "bg-gradient-to-br from-[#141414] via-[#1a1408] to-[#0a0a0a]",
    "bold-band": "",
    "paper": "bg-gradient-to-b from-[#f5f0e6] to-[#e8e0cf]",
    "neon-edge": "bg-[#080808]",
  };
  return (
    <div className={`absolute inset-0 ${bgCls[bgStyle] ?? ""}`} style={bgStyle === "bold-band" ? { background: accent } : undefined}>
      {bgStyle === "gold-glow" && (
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 32%, ${accent}46, transparent 70%)` }} />
      )}
      {(bgStyle === "midnight" || bgStyle === "framed" || bgStyle === "neon-edge") && (
        <div className="absolute inset-7 rounded-2xl border-2" style={{ borderColor: `${accent}88` }} />
      )}
      {bgStyle === "split" && <div className="absolute top-1/2 left-0 right-0 h-1.5" style={{ background: accent }} />}
      {bgStyle === "bold-band" && <div className="absolute inset-14 rounded-3xl bg-black/80" />}

      <div className="relative h-full flex flex-col items-center justify-center px-8 text-center">
        {numberStyle === "pill" && (
          <span className="text-[10px] font-bold px-3 py-1 rounded-full border mb-4" style={{ borderColor: accent, color: accent }}>
            {index + 1} / {total}
          </span>
        )}
        {numberStyle === "corner" && (
          <span className={`absolute top-4 right-5 text-xl font-serif font-bold ${isPaper ? "text-black/30" : ""}`} style={isPaper ? undefined : { color: accent }}>
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <p className={`${fontCls} text-2xl font-black leading-tight ${isPaper ? "text-neutral-900" : "text-white"}`}>
          {slide?.title || <span className="opacity-25">Title</span>}
        </p>
        <div className="w-16 h-1 my-3 rounded-full" style={{ background: accent }} />
        <p className={`text-sm leading-relaxed ${isPaper ? "text-neutral-700" : "text-white/70"}`}>
          {slide?.body || <span className="opacity-25">Body text</span>}
        </p>
        <p className="absolute bottom-4 text-[9px] font-bold tracking-[0.2em]" style={{ color: isPaper ? "rgba(0,0,0,0.45)" : `${accent}cc` }}>
          {artistName ? `${artistName.toUpperCase()} · ` : ""}MADE WITH BOW DOWN VISUALS
        </p>
      </div>
    </div>
  );
}
