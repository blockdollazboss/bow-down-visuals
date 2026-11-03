import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarClock, ChevronLeft, ChevronRight, Download, Layers, Loader2,
  Plus, Sparkles, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useHubProject } from "@/lib/hub-project";
import {
  CAROUSEL_TEMPLATES,
  downloadCarouselSlide,
  renderCarouselSlide,
  type CarouselFormat,
  type CarouselSlide,
  type CarouselTemplate,
} from "@/lib/carousel-renderer";
import { DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import type { CreateDeskProps } from "./CreateDesks";
import { SchedulerComposeStandalone } from "./SchedulerDesk";
import {
  CAROUSEL_BG_CHOICES,
  CAROUSEL_BODY_MAX,
  CAROUSEL_FORMATS,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_TITLE_MAX,
  addCarouselSlide,
  buildCarouselExportPayload,
  carouselDisclosureForExport,
  carouselExportCost,
  carouselSchedulePrefill,
  disclosureOfCarouselResponse,
  filledCarouselCount,
  moveCarouselSlide,
  newCarouselSlide,
  removeCarouselSlide,
  slidesFromProjectConcept,
  updateCarouselSlide,
  type CarouselFont,
} from "@/lib/world/carousel-desk";

/* ─── The Carousel Desk (stack1400 parity wave #2, item 5) ─────────
   The Carousel Maker, native in the Create Wing: the 2D
   /carousel-maker page's whole surface on its own rails —
   template gallery, slide building (title / body / per-slide
   background), ordering (filmstrip move / delete / add, capped
   at the page's 10), captions carried into the schedule
   hand-off, format + font + brand controls, the Creative Vault
   and active-project pulls, and the export itself:
   POST /api/carousel/export at the registry's 100 Visual Bucs
   via confirmedFetch (the spend confirmation stands before
   anything runs; a decline runs and downloads nothing), then
   every slide renders with the site's own canvas renderer and
   downloads as a PNG in-world, the server's disclosure payload
   stamped into the PNG bytes when the toggle is on, and the
   export saves to the hub project exactly as the page saves it.
   "Schedule it" opens the IN-WORLD scheduler compose prefilled
   with the page's caption — never a website exit. The compose
   still asks for an image link: the slides are local PNG
   downloads no rail hosts, and the 2D hand-off carries caption
   only too (the desk says so on its face). */

const FONT_LABEL_KEYS: Record<CarouselFont, string> = {
  serif: "carouselMaker.fontSerif",
  sans: "carouselMaker.fontSans",
  display: "carouselMaker.fontDisplay",
};

export function CarouselDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { activeArtist } = useActiveArtist();
  const { project, addAsset } = useHubProject();

  const idSeq = useRef(0);
  const mintId = useCallback((n: number) => `slide-${Date.now()}-${n}`, []);
  const freshSlide = useCallback(() => {
    idSeq.current += 1;
    return newCarouselSlide(mintId(idSeq.current));
  }, [mintId]);

  const [templateId, setTemplateId] = useState(CAROUSEL_TEMPLATES[0]!.id);
  const [slides, setSlides] = useState<CarouselSlide[]>(() => [
    newCarouselSlide("slide-seed-1"),
    newCarouselSlide("slide-seed-2"),
    newCarouselSlide("slide-seed-3"),
  ]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [format, setFormat] = useState<CarouselFormat>("square");
  const [font, setFont] = useState<CarouselFont>("serif");
  const [brandColors, setBrandColors] = useState("");
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [doneLine, setDoneLine] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const template: CarouselTemplate = useMemo(
    () => CAROUSEL_TEMPLATES.find((x) => x.id === templateId) ?? CAROUSEL_TEMPLATES[0]!,
    [templateId],
  );
  const activeSlide = slides[activeIdx] ?? slides[0];
  const filledCount = filledCarouselCount(slides);
  const cost = carouselExportCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  /* ── The page's pulls: vault brand + project content (free) ── */
  const applyVault = () => {
    if (!activeArtist) return;
    if (activeArtist.brand_colors) setBrandColors(activeArtist.brand_colors);
    setNote(t("carouselMaker.vaultApplied"));
  };

  const pullFromProject = () => {
    if (!project?.concept) return;
    const fresh = slidesFromProjectConcept({
      concept: project.concept,
      projectName: project.name || "",
      idFor: (i) => `slide-proj-${Date.now()}-${i}`,
    });
    if (fresh.length === 0) return;
    setSlides(fresh);
    setActiveIdx(0);
    setNote(t("carouselMaker.projectPulled"));
  };

  /* ── Slide moves — the page's guards, via the desk's pure book ── */
  const addSlide = () => {
    if (slides.length >= CAROUSEL_MAX_SLIDES) return;
    setSlides((prev) => addCarouselSlide(prev, freshSlide()));
    setActiveIdx(slides.length);
  };
  const removeSlide = (idx: number) => {
    setSlides((prev) => removeCarouselSlide(prev, idx));
    setActiveIdx((a) => Math.max(0, Math.min(a, slides.length - 2)));
  };
  const moveSlide = (idx: number, dir: -1 | 1) => {
    setSlides((prev) => moveCarouselSlide(prev, idx, dir));
    setActiveIdx(idx + dir);
  };

  /* ── Export: charge 100 VB, render all slides, download PNGs,
        save to the hub — the page's handleExport, step for step. ── */
  const handleExport = async () => {
    if (exporting || filledCount === 0) return;
    setExporting(true);
    setNote(null);
    setDoneLine(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/carousel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCarouselExportPayload({ slideCount: slides.length, aiDisclosure })),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        setNote(apiErrorMessage(data as { message?: string; error?: string }, t("carouselMaker.exportFailed")));
        return;
      }
      const disclosure = carouselDisclosureForExport({
        aiDisclosure,
        responseDisclosure: disclosureOfCarouselResponse(data),
        artistName: activeArtist?.artist_name || null,
      });
      for (let i = 0; i < slides.length; i++) {
        const canvas = renderCarouselSlide({
          slide: slides[i]!,
          template,
          slideIndex: i,
          totalSlides: slides.length,
          format,
          brandColors: brandColors || activeArtist?.brand_colors || null,
          artistName: activeArtist?.artist_name || null,
          fontFamily: font,
        });
        // eslint-disable-next-line no-await-in-loop
        await downloadCarouselSlide(canvas, `carousel-slide-${i + 1}.png`, disclosure);
      }
      addAsset({
        kind: "image",
        url: "",
        label: t("carouselMaker.assetLabel", { count: slides.length }),
        detail: slides[0]?.title || undefined,
        meta: { tool: "carousel-maker", template: template.id, format },
      });
      await refreshProfile().catch(() => undefined);
      setDoneLine(t("carouselMaker.exportDone", { count: slides.length }));
    } catch (err) {
      setNote(plainErrorText(err, t("carouselMaker.exportFailed")));
    } finally {
      setExporting(false);
    }
  };

  const slideBg = (activeSlide?.bg as CarouselTemplate["bgStyle"] | null) ?? template.bgStyle;

  return (
    <div className="space-y-4" data-testid="world-create-carousel-desk">
      {/* workflow strip: vault → project, the page's own pulls */}
      <div className="flex flex-wrap gap-1.5">
        {activeArtist && (
          <button type="button" onClick={applyVault} className={chipCls(false)}>
            <Sparkles className="h-3.5 w-3.5" /> {t("carouselMaker.useVault", { name: activeArtist.artist_name })}
          </button>
        )}
        {project?.concept && (
          <button type="button" onClick={pullFromProject} className={chipCls(false)}>
            <Layers className="h-3.5 w-3.5" /> {t("carouselMaker.pullProject")}
          </button>
        )}
      </div>

      {/* templates — the page's gallery, as a focusable chip row */}
      <div>
        <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("carouselMaker.pickTemplate")}
        </p>
        <div className="flex flex-wrap gap-1.5" role="listbox" aria-label={t("carouselMaker.pickTemplate")}>
          {CAROUSEL_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              role="option"
              aria-selected={templateId === tpl.id}
              data-testid={`world-carousel-template-${tpl.id}`}
              onClick={() => setTemplateId(tpl.id)}
              className={chipCls(templateId === tpl.id)}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: tpl.accent }} />
              {t(tpl.nameKey)}
            </button>
          ))}
        </div>
        <p className={`mt-1 text-xs ${muted}`}>{t(template.descKey)}</p>
      </div>

      {/* preview — a CSS mirror of the canvas slide, like the page's */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("carouselMaker.preview")} — {t("carouselMaker.editSlide", { n: activeIdx + 1, total: slides.length })}
          </p>
          <span className="ml-auto inline-flex gap-1.5">
            {CAROUSEL_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={format === f}
                data-testid={`world-carousel-format-${f}`}
                onClick={() => setFormat(f)}
                className={chipCls(format === f)}
              >
                {t(f === "square" ? "carouselMaker.fmtSquare" : "carouselMaker.fmtPortrait")}
              </button>
            ))}
          </span>
        </div>
        <div
          data-dark-lock
          className={`relative mx-auto overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] ${
            format === "square" ? "aspect-square max-w-[380px]" : "aspect-[9/16] max-w-[260px]"
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
          <button
            type="button"
            aria-label={t("carouselMaker.prevSlide")}
            onClick={() => setActiveIdx((a) => (a - 1 + slides.length) % slides.length)}
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/70 hover:text-white bdv-touch-box"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={t("carouselMaker.nextSlide")}
            onClick={() => setActiveIdx((a) => (a + 1) % slides.length)}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/70 hover:text-white bdv-touch-box"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {/* filmstrip: select / reorder / delete / add */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="world-carousel-filmstrip">
          {slides.map((s, i) => (
            <span
              key={s.id}
              className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-1 text-xs font-bold ${
                i === activeIdx
                  ? "border-[#d4af37] bg-[#d4af37] text-black"
                  : isLight
                    ? "border-[#7A5A12]/30 text-[#6B5B36]"
                    : "border-white/15 text-white/75"
              }`}
            >
              <button type="button" aria-label={t("carouselMaker.goSlide", { n: i + 1 })} onClick={() => setActiveIdx(i)} className="bdv-touch-box px-1">
                {i + 1}
              </button>
              <button type="button" aria-label="move left" onClick={() => moveSlide(i, -1)} className="bdv-touch-box px-0.5">‹</button>
              <button type="button" aria-label="move right" onClick={() => moveSlide(i, 1)} className="bdv-touch-box px-0.5">›</button>
            </span>
          ))}
          {slides.length < CAROUSEL_MAX_SLIDES && (
            <button
              type="button"
              onClick={addSlide}
              aria-label={t("carouselMaker.addSlide")}
              data-testid="world-carousel-add-slide"
              className={chipCls(false)}
            >
              <Plus className="h-3.5 w-3.5" /> {t("carouselMaker.addSlide")}
            </button>
          )}
          <span className={`text-xs ${muted}`}>{slides.length} / {CAROUSEL_MAX_SLIDES}</span>
        </div>
      </div>

      {/* the active slide's words + look */}
      <div className="space-y-3">
        <DeskTextField
          isLight={isLight}
          label={t("carouselMaker.titleLabel")}
          value={activeSlide?.title ?? ""}
          onChange={(v) => setSlides((prev) => updateCarouselSlide(prev, activeIdx, { title: v.slice(0, CAROUSEL_TITLE_MAX) }))}
          placeholder={t("carouselMaker.titlePlaceholder")}
        />
        <label className="block">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("carouselMaker.bodyLabel")}
          </span>
          <textarea
            value={activeSlide?.body ?? ""}
            onChange={(e) => setSlides((prev) => updateCarouselSlide(prev, activeIdx, { body: e.target.value.slice(0, CAROUSEL_BODY_MAX) }))}
            placeholder={t("carouselMaker.bodyPlaceholder")}
            rows={4}
            className={deskInputCls(isLight)}
          />
        </label>
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("carouselMaker.slideBgLabel")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={!activeSlide?.bg} onClick={() => setSlides((prev) => updateCarouselSlide(prev, activeIdx, { bg: null }))} className={chipCls(!activeSlide?.bg)}>
              {t("carouselMaker.bgTemplate")}
            </button>
            {CAROUSEL_BG_CHOICES.map((bg) => (
              <button
                key={bg}
                type="button"
                aria-pressed={activeSlide?.bg === bg}
                onClick={() => setSlides((prev) => updateCarouselSlide(prev, activeIdx, { bg }))}
                className={chipCls(activeSlide?.bg === bg)}
              >
                {bg}
              </button>
            ))}
          </div>
        </div>
        {slides.length > 1 && (
          <button
            type="button"
            onClick={() => removeSlide(activeIdx)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${
              isLight ? "border-red-700/30 text-red-800" : "border-red-400/30 text-red-300"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("carouselMaker.deleteSlide")}
          </button>
        )}
      </div>

      {/* brand: colors + font, the page's brand card */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={t("carouselMaker.brandColorsLabel")}
          value={brandColors}
          onChange={setBrandColors}
          placeholder={activeArtist?.brand_colors || t("carouselMaker.brandColorsPlaceholder")}
        />
        <DeskSelectField
          isLight={isLight}
          label={t("carouselMaker.fontLabel")}
          value={font}
          onChange={(v) => setFont(v as CarouselFont)}
          options={(Object.keys(FONT_LABEL_KEYS) as CarouselFont[]).map((f) => ({
            value: f,
            label: t(FONT_LABEL_KEYS[f]),
          }))}
        />
      </div>

      {/* actions: disclosure, export (the one charge), schedule */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${muted}`}>{t("videoExport.aiDisclosure", { defaultValue: "AI disclosure in file details" })}</span>
          <button
            type="button"
            role="switch"
            aria-checked={aiDisclosure}
            aria-label={t("videoExport.aiDisclosure", { defaultValue: "AI disclosure in file details" })}
            onClick={() => setAiDisclosure((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition bdv-touch-box ${aiDisclosure ? "bg-[#d4af37]" : isLight ? "bg-[#7A5A12]/25" : "bg-white/15"}`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${aiDisclosure ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="world-carousel-desk-cost" className={`text-xs font-semibold ${muted}`}>
            Export costs {cost.toLocaleString("en-US")} Visual Bucs — shown before anything runs.
          </span>
          <button
            type="button"
            data-testid="world-carousel-desk-export"
            onClick={() => void handleExport()}
            disabled={exporting || filledCount === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? t("carouselMaker.exporting") : t("carouselMaker.exportBtn", { count: cost })}
          </button>
          <button
            type="button"
            data-testid="world-carousel-desk-schedule"
            aria-expanded={scheduleOpen}
            onClick={() => setScheduleOpen((v) => !v)}
            disabled={filledCount === 0}
            className={chipCls(scheduleOpen)}
          >
            <CalendarClock className="h-3.5 w-3.5" /> {t("carouselMaker.scheduleBtn")}
          </button>
        </div>
        {filledCount === 0 && <p className={`text-xs ${muted}`}>{t("carouselMaker.fillHint")}</p>}
        {outOfCredits && (
          <p className={noteCls}>
            You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and the Carousel Desk is ready again.
          </p>
        )}
        {note && <p className={noteCls}>{note}</p>}
        {doneLine && (
          <p data-testid="world-carousel-desk-done" className={`text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>
            {doneLine}
          </p>
        )}
        {scheduleOpen && filledCount > 0 && (
          <div className="w-full">
            <p className={`mb-2 text-xs ${muted}`}>
              Your slides download as PNG files on export — add the first slide&rsquo;s image link in the composer and the post carries your carousel.
            </p>
            <SchedulerComposeStandalone
              isLight={isLight}
              prefill={carouselSchedulePrefill(slides, t("carouselMaker.defaultCaption"))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CSS preview mirror of the canvas slide (the page's own) ────── */
function SlidePreview({ slide, bgStyle, accent, numberStyle, index, total, font, artistName }: {
  slide: CarouselSlide | undefined;
  bgStyle: CarouselTemplate["bgStyle"];
  accent: string;
  numberStyle: CarouselTemplate["numberStyle"];
  index: number;
  total: number;
  font: CarouselFont;
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
      {bgStyle === "split" && <div className="absolute left-0 right-0 top-1/2 h-1.5" style={{ background: accent }} />}
      {bgStyle === "bold-band" && <div className="absolute inset-14 rounded-3xl bg-black/80" />}
      <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
        {numberStyle === "pill" && (
          <span className="mb-4 rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: accent, color: accent }}>
            {index + 1} / {total}
          </span>
        )}
        {numberStyle === "corner" && (
          <span className={`absolute right-5 top-4 font-serif text-xl font-bold ${isPaper ? "text-black/30" : ""}`} style={isPaper ? undefined : { color: accent }}>
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <p className={`${fontCls} text-2xl font-black leading-tight ${isPaper ? "text-neutral-900" : "text-white"}`}>
          {slide?.title || <span className="opacity-25">Title</span>}
        </p>
        <div className="my-3 h-1 w-16 rounded-full" style={{ background: accent }} />
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
