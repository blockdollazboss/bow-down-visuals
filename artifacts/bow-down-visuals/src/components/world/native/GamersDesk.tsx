/* ─── #96 The Gamers Hub desk ──────────────────────────────────────
   The Home of Gamers idea engine inside the hall Screen panel, on
   the 2D Gamers page's own rail (the pure seam that carries the
   rail's path is lib/world/gamers-desk.ts).

   The flow is the page's: game + niche + content type, one
   confirmedFetch — the credit confirm quotes the registry row for
   the rail (no override), a cancel sends nothing, the rail charges
   before the model call and auto-refunds a failed generation, so
   a pack is charged exactly once or not at all. The displayed
   price is GAMERS_IDEAS_COST from lib/gamers-prices — the same
   derived figure the fixed page renders; this file carries no
   price literal of its own.

   First load shows the page's labeled sample pack; the first real
   generation replaces it wholesale. The toolkit below is the
   page's six cards as a browse shelf — no links out, no page
   pull-ups (World law): their working in-world homes are the
   palace's own desks, and this desk is the idea engine.

   Guest boundary: the desk mounts only inside LiveDesksPanel,
   which the World renders inside the members-only Screen panel —
   palace guests never reach it. */

import { useState } from "react";
import type { ReactNode } from "react";
import {
  Check, Clapperboard, Copy, Gamepad2, Loader2, Radio, Sparkles, Tag, Trophy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { GAMERS_IDEAS_COST } from "@/lib/gamers-prices";
import {
  GAMERS_IDEAS_PATH, GAMERS_CONTENT_TYPES, GAMERS_GAME_MAX, GAMERS_NICHE_MAX,
  GAMERS_TRENDING_GAMES, GAMERS_SAMPLE_PACK, GAMERS_TOOL_CARDS,
  GAMERS_OUT_OF_CREDITS_LINE,
  gamersDraftReady, buildGamersIdeasBody, normalizeGamersPack, gamersOutOfCredits,
  type GamersContentType, type GamersIdeaPack,
} from "@/lib/world/gamers-desk";

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

function CopyLine({ text, isLight }: { text: string; isLight: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      data-testid="world-gamers-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* Clipboard unavailable on this device — the line stays
             on screen to copy by hand; nothing is dressed up. */
        }
      }}
      className={`shrink-0 rounded-full border p-1.5 transition bdv-touch-target ${
        isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/60 hover:text-white"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function PackBlock({
  isLight, testId, icon, title, isSample, children,
}: {
  isLight: boolean;
  testId: string;
  icon: ReactNode;
  title: string;
  isSample: boolean;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
          {icon} {title}
        </h4>
        {isSample && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/40"}`}>
            Sample
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function GamersDesk({ isLight }: { isLight: boolean }) {
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [game, setGame] = useState("Valorant");
  const [niche, setNiche] = useState("");
  const [contentType, setContentType] = useState<GamersContentType>("stream");
  const [pack, setPack] = useState<GamersIdeaPack>(GAMERS_SAMPLE_PACK);
  const [isSample, setIsSample] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const body = isLight ? "text-[#2a1e07]" : "text-white/85";
  const activeType = GAMERS_CONTENT_TYPES.find((c) => c.key === contentType) ?? GAMERS_CONTENT_TYPES[0];

  async function generate() {
    if (loading) return;
    if (!gamersDraftReady(game, niche)) {
      setError("Tell us which game first — the AI needs a game to build around.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(GAMERS_IDEAS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGamersIdeasBody({ game, niche, contentType })),
      });
      if (!res) return; /* the member cancelled the credit confirmation — nothing was sent or charged */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (gamersOutOfCredits(res.status, data)) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const normalized = res.ok ? normalizeGamersPack(data) : null;
      if (!normalized) throw new Error(apiErrorMessage(data, "Generation failed"));
      setPack(normalized);
      setIsSample(false);
      refreshProfile();
    } catch (e) {
      setError(plainErrorText(e, "The generator hiccupped — try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-testid="world-gamers-desk"
      className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${body}`}>
          <Gamepad2 className="h-4 w-4 text-[#b8912c]" aria-hidden="true" /> Gamers Hub
        </h3>
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${muted}`}>
          <Sparkles className="h-3 w-3" aria-hidden="true" /> AI powered · {GAMERS_IDEAS_COST} Visual Bucs per idea pack
        </span>
      </div>
      <p className={`mt-1 text-sm ${muted}`}>
        The Home of Gamers idea engine — stream titles, video ideas and tags for your next run, without leaving the palace.
      </p>

      {/* content type — the page's three, one pack shape each */}
      <div className="mt-3 flex flex-wrap gap-2" data-testid="world-gamers-types">
        {GAMERS_CONTENT_TYPES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setContentType(c.key)}
            aria-pressed={contentType === c.key}
            className={
              contentType === c.key
                ? goldBtn
                : `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                    isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                  }`
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className={`mt-1.5 text-xs ${muted}`}>{activeType.blurb}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={game}
          onChange={(e) => setGame(e.target.value)}
          placeholder="Which game?"
          aria-label="Game"
          maxLength={GAMERS_GAME_MAX}
          className={inputCls(isLight)}
          data-testid="world-gamers-game"
        />
        <input
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="Niche or angle (optional)"
          aria-label="Niche or angle"
          maxLength={GAMERS_NICHE_MAX}
          className={inputCls(isLight)}
          data-testid="world-gamers-niche"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="world-gamers-trending">
        <span className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>Trending</span>
        {GAMERS_TRENDING_GAMES.map((g) => (
          <button
            key={g.name}
            type="button"
            onClick={() => setGame(g.name)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition bdv-touch-target ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                : "border-white/15 text-white/70 hover:text-white"
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={loading || !gamersDraftReady(game, niche)}
        className={`${goldBtn} mt-3`}
        data-testid="world-gamers-generate"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Generating…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Generate ideas · {GAMERS_IDEAS_COST} Visual Bucs
          </>
        )}
      </button>

      {outOfCredits && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${isLight ? "border-amber-600/40 bg-amber-100/60 text-[#6B4E00]" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`} data-testid="world-gamers-out-of-credits">
          {GAMERS_OUT_OF_CREDITS_LINE}
        </p>
      )}
      {error && !outOfCredits && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${isLight ? "border-red-600/30 bg-red-100/60 text-red-900" : "border-red-500/30 bg-red-500/10 text-red-300"}`} data-testid="world-gamers-error">
          {error}
        </p>
      )}

      {/* the pack — sample until the first real generation lands */}
      <div className="mt-4 space-y-4" data-testid="world-gamers-pack">
        <PackBlock isLight={isLight} testId="world-gamers-titles" icon={<Radio className="h-3.5 w-3.5" />} title="Stream titles" isSample={isSample}>
          <ul className="space-y-1.5">
            {pack.titles.map((line, i) => (
              <li key={i} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white/85"}`}>
                <span>{line}</span>
                <CopyLine text={line} isLight={isLight} />
              </li>
            ))}
          </ul>
        </PackBlock>
        <PackBlock isLight={isLight} testId="world-gamers-ideas" icon={<Clapperboard className="h-3.5 w-3.5" />} title="Video ideas" isSample={isSample}>
          <ul className="space-y-1.5">
            {pack.videoIdeas.map((line, i) => (
              <li key={i} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white/85"}`}>
                <span>{line}</span>
                <CopyLine text={line} isLight={isLight} />
              </li>
            ))}
          </ul>
        </PackBlock>
        <PackBlock isLight={isLight} testId="world-gamers-tags" icon={<Tag className="h-3.5 w-3.5" />} title="Tags" isSample={isSample}>
          <div className="flex flex-wrap gap-1.5">
            {pack.tags.map((tag, i) => (
              <span key={i} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"}`}>
                #{tag}
              </span>
            ))}
          </div>
        </PackBlock>
      </div>

      {/* the toolkit — the page's six cards as a browse shelf */}
      <div className={`mt-4 border-t pt-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
        <h4 className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#d4af37]"}`}>
          <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> The Gamer Toolkit
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="world-gamers-toolkit">
          {GAMERS_TOOL_CARDS.map((card) => (
            <div key={card.label} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}>
              <p className={`text-sm font-bold ${body}`}>{card.label}</p>
              <p className={`mt-0.5 text-xs ${muted}`}>{card.blurb}</p>
            </div>
          ))}
        </div>
        <p className={`mt-2 text-xs ${muted}`}>
          Browse shelf — every tool's working home is its own desk in the palace; this desk is the idea engine.
        </p>
      </div>
    </div>
  );
}
