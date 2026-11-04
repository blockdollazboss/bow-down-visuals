/**
 * BriefDesk — the My Studio board's native Morning Brief desk
 * (stack1500 world parity wave #3, census item 20).
 *
 * Thy Cheat Code's written brief, read in the World: press the
 * button and the operator reads your own business digest and
 * writes the brief — a short summary and the ONE next best move,
 * drafted for you. Free, like the website's Command Center brief
 * (the rail is pacing-limited, never charged).
 *
 * The draft-only law holds in the World exactly as on the
 * website: the desk shows the draft whole with a copy button and
 * names the surface it belongs to — it never sends, posts, or
 * executes the move. When the written brief can't be produced,
 * the rail serves the digest itself and the desk shows those
 * real numbers under a plain line — never an invented brief,
 * never an error dressed as emptiness. A failed read says so
 * and offers a retry.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import {
  BRIEF_PATH,
  briefDigestStrings,
  briefOfResponse,
  digestLines,
  type BriefRead,
} from "@/lib/world/brief-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

/* The move-kind surface names' catalog keys (worldTeamLegal) —
   the seam's BRIEF_MOVE_SURFACES table stays as the fallback
   behind this key-map. */
const BRIEF_SURFACE_KEYS: Record<string, string> = {
  post: "worldTeamLegal.briefSurfacePost",
  winback: "worldTeamLegal.briefSurfaceWinback",
  reply: "worldTeamLegal.briefSurfaceReply",
  deliver: "worldTeamLegal.briefSurfaceDeliver",
  price_check: "worldTeamLegal.briefSurfacePriceCheck",
  create: "worldTeamLegal.briefSurfaceCreate",
};

type BriefState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "read"; read: BriefRead }
  | { kind: "failed" };

export function BriefDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const [state, setState] = useState<BriefState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";

  async function readBrief() {
    setState({ kind: "loading" });
    setCopied(false);
    try {
      const headers = await deskHeaders();
      const res = await fetch(BRIEF_PATH, { headers });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "failed" });
        return;
      }
      const read = briefOfResponse(data);
      if (read.kind === "unusable") {
        setState({ kind: "failed" });
        return;
      }
      setState({ kind: "read", read });
    } catch {
      setState({ kind: "failed" });
    }
  }

  async function copyDraft(draft: string) {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard unavailable — the draft stays on screen to copy by hand. */
    }
  }

  const read = state.kind === "read" ? state.read : null;

  return (
    <div className="space-y-3" data-testid="world-brief-desk">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className={`text-base font-black ${strong}`}>{t("worldTeamLegal.briefTitle")}</p>
          <p className={`text-xs ${muted}`}>
            {t("worldTeamLegal.briefSubtitle")}
          </p>
        </div>
        <button
          type="button"
          data-testid="world-brief-desk-read"
          className={`ml-auto ${goldBtn}`}
          disabled={state.kind === "loading"}
          onClick={() => void readBrief()}
        >
          {state.kind === "loading"
            ? t("worldTeamLegal.briefReading")
            : read
              ? t("worldTeamLegal.briefReadFresh")
              : t("worldTeamLegal.briefRead")}
        </button>
      </div>

      {state.kind === "failed" ? (
        <div className={`rounded-xl border px-3 py-2 ${cardCls}`} data-testid="world-brief-desk-failed">
          <p className={`text-sm ${muted}`}>
            {t("worldTeamLegal.briefFailed")}
          </p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void readBrief()}>
            {t("worldTeamLegal.tryAgain")}
          </button>
        </div>
      ) : null}

      {read?.kind === "brief" ? (
        <div className="space-y-3" data-testid="world-brief-desk-brief">
          <p className={`text-sm leading-relaxed ${strong}`}>{read.brief.summary}</p>
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldTeamLegal.briefNextMove")}
            </p>
            <p className={`mt-1 text-sm font-bold ${strong}`}>{read.brief.move.title}</p>
            <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`} data-testid="world-brief-desk-draft">
              {read.brief.move.draft}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="world-brief-desk-copy"
                className={chipCls(copied)}
                onClick={() => void copyDraft(read.brief.move.draft)}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("worldTeamLegal.briefCopied") : t("worldTeamLegal.briefCopyDraft")}
              </button>
              <span className={`text-xs ${muted}`}>
                {t("worldTeamLegal.briefBelongs", {
                  surface: t(
                    BRIEF_SURFACE_KEYS[read.brief.move.kind] ?? "worldTeamLegal.briefSurfaceCreate",
                  ),
                })}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {read?.kind === "digest" ? (
        <div className="space-y-2" data-testid="world-brief-desk-digest">
          <p className={`text-sm ${muted}`}>
            {t("worldTeamLegal.briefDigestIntro")}
          </p>
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            {digestLines(read.fallback, briefDigestStrings(t), i18n.language).length > 0 ? (
              <ul className="space-y-1.5">
                {digestLines(read.fallback, briefDigestStrings(t), i18n.language).map((line, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={muted}>{line.label}</span>
                    <span className={`text-right font-bold ${strong}`}>{line.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-sm ${muted}`}>
                {t("worldTeamLegal.briefDigestEmpty")}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
