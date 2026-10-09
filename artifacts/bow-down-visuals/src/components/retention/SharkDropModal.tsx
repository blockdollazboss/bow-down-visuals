import { useCallback, useEffect, useRef, useState } from "react";
import { X, Gift, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";

/* ─── SharkDropModal — surprise Visual Bucs ──────────────────────────────
   The King Shark (character-locked favicon GIF) drops VB in your vault.
   Fully dismissible: X, backdrop tap, Escape, or "Maybe later". No timers
   force a claim — the drop simply expires server-side after 48h. */

export interface SharkDrop {
  id: string;
  amount: number;
  droppedAt: string;
  expiresAt: string;
}

function formatVB(n: number) {
  return n.toLocaleString("en-US");
}

function expiryLabel(expiresAt: string, t: (k: string, o?: Record<string, string>) => string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t("retentionDelight.sharkDrop_expired");
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return t("retentionDelight.sharkDrop_expires", { time: `${mins}m` });
  const hrs = Math.floor(mins / 60);
  return t("retentionDelight.sharkDrop_expires", { time: `${hrs}h ${mins % 60}m` });
}

export default function SharkDropModal({
  drop,
  onClaimed,
  onDismiss,
}: {
  drop: SharkDrop;
  onClaimed: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const claimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Refresh the expiry countdown every 30s. */
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  /* Escape dismisses. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => () => {
    if (claimTimer.current) clearTimeout(claimTimer.current);
  }, []);

  const claim = useCallback(async () => {
    if (claiming || claimed) return;
    setClaiming(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/retention/shark-drop/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ dropId: drop.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { claimed?: boolean; amount?: number; error?: string };
      if (!res.ok || !data.claimed) {
        throw new Error(data.error ?? t("retentionDelight.sharkDrop_failed"));
      }
      setClaimed(true);
      refreshProfile();
      // Let the success moment land, then close on its own.
      claimTimer.current = setTimeout(onClaimed, 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("retentionDelight.sharkDrop_failed"));
    } finally {
      setClaiming(false);
    }
  }, [claiming, claimed, drop.id, getAccessToken, onClaimed, refreshProfile, t]);

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("retentionDelight.sharkDrop_title")}
      onClick={onDismiss}
    >
      <div
        className="relative w-[min(94vw,420px)] rounded-3xl border-2 border-[#C9A84C] bg-gradient-to-b from-[#1a1408] to-black p-7 text-center shadow-[0_0_60px_rgba(201,168,76,0.35)] animate-[popIn_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 rounded-full p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Mascot — the character-locked Shark King, ringed in gold */}
        <div className="mx-auto -mt-16 mb-4 h-28 w-28 rounded-full border-[3px] border-[#e8c86a] shadow-[0_0_35px_rgba(232,200,106,0.55)] overflow-hidden bg-black">
          <img src="/favicon.gif" alt="Thy Cheat Code, the Shark King" className="h-full w-full object-cover" draggable={false} />
        </div>

        <p className="text-[10px] font-black tracking-[0.22em] text-[#C9A84C]/80 uppercase flex items-center justify-center gap-1.5">
          <Gift className="h-3.5 w-3.5" />{t("retentionDelight.sharkDrop_title")}
        </p>
        <h2 className="font-display mt-2 text-2xl font-black text-white leading-tight">
          {t("retentionDelight.sharkDrop_subtitle", { amount: formatVB(drop.amount) })}
        </h2>
        <p className="mt-2 text-sm text-white/60">{t("retentionDelight.sharkDrop_body")}</p>

        {claimed ? (
          <p className="mt-6 rounded-xl bg-[#e8c86a]/10 border border-[#e8c86a]/30 px-4 py-3 text-sm font-bold text-[#e8c86a]">
            {t("retentionDelight.sharkDrop_claimed", { amount: formatVB(drop.amount) })}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={claim}
              disabled={claiming}
              className="mt-6 w-full rounded-xl bg-gradient-to-b from-[#f0d878] to-[#C9A84C] py-3.5 text-lg font-black text-black transition hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-wait"
            >
              {claiming
                ? t("retentionDelight.sharkDrop_claiming")
                : t("retentionDelight.sharkDrop_claim", { amount: formatVB(drop.amount) })}
            </button>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 text-sm font-semibold text-white/40 hover:text-white/70 transition-colors"
            >
              {t("retentionDelight.sharkDrop_dismiss")}
            </button>
          </>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/35">
          <Timer className="h-3 w-3" />{expiryLabel(drop.expiresAt, t)}
        </p>
      </div>
    </div>
  );
}
