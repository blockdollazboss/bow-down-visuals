import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Camera, Crown, Download, Megaphone, Newspaper, Palette, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeLoadingState, NativeEmptyState, NativeErrorState } from "./NativeStates";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import { TRANSFER_BUTTON_LABEL } from "@/lib/world/station-panel";
import { fetchBrandKit, type BrandKit } from "@/lib/brand-kit";
import { slugifyHandle } from "@/lib/press-kit";
import { SITE_FEATURES } from "@/data/features";
import { prettyDateTime, countdownLabel } from "@/lib/scheduler";
import {
  LOGO_MODELS,
  LOGO_STYLES,
  logoModelCost,
  INTRO_COST_VISUAL_BUCS,
  INTRO_TYPES,
  HEADSHOT_COST_VISUAL_BUCS,
  HEADSHOT_FLOWS,
  HEADSHOT_PRESETS,
  HEADSHOT_MODELS,
  buildHeadshotPayload,
  headshotReady,
  parseHeadshotFailure,
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

  /* Headshot bench (the Headshot Studio's rail, native). The rail is
   * synchronous — one POST settles the make — so this is the press
   * desk's busy/note shape rather than a polled job. */
  const [hsFlow, setHsFlow] = useState<string>("autopilot");
  const [hsPreset, setHsPreset] = useState<string>("studio");
  const [hsPrompt, setHsPrompt] = useState("");
  const [hsModel, setHsModel] = useState<string>("nano-banana-2.1");
  const [hsRef, setHsRef] = useState("");
  const [hsBusy, setHsBusy] = useState(false);
  const [hsUrl, setHsUrl] = useState<string | null>(null);
  const [hsError, setHsError] = useState<string | null>(null);

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

  const runHeadshot = async () => {
    if (hsBusy || !headshotReady(hsFlow, hsPrompt)) return;
    setHsBusy(true);
    setHsError(null);
    setHsUrl(null);
    try {
      const res = await confirmedFetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: HEADSHOT_COST_VISUAL_BUCS,
        overrideFeature: "Headshot",
        body: JSON.stringify(
          buildHeadshotPayload({ flow: hsFlow, preset: hsPreset, promptText: hsPrompt, model: hsModel, referenceImageUrl: hsRef }),
        ),
      });
      if (!res) return; /* the member declined the credit confirmation */
      const data: unknown = await res.json().catch(() => ({}));
      const failure = parseHeadshotFailure(res.status, data);
      if (failure) {
        setHsError(
          failure.kind === "credits"
            ? "Out of Visual Bucs — top up and the headshot bench is ready again."
            : failure.kind === "provider"
              ? "Headshots aren't connected in the palace right now — try the other engine above, or the website bench below."
              : res.status === 400 && failure.message
                ? failure.message
                : "The headshot couldn't be made — a failed make is not charged. Try again.",
        );
        return;
      }
      const start = parseJobStart(data);
      if (!start.url) {
        setHsError("The bench answered without a headshot. Try again.");
        return;
      }
      setHsUrl(start.url);
      refreshProfile();
    } catch {
      setHsError("The headshot bench didn't answer. Try again.");
    } finally {
      setHsBusy(false);
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
            detail="Generate one on the website (the footer below) and your logo, colors and fonts will stand on this desk. The two makers below work either way."
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
              <p className={`text-xs ${muted}`}>Taglines: {kit.taglines.join(" · ")}</p>
            )}
          </div>
        )}
      </SectionShell>

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

      <NativeCard isLight={isLight} title="Make a headshot">
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            aria-label="Headshot flow"
            className={selectCls(isLight)}
            value={hsFlow}
            disabled={hsBusy}
            onChange={(e) => { setHsFlow(e.target.value); setHsError(null); }}
          >
            {HEADSHOT_FLOWS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          {hsFlow === "preset" && (
            <select aria-label="Headshot style" className={selectCls(isLight)} value={hsPreset} disabled={hsBusy} onChange={(e) => setHsPreset(e.target.value)}>
              {HEADSHOT_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          )}
          <select aria-label="Headshot engine" className={selectCls(isLight)} value={hsModel} disabled={hsBusy} onChange={(e) => setHsModel(e.target.value)}>
            {HEADSHOT_MODELS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
        {hsFlow === "autopilot" && (
          <p className={`mb-3 text-sm ${muted}`}>
            One tap — the bench picks the most flattering studio look for you: lighting, backdrop, framing, everything.
          </p>
        )}
        {hsFlow === "manual" && (
          <textarea
            aria-label="Describe the headshot"
            value={hsPrompt}
            onChange={(e) => setHsPrompt(e.target.value)}
            disabled={hsBusy}
            rows={3}
            placeholder="Describe the look — e.g. dramatic black-and-white headshot, hard shadows, film-noir mood…"
            className={`mb-3 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
              isLight
                ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
                : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
            }`}
          />
        )}
        <input
          aria-label="Face reference photo URL (optional)"
          className={`${inputCls(isLight)} mb-3`}
          placeholder="Face reference (optional) — paste a photo URL and the headshot keeps your face"
          value={hsRef}
          disabled={hsBusy}
          onChange={(e) => setHsRef(e.target.value)}
        />
        {hsError && <p className={`mb-3 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{hsError}</p>}
        <button
          type="button"
          data-testid="world-branding-headshot-generate"
          onClick={runHeadshot}
          disabled={hsBusy || !headshotReady(hsFlow, hsPrompt)}
          className={goldBtn}
        >
          <Camera className="h-4 w-4" />
          {hsBusy ? "Making your headshot…" : `Make my headshot — ${HEADSHOT_COST_VISUAL_BUCS} Visual Bucs`}
        </button>
        <p className={`mt-2 text-xs ${muted}`}>Charged only if the headshot succeeds — a failed make is never charged.</p>
        {hsUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <img src={hsUrl} alt="Your new headshot" className="h-32 w-32 rounded-2xl border border-[#d4af37]/40 object-cover" />
            <div className="space-y-2">
              <p className={`text-xs ${muted}`}>Your headshot, made right here in the room — saved to your account like the website studio's.</p>
              <a href={hsUrl} download target="_blank" rel="noreferrer" className={goldBtn}>
                <Download className="h-4 w-4" />
                Download
              </a>
            </div>
          </div>
        )}
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
