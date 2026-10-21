import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Video, Loader2, ChevronDown, ChevronUp, Send,
  MoveRight, MoveLeft, Orbit, ArrowUpFromLine, ArrowDownToLine, Hand, Aperture,
  AlertCircle, Sparkles, X, Check, FastForward, Timer, ArrowLeft, ArrowRight,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, RotateCcw, RefreshCw, Gauge,
  Rewind, Footprints, Eye, Rocket, Mountain, Maximize2, ZoomIn, ZoomOut,
  Focus, Crosshair, Camera, Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { SceneData } from "@/lib/scene-parser";

/* ─── Director's Camera Deck (Wave 9D, grown) ─────────────────────
   PURE PROMPT ENRICHMENT over the existing Scene Studio generation
   pipeline — no generation happens here, no new video model.
   The deck: 47 named camera presets served by GET /wave9d/camera/
   presets (the server's lib/camera-deck.ts is the source of truth),
   grouped by category. A creator picks ONE move or stacks up to 3;
   the stack weaves into one continuous camera path in pick order.
   Conflicts (opposite directions, locked-off statics) are refused
   with the rule stated — checked here for instant feedback and again
   server-side at build time.
   Turbo Shot Designer: POST /wave9d/camera/design (free) proposes a
   stack with a one-line reason per move. A proposal is only ever
   loaded into the pick state on an explicit "Use this stack" tap —
   it never builds, charges, or touches a scene on its own.
   The woven prompt is PREVIEWED first; "Use in Scene Studio" injects
   it into the chosen scene's existing AI Video Prompt field (and
   records the stack in its Camera Direction), so the existing
   InlineRunwayGenerator flow picks it up unchanged.

   DOCKING: mounted in pages/make-video.tsx beside CharacterDirector,
   inside Scene Studio's flow — no standalone page. */

const BUILD_CREDITS = 100;
const MAX_STACK = 3;

type Intensity = "subtle" | "natural" | "dramatic";
const INTENSITIES: Intensity[] = ["subtle", "natural", "dramatic"];

interface DeckPreset {
  id: string;
  name: string;
  category: string;
  blurb: string;
  locked: boolean;
  conflictsWith: string[];
}

interface StackPick {
  id: string;
  /** Per-move intensity override; null rides the stack default. */
  intensity: Intensity | null;
}

interface DesignerMove {
  preset: string;
  name: string;
  intensity: Intensity;
  reason: string;
}

const PRESET_ICONS: Record<string, typeof MoveRight> = {
  "dolly-in": MoveRight, "dolly-out": MoveLeft, "push-in": FastForward,
  "slow-creep": Timer, "dolly-left": ArrowLeft, "dolly-right": ArrowRight,
  orbit: Orbit, "orbit-arc": RefreshCw, "orbit-fast": Gauge, "reverse-orbit": RotateCcw,
  "crane-up": ArrowUpFromLine, "crane-down": ArrowDownToLine, "jib-sweep": Repeat,
  "pedestal-up": ChevronsUp, "pedestal-down": ChevronsDown,
  "tilt-up": ArrowUp, "tilt-down": ArrowDown,
  "pan-left": Rewind, "pan-right": FastForward, "whip-pan": RefreshCw,
  "tracking-left": ArrowLeft, "tracking-right": ArrowRight,
  "follow-behind": Footprints, "follow-front": Eye, chase: FastForward,
  "drone-rise": Rocket, "drone-reveal": Mountain, "aerial-pullback": Maximize2,
  "fpv-chase": Gauge, "fpv-dive": ArrowDownToLine,
  "snap-zoom": ZoomIn, "zoom-out": ZoomOut, "dolly-zoom": Focus,
  "slow-zoom": Maximize2, "rack-focus": Crosshair,
  handheld: Hand, "handheld-doc": Video, "shoulder-cam": Camera,
  snorricam: Camera, "pov-walk": Eye,
  "static-wide": Aperture, "static-close": Crosshair,
  "bullet-time": Timer, "dutch-drift": RotateCcw, "parallax-slide": MoveRight,
  hyperlapse: FastForward, "low-angle-hero": ArrowUp,
};

const LEGACY_IDS = ["dolly-in", "orbit", "crane-up", "handheld", "static-wide"] as const;

/** Base prompt for a scene: the same seed SceneStudio falls back to when
    no AI Video Prompt is set (action + location + camera + lighting + mood). */
function sceneBasePrompt(scene: SceneData): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ") ||
    "cinematic music video scene, dramatic lighting, luxury aesthetic"
  );
}

function sceneLabel(scene: SceneData, index: number): string {
  const summary = scene.section || scene.lyricLine || scene.action || scene.location;
  return `Scene ${index + 1}${summary ? ` — ${summary.slice(0, 40)}` : ""}`;
}

interface CameraMovePlannerProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
}

export function CameraMovePlanner({ scenes, onScenesChange }: CameraMovePlannerProps) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const ns = "wave9.cameraMovePlanner";

  const [expanded, setExpanded] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [deck, setDeck] = useState<DeckPreset[] | null>(null);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [deckFallback, setDeckFallback] = useState(false);
  const [stack, setStack] = useState<StackPick[]>([{ id: "dolly-in", intensity: null }]);
  const [intensity, setIntensity] = useState<Intensity>("natural");
  const [stackMsg, setStackMsg] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [proposal, setProposal] = useState<{ moves: DesignerMove[]; summary: string } | null>(null);
  const [proposalNotes, setProposalNotes] = useState<string[]>([]);
  const [designerError, setDesignerError] = useState<string | null>(null);

  const target = scenes[Math.min(sceneIndex, Math.max(scenes.length - 1, 0))] ?? null;

  /* The deck is the server's catalog; if it can't load, fall back to the
     classic five (names/blurbs from i18n) so the planner never bricks. */
  useEffect(() => {
    if (!expanded || deck) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/wave9d/camera/presets", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error("deck unavailable");
        const data = (await res.json()) as {
          presets: DeckPreset[];
          categories: { id: string; label: string }[];
        };
        if (cancelled) return;
        setDeck(data.presets);
        setCategories(data.categories);
      } catch {
        if (cancelled) return;
        setDeck(
          LEGACY_IDS.map((id) => ({
            id,
            name: t(`${ns}.moves.${id}`),
            category: id === "static-wide" ? "static" : "dolly",
            blurb: t(`${ns}.moveBlurbs.${id}`),
            locked: id === "static-wide",
            conflictsWith:
              id === "static-wide"
                ? LEGACY_IDS.filter((x) => x !== id)
                : ["static-wide"],
          })),
        );
        setCategories([]);
        setDeckFallback(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  function presetById(id: string): DeckPreset | undefined {
    return deck?.find((p) => p.id === id);
  }

  function presetName(id: string): string {
    return presetById(id)?.name ?? t(`${ns}.moves.${id}`, { defaultValue: id });
  }

  function touchPicks() {
    setPreview(null);
    setUsed(false);
    setError(null);
  }

  function togglePreset(p: DeckPreset) {
    setStackMsg(null);
    if (stack.some((s) => s.id === p.id)) {
      setStack(stack.filter((s) => s.id !== p.id));
      touchPicks();
      return;
    }
    if (stack.length >= MAX_STACK) {
      setStackMsg(t(`${ns}.stackFull`));
      return;
    }
    const clash = stack
      .map((s) => presetById(s.id))
      .find((other) => other && (p.conflictsWith.includes(other.id) || other.conflictsWith.includes(p.id)));
    if (clash) {
      setStackMsg(
        p.locked || clash.locked
          ? t(`${ns}.conflictLocked`, { a: p.locked ? p.name : clash.name })
          : t(`${ns}.conflictOpposite`, { a: p.name, b: clash.name }),
      );
      return;
    }
    setStack([...stack, { id: p.id, intensity: null }]);
    touchPicks();
  }

  function cycleSlotIntensity(id: string) {
    setStack(
      stack.map((s) => {
        if (s.id !== id) return s;
        const next: Intensity | null =
          s.intensity === null
            ? "subtle"
            : s.intensity === "subtle"
              ? "natural"
              : s.intensity === "natural"
                ? "dramatic"
                : null;
        return { ...s, intensity: next };
      }),
    );
    touchPicks();
  }

  async function handleBuild() {
    setError(null);
    if (!target) {
      setError(t(`${ns}.noScenes`));
      return;
    }
    if (stack.length === 0) {
      setError(t(`${ns}.noMove`));
      return;
    }
    setBuilding(true);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/wave9d/camera/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          moves: stack.map((s) => ({
            preset: s.id,
            ...(s.intensity ? { intensity: s.intensity } : {}),
          })),
          intensity,
          basePrompt: sceneBasePrompt(target),
          sceneContext: [target.location, target.mood].filter(Boolean).join(" — "),
        }),
        overrideCost: BUILD_CREDITS,
        overrideFeature: "Camera Move Planner",
      });
      if (!res) return; /* user cancelled the credit confirm */
      const data = (await res.json()) as { enrichedPrompt?: string; error?: string };
      if (!res.ok || !data.enrichedPrompt) throw new Error(data.error ?? "Build failed");
      setPreview(data.enrichedPrompt);
      setUsed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`${ns}.errorGeneric`));
    } finally {
      setBuilding(false);
    }
  }

  /* Turbo Shot Designer — free proposal. Plain fetch on purpose: this
     call charges nothing, so it must NOT go through the credit-confirm
     rail. The proposal lands in local state only; accepting it loads
     the picks — building still takes the normal confirmed build tap. */
  async function handleDesign() {
    if (!target) {
      setDesignerError(t(`${ns}.noScenes`));
      return;
    }
    setDesigning(true);
    setDesignerError(null);
    setProposal(null);
    setProposalNotes([]);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/wave9d/camera/design", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          basePrompt: sceneBasePrompt(target),
          sceneContext: [target.location, target.mood].filter(Boolean).join(" — "),
        }),
      });
      const data = (await res.json()) as {
        proposal?: { moves: DesignerMove[]; summary: string };
        notes?: string[];
        error?: string;
      };
      if (!res.ok || !data.proposal) throw new Error(data.error ?? "design failed");
      setProposal(data.proposal);
      setProposalNotes(data.notes ?? []);
    } catch {
      setDesignerError(t(`${ns}.designerError`));
    } finally {
      setDesigning(false);
    }
  }

  function acceptProposal() {
    if (!proposal) return;
    setStack(proposal.moves.map((m) => ({ id: m.preset, intensity: m.intensity })));
    setProposal(null);
    setProposalNotes([]);
    setStackMsg(null);
    touchPicks();
  }

  function handleUseInStudio() {
    if (!target || !preview) return;
    const stackLabel = stack.map((s) => presetName(s.id)).join(" + ");
    const next = scenes.map((s, i) =>
      i === Math.min(sceneIndex, Math.max(scenes.length - 1, 0))
        ? {
            ...s,
            aiVideoPrompt: preview,
            cameraMovement: `${stackLabel} — ${t(`${ns}.intensity.${intensity}`)}`,
          }
        : s,
    );
    onScenesChange(next);
    setUsed(true);
    toast({
      title: t(`${ns}.usedTitle`),
      description: t(`${ns}.usedDetail`, { scene: sceneIndex + 1 }),
    });
  }

  const grouped = (categories.length
    ? categories
    : [...new Set((deck ?? []).map((p) => p.category))].map((id) => ({
        id,
        label: t(`${ns}.categories.${id}`, { defaultValue: id }),
      }))
  )
    .map((c) => ({ ...c, presets: (deck ?? []).filter((p) => p.category === c.id) }))
    .filter((c) => c.presets.length > 0);

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="camera-move-planner"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Video className="h-4.5 w-4.5 text-primary" style={{ width: "1.125rem", height: "1.125rem" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            {t(`${ns}.title`)}
          </h3>
          <p className="text-xs text-white/30 mt-0.5 truncate">{t(`${ns}.subtitle`)}</p>
        </div>
        <span className="text-[10px] font-black text-primary/80 uppercase tracking-widest border border-primary/30 bg-primary/10 rounded-full px-2.5 py-1 shrink-0">
          {t(`${ns}.buildCost`, { cost: BUILD_CREDITS })}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>

      {expanded && (
        <div className="px-5 py-4 space-y-5 border-t border-white/[0.06]">
          {/* ── Scene picker ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.sceneLabel`)}
            </p>
            {scenes.length === 0 ? (
              <p className="text-xs text-white/40">{t(`${ns}.noScenes`)}</p>
            ) : (
              <div className="relative">
                <select
                  value={Math.min(sceneIndex, scenes.length - 1)}
                  onChange={(e) => { setSceneIndex(Number(e.target.value)); setPreview(null); setUsed(false); setProposal(null); }}
                  className="h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 pr-8 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                  data-testid="camera-scene-select"
                >
                  {scenes.map((s, i) => (
                    <option key={s.id} value={i} className="bg-zinc-900">
                      {sceneLabel(s, i)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-4 w-4 text-white/40 absolute right-3 top-3 pointer-events-none" />
              </div>
            )}
          </div>

          {/* ── Turbo Shot Designer ── */}
          <div className="rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3.5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> {t(`${ns}.designerTitle`)}
                </p>
                <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                  {t(`${ns}.designerBlurb`, { cost: BUILD_CREDITS })}
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleDesign}
                disabled={designing || scenes.length === 0}
                className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5 shrink-0"
                data-testid="btn-design-shot"
              >
                {designing
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t(`${ns}.designerWorking`)}</>
                  : <><Sparkles className="h-3.5 w-3.5" /> {t(`${ns}.designerButton`)}</>}
              </Button>
            </div>

            {designerError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-300">{designerError}</p>
              </div>
            )}

            {proposal && (
              <div className="space-y-2.5" data-testid="designer-proposal">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                  {t(`${ns}.designerProposalHeading`)}
                </p>
                <div className="space-y-1.5">
                  {proposal.moves.map((m, i) => (
                    <div key={m.preset} className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                      <span className="h-5 w-5 rounded-full bg-primary/15 border border-primary/40 text-primary text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white/85">
                          {m.name}{" "}
                          <span className="text-[10px] font-black uppercase tracking-wide text-primary/80">
                            · {t(`${ns}.intensity.${m.intensity}`)}
                          </span>
                        </p>
                        {m.reason && <p className="text-[11px] text-white/45 leading-snug">{m.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {proposal.summary && (
                  <p className="text-[11px] text-white/50 italic">{proposal.summary}</p>
                )}
                {proposalNotes.length > 0 && (
                  <p className="text-[11px] text-amber-300/80">
                    {t(`${ns}.designerAdjusted`, { notes: proposalNotes.join(" ") })}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={acceptProposal}
                    className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-8 gap-1.5"
                    data-testid="btn-accept-proposal"
                  >
                    <Check className="h-3.5 w-3.5" /> {t(`${ns}.designerAccept`)}
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { setProposal(null); setProposalNotes([]); }}
                    className="h-8 text-xs gap-1.5 border-white/10 bg-white/5 text-white/70 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" /> {t(`${ns}.designerDismiss`)}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── The Deck ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.deckLabel`)}
            </p>
            <p className="text-[11px] text-white/35 leading-relaxed mb-2.5">{t(`${ns}.stackRule`)}</p>
            {deckFallback && (
              <p className="text-[11px] text-amber-300/80 mb-2.5">{t(`${ns}.deckFallback`)}</p>
            )}
            {!deck ? (
              <p className="flex items-center gap-2 text-xs text-white/40">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t(`${ns}.deckLoading`)}
              </p>
            ) : (
              <div className="space-y-4 max-h-[430px] overflow-y-auto pr-1" data-testid="camera-deck">
                {grouped.map((group) => (
                  <div key={group.id}>
                    <p className="text-[10px] font-black text-primary/60 uppercase tracking-widest mb-1.5">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {group.presets.map((p) => {
                        const Icon = PRESET_ICONS[p.id] ?? Video;
                        const order = stack.findIndex((s) => s.id === p.id);
                        const selected = order >= 0;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePreset(p)}
                            data-testid={`move-pick-${p.id}`}
                            className={`relative rounded-xl border px-2.5 py-3 text-left transition-all ${
                              selected
                                ? "border-primary/60 bg-primary/10"
                                : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] hover:border-primary/40"
                            }`}
                          >
                            {selected && (
                              <span className="absolute top-1.5 right-1.5 h-4.5 w-4.5 rounded-full bg-primary text-black text-[10px] font-black flex items-center justify-center" style={{ width: "1.125rem", height: "1.125rem" }}>
                                {order + 1}
                              </span>
                            )}
                            <Icon className={`h-4.5 w-4.5 mb-1.5 ${selected ? "text-primary" : "text-white/50"}`} style={{ width: "1.125rem", height: "1.125rem" }} />
                            <p className={`text-[11px] font-black uppercase tracking-wide ${selected ? "text-primary" : "text-white/70"}`}>
                              {p.name}
                            </p>
                            <p className="text-[10px] text-white/30 mt-0.5 leading-snug">{p.blurb}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Your stack ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.stackLabel`)}
            </p>
            {stack.length === 0 ? (
              <p className="text-xs text-white/40">{t(`${ns}.stackEmpty`)}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="camera-stack">
                {stack.map((s, i) => (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-2 pr-1 py-1">
                    <span className="text-[10px] font-black text-primary">{i + 1}</span>
                    <span className="text-[11px] font-bold text-white/85">{presetName(s.id)}</span>
                    <button
                      type="button"
                      onClick={() => cycleSlotIntensity(s.id)}
                      title={t(`${ns}.slotIntensityTitle`)}
                      data-testid={`slot-intensity-${s.id}`}
                      className="text-[9px] font-black uppercase tracking-wide text-primary/80 border border-primary/30 rounded-full px-1.5 py-0.5 hover:bg-primary/20"
                    >
                      {t(`${ns}.intensity.${s.intensity ?? intensity}`)}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePreset(presetById(s.id) ?? { id: s.id, name: s.id, category: "", blurb: "", locked: false, conflictsWith: [] })}
                      className="text-white/40 hover:text-white px-0.5"
                      aria-label={`Remove ${presetName(s.id)}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {stackMsg && (
              <p className="text-[11px] text-amber-300/90 mt-2" data-testid="stack-message">{stackMsg}</p>
            )}
          </div>

          {/* ── Intensity (stack default) ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1.5">
              {t(`${ns}.intensityLabel`)}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {INTENSITIES.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => { setIntensity(lvl); touchPicks(); }}
                  data-testid={`intensity-pick-${lvl}`}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors capitalize ${
                    intensity === lvl
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                  }`}
                >
                  {t(`${ns}.intensity.${lvl}`)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Errors ── */}
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* ── Build ── */}
          <Button
            size="sm"
            onClick={handleBuild}
            disabled={building || scenes.length === 0 || stack.length === 0}
            className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
            data-testid="btn-build-camera-prompt"
          >
            {building
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t(`${ns}.building`)}</>
              : <><Video className="h-3.5 w-3.5" /> {t(`${ns}.buildButton`, { cost: BUILD_CREDITS })}</>}
          </Button>

          {/* ── Preview (BEFORE any generation) ── */}
          {preview && (
            <div className="space-y-2.5">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                {t(`${ns}.previewHeading`)}
              </p>
              <pre
                className="text-[11px] text-white/60 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-primary/20 rounded-xl px-3.5 py-3 font-mono max-h-48 overflow-y-auto"
                data-testid="camera-prompt-preview"
              >
                {preview}
              </pre>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleUseInStudio}
                  className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
                  data-testid="btn-use-camera-prompt"
                >
                  <Send className="h-3.5 w-3.5" /> {t(`${ns}.useButton`)}
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={handleBuild}
                  disabled={building}
                  className="h-9 text-xs gap-1.5 border-white/10 bg-white/5 text-white/70 hover:text-white"
                >
                  {t(`${ns}.regenerate`)}
                </Button>
                {used && (
                  <span className="text-[11px] font-bold text-green-400">
                    {t(`${ns}.usedConfirm`)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/30">{t(`${ns}.previewHint`)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
