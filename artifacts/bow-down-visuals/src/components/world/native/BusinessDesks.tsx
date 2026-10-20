import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Crown, Megaphone, Newspaper, Palette, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeLoadingState, NativeEmptyState, NativeErrorState } from "./NativeStates";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import { TRANSFER_BUTTON_LABEL } from "@/lib/world/station-panel";
import { applyBrandKit, fetchBrandKit, saveBrandKit, type BrandKit } from "@/lib/brand-kit";
import { slugifyHandle } from "@/lib/press-kit";
import { SITE_FEATURES } from "@/data/features";
import { prettyDateTime, countdownLabel } from "@/lib/scheduler";
import {
  BRAND_KIT_GENERATE_COST_VISUAL_BUCS,
  buildBrandKitGeneratePayload,
  brandKitGenerateReady,
  LOGO_MODELS,
  LOGO_STYLES,
  logoModelCost,
  INTRO_COST_VISUAL_BUCS,
  INTRO_TYPES,
  PRESS_KIT_GENERATE_COST_VISUAL_BUCS,
  PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS,
  PRESS_KIT_TONES,
  PROMO_GENERATOR_COST_VISUAL_BUCS,
  PROMO_CARDS_COST_VISUAL_BUCS,
  COACH_COST_VISUAL_BUCS,
  parseJobStart,
  jobPollOutcome,
  buildLogoPayload,
  buildIntroPayload,
  parsePressKits,
  buildPressKitGeneratePayload,
  pressKitGenerateReady,
  buildRegenerateBioPayload,
  parseBioPages,
  bioPageStatusLine,
  parseBioAnalytics,
  buildPromoGeneratorPayload,
  parsePromoResult,
  PROMO_CONTENT_TYPES,
  PROMO_TONES,
  buildPromoCardsPayload,
  parsePromoCards,
  PROMO_CARD_STYLES,
  parseReleases,
  releaseDeskLine,
  parseVaultedCount,
  parseScheduledPosts,
  upcomingPosts,
  buildCoachPayload,
  parseCoachTodayAction,
  type PressKitSummary,
  type BioPageSummary,
  type BioAnalytics,
  type PromoResult,
  type PromoCardItem,
  type ReleaseSummary,
  type UpcomingPost,
  type CoachTodayAction,
} from "@/lib/world/business-desks";

/* ─── The Business Desks (NATIVE-PLAN §3.7, Lane 7) ──────────────────
   Branding Kit, Press Kit and Promote as in-world instruments:
   status + headline actions native, deep benches behind the frame's
   transfer footer (the host renders it once) — plus, for Promote's
   folded rows, each row's own quiet transfer to its bench. Every
   fetch rides the member's token the way the custom panels do;
   every paid action shows its Visual Bucs price BEFORE it runs and
   goes through the same credit confirmation the website pages use
   (useConfirmedApi, with the pages' own override costs where the
   registry is stale). No provider names in any copy. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function GuestGate({ isLight, desk }: { isLight: boolean; desk: string }) {
  return (
    <NativeCard isLight={isLight}>
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {desk} works on your own account — guests can look around the palace, but this desk
        only opens for members.{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          Sign in
        </Link>{" "}
        and the desk is yours, right here in the room.
      </p>
    </NativeCard>
  );
}

const selectCls = (isLight: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/15 bg-white/5 text-white/80"
  }`;

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";

/** A folded row's own quiet transfer to its bench (new tab). */
function RowTransfer({ websitePath, isLight }: { websitePath: string; isLight: boolean }) {
  return (
    <a
      href={websitePath}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold transition ${
        isLight ? "text-[#7A5A12] hover:text-[#2a1e07]" : "text-[#e8c86a] hover:text-white"
      }`}
    >
      {TRANSFER_BUTTON_LABEL}
    </a>
  );
}

function SectionShell({
  isLight,
  title,
  state,
  loadingMessage,
  errorMessage,
  onRetry,
  children,
}: {
  isLight: boolean;
  title: string;
  state: "loading" | "failed" | "ready";
  loadingMessage: string;
  errorMessage: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <NativeCard isLight={isLight} title={title}>
      {state === "loading" ? (
        <NativeLoadingState isLight={isLight} message={loadingMessage} />
      ) : state === "failed" ? (
        <NativeErrorState isLight={isLight} message={errorMessage} onRetry={onRetry} />
      ) : (
        children
      )}
    </NativeCard>
  );
}

/* ═══ 1. Branding Kit Desk ═══════════════════════════════════════════ */

export function BrandingKitDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [kitState, setKitState] = useState<"loading" | "failed" | "ready">("loading");
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  /* Brand-kit verbs (the kit card used to be read-only): generate rides
     the same endpoint + confirmed charge as the website; choosing a
     tagline and applying the kit are the website's free saves. */
  const [genName, setGenName] = useState("");
  const [genVibe, setGenVibe] = useState("");
  const [genIndustry, setGenIndustry] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [kitBusy, setKitBusy] = useState<"tagline" | "apply" | null>(null);
  const [kitNote, setKitNote] = useState<string | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);

  /* Logo job (the Create Desk kit in miniature). */
  const [logoName, setLogoName] = useState("");
  const [logoStyle, setLogoStyle] = useState<string>("luxury-gold");
  const [logoModel, setLogoModel] = useState<string>("premium");
  const [logoJob, setLogoJob] = useState<CreateDeskJobState>("idle");
  const [logoTaskId, setLogoTaskId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  /* Intro/outro job. */
  const [introName, setIntroName] = useState("");
  const [introType, setIntroType] = useState<string>("intro");
  const [introJob, setIntroJob] = useState<CreateDeskJobState>("idle");
  const [introTaskId, setIntroTaskId] = useState<string | null>(null);
  const [introUrl, setIntroUrl] = useState<string | null>(null);
  const [introError, setIntroError] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setKitState("loading");
      try {
        const record = await fetchBrandKit(getAccessToken);
        if (cancelled) return;
        setKit(record);
        setKitState("ready");
        if (record?.brandName) {
          setLogoName((v) => v || record.brandName);
          setIntroName((v) => v || record.brandName);
          setGenName((v) => v || record.brandName);
        }
        if (record) {
          setGenVibe((v) => v || record.vibe);
          setGenIndustry((v) => v || record.industry || "");
        }
      } catch {
        if (!cancelled) setKitState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, reloadTick]);

  /* Poll the logo task (Standard tier) — the page's 3s cadence. */
  useEffect(() => {
    if (!logoTaskId || logoJob !== "running") return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-logo/${logoTaskId}`, { headers: await authHeaders() });
        const data: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLogoJob("failed");
          setLogoError("That logo couldn't be found — nothing more was charged. Try again.");
          return;
        }
        const outcome = jobPollOutcome(data);
        if (outcome.kind === "succeeded") {
          setLogoUrl(outcome.url);
          setLogoJob("done");
          refreshProfile();
        } else if (outcome.kind === "failed") {
          setLogoJob("failed");
          setLogoError(outcome.error ?? "The logo didn't finish — a failed make is not charged. Try again.");
        }
      } catch {
        /* keep polling on transient network errors (the page's rule) */
      }
    }, 3000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoTaskId, logoJob]);

  /* Poll the intro/outro task — the page's 4s cadence. */
  useEffect(() => {
    if (!introTaskId || introJob !== "running") return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-intro-outro/${introTaskId}`, { headers: await authHeaders() });
        const data: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          setIntroJob("failed");
          setIntroError("That sting couldn't be found — nothing more was charged. Try again.");
          return;
        }
        const outcome = jobPollOutcome(data);
        if (outcome.kind === "succeeded") {
          setIntroUrl(outcome.url);
          setIntroJob("done");
          refreshProfile();
        } else if (outcome.kind === "failed") {
          setIntroJob("failed");
          setIntroError(outcome.error ?? "The sting didn't finish — a failed make is not charged. Try again.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introTaskId, introJob]);

  const runGenerateKit = async () => {
    if (!brandKitGenerateReady({ brandName: genName, vibe: genVibe }) || genBusy) return;
    setGenBusy(true);
    setKitNote(null);
    setKitError(null);
    try {
      const res = await confirmedFetch("/api/brand-kit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: BRAND_KIT_GENERATE_COST_VISUAL_BUCS,
        overrideFeature: "Brand Kit Generator",
        body: JSON.stringify(
          buildBrandKitGeneratePayload({ brandName: genName, vibe: genVibe, industry: genIndustry }),
        ),
      });
      if (!res) return; /* the creator declined the confirm — nothing charged */
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setKitError("Out of Visual Bucs — top up and the brand kit maker is ready again.");
        return;
      }
      if (!res.ok) {
        setKitError("The brand kit couldn't be made right now. Try again.");
        return;
      }
      const saved = (data as { brandKit?: BrandKit | null }).brandKit ?? null;
      if (saved) setKit(saved);
      setKitNote(
        saved
          ? "Brand kit made and saved — it stands on this desk and on the website alike."
          : "Kit made. Create your creator profile and it will save as your brand record.",
      );
      refreshProfile();
    } catch {
      setKitError("The brand kit desk didn't answer. Try again.");
    } finally {
      setGenBusy(false);
    }
  };

  const pickTagline = async (line: string) => {
    if (!kit || kitBusy) return;
    setKitBusy("tagline");
    setKitNote(null);
    setKitError(null);
    try {
      const saved = await saveBrandKit(getAccessToken, { selectedTagline: line });
      setKit(saved);
      setKitNote("Tagline chosen — your surfaces now speak it.");
    } catch {
      setKitError("That tagline pick didn't save. Try again.");
    } finally {
      setKitBusy(null);
    }
  };

  const applyKit = async () => {
    if (!kit || kitBusy) return;
    setKitBusy("apply");
    setKitNote(null);
    setKitError(null);
    try {
      await applyBrandKit(getAccessToken);
      setKitNote("Applied — your profile now wears your brand kit's colors and fonts.");
      refreshProfile();
    } catch {
      setKitError("The kit wouldn't apply. Try again.");
    } finally {
      setKitBusy(null);
    }
  };

  if (isGuest) return <GuestGate isLight={isLight} desk="The Branding Kit Desk" />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const runLogo = async () => {
    if (!logoName.trim() || logoJob === "running") return;
    setLogoJob("running");
    setLogoError(null);
    setLogoUrl(null);
    setLogoTaskId(null);
    try {
      const cost = logoModelCost(logoModel);
      const res = await confirmedFetch("/api/generate-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Logo Generator",
        body: JSON.stringify(
          buildLogoPayload({ brandName: logoName, style: logoStyle, model: logoModel, tagline: kit?.selectedTagline ?? kit?.taglines[0] }),
        ),
      });
      if (!res) {
        setLogoJob("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setLogoJob("failed");
        setLogoError("Out of Visual Bucs — top up and the logo desk is ready again.");
        return;
      }
      if (!res.ok) {
        setLogoJob("failed");
        setLogoError("The logo couldn't be made right now. Try again.");
        return;
      }
      const start = parseJobStart(data);
      if (start.url) {
        setLogoUrl(start.url);
        setLogoJob("done");
        refreshProfile();
      } else if (start.taskId) {
        setLogoTaskId(start.taskId);
        /* stays "running" — the poll effect takes it from here */
      } else {
        setLogoJob("failed");
        setLogoError("The logo desk answered without a logo or a task. Try again.");
      }
    } catch {
      setLogoJob("failed");
      setLogoError("The logo desk didn't answer. Try again.");
    }
  };

  const runIntro = async () => {
    if (!introName.trim() || introJob === "running") return;
    setIntroJob("running");
    setIntroError(null);
    setIntroUrl(null);
    setIntroTaskId(null);
    try {
      const res = await confirmedFetch("/api/generate-intro-outro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildIntroPayload({
            channelName: introName,
            type: introType,
            tagline: kit?.selectedTagline ?? kit?.taglines[0],
            logoUrl: kit?.logoUrl ?? undefined,
          }),
        ),
      });
      if (!res) {
        setIntroJob("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setIntroJob("failed");
        setIntroError("Out of Visual Bucs — top up and the intro desk is ready again.");
        return;
      }
      const start = parseJobStart(data);
      if (!res.ok || !start.taskId) {
        setIntroJob("failed");
        setIntroError("The sting couldn't be started right now. Try again.");
        return;
      }
      setIntroTaskId(start.taskId);
      refreshProfile();
    } catch {
      setIntroJob("failed");
      setIntroError("The intro desk didn't answer. Try again.");
    }
  };

  return (
    <div className="space-y-3" data-testid="world-business-branding-desk">
      <SectionShell
        isLight={isLight}
        title="Your brand kit"
        state={kitState}
        loadingMessage="Opening your brand kit…"
        errorMessage="Your brand kit wouldn't open — your kit is safe on the real rails."
        onRetry={() => setReloadTick((n) => n + 1)}
      >
        {kit === null ? (
          <NativeEmptyState
            isLight={isLight}
            message="No brand kit yet."
            detail="Make one with the Brand kit maker below — your logo, colors and fonts will stand on this desk. The logo and sting makers work either way."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {kit.logoUrl ? (
                <img src={kit.logoUrl} alt="" className="h-14 w-14 rounded-xl border border-[#d4af37]/40 object-contain" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#d4af37]/15">
                  <Palette className="h-6 w-6 text-[#d4af37]" />
                </span>
              )}
              <div className="min-w-0">
                <p className={`truncate text-sm font-black ${strong}`}>{kit.brandName || "Your brand"}</p>
                <p className={`truncate text-xs ${muted}`}>
                  {(kit.selectedTagline ?? kit.taglines[0]) || kit.vibe || "Your whole look, in one kit."}
                </p>
                {kit.industry ? <p className={`truncate text-xs ${muted}`}>{kit.industry}</p> : null}
              </div>
            </div>
            {kit.colors.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {kit.colors.map((c) => (
                  <span
                    key={`${c.role}-${c.hex}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/60"}`}
                  >
                    <span className="h-3 w-3 rounded-full border border-black/20" style={{ backgroundColor: c.hex }} />
                    {c.name} · {c.role}
                  </span>
                ))}
              </div>
            )}
            {kit.fonts.length > 0 && (
              <p className={`text-xs ${muted}`}>
                Fonts: {kit.fonts.map((f) => `${f.heading} / ${f.body}`).join(" · ")}
              </p>
            )}
            {kit.taglines.length > 1 && (
              <div className="space-y-1.5">
                <p className={`text-[11px] font-bold uppercase tracking-wider ${muted}`}>
                  Your tagline — pick the one your surfaces use
                </p>
                {kit.taglines.map((line) => {
                  const chosen = (kit.selectedTagline ?? kit.taglines[0]) === line;
                  return (
                    <button
                      key={line}
                      type="button"
                      disabled={kitBusy !== null}
                      onClick={() => void pickTagline(line)}
                      className={`block w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition disabled:opacity-50 ${
                        chosen
                          ? "border-[#d4af37] bg-[#d4af37]/10 " + strong
                          : isLight
                            ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#d4af37]"
                            : "border-white/10 text-white/60 hover:border-[#d4af37]/60"
                      }`}
                    >
                      {line}
                      {chosen ? " · in use" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={kitBusy !== null || kit.colors.length === 0 || kit.fonts.length === 0}
                onClick={() => void applyKit()}
                className={`inline-flex items-center gap-2 rounded-full border border-[#d4af37]/60 px-4 py-2 text-xs font-bold transition hover:bg-[#d4af37]/10 disabled:opacity-40 ${
                  isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
                }`}
              >
                {kitBusy === "apply" ? "Applying…" : "Apply colors & fonts to my profile"}
              </button>
              <span className={`text-[11px] ${muted}`}>Free — your profile theme takes the kit's lead colors and fonts.</span>
            </div>
          </div>
        )}
      </SectionShell>

      {(kitNote || kitError) && (
        <p className={`px-1 text-xs font-semibold ${kitError ? "text-red-400" : isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {kitError ?? kitNote}
        </p>
      )}

      <NativeCard isLight={isLight} title={kit ? "Refresh your brand kit" : "Brand kit maker"}>
        <div className="space-y-2">
          <input
            className={inputCls(isLight)}
            value={genName}
            maxLength={80}
            onChange={(e) => setGenName(e.target.value)}
            placeholder="Brand name"
            aria-label="Brand name"
          />
          <input
            className={inputCls(isLight)}
            value={genVibe}
            maxLength={500}
            onChange={(e) => setGenVibe(e.target.value)}
            placeholder="The vibe — royal, bold, gold-on-black luxury…"
            aria-label="The vibe"
          />
          <input
            className={inputCls(isLight)}
            value={genIndustry}
            maxLength={80}
            onChange={(e) => setGenIndustry(e.target.value)}
            placeholder="Industry (optional)"
            aria-label="Industry (optional)"
          />
        </div>
        <button
          type="button"
          className={`${goldBtn} mt-3`}
          disabled={genBusy || !brandKitGenerateReady({ brandName: genName, vibe: genVibe })}
          onClick={() => void runGenerateKit()}
        >
          <Sparkles className="h-4 w-4" />
          {genBusy
            ? "Making your kit…"
            : `${kit ? "Regenerate" : "Generate"} brand kit — ${BRAND_KIT_GENERATE_COST_VISUAL_BUCS} VB`}
        </button>
        {kit && (
          <p className={`mt-2 text-xs ${muted}`}>
            Regenerating refreshes colors, fonts and taglines — your logo, bio lines and press facts are kept.
          </p>
        )}
      </NativeCard>

      <NativeCard isLight={isLight} title="Make a logo">
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="Logo style" className={selectCls(isLight)} value={logoStyle} onChange={(e) => setLogoStyle(e.target.value)}>
            {LOGO_STYLES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <select aria-label="Logo tier" className={selectCls(isLight)} value={logoModel} onChange={(e) => setLogoModel(e.target.value)}>
            {LOGO_MODELS.map((m) => (
              <option key={m.key} value={m.key}>{m.label} — {m.costVisualBucs} VB</option>
            ))}
          </select>
        </div>
        <CreateDeskRunner
          isLight={isLight}
          promptLabel="Brand name for the logo"
          prompt={logoName}
          onPromptChange={setLogoName}
          costVisualBucs={logoModelCost(logoModel)}
          state={logoJob}
          errorMessage={logoError}
          onRun={runLogo}
          runLabel="Make a logo"
          result={
            logoUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                <img src={logoUrl} alt="Your new logo" className="h-24 w-24 rounded-2xl border border-[#d4af37]/40 object-contain" />
                <p className={`text-xs ${muted}`}>Your logo, made right here. Saving it into your brand kit is on the website bench for now.</p>
              </div>
            ) : undefined
          }
        />
      </NativeCard>

      <NativeCard isLight={isLight} title="Make an intro / outro">
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="Intro or outro" className={selectCls(isLight)} value={introType} onChange={(e) => setIntroType(e.target.value)}>
            {INTRO_TYPES.map((tp) => (
              <option key={tp.key} value={tp.key}>{tp.label}</option>
            ))}
          </select>
        </div>
        <CreateDeskRunner
          isLight={isLight}
          promptLabel="Channel name for the sting"
          prompt={introName}
          onPromptChange={setIntroName}
          costVisualBucs={INTRO_COST_VISUAL_BUCS}
          state={introJob}
          errorMessage={introError}
          onRun={runIntro}
          runLabel="Make an intro/outro"
          result={
            introUrl ? (
              <div className="space-y-2">
                <video src={introUrl} controls className="w-full max-w-md rounded-2xl border border-[#d4af37]/40" />
                <p className={`text-xs ${muted}`}>Your 5-second sting, made right here in the room.</p>
              </div>
            ) : undefined
          }
        />
      </NativeCard>
    </div>
  );
}

/* ═══ 2. Press Kit Desk ══════════════════════════════════════════════ */

export function PressKitDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
  const [kit, setKit] = useState<PressKitSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [tone, setTone] = useState<string>("professional");
  const [regenBusy, setRegenBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* First-kit form (shown only when there is no kit yet). */
  const [artistName, setArtistName] = useState("");
  const [handle, setHandle] = useState("");
  const [genre, setGenre] = useState("");
  const [location, setLocation] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setState("loading");
      try {
        const res = await fetch("/api/press-kit/mine", { headers: await authHeaders() });
        if (!res.ok) throw new Error("mine");
        const data: unknown = await res.json();
        if (cancelled) return;
        setKit(parsePressKits(data)[0] ?? null);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, reloadTick]);

  if (isGuest) return <GuestGate isLight={isLight} desk="The Press Kit Desk" />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const regenerateBio = async () => {
    if (!kit || regenBusy) return;
    setRegenBusy(true);
    setNote(null);
    try {
      const res = await confirmedFetch(`/api/press-kit/${kit.id}/regenerate-bio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS,
        overrideFeature: "Press Kit Bio Refresh",
        body: JSON.stringify(buildRegenerateBioPayload(kit, tone)),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setNote("Out of Visual Bucs — top up and the bio refresh is ready again.");
        return;
      }
      if (!res.ok) {
        setNote("The bio couldn't be refreshed — a failed refresh is refunded. Try again.");
        return;
      }
      const updated = parsePressKits({ kits: [(data as Record<string, unknown>)["kit"]] })[0];
      if (updated) setKit(updated);
      setNote("Bio refreshed — the new words are on your kit, right here.");
      refreshProfile();
    } catch {
      setNote("The press desk didn't answer. Try again.");
    } finally {
      setRegenBusy(false);
    }
  };

  const generateFirstKit = async () => {
    if (generating || !pressKitGenerateReady(artistName, handle)) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await confirmedFetch("/api/press-kit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: PRESS_KIT_GENERATE_COST_VISUAL_BUCS,
        overrideFeature: "Press Kit Generator",
        body: JSON.stringify(buildPressKitGeneratePayload({ artistName, handle, genre, location })),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setGenError("Out of Visual Bucs — top up and the press desk is ready again.");
        return;
      }
      if (!res.ok) {
        const msg = (data as Record<string, unknown>)["message"];
        setGenError(typeof msg === "string" ? msg : "The press kit couldn't be generated — a failed generation is refunded.");
        return;
      }
      const created = parsePressKits({ kits: [(data as Record<string, unknown>)["kit"]] })[0];
      if (created) setKit(created);
      refreshProfile();
    } catch {
      setGenError("The press desk didn't answer. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="world-business-press-desk">
      <SectionShell
        isLight={isLight}
        title="Your press kit"
        state={state}
        loadingMessage="Opening your press kit…"
        errorMessage="Your press kit wouldn't open — your kits are safe on the real rails."
        onRetry={() => setReloadTick((n) => n + 1)}
      >
        {kit === null ? (
          <div className="space-y-3">
            <NativeEmptyState
              isLight={isLight}
              message="No press kit yet — make your first one right here."
              detail={`It writes your bio for you. Costs ${PRESS_KIT_GENERATE_COST_VISUAL_BUCS} Visual Bucs — shown before anything runs.`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Artist name" className={inputCls(isLight)} placeholder="Artist name" value={artistName} onChange={(e) => setArtistName(e.target.value)} />
              <input
                aria-label="Press kit handle"
                className={inputCls(isLight)}
                placeholder={artistName ? slugifyHandle(artistName) || "your-handle" : "your-handle"}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
              <input aria-label="Genre" className={inputCls(isLight)} placeholder="Genre (optional)" value={genre} onChange={(e) => setGenre(e.target.value)} />
              <input aria-label="Location" className={inputCls(isLight)} placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            {genError && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{genError}</p>}
            <button
              type="button"
              data-testid="world-press-kit-generate"
              onClick={generateFirstKit}
              disabled={generating || !pressKitGenerateReady(artistName, handle)}
              className={goldBtn}
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generating…" : `Generate my press kit — ${PRESS_KIT_GENERATE_COST_VISUAL_BUCS} Visual Bucs`}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {kit.photo_urls[0] ? (
                <img src={kit.photo_urls[0]} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#d4af37]/15">
                  <Newspaper className="h-6 w-6 text-[#d4af37]" />
                </span>
              )}
              <div className="min-w-0">
                <p className={`truncate text-sm font-black ${strong}`}>{kit.artist_name || kit.handle}</p>
                <p className={`truncate text-xs ${muted}`}>
                  /press/{kit.handle}
                  {kit.genre ? ` · ${kit.genre}` : ""}
                  {kit.location ? ` · ${kit.location}` : ""} · {kit.is_public ? "Public" : "Private"}
                </p>
                {kit.tagline ? <p className={`truncate text-xs ${muted}`}>{kit.tagline}</p> : null}
              </div>
            </div>
            {kit.bio ? (
              <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>{kit.bio}</p>
            ) : (
              <p className={`text-sm ${muted}`}>No bio written yet — refresh it below and the words land here.</p>
            )}
            {kit.achievements.length > 0 && (
              <p className={`text-xs ${muted}`}>Achievements: {kit.achievements.join(" · ")}</p>
            )}
            {kit.top_tracks.length > 0 && (
              <p className={`text-xs ${muted}`}>Top tracks: {kit.top_tracks.map((t) => t.title).join(" · ")}</p>
            )}
            {kit.booking_email ? <p className={`text-xs ${muted}`}>Booking: {kit.booking_email}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Bio tone" className={selectCls(isLight)} value={tone} onChange={(e) => setTone(e.target.value)}>
                {PRESS_KIT_TONES.map((tn) => (
                  <option key={tn} value={tn}>{tn[0]!.toUpperCase() + tn.slice(1)}</option>
                ))}
              </select>
              <button
                type="button"
                data-testid="world-press-kit-regenerate-bio"
                onClick={regenerateBio}
                disabled={regenBusy}
                className={goldBtn}
              >
                <RefreshCw className="h-4 w-4" />
                {regenBusy ? "Refreshing…" : `Regenerate the bio — ${PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS} Visual Bucs`}
              </button>
            </div>
            {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
            <p className={`text-xs ${muted}`}>Layout and theme editing for the kit lives on the website bench — the footer below takes you straight there.</p>
          </div>
        )}
      </SectionShell>
    </div>
  );
}

/* ═══ 3. Promote Desk ════════════════════════════════════════════════ */

type SectionState<T> = { status: "loading" | "failed" | "ready"; data: T | null };
const loading = <T,>(): SectionState<T> => ({ status: "loading", data: null });

export function PromoteDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [bio, setBio] = useState<SectionState<{ page: BioPageSummary; analytics: BioAnalytics | null }>>(loading());
  const [releases, setReleases] = useState<SectionState<{ list: ReleaseSummary[]; vaulted: number }>>(loading());
  const [scheduled, setScheduled] = useState<SectionState<{ posts: UpcomingPost[] }>>(loading());
  const [tick, setTick] = useState(0);

  /* Make a promo (promo-generator). */
  const [featureKey, setFeatureKey] = useState(SITE_FEATURES[0]!.key);
  const [contentType, setContentType] = useState<string>("twitter");
  const [promoTone, setPromoTone] = useState<string>("hype");
  const [focus, setFocus] = useState("");
  const [promoJob, setPromoJob] = useState<CreateDeskJobState>("idle");
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  /* Promo cards gallery (this sitting's pack — see the lib gap note). */
  const [cardTitle, setCardTitle] = useState("");
  const [cardArtist, setCardArtist] = useState("");
  const [cardStyle, setCardStyle] = useState<string>("out-now");
  const [cards, setCards] = useState<PromoCardItem[]>([]);
  const [cardCaption, setCardCaption] = useState<string | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsNote, setCardsNote] = useState<string | null>(null);

  /* Coach row. */
  const [coachBusy, setCoachBusy] = useState(false);
  const [coach, setCoach] = useState<CoachTodayAction | null>(null);
  const [coachNote, setCoachNote] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bio-pages/me", { headers: await authHeaders() });
        if (!res.ok) throw new Error("bio");
        const page = parseBioPages((await res.json()) as unknown)[0] ?? null;
        if (cancelled) return;
        if (!page) {
          setBio({ status: "ready", data: null });
          return;
        }
        let analytics: BioAnalytics | null = null;
        try {
          const aRes = await fetch(`/api/bio-pages/${page.id}/analytics`, { headers: await authHeaders() });
          if (aRes.ok) analytics = parseBioAnalytics((await aRes.json()) as unknown);
        } catch {
          /* analytics is a strip, not the desk — a miss stays a miss */
        }
        if (!cancelled) setBio({ status: "ready", data: { page, analytics } });
      } catch {
        if (!cancelled) setBio({ status: "failed", data: null });
      }
    })();
    (async () => {
      try {
        const [rRes, vRes] = await Promise.all([
          fetch("/api/distribution/releases", { headers: await authHeaders() }),
          fetch("/api/catalog-vault/status", { headers: await authHeaders() }),
        ]);
        if (!rRes.ok) throw new Error("releases");
        const list = parseReleases((await rRes.json()) as unknown);
        const vaulted = vRes.ok ? parseVaultedCount((await vRes.json()) as unknown) : 0;
        if (!cancelled) setReleases({ status: "ready", data: { list, vaulted } });
      } catch {
        if (!cancelled) setReleases({ status: "failed", data: null });
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/scheduler/posts?status=scheduled", { headers: await authHeaders() });
        if (!res.ok) throw new Error("scheduler");
        const posts = parseScheduledPosts((await res.json()) as unknown);
        if (!cancelled) setScheduled({ status: "ready", data: { posts } });
      } catch {
        if (!cancelled) setScheduled({ status: "failed", data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  if (isGuest) return <GuestGate isLight={isLight} desk="The Promote Desk" />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const feature = SITE_FEATURES.find((f) => f.key === featureKey) ?? SITE_FEATURES[0]!;

  const runPromo = async () => {
    if (promoJob === "running") return;
    setPromoJob("running");
    setPromoError(null);
    setPromoResult(null);
    try {
      const res = await fetch("/api/promo-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildPromoGeneratorPayload({
            featureName: feature.name,
            featureTagline: feature.tagline,
            featureRoute: feature.route,
            contentType,
            tone: promoTone,
            focus,
          }),
        ),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setPromoJob("failed");
        setPromoError("Out of Visual Bucs — top up and the promo desk is ready again.");
        return;
      }
      const parsed = parsePromoResult(data);
      if (!res.ok || !parsed) {
        setPromoJob("failed");
        setPromoError("The promo couldn't be written right now. Try again.");
        return;
      }
      setPromoResult(parsed);
      setPromoJob("done");
      refreshProfile();
    } catch {
      setPromoJob("failed");
      setPromoError("The promo desk didn't answer. Try again.");
    }
  };

  const runCards = async () => {
    if (cardsBusy || cardTitle.trim().length < 2 || cardArtist.trim().length < 2) return;
    setCardsBusy(true);
    setCardsNote(null);
    try {
      const res = await confirmedFetch("/api/promo-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPromoCardsPayload({ releaseTitle: cardTitle, artistName: cardArtist, style: cardStyle })),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCardsNote("The cards couldn't be made — a failed pack is refunded. Try again.");
        return;
      }
      const { cards: made, suggestedCaption } = parsePromoCards(data);
      if (made.length === 0) {
        setCardsNote("The card desk answered without any cards. Try again.");
        return;
      }
      setCards(made);
      setCardCaption(suggestedCaption);
      refreshProfile();
    } catch {
      setCardsNote("The card desk didn't answer. Try again.");
    } finally {
      setCardsBusy(false);
    }
  };

  const askCoach = async () => {
    if (coachBusy) return;
    setCoachBusy(true);
    setCoachNote(null);
    try {
      const res = await confirmedFetch("/api/monetization-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCoachPayload()),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setCoachNote("Out of Visual Bucs — top up and the coach is ready again.");
        return;
      }
      const parsed = parseCoachTodayAction(data);
      if (!res.ok || !parsed) {
        setCoachNote("The coach couldn't build a plan right now — a failed plan is refunded. Try again.");
        return;
      }
      setCoach(parsed);
      refreshProfile();
    } catch {
      setCoachNote("The coach didn't answer. Try again.");
    } finally {
      setCoachBusy(false);
    }
  };

  const retryAll = () => {
    setBio(loading());
    setReleases(loading());
    setScheduled(loading());
    setTick((n) => n + 1);
  };

  return (
    <div className="space-y-3" data-testid="world-business-promote-desk">
      <SectionShell
        isLight={isLight}
        title="Your link-in-bio"
        state={bio.status}
        loadingMessage="Opening your link-in-bio…"
        errorMessage="Your link-in-bio wouldn't open — your page is safe on the real rails."
        onRetry={retryAll}
      >
        {bio.data === null ? (
          <NativeEmptyState
            isLight={isLight}
            message="No link-in-bio page yet."
            detail="Start one on the website bench (the footer below) and its status and numbers will stand on this desk."
          />
        ) : (
          <div className="space-y-2">
            <p className={`text-sm font-black ${strong}`}>{bio.data.page.displayName}</p>
            {bio.data.page.headline ? <p className={`text-xs ${muted}`}>{bio.data.page.headline}</p> : null}
            <p className={`text-xs ${muted}`}>
              {bioPageStatusLine(bio.data.page)} · {bio.data.page.linkCount} link{bio.data.page.linkCount === 1 ? "" : "s"} ·{" "}
              {bio.data.page.viewCount.toLocaleString("en-US")} views
            </p>
            {bio.data.analytics ? (
              <div className="flex flex-wrap gap-2" data-testid="world-promote-analytics-strip">
                {[
                  `${bio.data.analytics.views.toLocaleString("en-US")} views`,
                  `${bio.data.analytics.totalClicks.toLocaleString("en-US")} link clicks`,
                  `${bio.data.analytics.clicksLast7d.toLocaleString("en-US")} clicks in 7 days`,
                ].map((s) => (
                  <span key={s} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/60"}`}>{s}</span>
                ))}
              </div>
            ) : (
              <p className={`text-xs ${muted}`}>The numbers strip didn't load this time — the page itself is fine.</p>
            )}
          </div>
        )}
      </SectionShell>

      <NativeCard isLight={isLight} title="Make a promo">
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="What to promote" className={selectCls(isLight)} value={featureKey} onChange={(e) => setFeatureKey(e.target.value)}>
            {SITE_FEATURES.map((f) => (
              <option key={f.key} value={f.key}>{f.name}</option>
            ))}
          </select>
          <select aria-label="Promo format" className={selectCls(isLight)} value={contentType} onChange={(e) => setContentType(e.target.value)}>
            {PROMO_CONTENT_TYPES.map((ct) => (
              <option key={ct.key} value={ct.key}>{ct.label}</option>
            ))}
          </select>
          <select aria-label="Promo tone" className={selectCls(isLight)} value={promoTone} onChange={(e) => setPromoTone(e.target.value)}>
            {PROMO_TONES.map((tn) => (
              <option key={tn.key} value={tn.key}>{tn.label}</option>
            ))}
          </select>
        </div>
        <CreateDeskRunner
          isLight={isLight}
          promptLabel="What should this promo focus on?"
          prompt={focus}
          onPromptChange={setFocus}
          costVisualBucs={PROMO_GENERATOR_COST_VISUAL_BUCS}
          state={promoJob}
          errorMessage={promoError}
          onRun={runPromo}
          runLabel="Make a promo"
          result={
            promoResult ? (
              <div className="space-y-2">
                {promoResult.title ? <p className={`text-sm font-black ${strong}`}>{promoResult.title}</p> : null}
                {promoResult.body ? <p className={`whitespace-pre-wrap text-sm ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>{promoResult.body}</p> : null}
                {promoResult.extras.map((ex, i) => (
                  <p key={i} className={`whitespace-pre-wrap text-sm ${muted}`}>{ex}</p>
                ))}
                {promoResult.cta ? <p className={`text-sm font-bold ${strong}`}>{promoResult.cta}</p> : null}
                {promoResult.hashtags.length > 0 && <p className={`text-xs ${muted}`}>{promoResult.hashtags.join(" ")}</p>}
              </div>
            ) : undefined
          }
        />
      </NativeCard>

      <NativeCard isLight={isLight} title="Promo cards">
        <div className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Release title" className={inputCls(isLight)} placeholder="Release title" value={cardTitle} onChange={(e) => setCardTitle(e.target.value)} />
          <input aria-label="Artist name for cards" className={inputCls(isLight)} placeholder="Artist name" value={cardArtist} onChange={(e) => setCardArtist(e.target.value)} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select aria-label="Card style" className={selectCls(isLight)} value={cardStyle} onChange={(e) => setCardStyle(e.target.value)}>
            {PROMO_CARD_STYLES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <span className={`text-xs font-semibold ${muted}`}>
            Costs {PROMO_CARDS_COST_VISUAL_BUCS} Visual Bucs for the pack (all three sizes) — shown before anything runs.
          </span>
          <button
            type="button"
            data-testid="world-promote-make-cards"
            onClick={runCards}
            disabled={cardsBusy || cardTitle.trim().length < 2 || cardArtist.trim().length < 2}
            className={`${goldBtn} ml-auto`}
          >
            <Megaphone className="h-4 w-4" /> {cardsBusy ? "Making…" : "Make promo cards"}
          </button>
        </div>
        {cardsNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{cardsNote}</p>}
        {cards.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2" data-testid="world-promote-cards-gallery">
              {cards.map((c, i) => (
                <figure key={`${c.url}-${i}`} className="w-28">
                  <img src={c.url} alt="" className="w-28 rounded-xl border border-[#d4af37]/40 object-cover" />
                  <figcaption className={`mt-1 text-center text-[11px] font-semibold ${muted}`}>{c.style} · {c.size}</figcaption>
                </figure>
              ))}
            </div>
            {cardCaption ? <p className={`text-xs ${muted}`}>Suggested caption: {cardCaption}</p> : null}
          </div>
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message="No promo cards on the stand yet."
            detail="Cards you make here stand in this gallery for this sitting — there's no saved card shelf yet, on the website either (it's in this desk's follow-on log)."
          />
        )}
      </NativeCard>

      <NativeBoard isLight={isLight} title="Folded in — status here, the bench one tap out">
        <div className="space-y-3">
          <NativeCard isLight={isLight} title="Release Desk">
            {releases.status === "loading" ? (
              <NativeLoadingState isLight={isLight} message="Checking your releases…" />
            ) : releases.status === "failed" || !releases.data ? (
              <NativeErrorState isLight={isLight} message="Your releases wouldn't open — nothing about them changed." onRetry={retryAll} />
            ) : (
              <div className="space-y-1.5">
                <p className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>{releaseDeskLine(releases.data.list, releases.data.vaulted)}</p>
                {releases.data.list.slice(0, 3).map((r) => (
                  <NativeBoardRow key={r.id} isLight={isLight} title={r.title} detail={r.artistName || undefined} meta={`${r.releaseType} · ${r.status}`} />
                ))}
                <div className="flex justify-end pt-1"><RowTransfer websitePath="/distribute" isLight={isLight} /></div>
              </div>
            )}
          </NativeCard>

          <NativeCard isLight={isLight} title="Scheduler">
            {scheduled.status === "loading" ? (
              <NativeLoadingState isLight={isLight} message="Checking what's coming up…" />
            ) : scheduled.status === "failed" || !scheduled.data ? (
              <NativeErrorState isLight={isLight} message="Your upcoming posts wouldn't open — the schedule itself is untouched." onRetry={retryAll} />
            ) : upcomingPosts(scheduled.data.posts).length === 0 ? (
              <div className="space-y-2">
                <NativeEmptyState isLight={isLight} message="Nothing scheduled right now." detail="The calendar bench is one tap out — plan the next post there." />
                <div className="flex justify-end"><RowTransfer websitePath="/scheduler" isLight={isLight} /></div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {upcomingPosts(scheduled.data.posts).map((p) => (
                  <NativeBoardRow
                    key={p.id}
                    isLight={isLight}
                    title={p.caption || "Scheduled post"}
                    detail={`${prettyDateTime(p.scheduledAt)} · ${countdownLabel(p.scheduledAt)}`}
                    meta={p.platforms.join(", ") || undefined}
                  />
                ))}
                <div className="flex justify-end pt-1"><RowTransfer websitePath="/scheduler" isLight={isLight} /></div>
              </div>
            )}
          </NativeCard>

          <NativeCard isLight={isLight} title="Coach — today's next action">
            {coach ? (
              <div className="space-y-1.5">
                <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
                  <Crown className="h-4 w-4 text-[#d4af37]" /> {coach.label}
                </p>
                {coach.firstMove ? <p className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>{coach.firstMove}</p> : null}
                {coach.stateSummary ? <p className={`text-xs ${muted}`}>{coach.stateSummary}</p> : null}
                <div className="flex justify-end pt-1"><RowTransfer websitePath="/coach" isLight={isLight} /></div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className={`text-sm ${muted}`}>
                  Ask the coach for today's one next move, from your real catalog. Costs {COACH_COST_VISUAL_BUCS} Visual Bucs — shown
                  before anything runs. The full money plan is the bench, one tap out.
                </p>
                {coachNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{coachNote}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" data-testid="world-promote-ask-coach" onClick={askCoach} disabled={coachBusy} className={goldBtn}>
                    <Sparkles className="h-4 w-4" /> {coachBusy ? "Asking…" : `Ask the coach — ${COACH_COST_VISUAL_BUCS} Visual Bucs`}
                  </button>
                  <span className="ml-auto"><RowTransfer websitePath="/coach" isLight={isLight} /></span>
                </div>
              </div>
            )}
          </NativeCard>
        </div>
      </NativeBoard>
    </div>
  );
}
