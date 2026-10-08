import { useState } from "react";
import { Share2, Check, Link2, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getMyReferralCode, shareUrl, copyText } from "@/lib/streaming";

/* ─── ShareMenu — every share carries ?ref=CODE + attribution ──────────────
   "Made with Bow Down Visuals" rides along on every shared card/link. */

export function ShareMenu({
  path,
  title,
  compact,
}: {
  path: string;
  title: string;
  compact?: boolean;
}) {
  const { getAccessToken } = useAuth();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const buildLink = async () => {
    const code = await getMyReferralCode(getAccessToken).catch(() => null);
    return shareUrl(path, code);
  };

  const doCopy = async () => {
    const url = await buildLink();
    const ok = await copyText(`${title} — Made with Bow Down Visuals\n${url}`);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareNative = async () => {
    const url = await buildLink();
    const text = `${title} — Made with Bow Down Visuals`;
    if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: unknown }).share) {
      try {
        await (navigator as Navigator & { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({ title, text, url });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to menu */
      }
    }
    setOpen((o) => !o);
  };

  const shareTargets = (url: string) => [
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${title} — Made with Bow Down Visuals`)}&url=${encodeURIComponent(url)}`,
    },
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodeURIComponent(`${title} — Made with Bow Down Visuals ${url}`)}`,
    },
    {
      label: "SMS",
      href: `sms:?&body=${encodeURIComponent(`${title} — Made with Bow Down Visuals ${url}`)}`,
    },
  ];

  const [menuUrl, setMenuUrl] = useState<string | null>(null);
  const toggleMenu = async () => {
    if (!open) setMenuUrl(await buildLink());
    setOpen((o) => !o);
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={shareNative}
        onContextMenu={(e) => {
          e.preventDefault();
          void toggleMenu();
        }}
        title="Share (right-click for options)"
        className={`flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 text-white/60 transition-colors hover:border-[#e8c86a]/50 hover:text-[#e8c86a] ${
          compact ? "p-1.5" : "px-3 py-1.5 text-xs font-semibold"
        }`}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Share2 className="h-4 w-4" />}
        {!compact && (copied ? "Copied!" : "Share")}
      </button>
      {open && menuUrl && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-[#c9a84c]/30 bg-[#14100a] p-2 shadow-2xl">
            <button
              onClick={doCopy}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <Link2 className="h-4 w-4 text-[#e8c86a]" />
              {copied ? "Copied!" : "Copy link"}
            </button>
            {shareTargets(menuUrl).map((t) => (
              <a
                key={t.label}
                href={t.href}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
              >
                <MessageCircle className="h-4 w-4 text-[#e8c86a]" />
                Share to {t.label}
              </a>
            ))}
            <p className="px-3 pb-1 pt-2 text-[11px] text-white/35">
              Links carry your referral code. Made with Bow Down Visuals.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
