/**
 * PageDesignerBench — the AI Page Designer's native bench at
 * the in-World profile desk (Stack 400 world parity, census
 * Lane B item B-05), stacked under the creator-profile card on
 * the My Studio board: the /artist-setup designer's own rails
 * (lib/world/page-designer-bench.ts) — the 400-Buc full page
 * design, the 100-Buc bio writer, the 200-Buc banner art, and
 * the free profile-photo upload door — each charged call on
 * the registry-priced spend confirmation, each result applied
 * on the profile's own PUT rail with the designer's exact
 * onApply patch shapes.
 *
 * The bench designs for the member's OWN profile: it reads
 * /api/creator-profiles/me first (the profile card's own
 * rail), and a member with no profile gets the honest empty
 * state pointing at the card above — never a design applied
 * to nobody. The palette steal is the page's own free
 * client-side sampler, riding along unchanged.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Palette, PenLine, Sparkles, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { VERTICALS, type VerticalId } from "@/lib/artist-profiles";
import { extractPalette } from "@/lib/palette";
import { DeskTextField, deskInputCls, useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  PAGE_DESIGNER_BANNER_PATH,
  PAGE_DESIGNER_BIO_PATH,
  PAGE_DESIGNER_DEFAULT_BASE_THEME,
  PAGE_DESIGNER_THEME_PATH,
  PAGE_DESIGNER_UPLOAD_PATH,
  PROFILE_ME_PATH,
  buildPageBannerPayload,
  buildPageBioPayload,
  buildPageThemePayload,
  buildProfileBannerPatch,
  buildProfileBioPatch,
  buildProfileDesignPatch,
  buildProfileUploadPatch,
  designerProfileOf,
  pageBioOf,
  pageDesignOf,
  pageDesignerBannerCost,
  pageDesignerBioCost,
  pageDesignerThemeCost,
  pageDesignerWordingReady,
  pageImageUrlOf,
  type DesignerProfile,
  type PageDesign,
} from "@/lib/world/page-designer-bench";
import { photoIntakeVerdict } from "@/lib/world/photo-desk";

type LoadState = "loading" | "ready" | "empty" | "error";

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

export function PageDesignerBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<DesignerProfile | null>(null);

  const [vertical, setVertical] = useState<VerticalId>("music");
  const [vibe, setVibe] = useState("");
  const [palette, setPalette] = useState<string[]>([]);
  const [paletteBusy, setPaletteBusy] = useState(false);
  const [paletteNote, setPaletteNote] = useState<string | null>(null);

  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState<PageDesign | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const [designOutOfCredits, setDesignOutOfCredits] = useState(false);

  const [facts, setFacts] = useState("");
  const [bioBusy, setBioBusy] = useState(false);
  const [bioDraft, setBioDraft] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioOutOfCredits, setBioOutOfCredits] = useState(false);

  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerOutOfCredits, setBannerOutOfCredits] = useState(false);

  const [uploadKind, setUploadKind] = useState<"avatar" | "banner">("avatar");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const themeCost = pageDesignerThemeCost();
  const bioCost = pageDesignerBioCost();
  const bannerCost = pageDesignerBannerCost();
  const vibeReady = pageDesignerWordingReady(vibe);
  const factsReady = pageDesignerWordingReady(facts);

  async function loadProfile() {
    setLoadState("loading");
    try {
      const res = await fetch(PROFILE_ME_PATH, { headers: await authHeaders() });
      if (res.status === 404) {
        setLoadState("empty");
        return;
      }
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const parsed = designerProfileOf(data);
      if (!parsed) {
        setLoadState("empty");
        return;
      }
      setProfile(parsed);
      if ((VERTICALS as ReadonlyArray<{ id: string }>).some((v) => v.id === parsed.vertical)) {
        setVertical(parsed.vertical as VerticalId);
      }
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Apply a patch on the profile's own PUT rail — the setup
     page's save, one patch at a time, with the answer read
     back into the bench so later designs build on the truth. */
  async function applyPatch(patch: Record<string, unknown>, note: string): Promise<boolean> {
    setApplying(true);
    setApplyError(null);
    setApplyNote(null);
    try {
      const res = await fetch(PROFILE_ME_PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(patch),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setApplyError(apiErrorMessage(data, t("worldPageDesigner.applyFailed", { defaultValue: "That change didn't save — try again." })));
        return false;
      }
      const fresh = designerProfileOf(data);
      if (fresh) setProfile(fresh);
      setApplyNote(note);
      return true;
    } catch (err) {
      setApplyError(plainErrorText(err, t("worldPageDesigner.applyFailed", { defaultValue: "That change didn't save — try again." })));
      return false;
    } finally {
      setApplying(false);
    }
  }

  async function stealPalette() {
    const art = profile?.avatarUrl || profile?.bannerUrl;
    if (!art || paletteBusy) {
      if (!art) setPaletteNote(t("worldPageDesigner.noArtToSample", { defaultValue: "No art to sample yet — add a photo first, then steal its colors." }));
      return;
    }
    setPaletteBusy(true);
    setPaletteNote(null);
    try {
      const colors = await extractPalette(art, 5);
      setPalette(colors);
      setPaletteNote(
        t("worldPageDesigner.paletteStolen", { defaultValue: "{{count}} colors pulled from your art — free.", count: colors.length }),
      );
    } catch {
      setPaletteNote(t("worldPageDesigner.paletteFailed", { defaultValue: "Couldn't sample that image — try a different photo." }));
    } finally {
      setPaletteBusy(false);
    }
  }

  async function runDesign(regenerate: boolean) {
    if (!profile || designing || !vibeReady) return;
    setDesigning(true);
    setDesignError(null);
    setDesignOutOfCredits(false);
    try {
      const res = await confirmedFetch(PAGE_DESIGNER_THEME_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPageThemePayload({
            vertical,
            vibe,
            displayName: profile.displayName,
            palette,
            baseThemeId: profile.themeId ?? PAGE_DESIGNER_DEFAULT_BASE_THEME,
            regenerate,
          }),
        ),
        overrideCost: themeCost,
      });
      if (!res) {
        setDesigning(false);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setDesignOutOfCredits(true);
        setDesigning(false);
        return;
      }
      const parsed = pageDesignOf(data);
      if (!res.ok || !parsed) {
        setDesignError(apiErrorMessage(data, t("worldPageDesigner.designFailed", { defaultValue: "The designer stumbled — try again." })));
        setDesigning(false);
        return;
      }
      setDesign(parsed);
    } catch (err) {
      setDesignError(plainErrorText(err, t("worldPageDesigner.designFailed", { defaultValue: "The designer stumbled — try again." })));
    }
    setDesigning(false);
  }

  async function runBio() {
    if (!profile || bioBusy || !factsReady) return;
    setBioBusy(true);
    setBioError(null);
    setBioOutOfCredits(false);
    try {
      const res = await confirmedFetch(PAGE_DESIGNER_BIO_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPageBioPayload({ vertical, displayName: profile.displayName, facts })),
        overrideCost: bioCost,
      });
      if (!res) {
        setBioBusy(false);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setBioOutOfCredits(true);
        setBioBusy(false);
        return;
      }
      const bio = pageBioOf(data);
      if (!res.ok || !bio) {
        setBioError(apiErrorMessage(data, t("worldPageDesigner.bioFailed", { defaultValue: "The writer stumbled — try again." })));
        setBioBusy(false);
        return;
      }
      setBioDraft(bio);
    } catch (err) {
      setBioError(plainErrorText(err, t("worldPageDesigner.bioFailed", { defaultValue: "The writer stumbled — try again." })));
    }
    setBioBusy(false);
  }

  async function runBanner() {
    if (!profile || bannerBusy || !vibeReady) return;
    setBannerBusy(true);
    setBannerError(null);
    setBannerOutOfCredits(false);
    try {
      const res = await confirmedFetch(PAGE_DESIGNER_BANNER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPageBannerPayload({ vertical, vibe, palette })),
        overrideCost: bannerCost,
      });
      if (!res) {
        setBannerBusy(false);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setBannerOutOfCredits(true);
        setBannerBusy(false);
        return;
      }
      const url = pageImageUrlOf(data);
      if (!res.ok || !url) {
        setBannerError(apiErrorMessage(data, t("worldPageDesigner.bannerFailed", { defaultValue: "The banner artist stumbled — try again." })));
        setBannerBusy(false);
        return;
      }
      setBannerUrl(url);
      /* The 2D designer applies the banner the moment the art
         lands — the bench does the same on the PUT rail. */
      await applyPatch(
        buildProfileBannerPatch(url),
        t("worldPageDesigner.bannerApplied", { defaultValue: "Fresh banner art is on your page." }),
      );
    } catch (err) {
      setBannerError(plainErrorText(err, t("worldPageDesigner.bannerFailed", { defaultValue: "The banner artist stumbled — try again." })));
    }
    setBannerBusy(false);
  }

  async function pickUpload(file: File | undefined) {
    if (!file || uploadBusy) return;
    const verdict = photoIntakeVerdict(file);
    if (verdict === "not-image") {
      setUploadError(t("bgStudio.uploadNotImage"));
      return;
    }
    if (verdict === "too-large") {
      setUploadError(t("worldPhotoDesk.uploadTooLarge", { defaultValue: "That photo is over 5 MB — pick a smaller one." }));
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    setUploadedUrl(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", uploadKind);
      const res = await confirmedFetch(PAGE_DESIGNER_UPLOAD_PATH, { method: "POST", body: form, skipConfirm: true });
      if (!res) {
        setUploadBusy(false);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const url = pageImageUrlOf(data);
      if (!res.ok || !url) {
        setUploadError(apiErrorMessage(data, t("bgStudio.uploadFailed")));
        setUploadBusy(false);
        return;
      }
      setUploadedUrl(url);
    } catch {
      setUploadError(t("bgStudio.uploadFailed"));
    }
    setUploadBusy(false);
  }

  return (
    <div className="space-y-4" data-testid="world-page-designer-bench">
      <div className="flex items-center gap-2">
        <Sparkles className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>
          {t("worldPageDesigner.title", { defaultValue: "AI Page Designer" })}
        </p>
      </div>

      {loadState === "loading" ? (
        <NativeLoadingState isLight={isLight} message={t("worldPageDesigner.loadingProfile", { defaultValue: "Reading your profile…" })} />
      ) : null}
      {loadState === "error" ? (
        <NativeErrorState
          isLight={isLight}
          message={t("worldPageDesigner.profileLoadFailed", { defaultValue: "Your profile wouldn't open — try again." })}
          onRetry={() => void loadProfile()}
        />
      ) : null}
      {loadState === "empty" ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldPageDesigner.noProfile", { defaultValue: "You don't have a creator profile yet." })}
          detail={t("worldPageDesigner.noProfileDetail", {
            defaultValue: "Claim yours with the card above — then design it right here: a full page look, a written bio and fresh banner art.",
          })}
        />
      ) : null}

      {loadState === "ready" && profile ? (
        <>
          {/* The member's lane — the designer's vertical pick. */}
          <div className="flex flex-wrap gap-1.5">
            {VERTICALS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={vertical === v.id}
                onClick={() => setVertical(v.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                  vertical === v.id
                    ? "border-[#d4af37] bg-[#d4af37] text-black"
                    : isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                }`}
              >
                {v.emoji} {v.label}
              </button>
            ))}
          </div>

          <div>
            <DeskTextField
              isLight={isLight}
              label={t("worldPageDesigner.vibeLabel", { defaultValue: "Your vibe" })}
              value={vibe}
              onChange={setVibe}
              placeholder={t("worldPageDesigner.vibePlaceholder", { defaultValue: "A sentence or two about your vibe — that's all it takes." })}
            />
            {!vibeReady && vibe.length > 0 ? (
              <p className={`mt-1 text-[11px] ${muted}`}>
                {t("worldPageDesigner.vibeHint", { defaultValue: "Give me a little more — a sentence or two about your vibe." })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void stealPalette()} disabled={paletteBusy} className={chipBtn(isLight)}>
              {paletteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
              {t("worldPageDesigner.stealPalette", { defaultValue: "Steal colors from my art" })}
            </button>
            {palette.map((c) => (
              <span key={c} className="h-5 w-5 rounded-full border border-white/20" style={{ backgroundColor: c }} title={c} />
            ))}
            {paletteNote ? <span className={`text-[11px] ${muted}`}>{paletteNote}</span> : null}
          </div>

          {/* Full page design — 400. */}
          <div className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <div className="flex items-center gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("worldPageDesigner.designTitle", { defaultValue: "Design my page" })}</p>
              <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
                {themeCost} VB
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="world-page-designer-theme-run" onClick={() => void runDesign(false)} disabled={designing || !vibeReady} className={goldBtn}>
                {designing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("worldPageDesigner.designRun", { defaultValue: "Design my page" })}
              </button>
              {design ? (
                <button type="button" onClick={() => void runDesign(true)} disabled={designing || !vibeReady} className={chipBtn(isLight)}>
                  {t("worldPageDesigner.designRegenerate", { defaultValue: "Regenerate" })}
                </button>
              ) : null}
            </div>
            {designing ? <NativeLoadingState isLight={isLight} message={t("worldPageDesigner.designing", { defaultValue: "Designing your page…" })} /> : null}
            {designOutOfCredits ? (
              <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                {t("worldBenches300.outOfBucs", { feature: "AI Page Designer" })}
              </p>
            ) : null}
            {designError ? <NativeErrorState isLight={isLight} message={designError} onRetry={() => void runDesign(false)} /> : null}
            {design ? (
              <div className="space-y-2">
                {design.rationale ? <p className={`text-xs leading-relaxed ${muted}`}>{design.rationale}</p> : null}
                <p className={`text-[11px] ${muted}`}>
                  {t("worldPageDesigner.designSummary", {
                    defaultValue: "Theme {{theme}} · {{count}} sections",
                    theme: String(design.themeConfig.themeId),
                    count: design.sections.length,
                  })}
                </p>
                <button
                  type="button"
                  data-testid="world-page-designer-theme-apply"
                  disabled={applying}
                  onClick={() =>
                    void applyPatch(
                      buildProfileDesignPatch({
                        vertical,
                        design,
                        vibe: vibe.trim(),
                        palette,
                        existingAiDesign: profile.aiDesign,
                        designedAt: new Date().toISOString(),
                      }),
                      t("worldPageDesigner.designApplied", { defaultValue: "Your page just got the cheat-code treatment." }),
                    )
                  }
                  className={goldBtn}
                >
                  {t("worldPageDesigner.designApply", { defaultValue: "Put this look on my page" })}
                </button>
              </div>
            ) : null}
          </div>

          {/* Bio writer — 100. */}
          <div className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <div className="flex items-center gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("worldPageDesigner.bioTitle", { defaultValue: "Bio writer" })}</p>
              <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
                {bioCost} VB
              </span>
            </div>
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              rows={3}
              placeholder={t("worldPageDesigner.bioPlaceholder", { defaultValue: "A few facts — wins, style, what you're known for." })}
              className={deskInputCls(isLight)}
            />
            <button type="button" data-testid="world-page-designer-bio-run" onClick={() => void runBio()} disabled={bioBusy || !factsReady} className={goldBtn}>
              {bioBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              {t("worldPageDesigner.bioRun", { defaultValue: "Write my bio" })}
            </button>
            {bioBusy ? <NativeLoadingState isLight={isLight} message={t("worldPageDesigner.bioWriting", { defaultValue: "Writing your bio…" })} /> : null}
            {bioOutOfCredits ? (
              <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                {t("worldBenches300.outOfBucs", { feature: "AI Page Designer — Bio Writer" })}
              </p>
            ) : null}
            {bioError ? <NativeErrorState isLight={isLight} message={bioError} onRetry={() => void runBio()} /> : null}
            {bioDraft ? (
              <div className="space-y-2">
                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${strong}`}>{bioDraft}</p>
                <button
                  type="button"
                  data-testid="world-page-designer-bio-apply"
                  disabled={applying}
                  onClick={() =>
                    void applyPatch(
                      buildProfileBioPatch(bioDraft),
                      t("worldPageDesigner.bioApplied", { defaultValue: "Bio set — looking sharp." }),
                    )
                  }
                  className={goldBtn}
                >
                  {t("worldPageDesigner.bioApply", { defaultValue: "Use this bio" })}
                </button>
              </div>
            ) : null}
          </div>

          {/* Banner art — 200, applied the moment it lands. */}
          <div className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <div className="flex items-center gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("worldPageDesigner.bannerTitle", { defaultValue: "Banner art" })}</p>
              <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
                {bannerCost} VB
              </span>
            </div>
            <button type="button" data-testid="world-page-designer-banner-run" onClick={() => void runBanner()} disabled={bannerBusy || !vibeReady} className={goldBtn}>
              {bannerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {t("worldPageDesigner.bannerRun", { defaultValue: "Generate my banner" })}
            </button>
            {!vibeReady ? (
              <p className={`text-[11px] ${muted}`}>{t("worldPageDesigner.bannerNeedsVibe", { defaultValue: "The banner artist needs your vibe first — write it above." })}</p>
            ) : null}
            {bannerBusy ? <NativeLoadingState isLight={isLight} message={t("worldPageDesigner.bannerWorking", { defaultValue: "Painting your banner…" })} /> : null}
            {bannerOutOfCredits ? (
              <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                {t("worldBenches300.outOfBucs", { feature: "AI Page Designer — Banner Art" })}
              </p>
            ) : null}
            {bannerError ? <NativeErrorState isLight={isLight} message={bannerError} onRetry={() => void runBanner()} /> : null}
            {bannerUrl ? <img src={bannerUrl} alt={t("worldPageDesigner.bannerTitle", { defaultValue: "Banner art" })} className="w-full rounded-xl object-cover" /> : null}
          </div>

          {/* Photo upload — free door, applied on the PUT rail. */}
          <div className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <div className="flex items-center gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("worldPageDesigner.uploadTitle", { defaultValue: "Profile photos" })}</p>
              <span className={`ml-auto text-[11px] font-bold ${muted}`}>{t("worldPhotoDesk.uploadFree", { defaultValue: "Uploads are free" })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["avatar", "banner"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={uploadKind === k}
                  onClick={() => setUploadKind(k)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                    uploadKind === k
                      ? "border-[#d4af37] bg-[#d4af37] text-black"
                      : isLight
                        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                        : "border-white/15 text-white/75 hover:text-white"
                  }`}
                >
                  {k === "avatar"
                    ? t("worldPageDesigner.uploadAvatar", { defaultValue: "Profile photo" })
                    : t("worldPageDesigner.uploadBanner", { defaultValue: "Banner photo" })}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadBusy}
              className={`w-full rounded-xl border-2 border-dashed p-4 text-center transition bdv-touch-target ${
                isLight ? "border-[#C9A84C]/40 hover:border-[#C9A84C]/70" : "border-white/15 hover:border-amber-500/50"
              }`}
            >
              <Upload className={`mx-auto h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} />
              <span className={`mt-1 block text-sm font-medium ${strong}`}>{t("bgStudio.dropHint")}</span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void pickUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {uploadBusy ? <NativeLoadingState isLight={isLight} message={t("bgStudio.uploading")} /> : null}
            {uploadError ? <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{uploadError}</p> : null}
            {uploadedUrl ? (
              <div className="space-y-2">
                <img src={uploadedUrl} alt={t("worldPageDesigner.uploadTitle", { defaultValue: "Profile photos" })} className="max-h-[180px] w-full rounded-xl object-contain" />
                <button
                  type="button"
                  data-testid="world-page-designer-upload-apply"
                  disabled={applying}
                  onClick={() =>
                    void applyPatch(
                      buildProfileUploadPatch(uploadKind, uploadedUrl),
                      uploadKind === "avatar"
                        ? t("worldPageDesigner.avatarApplied", { defaultValue: "Profile photo updated." })
                        : t("worldPageDesigner.bannerPhotoApplied", { defaultValue: "Banner photo updated." }),
                    )
                  }
                  className={goldBtn}
                >
                  {uploadKind === "avatar"
                    ? t("worldPageDesigner.uploadApplyAvatar", { defaultValue: "Use as my profile photo" })
                    : t("worldPageDesigner.uploadApplyBanner", { defaultValue: "Use as my banner" })}
                </button>
              </div>
            ) : null}
          </div>

          {applying ? <NativeLoadingState isLight={isLight} message={t("worldPageDesigner.applying", { defaultValue: "Putting it on your page…" })} /> : null}
          {applyNote ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{applyNote}</p>
          ) : null}
          {applyError ? (
            <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{applyError}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
