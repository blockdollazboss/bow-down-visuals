import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2, Copy, Check, Coins } from "lucide-react";

/* ─── ShareMenu: the share-to-earn viral loop ─────────────────────────────
 * One share row used everywhere a user shares their work: native share,
 * X, WhatsApp, copy link.
 * - Every action posts to POST /api/shares (feeds the weekly "Viral
 *   Sharer" quest). Fire-and-forget; anonymous users just share.
 * - When the sharer has a referral code, same-site URLs get ?ref=CODE
 *   appended, so views convert to signups through the existing referral
 *   flow (signup ?ref= hook → POST /api/referrals/apply). File URLs
 *   (exports) instead carry "Make your own: {origin}/?ref=CODE" in the
 *   shared text — the export-attribution billboard, extended.
 * - When the share_to_earn retention toggle is off, this renders plain
 *   share buttons with no earn messaging. */

export type ShareContentType =
  | "video" | "song" | "thumbnail" | "showcase"
  | "review_link" | "winner_card" | "other";

type ShareChannel = "native" | "x" | "whatsapp" | "copy";

interface ShareMenuProps {
  getToken?: () => Promise<string | null>;
  /** Public URL of the content being shared (page URL or file URL). */
  shareUrl: string;
  title?: string;
  text?: string;
  contentType: ShareContentType;
  contentId?: string;
  /** Pass when the parent already has the caller's referral code. */
  referralCode?: string | null;
  className?: string;
}

function isSiteUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return u.hostname === window.location.hostname || u.hostname.endsWith("bowdownvisuals.com");
  } catch {
    return false;
  }
}

/** Append the sharer's referral code to same-site URLs (never to file/CDN URLs). */
function withRef(url: string, code: string | null): string {
  if (!code || !isSiteUrl(url)) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (!u.searchParams.get("ref")) u.searchParams.set("ref", code);
    return u.toString();
  } catch {
    return url;
  }
}

export default function ShareMenu({
  getToken,
  shareUrl,
  title,
  text,
  contentType,
  contentId,
  referralCode: referralCodeProp,
  className = "",
}: ShareMenuProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(referralCodeProp ?? null);
  const [shareToEarn, setShareToEarn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  /* Keep the prop in sync if the parent resolves its code late. */
  useEffect(() => {
    if (referralCodeProp !== undefined) setCode(referralCodeProp);
  }, [referralCodeProp]);

  useEffect(() => {
    if (!getToken || referralCodeProp !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/referrals/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const d = (await res.json()) as { code?: string };
        if (!cancelled && typeof d.code === "string") setCode(d.code);
      } catch {
        /* anonymous / offline — plain share */
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, referralCodeProp]);

  /* share_to_earn retention toggle (added by a sibling worker; absent ⇒ on). */
  useEffect(() => {
    if (!getToken) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/retention/prefs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const d = (await res.json()) as { share_to_earn_enabled?: boolean };
        if (!cancelled) setShareToEarn(d.share_to_earn_enabled !== false);
      } catch {
        /* default on */
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  const finalUrl = useMemo(() => withRef(shareUrl, code), [shareUrl, code]);

  /* Full share payload: for file URLs the referral rides in the text
     ("Make your own: {origin}/?ref=CODE") next to the attribution tag. */
  const sharePayload = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (isSiteUrl(shareUrl)) {
      return { url: finalUrl, text: text ?? title ?? "" };
    }
    const refLine = code
      ? `\nMake your own: ${origin}/?ref=${encodeURIComponent(code)}`
      : `\nMake your own: ${origin}/`;
    return {
      url: shareUrl,
      text: `${text ?? title ?? ""}\n\nMade with Bow Down Visuals 🦈${refLine}`.trim(),
    };
  }, [shareUrl, finalUrl, text, title, code]);

  const track = useCallback(async (channel: ShareChannel) => {
    if (!getToken) return;
    try {
      const token = await getToken();
      if (!token) return;
      await fetch("/api/shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId ?? null,
          channel,
        }),
      });
    } catch {
      /* tracking must never break sharing */
    }
  }, [getToken, contentType, contentId]);

  const doNative = useCallback(async () => {
    if (!("share" in navigator)) return;
    try {
      await navigator.share({
        title: sharePayload.text.slice(0, 120) || undefined,
        text: sharePayload.text,
        url: sharePayload.url,
      });
      setShared(true);
      void track("native");
    } catch {
      /* dismissed — not a share */
    }
  }, [sharePayload, track]);

  const openChannel = useCallback((channel: Exclude<ShareChannel, "native" | "copy">) => {
    const encodedText = encodeURIComponent(sharePayload.text);
    const encodedUrl = encodeURIComponent(sharePayload.url);
    const href =
      channel === "x"
        ? `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
        : `https://wa.me/?text=${encodeURIComponent(`${sharePayload.text} ${sharePayload.url}`)}`;
    window.open(href, "_blank", "noopener,noreferrer");
    void track(channel);
  }, [sharePayload, track]);

  const doCopy = useCallback(async () => {
    const copyText = `${sharePayload.text}\n${sharePayload.url}`.trim();
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      /* clipboard unavailable — selection fallback */
      const ta = document.createElement("textarea");
      ta.value = copyText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    void track("copy");
  }, [sharePayload, track]);

  const btn =
    "inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition-colors";

  return (
    <div className={className}>
      {shareToEarn && code && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.08] px-2.5 py-1 text-[11px] font-bold text-primary">
          <Coins className="h-3.5 w-3.5" />
          {t("share.earn_hint", { defaultValue: "Share to earn — every share counts toward your Viral Sharer quest" })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {"share" in navigator && (
          <button type="button" onClick={() => void doNative()} title={t("share.native", { defaultValue: "Share" })}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-black hover:brightness-110 transition-all">
            <Share2 className="h-3.5 w-3.5" />
            {shared
              ? t("share.shared", { defaultValue: "Shared" })
              : t("share.native", { defaultValue: "Share" })}
          </button>
        )}
        <button type="button" onClick={() => openChannel("x")} title={t("share.x", { defaultValue: "Post to X" })} className={btn}>
          𝕏 {t("share.x_short", { defaultValue: "Post" })}
        </button>
        <button type="button" onClick={() => openChannel("whatsapp")} title={t("share.whatsapp", { defaultValue: "Share on WhatsApp" })} className={btn}>
          {t("share.whatsapp", { defaultValue: "WhatsApp" })}
        </button>
        <button type="button" onClick={() => void doCopy()} title={t("share.copy", { defaultValue: "Copy link" })} className={btn}>
          {copied
            ? <><Check className="h-3.5 w-3.5 text-emerald-400" /> {t("share.copied", { defaultValue: "Copied!" })}</>
            : <><Copy className="h-3.5 w-3.5" /> {t("share.copy", { defaultValue: "Copy link" })}</>}
        </button>
      </div>
    </div>
  );
}
