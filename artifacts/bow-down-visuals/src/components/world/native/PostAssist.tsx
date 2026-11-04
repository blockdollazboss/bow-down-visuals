import { apiErrorMessage } from "../../../lib/api-error";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  POST_ASSIST_COST_VISUAL_BUCS,
  POST_ASSIST_PATH,
  POST_ASSIST_TONES,
  buildPostAssistPayload,
  parsePostAssistDraft,
  postAssistPromptReady,
  type PostAssistTone,
} from "@/lib/world/post-assist";

/* ─── Post Assist — "Write It For Me" (Stack-100 #58) ───────────────
   One shared block, two homes: the Community Hall's feed composer
   and the Promote Room. It rides the 2D composer's own rail
   (POST /api/posts/assist, 100 Visual Bucs — the registry's price,
   confirmed through useConfirmedApi before anything runs, refunded
   server-side when the assist fails) and hands the drafted words
   back to the host surface. It never posts by itself: the member
   reads, edits and sends their own words, exactly like the website
   composer. */

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

/* The assist's tone vocabulary renders from the catalog, keyed by
   the tone token, with the seam's label as the fallback. */
const ASSIST_TONE_KEYS: Record<string, string> = {
  hype: "worldSocialDesk.assistToneHype",
  chill: "worldSocialDesk.assistToneChill",
  professional: "worldSocialDesk.assistToneProfessional",
  funny: "worldSocialDesk.assistToneFunny",
};

export function PostAssistBlock({
  isLight,
  onDraft,
}: {
  isLight: boolean;
  /** The drafted words, handed to the host composer — never posted here. */
  onDraft: (draft: string) => void;
}) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<PostAssistTone>("hype");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const ask = async () => {
    if (busy || !postAssistPromptReady(prompt)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await confirmedFetch(POST_ASSIST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPostAssistPayload(prompt, tone)),
      });
      if (!res) return; // credit confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { message?: string };
        setNote(
          res.status === 402
            ? t("worldSocialDesk.assistOutOfCredits")
            : apiErrorMessage(d, t("worldSocialDesk.assistFailedFallback")),
        );
        return;
      }
      const draft = parsePostAssistDraft(data);
      if (!draft) {
        setNote(t("worldSocialDesk.assistNoWords"));
        return;
      }
      onDraft(draft);
      setPrompt("");
      setNote(t("worldSocialDesk.assistDraftedNote"));
      refreshProfile();
    } catch {
      setNote(t("worldSocialDesk.assistDidntAnswer"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="world-post-assist">
      <div className="flex gap-2">
        <input
          aria-label={t("worldSocialDesk.assistPromptAria")}
          data-testid="world-post-assist-prompt"
          className={inputCls(isLight)}
          placeholder={t("worldSocialDesk.assistPromptPlaceholder")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ask()}
          maxLength={300}
        />
        <button
          type="button"
          data-testid="world-post-assist-ask"
          onClick={() => void ask()}
          disabled={busy || !postAssistPromptReady(prompt)}
          className={goldBtn}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {t("worldSocialDesk.assistButton", { cost: POST_ASSIST_COST_VISUAL_BUCS })}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="world-post-assist-tones">
        {POST_ASSIST_TONES.map((toneOpt) => (
          <button
            key={toneOpt.key}
            type="button"
            data-testid={`world-post-assist-tone-${toneOpt.key}`}
            aria-pressed={tone === toneOpt.key}
            onClick={() => setTone(toneOpt.key)}
            className={chipBtn(isLight, tone === toneOpt.key)}
          >
            {ASSIST_TONE_KEYS[toneOpt.key] ? t(ASSIST_TONE_KEYS[toneOpt.key]!) : toneOpt.label}
          </button>
        ))}
        <span className={`text-[11px] ${muted}`}>{t("worldSocialDesk.assistNoteLine")}</span>
      </div>
      {note ? (
        <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-post-assist-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}
