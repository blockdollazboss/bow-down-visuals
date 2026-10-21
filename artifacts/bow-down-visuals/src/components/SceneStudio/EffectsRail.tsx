import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, TrendingUp, AlertTriangle, Check, Loader2 } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  effectConflictsClient,
  effectNeedsLabel,
  loadTrackedTrendSignals,
  type EffectRecipe,
  type EffectRecipesPayload,
} from "@/lib/scene-effects";

/* ─── Viral Effects rail ──────────────────────────────────────────────────
   Generation-time effect recipes docked in Scene Studio (the Higgsfield
   G7 answer): pick up to 2 named effects and their prompt constructions
   are woven into the clip generation server-side — riding the clip's
   existing charge, no extra cost. The library is served by
   GET /api/scene-effects/recipes (single source of truth in the API's
   lib/scene-effects.ts); if it can't load, the rail says so and
   generation carries on without effects.

   Turbo Effect Match: POST /api/scene-effects/match proposes effects
   from the scene + the trends the creator is tracking (Trend Predictor
   watchlist). Proposals change NOTHING until the creator taps Apply. */

let recipesCache: EffectRecipesPayload | null = null;
let recipesFetch: Promise<EffectRecipesPayload> | null = null;

function fetchRecipes(getAccessToken: () => Promise<string | null>): Promise<EffectRecipesPayload> {
  if (recipesCache) return Promise.resolve(recipesCache);
  if (!recipesFetch) {
    recipesFetch = (async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/scene-effects/recipes", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error(`recipes ${res.status}`);
      const data = (await res.json()) as EffectRecipesPayload;
      recipesCache = data;
      return data;
    })().catch((e) => {
      recipesFetch = null;
      throw e;
    });
  }
  return recipesFetch;
}

interface MatchProposal {
  effectId: string;
  name: string;
  trendReason: string | null;
  fitReason: string;
  bestFor: string;
  source: "trend" | "scene";
}

interface EffectsRailProps {
  scene: SceneData;
  pickedIds: string[];
  onChange: (ids: string[]) => void;
  getAccessToken: () => Promise<string | null>;
}

export function EffectsRail({ scene, pickedIds, onChange, getAccessToken }: EffectsRailProps) {
  const [payload, setPayload] = useState<EffectRecipesPayload | null>(recipesCache);
  const [loadFailed, setLoadFailed] = useState(false);
  const [matching, setMatching] = useState(false);
  const [proposals, setProposals] = useState<MatchProposal[] | null>(null);
  const [matchSource, setMatchSource] = useState<"ai" | "library" | null>(null);
  const [matchDisclaimer, setMatchDisclaimer] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [capHint, setCapHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecipes(getAccessToken)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxStack = payload?.maxStack ?? 2;
  const pickedRecipes = useMemo(
    () => (payload?.recipes ?? []).filter((r) => pickedIds.includes(r.id)),
    [payload, pickedIds],
  );
  const conflicts = useMemo(
    () =>
      payload
        ? effectConflictsClient(scene.cameraMovement, pickedRecipes, payload.moveKeywords)
        : [],
    [payload, scene.cameraMovement, pickedRecipes],
  );

  const categories = useMemo(() => {
    const out: Array<{ name: string; recipes: EffectRecipe[] }> = [];
    for (const r of payload?.recipes ?? []) {
      const cat = out.find((c) => c.name === r.category);
      if (cat) cat.recipes.push(r);
      else out.push({ name: r.category, recipes: [r] });
    }
    return out;
  }, [payload]);

  function toggle(id: string) {
    setCapHint(false);
    if (pickedIds.includes(id)) {
      onChange(pickedIds.filter((x) => x !== id));
      return;
    }
    if (pickedIds.length >= maxStack) {
      setCapHint(true);
      return;
    }
    onChange([...pickedIds, id]);
  }

  function applyProposal(id: string) {
    if (pickedIds.includes(id)) return;
    if (pickedIds.length >= maxStack) {
      setCapHint(true);
      return;
    }
    onChange([...pickedIds, id]);
  }

  async function runMatch() {
    setMatching(true);
    setMatchError(null);
    try {
      const token = await getAccessToken();
      const trends = loadTrackedTrendSignals();
      const res = await fetch("/api/scene-effects/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          promptText: scene.aiVideoPrompt ?? "",
          action: scene.action ?? "",
          mood: scene.mood ?? "",
          section: scene.section ?? "",
          cameraMovement: scene.cameraMovement ?? "",
          trends,
        }),
      });
      const data = (await res.json()) as {
        proposals?: MatchProposal[];
        source?: "ai" | "library";
        disclaimer?: string;
        error?: string;
      };
      if (!res.ok || !data.proposals) throw new Error(data.error ?? "match failed");
      setProposals(data.proposals);
      setMatchSource(data.source ?? "library");
      setMatchDisclaimer(data.disclaimer ?? null);
    } catch {
      setMatchError("Effect Match couldn't run — pick effects manually below; generation is unaffected.");
    } finally {
      setMatching(false);
    }
  }

  if (loadFailed) {
    return (
      <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]" data-testid="effects-rail-unavailable">
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="h-3 w-3" /> Viral Effects
        </p>
        <p className="text-[10px] text-white/40 mt-1">
          The effects library couldn't load — generation works normally without effects.
        </p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]" data-testid="effects-rail-loading">
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading Viral Effects…
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2.5" data-testid="effects-rail">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-primary" /> Viral Effects
          <span className="normal-case tracking-normal font-semibold text-white/30">
            — woven into this generation · stack up to {maxStack} · no extra charge
          </span>
        </p>
        <button
          type="button"
          onClick={runMatch}
          disabled={matching}
          data-testid="btn-effect-match"
          className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
        >
          {matching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Turbo Effect Match
        </button>
      </div>

      {/* Turbo Effect Match proposals — apply is always the creator's tap */}
      {matchError && <p className="text-[10px] text-amber-300/90">{matchError}</p>}
      {proposals && (
        <div className="space-y-1.5" data-testid="effect-match-proposals">
          {proposals.map((p) => {
            const applied = pickedIds.includes(p.effectId);
            return (
              <div
                key={p.effectId}
                className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-primary/[0.06] border border-primary/25"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-white/85">{p.name}</p>
                  {p.trendReason && (
                    <p className="text-[10px] text-primary/90 leading-snug flex gap-1">
                      <TrendingUp className="h-3 w-3 shrink-0 mt-px" />
                      <span>{p.trendReason}</span>
                    </p>
                  )}
                  <p className="text-[10px] text-white/45 leading-snug">{p.fitReason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => applyProposal(p.effectId)}
                  disabled={applied}
                  data-testid={`btn-apply-effect-${p.effectId}`}
                  className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                    applied
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-primary/60 bg-primary/15 text-primary hover:bg-primary/25"
                  }`}
                >
                  {applied ? (
                    <span className="flex items-center gap-1"><Check className="h-3 w-3" /> Applied</span>
                  ) : (
                    "Apply"
                  )}
                </button>
              </div>
            );
          })}
          <p className="text-[9px] text-white/30 leading-snug">
            {matchSource === "ai" ? "AI-matched" : "Matched"} from your scene
            {loadTrackedTrendSignals().length > 0 ? " + the trends you're tracking" : ""}.{" "}
            {matchDisclaimer ?? "Nothing is applied until you tap Apply."}
          </p>
        </div>
      )}

      {/* Effect picker, grouped by category */}
      {categories.map((cat) => (
        <div key={cat.name}>
          <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1">{cat.name}</p>
          <div className="flex gap-1.5 flex-wrap">
            {cat.recipes.map((r) => {
              const picked = pickedIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  title={r.bestFor}
                  data-testid={`effect-pick-${r.id}`}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                    picked
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-white/70"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {capHint && (
        <p className="text-[10px] text-amber-300/90" data-testid="effects-cap-hint">
          {maxStack} effects max per clip — remove one to swap in another.
        </p>
      )}

      {/* What the picks do + what they honestly need */}
      {pickedRecipes.map((r) => {
        const needs = effectNeedsLabel(r.needs);
        return (
          <p key={r.id} className="text-[10px] text-white/45 leading-snug">
            <span className="text-primary/90 font-semibold">{r.name}:</span> {r.bestFor}
            {needs && <span className="text-white/60"> {needs}.</span>}
          </p>
        );
      })}

      {/* Camera-conflict warnings — stated plainly, never a block */}
      {conflicts.length > 0 && (
        <div
          className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/[0.07] border border-amber-400/25"
          data-testid="effect-conflict-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-300 shrink-0 mt-px" />
          <div className="space-y-1">
            {conflicts.map((c) => (
              <p key={`${c.effectId}-${c.move}`} className="text-[10px] text-amber-200/90 leading-snug">
                {c.message}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
