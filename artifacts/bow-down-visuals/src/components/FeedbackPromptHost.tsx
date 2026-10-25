import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Star, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  FEEDBACK_MOMENT_EVENT,
  SESSION_MILESTONE_MS,
  decideFeedbackPrompt,
  notifyQualifyingMoment,
  type QualifyingMoment,
} from "@/lib/feedback-prompt";

/* ─── Feedback Pop-Up host (Stack-200 UPGRADES 180) ────────────────────
   Mounted once inside the signed-in shell. It NEVER shows anything on
   mount or on a page load: it only listens for qualifying moments
   (bdv:qualifying-moment events from real success paths) plus the
   host's own 20-minute session milestone, then runs the full gate —
   settings toggle + server cap (GET eligibility), suppression by
   route, and the chance roll — and only on a full pass stamps the
   showing (POST …/shown) and renders the prompt.

   The prompt itself: a star rating + ONE optional line of text, one
   tap to dismiss (the X, no questions asked, no guilt copy). A submit
   writes into the Pitch & Fix intake as fix-side feedback and goes
   through the same team moderation as everything else. */

export function FeedbackPromptHost() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [location] = useLocation();
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [thanks, setThanks] = useState(false);
  const busyRef = useRef(false);
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (!user) return;

    /* Session milestone: 20 minutes into the session is itself a
       qualifying moment (once per mount/session) — a session event,
       not a page load. */
    const milestone = setTimeout(() => notifyQualifyingMoment("session_milestone"), SESSION_MILESTONE_MS);

    async function onMoment(event: Event) {
      if (busyRef.current || visible) return;
      const moment = (event as CustomEvent<{ moment?: QualifyingMoment }>).detail?.moment;
      busyRef.current = true;
      try {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch("/api/pitch-fix/feedback-prompt/eligibility", { headers });
        if (!res.ok) return;
        const elig = (await res.json()) as { enabled: boolean; eligible: boolean; lastPromptedAt: string | null };
        const decision = decideFeedbackPrompt({
          moment,
          enabled: elig.enabled && elig.eligible,
          lastPromptedAt: elig.lastPromptedAt,
          now: Date.now(),
          context: { pathname: locationRef.current },
          roll: Math.random(),
        });
        if (!decision.show) return;
        /* Stamp the showing BEFORE rendering: the cap counts the
           showing, and a second moment racing this one finds the cap
           already running server-side. */
        const stamp = await fetch("/api/pitch-fix/feedback-prompt/shown", { method: "POST", headers });
        if (!stamp.ok) return;
        setRating(0);
        setText("");
        setThanks(false);
        setVisible(true);
      } catch {
        /* a failed gate check means no prompt — never a broken one */
      } finally {
        busyRef.current = false;
      }
    }

    window.addEventListener(FEEDBACK_MOMENT_EVENT, onMoment);
    return () => {
      clearTimeout(milestone);
      window.removeEventListener(FEEDBACK_MOMENT_EVENT, onMoment);
    };
  }, [user, getAccessToken, visible]);

  if (!user || !visible) return null;

  async function submit() {
    if (rating < 1) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/pitch-fix/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rating, text: text.trim() || undefined }),
      });
      if (!res.ok) throw new Error("feedback failed");
      setThanks(true);
      setTimeout(() => setVisible(false), 1600);
    } catch {
      /* keep the prompt open; the member can retry or dismiss */
      setThanks(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t("pitchFix.popup.title")}
      data-testid="feedback-prompt"
      className={`fixed bottom-4 right-4 z-[90] w-[min(92vw,340px)] rounded-2xl border p-5 shadow-2xl ${isLight ? "border-[#C9A84C]/50 bg-[#fffdf7] text-[#2A1E07]" : "border-[#d4a017]/40 bg-[#16140f] text-white"}`}
    >
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t("pitchFix.popup.dismiss")}
        className={`absolute right-3 top-3 rounded-full p-1 ${isLight ? "text-[#5c5138] hover:bg-black/5" : "text-white/50 hover:bg-white/10"}`}
      >
        <X className="h-4 w-4" />
      </button>
      {thanks ? (
        <p className="py-4 text-center text-sm font-bold" data-testid="feedback-prompt-thanks">{t("pitchFix.popup.thanks")}</p>
      ) : (
        <>
          <h3 className="font-serif text-lg font-bold">{t("pitchFix.popup.title")}</h3>
          <p className={`mt-1 text-sm ${isLight ? "text-[#5c5138]" : "text-white/55"}`}>{t("pitchFix.popup.sub")}</p>
          <div className="mt-3 flex gap-1" role="radiogroup" aria-label={t("pitchFix.popup.rateLabel")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t("pitchFix.popup.stars", { count: n })}
                onClick={() => setRating(n)}
                className="rounded-lg p-1 transition hover:scale-110"
              >
                <Star className={`h-7 w-7 ${n <= rating ? "fill-[#d4a017] text-[#d4a017]" : isLight ? "text-[#C9A84C]/60" : "text-white/30"}`} />
              </button>
            ))}
          </div>
          <input
            type="text"
            maxLength={400}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("pitchFix.popup.textPlaceholder")}
            aria-label={t("pitchFix.popup.textPlaceholder")}
            className={`mt-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[#d4a017] ${isLight ? "border-[#C9A84C]/50 bg-white text-[#2A1E07]" : "border-white/15 bg-black/40 text-white"}`}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={rating < 1}
            className="mt-3 w-full rounded-xl bg-[#d4a017] px-4 py-2.5 text-sm font-extrabold text-[#171408] transition hover:bg-[#eccd6d] disabled:opacity-50"
          >
            {t("pitchFix.popup.submit")}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className={`mt-2 w-full rounded-xl px-4 py-1.5 text-xs font-bold ${isLight ? "text-[#5c5138]" : "text-white/50"}`}
          >
            {t("pitchFix.popup.dismiss")}
          </button>
        </>
      )}
    </div>
  );
}
