import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { CalendarClock, Camera, Check, Crown, Download, FolderPlus, Layers, Link2, Megaphone, Newspaper, Palette, Pencil, Plus, RefreshCw, Rocket, Share2, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { downloadImage } from "@/lib/download-image";
import { promoCardFileName, promoCardSharePayload } from "@/lib/promo-card-history";
import { NativeCard } from "./NativeCard";
import { ReleaseDeskSection } from "./ReleaseDesk";
import { SchedulerDeskSection } from "./SchedulerDesk";
import type { SchedulerPrefill } from "@/lib/world/scheduler-desk";
import { NativeBoard } from "./NativeBoard";
import { NativeLoadingState, NativeEmptyState, NativeErrorState } from "./NativeStates";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import { TRANSFER_BUTTON_LABEL } from "@/lib/world/station-panel";
import { applyBrandKit, fetchBrandKit, saveBrandKit, type BrandKit } from "@/lib/brand-kit";
import {
  fetchMyStreamPackAssets,
  setStreamPackAssetApplied,
  type StreamPackAssetRecord,
} from "@/lib/stream-pack";
import { slugifyHandle } from "@/lib/press-kit";
import { SITE_FEATURES } from "@/data/features";
import {
  BRAND_KIT_GENERATE_COST_VISUAL_BUCS,
  buildBrandKitGeneratePayload,
  brandKitGenerateReady,
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
  STREAM_PACK_COST_VISUAL_BUCS,
  STREAM_PACK_THEMES,
  STREAM_PACK_ASSETS,
  streamPackGenerateReady,
  buildStreamPackGeneratePayload,
  parseStreamPackGenerate,
  streamPackThemeLabel,
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
  BIO_MAX_LINKS,
  BIO_PAGE_THEMES,
  BIO_PUBLISH_COST_VISUAL_BUCS,
  BIO_SOCIAL_FIELDS,
  bioDraftFromPage,
  bioPublishBlocker,
  buildBioSavePayload,
  emptyBioDraft,
  parseBioPageFull,
  parseBioPublishResult,
  validateBioDraft,
  type BioPageDraft,
  type BioPageFull,
  buildPromoGeneratorPayload,
  parsePromoResult,
  PROMO_CONTENT_TYPES,
  PROMO_TONES,
  buildPromoCardsPayload,
  parsePromoCards,
  PROMO_CARD_STYLES,
  buildCoachPayload,
  parseCoachTodayAction,
  type PressKitSummary,
  type BioPageSummary,
  type BioAnalytics,
  type PromoResult,
  type PromoCardItem,
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

  /* Stream pack bench (the Stream Pack page's rails, native). The
   * generate rail is synchronous like the headshot rail — one POST
   * settles the make — and the library + apply half rides the shared
   * lib/stream-pack seam, the same reads and writes the website's
   * library and the Go Live studio tray use. */
  const [spChannel, setSpChannel] = useState("");
  const [spTheme, setSpTheme] = useState<string>("gold-luxury");
  const [spAsset, setSpAsset] = useState<string>("webcam-frame");
  const [spBusy, setSpBusy] = useState(false);
  const [spUrl, setSpUrl] = useState<string | null>(null);
  const [spMadeLabel, setSpMadeLabel] = useState<string | null>(null);
  const [spError, setSpError] = useState<string | null>(null);
  const [spLibrary, setSpLibrary] = useState<StreamPackAssetRecord[] | null>(null);
  const [spLibState, setSpLibState] = useState<"loading" | "failed" | "ready">("loading");
  const [spLibTick, setSpLibTick] = useState(0);
  const [spApplyingId, setSpApplyingId] = useState<string | null>(null);
  const [spLibError, setSpLibError] = useState<string | null>(null);

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
          setSpChannel((v) => v || record.brandName);
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

  /* The stream pack shelf: the member's recorded graphics, read
   * through the shared seam. A failed load is an honest failure with
   * a retry — never a fake empty shelf. */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setSpLibState("loading");
      try {
        const assets = await fetchMyStreamPackAssets(getAccessToken);
        if (cancelled) return;
        setSpLibrary(assets);
        setSpLibState("ready");
      } catch {
        if (!cancelled) setSpLibState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, spLibTick]);

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

  const runStreamPack = async () => {
    if (spBusy || !streamPackGenerateReady(spChannel)) return;
    setSpBusy(true);
    setSpError(null);
    setSpUrl(null);
    setSpMadeLabel(null);
    try {
      const res = await confirmedFetch("/api/stream-pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: STREAM_PACK_COST_VISUAL_BUCS,
        overrideFeature: "Stream Pack Generator",
        body: JSON.stringify(
          buildStreamPackGeneratePayload({ channelName: spChannel, theme: spTheme, asset: spAsset }),
        ),
      });
      if (!res) return; /* the member declined the credit confirmation */
      const data: unknown = await res.json().catch(() => ({}));
      const outcome = parseStreamPackGenerate(res.status, data);
      if (outcome.kind === "credits") {
        setSpError("Out of Visual Bucs — top up and the stream pack bench is ready again.");
        return;
      }
      if (outcome.kind === "failed") {
        setSpError(
          outcome.message ??
            "The graphic couldn't be made — a failed make is not charged. Try again.",
        );
        return;
      }
      setSpUrl(outcome.url);
      setSpMadeLabel(outcome.label);
      refreshProfile();
      /* The server recorded this graphic — refresh the shelf so it
         shows up below as a durable, applicable asset. */
      setSpLibTick((n) => n + 1);
    } catch {
      setSpError("The stream pack bench didn't answer. Try again.");
    } finally {
      setSpBusy(false);
    }
  };

  /* Apply / unapply one shelf graphic for the Go Live studio tray.
   * The server re-checks ownership and answers with the record as it
   * now stands; the shelf renders from that answer. */
  const toggleSpApplied = async (asset: StreamPackAssetRecord) => {
    if (spApplyingId) return;
    setSpApplyingId(asset.id);
    setSpLibError(null);
    try {
      const updated = await setStreamPackAssetApplied(
        getAccessToken,
        asset.id,
        !asset.appliedToStudio,
      );
      setSpLibrary((list) =>
        (list ?? []).map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch {
      setSpLibError("That change didn't save — your pack is unchanged. Try again.");
    } finally {
      setSpApplyingId(null);
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

      <NativeCard isLight={isLight} title="Stream pack bench">
        <div data-testid="world-stream-pack-bench" className="space-y-3">
          <p className={`text-sm ${muted}`}>
            Branded graphics for your stream — overlays, alerts, panels and screens, made in your
            channel's theme. Every graphic is recorded to your pack here and on the website.
          </p>
          <input
            aria-label="Channel name for the pack"
            className={inputCls(isLight)}
            value={spChannel}
            maxLength={40}
            onChange={(e) => setSpChannel(e.target.value.slice(0, 40))}
            placeholder="Channel name"
            disabled={spBusy}
          />
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Stream pack theme"
              className={selectCls(isLight)}
              value={spTheme}
              disabled={spBusy}
              onChange={(e) => setSpTheme(e.target.value)}
            >
              {STREAM_PACK_THEMES.map((theme) => (
                <option key={theme.key} value={theme.key}>{theme.label}</option>
              ))}
            </select>
            <select
              aria-label="Stream pack graphic"
              className={selectCls(isLight)}
              value={spAsset}
              disabled={spBusy}
              onChange={(e) => setSpAsset(e.target.value)}
            >
              {STREAM_PACK_ASSETS.map((asset) => (
                <option key={asset.key} value={asset.key}>{asset.label} · {asset.group}</option>
              ))}
            </select>
          </div>
          {spError && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{spError}</p>}
          <button
            type="button"
            data-testid="world-stream-pack-generate"
            onClick={runStreamPack}
            disabled={spBusy || !streamPackGenerateReady(spChannel)}
            className={goldBtn}
          >
            <Layers className="h-4 w-4" />
            {spBusy ? "Making your graphic…" : `Make this graphic — ${STREAM_PACK_COST_VISUAL_BUCS} Visual Bucs`}
          </button>
          <p className={`text-xs ${muted}`}>Charged only when the graphic is made — a failed make is never charged.</p>
          {spUrl && (
            <div className="flex flex-wrap items-center gap-3">
              <img src={spUrl} alt={spMadeLabel ?? "Your new stream graphic"} className="h-24 w-40 rounded-2xl border border-[#d4af37]/40 object-cover" />
              <div className="space-y-2">
                <p className={`text-xs ${muted}`}>
                  {spMadeLabel ?? "Your graphic"}, made right here in the room — it is on your shelf
                  below and in your stream pack library on the website.
                </p>
                <a href={spUrl} download target="_blank" rel="noreferrer" className={goldBtn}>
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </div>
            </div>
          )}

          <div className="border-t border-[#d4af37]/20 pt-3">
            <p className={`mb-2 text-[11px] font-bold uppercase tracking-wider ${muted}`}>Your stream pack</p>
            {spLibState === "loading" ? (
              <NativeLoadingState isLight={isLight} message="Opening your stream pack…" />
            ) : spLibState === "failed" ? (
              <NativeErrorState
                isLight={isLight}
                message="Your stream pack wouldn't open — your graphics are safe on the real rails."
                onRetry={() => setSpLibTick((n) => n + 1)}
              />
            ) : spLibrary !== null && spLibrary.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No stream graphics yet."
                detail="Make one above — it lands here, in your website library, and in your Go Live studio when you add it."
              />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(spLibrary ?? []).map((asset) => {
                  const themeName = streamPackThemeLabel(asset.themeId);
                  return (
                    <div
                      key={asset.id}
                      className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/[0.03]"}`}
                    >
                      <img src={asset.url} alt={asset.label} className="aspect-video w-full object-cover bg-black" loading="lazy" />
                      <div className="space-y-2 px-3 py-2.5">
                        <p className={`truncate text-sm font-semibold ${strong}`}>{asset.label}</p>
                        {(themeName || asset.channelName) && (
                          <p className={`truncate text-xs ${muted}`}>
                            {[themeName, asset.channelName].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {asset.appliedToStudio ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#d4af37]/60 bg-[#d4af37]/10 px-3 py-1.5 text-xs font-bold text-[#d4af37]">
                              <Check className="h-3.5 w-3.5" />
                              In your studio
                            </span>
                            <button
                              type="button"
                              data-testid={`world-stream-pack-apply-${asset.id}`}
                              onClick={() => void toggleSpApplied(asset)}
                              disabled={spApplyingId === asset.id}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                                isLight
                                  ? "border-[#C9A84C]/40 text-[#6B5B36] hover:border-[#d4af37]"
                                  : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                              }`}
                            >
                              {spApplyingId === asset.id ? "Saving…" : "Remove"}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-testid={`world-stream-pack-apply-${asset.id}`}
                            onClick={() => void toggleSpApplied(asset)}
                            disabled={spApplyingId === asset.id}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-[1.02] disabled:opacity-60"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {spApplyingId === asset.id ? "Saving…" : "Add to my studio"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {spLibError && (
              <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{spLibError}</p>
            )}
          </div>
        </div>
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

/* ─── Link-in-bio editor (Stack-100 #59) ─────────────────────────────
   The Promote Desk's bio section, finished: create, edit (links,
   themes, slug, avatar, socials, tip jar), publish and unpublish all
   complete HERE on the bio-pages routes' own rails. Drafting and
   saving are free; publishing is the registry's 100 Visual Bucs and
   rides the credit confirmation (confirmedFetch) exactly like the
   website builder. The editor loads the full page itself
   (GET /api/bio-pages/me) — the desk header above stays a summary. */

function BioPageEditor({ isLight, onChanged }: { isLight: boolean; onChanged?: () => void }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [page, setPage] = useState<BioPageFull | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<BioPageDraft>(() => emptyBioDraft());
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "unpublish" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bio-pages/me", { headers: await authHeaders() });
      if (!res.ok) throw new Error("bio");
      const full = parseBioPageFull((await res.json()) as unknown);
      setPage(full);
      setLoadFailed(false);
      if (full && seededFor !== full.id) {
        setDraft(bioDraftFromPage(full));
        setSeededFor(full.id);
      }
      if (!full && seededFor !== "new") {
        setDraft(emptyBioDraft());
        setSeededFor("new");
        setEditing(true);
      }
    } catch {
      setLoadFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededFor]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const set = (patch: Partial<BioPageDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (busy) return;
    const problem = validateBioDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const creating = !page;
      const res = await fetch(creating ? "/api/bio-pages" : `/api/bio-pages/${page!.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildBioSavePayload(draft)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { error?: string };
        setError(d.error ?? "That save didn't land — try again.");
        return;
      }
      const saved = parseBioPageFull(data);
      if (saved) {
        setPage(saved);
        setSeededFor(saved.id);
        setDraft(bioDraftFromPage(saved));
      }
      setNote(creating ? "Your page is created — a draft for now. Publish it below when the links are right." : "Saved — your page carries the new words.");
      setEditing(false);
      onChanged?.();
    } catch {
      setError("The bio desk didn't answer. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (busy || !page) return;
    const blocker = bioPublishBlocker(draft);
    if (blocker) {
      setError(blocker);
      setEditing(true);
      return;
    }
    setBusy("publish");
    setError(null);
    setNote(null);
    try {
      const res = await confirmedFetch(`/api/bio-publish/${page.id}`, { method: "POST" });
      if (!res) return; // confirmation declined — nothing charged, nothing published
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { error?: string; message?: string };
        setError(
          res.status === 402
            ? "Out of Visual Bucs — top up and publishing is ready again."
            : res.status === 409
              ? "This page is already published."
              : (d.message ?? d.error ?? "Publishing didn't land — a failed publish is refunded. Try again."),
        );
        return;
      }
      const { url } = parseBioPublishResult(data);
      setPage({ ...page, isPublished: true, url: url ?? page.url });
      setNote(`Live! Your page is up${url ? ` at ${url}` : ""} — share it everywhere.`);
      refreshProfile();
      onChanged?.();
    } catch {
      setError("Publishing didn't answer — a failed publish is refunded. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (busy || !page) return;
    setBusy("unpublish");
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/bio-pages/${page.id}/unpublish`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("unpublish");
      setPage({ ...page, isPublished: false });
      setNote("Taken offline — the page is a draft again, and republishing costs the standard publish price.");
      onChanged?.();
    } catch {
      setError("That didn't land — your page is still as it was. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return (
      <div className="mt-3" data-testid="world-bio-editor">
        <NativeErrorState
          isLight={isLight}
          message="The page editor wouldn't open — your page itself is safe on the real rails."
          onRetry={() => void load()}
        />
      </div>
    );
  }
  if (page === undefined) {
    return (
      <div className="mt-3" data-testid="world-bio-editor">
        <NativeLoadingState isLight={isLight} message="Opening the page editor…" />
      </div>
    );
  }

  const linkRowCls = inputCls(isLight);

  return (
    <div className="mt-3 space-y-2" data-testid="world-bio-editor">
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          <Link2 className="mr-1 inline h-3.5 w-3.5" />
          {page ? "Edit your page" : "Start your page — free"}
        </p>
        {page && !editing ? (
          <button type="button" data-testid="world-bio-edit-open" onClick={() => setEditing(true)} className={`${goldBtn} ml-auto`}>
            <Pencil className="h-4 w-4" /> Edit links, theme &amp; address
          </button>
        ) : null}
        {page?.isPublished ? (
          <button type="button" data-testid="world-bio-unpublish" onClick={() => void unpublish()} disabled={busy !== null} className={`${goldBtn} ml-auto`}>
            {busy === "unpublish" ? "Taking offline…" : "Take it offline — free"}
          </button>
        ) : page ? (
          <button type="button" data-testid="world-bio-publish" onClick={() => void publish()} disabled={busy !== null} className={`${goldBtn} ml-auto`}>
            <Rocket className="h-4 w-4" /> {busy === "publish" ? "Publishing…" : `Publish — ${BIO_PUBLISH_COST_VISUAL_BUCS} Visual Bucs`}
          </button>
        ) : null}
      </div>

      {editing || !page ? (
        <div className="space-y-2" data-testid="world-bio-form">
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Display name" data-testid="world-bio-name" className={linkRowCls} placeholder="Display name *" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={80} />
            <input aria-label="Headline" className={linkRowCls} placeholder="Headline" value={draft.headline} onChange={(e) => set({ headline: e.target.value })} maxLength={120} />
          </div>
          <textarea aria-label="About line" className={linkRowCls} rows={2} placeholder="A line or two about you" value={draft.bio} onChange={(e) => set({ bio: e.target.value })} maxLength={600} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Avatar image link" data-testid="world-bio-avatar" className={linkRowCls} placeholder="Avatar image link (https://…)" value={draft.avatarUrl} onChange={(e) => set({ avatarUrl: e.target.value })} maxLength={800} />
            <label className="block">
              <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>Page address — bowdownvisuals.com/bio/</span>
              <input aria-label="Page address (slug)" data-testid="world-bio-slug" className={linkRowCls} placeholder="your-name" value={draft.slug} onChange={(e) => set({ slug: e.target.value })} maxLength={40} />
            </label>
          </div>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>Theme</span>
            <select aria-label="Page theme" data-testid="world-bio-theme" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.theme} onChange={(e) => set({ theme: e.target.value })}>
              {BIO_PAGE_THEMES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5" data-testid="world-bio-links">
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>Links</p>
            {draft.links.map((link, i) => (
              <div key={i} className="flex gap-1.5" data-testid="world-bio-link-row">
                <input aria-label={`Link ${i + 1} title`} className={linkRowCls} style={{ flex: "0 0 34%" }} placeholder="Title" value={link.title} onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, title: e.target.value } : l)) })} maxLength={60} />
                <input aria-label={`Link ${i + 1} address`} className={linkRowCls} placeholder="https://…" value={link.url} onChange={(e) => set({ links: draft.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })} maxLength={800} />
                <button type="button" aria-label={`Remove link ${i + 1}`} data-testid="world-bio-link-remove" onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })} className={goldBtn} style={{ padding: "0 10px" }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {draft.links.length < BIO_MAX_LINKS ? (
              <button type="button" data-testid="world-bio-link-add" onClick={() => set({ links: [...draft.links, { title: "", url: "", icon: "link" }] })} className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                <Plus className="h-3.5 w-3.5 text-[#d4af37]" /> Add a link
              </button>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2" data-testid="world-bio-socials">
            {BIO_SOCIAL_FIELDS.map((f) => (
              <input key={f.key} aria-label={`${f.label} link`} className={linkRowCls} placeholder={`${f.label} link`} value={draft.socials[f.key]} onChange={(e) => set({ socials: { ...draft.socials, [f.key]: e.target.value } })} maxLength={800} />
            ))}
          </div>
          <input aria-label="Tip jar link" className={linkRowCls} placeholder="Tip jar link (optional)" value={draft.tipJarUrl} onChange={(e) => set({ tipJarUrl: e.target.value })} maxLength={800} />

          {error ? <p className={noteCls} data-testid="world-bio-error">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="world-bio-save" onClick={() => void save()} disabled={busy !== null} className={goldBtn}>
              <Check className="h-4 w-4" /> {busy === "save" ? "Saving…" : page ? "Save changes — free" : "Create my page — free"}
            </button>
            {page ? (
              <button type="button" onClick={() => { setEditing(false); setDraft(bioDraftFromPage(page)); setError(null); }} className={`text-xs font-bold ${muted}`}>
                Done editing
              </button>
            ) : null}
            <span className={`text-xs ${muted}`}>Saving is free — publishing is {BIO_PUBLISH_COST_VISUAL_BUCS} Visual Bucs, asked before it charges.</span>
          </div>
        </div>
      ) : null}
      {note ? <p className={`text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`} data-testid="world-bio-note">{note}</p> : null}
      {!editing && error ? <p className={noteCls}>{error}</p> : null}
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
  const { addAsset } = useHubProject();

  const [bio, setBio] = useState<SectionState<{ page: BioPageSummary; analytics: BioAnalytics | null }>>(loading());
  const [tick, setTick] = useState(0);

  /* A promo card's Schedule tap hands the card to the in-world
     Scheduler section below (Stack-100 #45/#46) — the compose opens
     prefilled, in this room, never a new tab. */
  const [cardPrefill, setCardPrefill] = useState<SchedulerPrefill | null>(null);
  const [cardPrefillNonce, setCardPrefillNonce] = useState(0);

  /* Make a promo (promo-generator). */
  const [featureKey, setFeatureKey] = useState(SITE_FEATURES[0]!.key);
  const [contentType, setContentType] = useState<string>("twitter");
  const [promoTone, setPromoTone] = useState<string>("hype");
  const [focus, setFocus] = useState("");
  const [promoJob, setPromoJob] = useState<CreateDeskJobState>("idle");
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  /* Promo cards gallery (this sitting's pack; every pack is recorded
     server-side and the full shelf is the website's history — see
     the lib follow-on note). */
  const [cardTitle, setCardTitle] = useState("");
  const [cardArtist, setCardArtist] = useState("");
  const [cardStyle, setCardStyle] = useState<string>("out-now");
  const [cards, setCards] = useState<PromoCardItem[]>([]);
  const [cardCaption, setCardCaption] = useState<string | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsNote, setCardsNote] = useState<string | null>(null);
  const [cardActionNote, setCardActionNote] = useState<string | null>(null);
  const [sharedCardKey, setSharedCardKey] = useState<string | null>(null);

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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  if (isGuest) return <GuestGate isLight={isLight} desk="The Promote Desk" />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardChipCls = `inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
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
      setCardActionNote(null);
      setSharedCardKey(null);
      refreshProfile();
    } catch {
      setCardsNote("The card desk didn't answer. Try again.");
    } finally {
      setCardsBusy(false);
    }
  };

  /* Per-card actions — the website panel's own actions, on the same
     rails: download the stored card image, share on the share rail
     (the card rides as an image with its history record id), schedule
     through the IN-WORLD scheduler below (the compose opens with the
     card loaded — Stack-100 #46), and add to the hub project's
     release assets. */
  const cardShareText = () => cardCaption ?? `${cardTitle} — ${cardArtist}`;

  const shareGalleryCard = async (c: PromoCardItem) => {
    const text = cardShareText();
    const channel = typeof navigator !== "undefined" && "share" in navigator ? "native" : "copy";
    try {
      if (channel === "native") {
        await navigator.share({ title: `${cardTitle} — ${cardArtist}`, text, url: c.url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${c.url}`);
        setCardActionNote("Share link copied.");
      }
    } catch {
      /* user dismissed — a dismissed share is not a share, so
         nothing is tracked for it below */
      return;
    }
    setSharedCardKey(c.url);
    /* Tracking rides the share rail; it never blocks the share. */
    try {
      await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(promoCardSharePayload(c, channel)),
      });
    } catch { /* tracking is a passenger, never the driver */ }
  };

  const addGalleryCardToAssets = (c: PromoCardItem) => {
    addAsset({
      kind: "image",
      url: c.url,
      label: `Promo card — ${c.style} (${c.size})`,
      detail: `${cardTitle} — ${cardArtist}`,
      meta: { sourceAsset: "promo-cards", handoff: "promo-cards", style: c.style, size: c.size },
    });
    setCardActionNote("Added to your project assets.");
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
          <div className="space-y-2">
            <NativeEmptyState
              isLight={isLight}
              message="No link-in-bio page yet."
              detail="Start one right here — drafting is free, and publishing is 100 Visual Bucs when you're ready."
            />
            <BioPageEditor isLight={isLight} onChanged={retryAll} />
          </div>
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
            <BioPageEditor isLight={isLight} onChanged={retryAll} />
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
            <div className="flex flex-wrap gap-3" data-testid="world-promote-cards-gallery">
              {cards.map((c, i) => (
                <figure key={`${c.url}-${i}`} className="w-44">
                  <img src={c.url} alt="" className="w-44 rounded-xl border border-[#d4af37]/40 object-cover" />
                  <figcaption className={`mt-1 text-center text-[11px] font-semibold ${muted}`}>{c.style} · {c.size}</figcaption>
                  <div className="mt-1.5 grid grid-cols-2 gap-1" data-testid="world-promote-card-actions">
                    <button
                      type="button"
                      data-testid="world-promote-card-download"
                      onClick={() => void downloadImage(c.url, promoCardFileName(c))}
                      className={cardChipCls}
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                    <button
                      type="button"
                      data-testid="world-promote-card-schedule"
                      onClick={() => {
                        setCardPrefill({ mediaUrl: c.url, mediaType: "image", caption: cardShareText() });
                        setCardPrefillNonce((n) => n + 1);
                        setCardActionNote("Your card is loaded in the Scheduler below — pick a platform and a time, right here.");
                      }}
                      className={cardChipCls}
                    >
                      <CalendarClock className="h-3.5 w-3.5" /> Schedule
                    </button>
                    <button
                      type="button"
                      data-testid="world-promote-card-share"
                      onClick={() => void shareGalleryCard(c)}
                      className={cardChipCls}
                    >
                      <Share2 className="h-3.5 w-3.5" /> {sharedCardKey === c.url ? "Shared" : "Share"}
                    </button>
                    <button
                      type="button"
                      data-testid="world-promote-card-assets"
                      onClick={() => addGalleryCardToAssets(c)}
                      className={cardChipCls}
                    >
                      <FolderPlus className="h-3.5 w-3.5" /> Add to assets
                    </button>
                  </div>
                </figure>
              ))}
            </div>
            {cardCaption ? <p className={`text-xs ${muted}`}>Suggested caption: {cardCaption}</p> : null}
            {cardActionNote ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{cardActionNote}</p> : null}
            <p className={`text-xs ${muted}`}>These cards are saved in your promo card history — every pack lives on the website's Promote page too.</p>
          </div>
        ) : (
          <NativeEmptyState
            isLight={isLight}
            message="No promo cards on the stand yet."
            detail="Cards you make here are recorded to your promo card history (the full shelf lives on the website's Promote page); this gallery holds the pack you make in this sitting."
          />
        )}
      </NativeCard>

      {/* The Scheduler, finished in-world (Stack-100 #45): compose,
          best-time, calendar, edit and cancel all complete here. */}
      <SchedulerDeskSection isLight={isLight} prefill={cardPrefill} prefillNonce={cardPrefillNonce} />

      {/* The Release Desk, finished in-world (Stack-100 #53/#54):
          the full distribution wizard + the smartlink surface
          complete here on the /distribute page's own rails. */}
      <ReleaseDeskSection isLight={isLight} />

      <NativeBoard isLight={isLight} title="Folded in — status here, the bench one tap out">
        <div className="space-y-3">
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
