import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Star, Sparkles, Download, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { levelInfo } from "@/lib/creator-level";
import type { StarLevel } from "@/contexts/UserModeContext";
import ConfettiBurst from "@/components/artist/confetti-burst";

/* ─── LevelUpModal — creator-level celebration ────────────────────────────
   Fires exactly once per level: the celebration is recorded server-side the
   moment the modal mounts, so even a dismiss never re-fires it. CSS-only
   confetti (ConfettiBurst), gold-black luxury, share card via canvas.
   Fully dismissible: X, backdrop tap, Escape. */

const GOLD = "#e8c86a";
const GOLD_DEEP = "#C9A84C";

function Stars({ n, size = "h-7 w-7" }: { n: number; size?: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label={`${n} of 6 stars`}>
      {Array.from({ length: 6 }, (_, i) => (
        <Star
          key={i}
          className={`${size} ${i < n ? "text-[#e8c86a] fill-[#e8c86a] drop-shadow-[0_0_8px_rgba(232,200,106,0.8)]" : "text-white/15"}`}
        />
      ))}
    </div>
  );
}

export default function LevelUpModal({ level, onClose }: { level: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const clamped = Math.min(6, Math.max(1, level)) as StarLevel;
  const info = useMemo(() => levelInfo(clamped), [clamped]);
  const [showCard, setShowCard] = useState(false);
  const [copied, setCopied] = useState(false);
  const celebrateSent = useRef(false);

  /* Exactly-once: record the celebration the moment the modal mounts. */
  useEffect(() => {
    if (celebrateSent.current) return;
    celebrateSent.current = true;
    (async () => {
      try {
        const token = await getAccessToken();
        await fetch("/api/retention/level-check/celebrate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ level: clamped }),
        });
      } catch {
        /* Non-fatal: the GET already returned this level as uncelebrated;
           worst case it shows again next load. */
      }
    })();
  }, [clamped, getAccessToken]);

  /* Escape dismisses. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unlocks = useMemo(() => {
    const raw = t(`retentionDelight.levelUp_unlocks_${clamped}`, { returnObjects: true });
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [t, clamped]);

  const shareText = t("retentionDelight.levelUp_shareText", { rank: info.rank, stars: clamped });

  const copyShareText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can still download the card */
    }
  }, [shareText]);

  const downloadCard = useCallback(() => {
    const W = 1080, H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Gold-black luxury card
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#14100a");
    bg.addColorStop(1, "#000000");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = GOLD_DEEP;
    ctx.lineWidth = 10;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.strokeStyle = "rgba(232,200,106,0.25)";
    ctx.lineWidth = 3;
    ctx.strokeRect(55, 55, W - 110, H - 110);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(201,168,76,0.85)";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.fillText("BOW DOWN VISUALS", W / 2, 200);

    ctx.fillStyle = GOLD;
    ctx.font = "900 130px system-ui, sans-serif";
    ctx.fillText("LEVEL UP", W / 2, 400);

    ctx.font = "120px system-ui, sans-serif";
    ctx.fillStyle = GOLD;
    const stars = "★".repeat(clamped) + "☆".repeat(6 - clamped);
    ctx.fillText(stars, W / 2, 580);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 84px system-ui, sans-serif";
    ctx.fillText(info.rank.toUpperCase(), W / 2, 740);

    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "italic 500 44px system-ui, sans-serif";
    ctx.fillText(info.tagline, W / 2, 830);

    ctx.fillStyle = GOLD_DEEP;
    ctx.font = "700 40px system-ui, sans-serif";
    ctx.fillText("bowdownvisuals.com", W / 2, H - 130);

    const a = document.createElement("a");
    a.download = `bow-down-visuals-level-${clamped}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }, [clamped, info]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/85 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={t("retentionDelight.levelUp_title")}
      onClick={onClose}
    >
      <ConfettiBurst count={110} />
      <div
        className="relative w-[min(94vw,460px)] my-8 rounded-3xl border-2 border-[#C9A84C] bg-gradient-to-b from-[#1a1408] to-black p-7 pt-8 text-center shadow-[0_0_70px_rgba(201,168,76,0.4)] animate-[popIn_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute top-3 right-3 rounded-full p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        {!showCard ? (
          <>
            <p className="text-[11px] font-black tracking-[0.3em] text-[#C9A84C] uppercase flex items-center justify-center gap-1.5">
              <Sparkles className="h-4 w-4" />{t("retentionDelight.levelUp_title")}
            </p>
            <h2 className="font-display mt-3 text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-[#f5e3a8] via-[#e8c86a] to-[#8a6d2f] leading-tight">
              {info.rank}
            </h2>
            <div className="mt-4"><Stars n={clamped} /></div>
            <p className="mt-3 text-sm italic text-white/55">{info.tagline}</p>

            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left">
              <p className="text-[10px] font-black tracking-[0.2em] text-[#C9A84C]/80 uppercase mb-2.5">
                {t("retentionDelight.levelUp_unlocks")}
              </p>
              <ul className="space-y-2">
                {unlocks.map((u, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-white/75">
                    <Check className="h-4 w-4 text-[#e8c86a] shrink-0 mt-0.5" />
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowCard(true)}
                className="rounded-xl bg-gradient-to-b from-[#f0d878] to-[#C9A84C] py-3 text-sm font-black text-black transition hover:brightness-110 active:brightness-95"
              >
                {t("retentionDelight.levelUp_share")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/15 bg-white/[0.04] py-3 text-sm font-bold text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                {t("retentionDelight.levelUp_dismiss")}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Share card preview */}
            <div className="rounded-2xl border-2 border-[#C9A84C] bg-gradient-to-b from-[#14100a] to-black p-6">
              <p className="text-[10px] font-bold tracking-[0.25em] text-[#C9A84C]/80 uppercase">Bow Down Visuals</p>
              <p className="font-display mt-2 text-3xl font-black text-[#e8c86a]">{t("retentionDelight.levelUp_title")}</p>
              <div className="mt-3"><Stars n={clamped} size="h-5 w-5" /></div>
              <p className="mt-3 text-xl font-black text-white">{info.rank}</p>
              <p className="mt-1 text-xs italic text-white/50">{info.tagline}</p>
              <p className="mt-4 text-[11px] font-bold text-[#C9A84C]/70">bowdownvisuals.com</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={downloadCard}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f0d878] to-[#C9A84C] py-3 text-sm font-black text-black transition hover:brightness-110 active:brightness-95"
              >
                <Download className="h-4 w-4" />{t("retentionDelight.levelUp_download")}
              </button>
              <button
                type="button"
                onClick={copyShareText}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] py-3 text-sm font-bold text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                {copied ? t("retentionDelight.levelUp_copied") : t("retentionDelight.levelUp_copy")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowCard(false)}
              className="mt-3 text-sm font-semibold text-white/40 hover:text-white/70 transition-colors"
            >
              ← {t("retentionDelight.levelUp_dismiss")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
