import { useState } from "react";
import { Clapperboard, Sparkles, Loader2, Check, X, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { SceneData } from "@/lib/scene-parser";
import {
  LOOK_RAIL_ORDER,
  LOOK_RAIL_OPTIONS,
  LOOK_RAIL_TITLES,
  applicableLookClauses,
  applyLookProposal,
  lookOption,
  suppressedLookPicks,
  type LookRail,
  type SceneLookPicks,
} from "@/lib/scene-look";

/* ─── Director's Look Rails panel ──────────────────────────────────────────
   Docked in the Scene Studio scene card beside the free-text Camera /
   Lighting / Mood fields. Five structured rails (genre, era, lens look,
   lighting, emotion/tempo); picks persist on the scene (scene.look) and
   weave into the generation prompt through the shared composer in
   lib/scene-look.ts.

   The AI Director proposes a full look per scene; a proposal is ONLY a
   proposal — it lives in this panel's local state and reaches the scene
   exclusively through the per-rail / Accept-all buttons below. Nothing
   is ever applied silently. */

interface DirectorProposal {
  picks: SceneLookPicks;
  reasons: Partial<Record<LookRail, string>>;
}

export function LookRailsPanel({ scene, onPick }: {
  scene: SceneData;
  onPick: (patch: Partial<SceneData>) => void;
}) {
  const { getAccessToken } = useAuth();
  const [proposal, setProposal] = useState<DirectorProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [acceptedRails, setAcceptedRails] = useState<Set<LookRail>>(new Set());

  const look: SceneLookPicks = scene.look ?? {};
  const clauses = applicableLookClauses(scene);
  const suppressed = suppressedLookPicks(scene);

  function setRailPick(rail: LookRail, key: string | null) {
    const next: SceneLookPicks = { ...look };
    if (key) next[rail] = key;
    else delete next[rail];
    onPick({ look: next });
  }

  async function askDirector() {
    if (proposing) return;
    setProposing(true);
    setProposalError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/director-look", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: scene.aiVideoPrompt ?? "",
          action: scene.action,
          location: scene.location,
          cameraMovement: scene.cameraMovement,
          lighting: scene.lighting,
          mood: scene.mood,
          currentLook: look,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        proposal?: DirectorProposal;
        error?: string;
      };
      if (!res.ok || !data.proposal) {
        throw new Error(data.error || `AI Director error (HTTP ${res.status})`);
      }
      /* Proposal lands in LOCAL state only — the scene is untouched until
         the creator accepts a rail (acceptRail / acceptAllProposal). */
      setProposal(data.proposal);
      setAcceptedRails(new Set());
    } catch (e) {
      setProposalError(e instanceof Error ? e.message : "The AI Director could not propose a look.");
    } finally {
      setProposing(false);
    }
  }

  function acceptRail(rail: LookRail) {
    if (!proposal) return;
    onPick({ look: applyLookProposal(scene.look, proposal.picks, [rail]) });
    setAcceptedRails((prev) => new Set(prev).add(rail));
  }

  function acceptAllProposal() {
    if (!proposal) return;
    const rails = LOOK_RAIL_ORDER.filter((r) => proposal.picks[r]);
    onPick({ look: applyLookProposal(scene.look, proposal.picks, rails) });
    setAcceptedRails(new Set(rails));
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3.5 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
          <Clapperboard className="h-2.5 w-2.5" /> Director&rsquo;s Look
        </p>
        <button
          onClick={() => void askDirector()}
          disabled={proposing}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary/30 bg-primary/[0.08] text-primary text-[11px] font-bold hover:bg-primary/[0.15] transition-colors disabled:opacity-50"
          data-testid="btn-ai-director-look"
        >
          {proposing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          AI Director — propose a look
        </button>
      </div>

      {LOOK_RAIL_ORDER.map((rail) => {
        const picked = look[rail];
        const suppressedHere = suppressed.find((s) => s.rail === rail);
        return (
          <div key={rail} className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-white/40 w-24 shrink-0">
                {LOOK_RAIL_TITLES[rail]}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LOOK_RAIL_OPTIONS[rail].map((option) => {
                  const active = picked === option.key;
                  return (
                    <button
                      key={option.key}
                      onClick={() => setRailPick(rail, active ? null : option.key)}
                      className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80 hover:border-white/25"
                      }`}
                      data-testid={`look-chip-${rail}-${option.key}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {suppressedHere && (
              <p className="text-[10px] text-white/30 flex items-start gap-1 pl-24">
                <Info className="h-3 w-3 shrink-0 mt-px" />
                {suppressedHere.reason === "free-text"
                  ? rail === "lighting"
                    ? "Your written Lighting text wins — this pick stays saved but won't be added while that text is there."
                    : "Your written Mood text wins — this pick stays saved but won't be added while that text is there."
                  : "Already expressed in your prompt text, so it isn't added twice."}
              </p>
            )}
          </div>
        );
      })}

      <p className="text-[10px] text-white/30 leading-relaxed">
        {clauses.length > 0 ? (
          <>Adds to the prompt: <span className="text-white/50">{clauses.map((c) => c.phrase).join(" · ")}</span></>
        ) : (
          "Picks weave into the generation prompt as look language — lens picks describe the look, not camera metadata."
        )}
      </p>

      {proposalError && (
        <p className="text-[11px] text-red-300/80">{proposalError}</p>
      )}

      {proposal && (
        <div className="rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black text-primary/80 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> AI Director&rsquo;s proposal — nothing applied yet
            </p>
            <button
              onClick={() => { setProposal(null); setAcceptedRails(new Set()); }}
              className="text-white/40 hover:text-white/80 transition-colors"
              aria-label="Dismiss proposal"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {LOOK_RAIL_ORDER.filter((rail) => proposal.picks[rail]).map((rail) => {
            const option = lookOption(rail, proposal.picks[rail]);
            if (!option) return null;
            const accepted = acceptedRails.has(rail);
            return (
              <div key={rail} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-white/80">
                    <span className="text-white/35 font-semibold">{LOOK_RAIL_TITLES[rail]}: </span>
                    {option.label}
                  </p>
                  {proposal.reasons[rail] && (
                    <p className="text-[11px] text-white/40 leading-snug">{proposal.reasons[rail]}</p>
                  )}
                </div>
                <button
                  onClick={() => acceptRail(rail)}
                  disabled={accepted}
                  className={`shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-lg border text-[11px] font-bold transition-colors ${
                    accepted
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                  data-testid={`btn-accept-look-${rail}`}
                >
                  <Check className="h-3 w-3" /> {accepted ? "Accepted" : "Accept"}
                </button>
              </div>
            );
          })}
          <button
            onClick={acceptAllProposal}
            className="w-full h-8 rounded-lg bg-primary text-black text-xs font-black hover:brightness-110 transition"
            data-testid="btn-accept-look-all"
          >
            Accept the whole look
          </button>
        </div>
      )}
    </div>
  );
}
