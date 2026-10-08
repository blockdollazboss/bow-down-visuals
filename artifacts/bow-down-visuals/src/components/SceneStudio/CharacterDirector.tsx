import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Clapperboard, Loader2, Plus, Trash2, ChevronDown, ChevronUp,
  Send, FolderOpen, CheckCircle2, AlertCircle, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

/* ─── Character Director ─────────────────────────────────────────
   Planning layer over the existing Scene Studio generation pipeline
   (Runway/Seedance — NO new video model). Cast 2+ characters from the
   vault, assign shots per character, and the AI turns the cast + shot
   list into per-shot generation prompts. "Send to Scene Studio" appends
   each shot as a new scene (via onScenesChange) with its prompt loaded
   into the scene's existing AI Video Prompt field, so the existing
   InlineRunwayGenerator flow picks it up unchanged (consistency prefix,
   reference photo, co-star compositing all still apply at generation).

   DOCKING: mount inside SceneStudio's main return, e.g. right after the
   section heading:
     <CharacterDirector
       scenes={scenes}
       onScenesChange={onScenesChange}
       artistVault={artistVault}
       videoStyle={videoStyle}
       platform={platform}
     />
   Cast selection uses the same /api/artist-vaults data source as
   ArtistVaultSelector (which is single-select only, so the director uses
   a multi-select cast grid in the same style as SceneStudio's co-star
   picker; the active artistVault is pre-cast as character 1). */

const PLAN_CREDITS = 150;

interface ShotDraft {
  id: number;
  characters: string[]; /* character names from the cast */
  action: string;
  cameraNote: string;
}

interface PlannedShot {
  index: number;
  characters: string[];
  action: string;
  cameraNote: string;
  generatedPrompt: string;
}

interface SavedPlan {
  id: string;
  name: string;
  cast: { vaultId?: string; name: string; description?: string }[];
  shots: {
    index?: number; characters: string[]; action: string;
    cameraNote?: string; generatedPrompt?: string;
  }[];
  created_at: string;
}

function describeVault(v: ArtistVault): string {
  return [v.personality, v.visual_style, v.hair, v.clothing_style, v.jewelry]
    .filter(Boolean)
    .join(". ");
}

let shotSeq = 1;
function blankShot(): ShotDraft {
  return { id: shotSeq++, characters: [], action: "", cameraNote: "" };
}

interface CharacterDirectorProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
  artistVault?: ArtistVault | null;
  videoStyle?: string;
  platform?: string;
}

export function CharacterDirector({ scenes, onScenesChange, artistVault }: CharacterDirectorProps) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const ns = "wave9.characterDirector";

  const [expanded, setExpanded] = useState(false);
  const [vaults, setVaults] = useState<ArtistVault[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [castIds, setCastIds] = useState<string[]>([]);
  const [shots, setShots] = useState<ShotDraft[]>([blankShot()]);
  const [planName, setPlanName] = useState("");
  const [sceneStyle, setSceneStyle] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ planId: string | null; shots: PlannedShot[] } | null>(null);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [sent, setSent] = useState(false);

  /* Load vaults; pre-cast the active artist as character 1. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/artist-vaults", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { vaults?: ArtistVault[] };
        const list = data.vaults ?? [];
        if (!cancelled) {
          setVaults(list);
          if (artistVault?.id && list.some((v) => v.id === artistVault.id)) {
            setCastIds((prev) => (prev.includes(artistVault.id) ? prev : [...prev, artistVault.id]));
          }
        }
      } catch {
        /* cast grid simply stays empty */
      } finally {
        if (!cancelled) setLoadingVaults(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCast(id: string) {
    setCastIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
    setSent(false);
  }

  const castVaults = castIds
    .map((id) => vaults.find((v) => v.id === id))
    .filter((v): v is ArtistVault => !!v);
  const castNames = castVaults.map((v) => v.artist_name);

  function updateShot(id: number, patch: Partial<ShotDraft>) {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setSent(false);
  }

  function toggleShotCharacter(shotId: number, name: string) {
    const shot = shots.find((s) => s.id === shotId);
    if (!shot) return;
    const next = shot.characters.includes(name)
      ? shot.characters.filter((c) => c !== name)
      : [...shot.characters, name];
    updateShot(shotId, { characters: next });
  }

  function removeShot(id: number) {
    setShots((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }

  async function loadSavedPlans() {
    if (loadingSaved) return;
    setLoadingSaved(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/wave9d/director/plans", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as { plans?: SavedPlan[] };
        setSavedPlans(data.plans ?? []);
        setShowSaved(true);
      }
    } catch {
      /* optional */
    } finally {
      setLoadingSaved(false);
    }
  }

  function loadPlan(plan: SavedPlan) {
    /* Resolve saved character names back to vault ids where possible. */
    const names = plan.cast.map((c) => c.name.toLowerCase());
    const matched = vaults
      .filter((v) => names.includes(v.artist_name.toLowerCase()))
      .map((v) => v.id);
    setCastIds(matched);
    setShots(
      plan.shots.map((s) => ({
        id: shotSeq++,
        characters: s.characters ?? [],
        action: s.action ?? "",
        cameraNote: s.cameraNote ?? "",
      }))
    );
    setPlanName(plan.name);
    setResult({
      planId: plan.id,
      shots: plan.shots.map((s, i) => ({
        index: s.index ?? i + 1,
        characters: s.characters ?? [],
        action: s.action ?? "",
        cameraNote: s.cameraNote ?? "",
        generatedPrompt: s.generatedPrompt ?? "",
      })),
    });
    setShowSaved(false);
    setSent(false);
  }

  async function handlePlan() {
    setError(null);
    if (castVaults.length < 2) {
      setError(t(`${ns}.needTwoCharacters`));
      return;
    }
    for (const s of shots) {
      if (s.characters.length === 0 || !s.action.trim()) {
        setError(t(`${ns}.needShot`));
        return;
      }
    }
    setPlanning(true);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/wave9d/director/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          name: planName.trim() || undefined,
          sceneStyle: sceneStyle.trim() || undefined,
          cast: castVaults.map((v) => ({
            vaultId: v.id,
            name: v.artist_name,
            description: describeVault(v),
          })),
          shots: shots.map((s, i) => ({
            index: i + 1,
            characters: s.characters,
            action: s.action.trim(),
            cameraNote: s.cameraNote.trim(),
          })),
        }),
        overrideCost: PLAN_CREDITS,
        overrideFeature: "Character Director — Shot Plan",
      });
      if (!res) return; /* user cancelled the credit confirm */
      const data = (await res.json()) as {
        planId?: string | null;
        shots?: PlannedShot[];
        error?: string;
      };
      if (!res.ok || !data.shots) throw new Error(data.error ?? "Planning failed");
      setResult({ planId: data.planId ?? null, shots: data.shots });
      setSent(false);
      void loadSavedPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`${ns}.errorGeneric`));
    } finally {
      setPlanning(false);
    }
  }

  function handleSendToStudio() {
    if (!result) return;
    const base = scenes.length;
    const newScenes: SceneData[] = result.shots.map((s, i) => ({
      id: `scene-dir-${Date.now()}-${i}`,
      sceneNumber: base + i + 1,
      timestamp: "",
      section: planName.trim() ? `Director: ${planName.trim()}` : "Director Plan",
      lyricLine: "",
      location: "",
      action: s.action,
      cameraMovement: s.cameraNote,
      lighting: "",
      mood: sceneStyle.trim(),
      aiVideoPrompt: s.generatedPrompt,
      negativePrompt: "",
      approved: false,
      demoClipUrl: null,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: null,
      generationStatus: null,
      promptUsed: null,
      generatedAt: null,
    }));
    onScenesChange([...scenes, ...newScenes]);
    setSent(true);
    toast({
      title: t(`${ns}.sentToStudio`),
      description: t(`${ns}.sentToStudioDetail`, { count: newScenes.length }),
    });
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden"
      data-testid="character-director"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Clapperboard className="h-4.5 w-4.5 text-primary" style={{ width: "1.125rem", height: "1.125rem" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            {t(`${ns}.title`)}
          </h3>
          <p className="text-xs text-white/30 mt-0.5 truncate">{t(`${ns}.subtitle`)}</p>
        </div>
        <span className="text-[10px] font-black text-primary/80 uppercase tracking-widest border border-primary/30 bg-primary/10 rounded-full px-2.5 py-1 shrink-0">
          {t(`${ns}.planCost`, { cost: PLAN_CREDITS })}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>

      {expanded && (
        <div className="px-5 py-4 space-y-5 border-t border-white/[0.06]">
          {/* ── Cast ── */}
          <div>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <Users className="h-3 w-3" /> {t(`${ns}.castHeading`)}
            </p>
            {loadingVaults ? (
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            ) : vaults.length === 0 ? (
              <p className="text-xs text-white/40">
                {t(`${ns}.noVaults`)}{" "}
                <a href="/artist-vault" className="text-primary hover:underline font-bold">
                  {t(`${ns}.noVaultsCta`)}
                </a>
              </p>
            ) : (
              <>
                <div className="flex gap-1.5 flex-wrap" data-testid="director-cast-grid">
                  {vaults.map((v) => {
                    const selected = castIds.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggleCast(v.id)}
                        title={v.artist_name}
                        className={`relative h-12 w-12 rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
                          selected ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                        }`}
                      >
                        {v.reference_image_url ? (
                          <img src={v.reference_image_url} alt={v.artist_name} className="h-full w-full object-cover object-top" loading="lazy" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-white/10 text-[9px] text-white/50 font-bold">
                            {v.artist_name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        {selected && (
                          <span className="absolute inset-0 flex items-center justify-center bg-primary/30">
                            <CheckCircle2 className="h-5 w-5 text-white" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-white/40 mt-1.5">
                  {castVaults.length > 0
                    ? t(`${ns}.castSelected`, { names: castNames.join(", ") })
                    : t(`${ns}.castHint`)}
                </p>
              </>
            )}
          </div>

          {/* ── Shots ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                {t(`${ns}.shotsHeading`)}
              </p>
              <Button
                size="sm" variant="outline"
                onClick={() => setShots((prev) => [...prev, blankShot()])}
                className="h-7 text-[11px] gap-1 border-white/10 bg-white/5 text-white/70 hover:text-white"
                data-testid="btn-add-shot"
              >
                <Plus className="h-3 w-3" /> {t(`${ns}.addShot`)}
              </Button>
            </div>
            <div className="space-y-2.5">
              {shots.map((shot, i) => (
                <div
                  key={shot.id}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 space-y-2.5"
                  data-testid={`shot-editor-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                      {t(`${ns}.shotLabel`, { n: i + 1 })}
                    </span>
                    <button
                      onClick={() => removeShot(shot.id)}
                      disabled={shots.length <= 1}
                      className="ml-auto text-white/30 hover:text-red-400 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                      title={t(`${ns}.removeShot`)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {/* Characters in this shot */}
                  {castNames.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {castNames.map((name) => {
                        const on = shot.characters.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleShotCharacter(shot.id, name)}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                              on
                                ? "border-primary/60 bg-primary/15 text-primary"
                                : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                            }`}
                          >
                            {on && <CheckCircle2 className="h-3 w-3 inline mr-1 -mt-0.5" />}
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Action */}
                  <textarea
                    value={shot.action}
                    onChange={(e) => updateShot(shot.id, { action: e.target.value })}
                    rows={2}
                    placeholder={t(`${ns}.actionPlaceholder`)}
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white/80 resize-none focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
                    data-testid={`shot-action-${i}`}
                  />
                  {/* Camera note */}
                  <input
                    value={shot.cameraNote}
                    onChange={(e) => updateShot(shot.id, { cameraNote: e.target.value })}
                    placeholder={t(`${ns}.cameraNotePlaceholder`)}
                    className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/60 focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/15"
                    data-testid={`shot-camera-${i}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ── Plan name + style ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder={t(`${ns}.planNamePlaceholder`)}
              className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white/80 focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
              data-testid="director-plan-name"
            />
            <input
              value={sceneStyle}
              onChange={(e) => setSceneStyle(e.target.value)}
              placeholder={t(`${ns}.sceneStylePlaceholder`)}
              className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white/80 focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
              data-testid="director-scene-style"
            />
          </div>

          {/* ── Errors ── */}
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handlePlan}
              disabled={planning}
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
              data-testid="btn-plan-shots"
            >
              {planning
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t(`${ns}.planning`)}</>
                : <><Clapperboard className="h-3.5 w-3.5" /> {t(`${ns}.planButton`, { cost: PLAN_CREDITS })}</>}
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={loadSavedPlans}
              disabled={loadingSaved}
              className="h-9 text-xs gap-1.5 border-white/10 bg-white/5 text-white/70 hover:text-white"
              data-testid="btn-saved-plans"
            >
              {loadingSaved
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <FolderOpen className="h-3.5 w-3.5" />}
              {t(`${ns}.savedPlansButton`)}
            </Button>
          </div>

          {/* ── Saved plans ── */}
          {showSaved && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-1.5">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                {t(`${ns}.savedPlansHeading`)}
              </p>
              {savedPlans.length === 0 ? (
                <p className="text-xs text-white/40">{t(`${ns}.noSavedPlans`)}</p>
              ) : (
                savedPlans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => loadPlan(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <span className="text-xs font-bold text-white/70 truncate flex-1">{p.name}</span>
                    <span className="text-[10px] text-white/30 shrink-0">
                      {p.shots.length} {t(`${ns}.shotsWord`)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ── Results ── */}
          {result && (
            <div className="space-y-2.5">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                {t(`${ns}.resultsHeading`)}
              </p>
              {result.shots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3.5 py-3 space-y-2"
                  data-testid={`planned-shot-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-[10px] font-black text-primary shrink-0">
                      {s.index}
                    </span>
                    <span className="text-xs font-bold text-white/70 truncate">
                      {s.characters.join(", ")}
                    </span>
                  </div>
                  <textarea
                    value={s.generatedPrompt}
                    onChange={(e) => {
                      const next = [...result.shots];
                      next[i] = { ...s, generatedPrompt: e.target.value };
                      setResult({ ...result, shots: next });
                      setSent(false);
                    }}
                    rows={3}
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-white/75 leading-relaxed resize-none focus:outline-none focus:border-primary/40 transition-colors font-mono"
                  />
                </div>
              ))}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={handleSendToStudio}
                  className="bg-primary text-black hover:bg-primary/90 font-bold text-xs h-9 gap-1.5"
                  data-testid="btn-send-to-studio"
                >
                  <Send className="h-3.5 w-3.5" /> {t(`${ns}.sendToStudio`)}
                </Button>
                {sent && (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t(`${ns}.sentConfirm`)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/30">
                {t(`${ns}.sendHint`)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
