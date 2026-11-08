/**
 * DreamCollabBench — Dream Collab's native bench at the My
 * Studio board (Stack 300 world parity, census Lane B item
 * 11 / manifest item 104), stacked with the board's other
 * Create-family desks: the /create hub panel, in the room.
 *
 * The panel's own flow on its own rail (lib/world/
 * dream-collab-bench.ts): a dream collaborator + your style
 * (+ an optional song theme) behind the spend confirmation —
 * 200 Bucs, the override the panel itself passes — returns
 * the style-blend concept whole: logline, concept, blend,
 * video prompts, song concept, with the panel's copy-all
 * text. "Make this song" opens the Song Desk station
 * in-world (the panel's website prefill link has no
 * panel-payload kind; the concept stays on the bench,
 * copyable — nothing is silently dropped). A decline runs
 * nothing; a 402 lands in the out-of-Bucs state; a failed
 * run is refunded server-side. Copy rides dreamCollab.*.
 */
import { useState } from "react";
import { Check, Copy, Loader2, Sparkles, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskTextField } from "./CreateDeskLeaf";
import {
  DREAM_COLLAB_COST,
  DREAM_COLLAB_FEATURE,
  DREAM_COLLAB_PATH,
  DREAM_COLLAB_SONG_STATION_ID,
  buildDreamCollabPayload,
  dreamCollabConceptOf,
  dreamCollabCopyText,
  dreamCollabInputReady,
  type DreamCollabConcept,
} from "@/lib/world/dream-collab-bench";

export function DreamCollabBench({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string) => void;
}) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [collaborator, setCollaborator] = useState("");
  const [userStyle, setUserStyle] = useState("");
  const [songTheme, setSongTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [concept, setConcept] = useState<DreamCollabConcept | null>(null);
  const [copied, setCopied] = useState(false);

  const ready = dreamCollabInputReady({ collaborator, userStyle });
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const labelCls = `text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

  async function generate() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(DREAM_COLLAB_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: DREAM_COLLAB_COST,
        overrideFeature: DREAM_COLLAB_FEATURE,
        body: JSON.stringify(buildDreamCollabPayload({ collaborator, userStyle, songTheme })),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = dreamCollabConceptOf(data);
      if (!res.ok || !parsed) {
        throw new Error(apiErrorMessage(data, t("dreamCollab.failed")));
      }
      setConcept(parsed);
      refreshProfile();
    } catch (e) {
      setError(plainErrorText(e, t("dreamCollab.failed")));
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!concept) return;
    void navigator.clipboard?.writeText(dreamCollabCopyText(concept)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="space-y-3" data-testid="world-dream-collab-bench">
      <div className="flex items-center gap-2">
        <Users className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>{t("dreamCollab.title")}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {t("dreamCollab.cost")}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("dreamCollab.desc")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={t("dreamCollab.collabLabel")}
          value={collaborator}
          onChange={setCollaborator}
          placeholder={t("dreamCollab.collabPh")}
        />
        <DeskTextField
          isLight={isLight}
          label={t("dreamCollab.styleLabel")}
          value={userStyle}
          onChange={setUserStyle}
          placeholder={t("dreamCollab.stylePh")}
        />
      </div>
      <DeskTextField
        isLight={isLight}
        label={t("dreamCollab.themeLabel")}
        value={songTheme}
        onChange={setSongTheme}
        placeholder={t("dreamCollab.themePh")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-dream-collab-run"
          onClick={() => void generate()}
          disabled={loading || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("dreamCollab.generate")}
        </button>
      </div>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: DREAM_COLLAB_FEATURE })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {concept && (
        <div className={`space-y-3 rounded-xl border p-3 ${cardCls}`} data-testid="world-dream-collab-result">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-base font-black leading-snug ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              “{concept.logline}”
            </p>
            <button
              type="button"
              onClick={copyAll}
              className={`shrink-0 ${muted}`}
              aria-label={t("worldBenches300.copyLabel")}
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isLight ? "text-[#2a1e07]/85" : "text-white/80"}`}>
            {concept.concept}
          </p>
          <div>
            <p className={labelCls}>{t("dreamCollab.styleBlend")}</p>
            <p className={`text-sm ${muted}`}>{concept.styleBlend}</p>
          </div>
          {concept.videoPrompts.length > 0 && (
            <div>
              <p className={labelCls}>{t("dreamCollab.videoPrompts")}</p>
              <div className="mt-1 space-y-2">
                {concept.videoPrompts.map((p, i) => (
                  <p key={i} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${isLight ? "border-[#C9A84C]/30 bg-white/60 text-[#2a1e07]/75" : "border-white/10 bg-black/40 text-white/75"}`}>
                    {p}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className={labelCls}>{t("dreamCollab.songConcept")}</p>
            <p className={`whitespace-pre-wrap text-sm ${muted}`}>{concept.songConcept}</p>
          </div>
          {/* Hand-off: open the Song Desk in-world — the
              concept rides the copy button above (the
              website's prefill channel has no in-World
              payload kind). */}
          <button
            type="button"
            data-testid="world-dream-collab-make-song"
            onClick={() => onOpenStation?.(DREAM_COLLAB_SONG_STATION_ID)}
            className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target"
          >
            <Sparkles className="h-4 w-4" />
            {t("dreamCollab.makeThisSong")}
          </button>
        </div>
      )}
    </div>
  );
}
