import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BadgeDollarSign, Tag, Megaphone, HandCoins, ArrowRight, Link2, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { copyText, getMyReferralCode, shareUrl } from "@/lib/streaming";

/* ─── Get Paid finale (Worker 2) ───
   Standing flow directive: every content page ends in a Get Paid path.
   Guide them to the money — upload → price it → promote → earn.
   Owner mode (isOwner): edit → price → promote. Everyone else sees the
   earning path spelled out, never a dead "no content" wall. */

export function GetPaidFinale({
  title,
  artistName,
  artistSlug,
  isOwner,
  sharePath,
  downloadPriceCents = null,
  manageHref = "/my-music",
}: {
  title: string;
  artistName?: string;
  artistSlug?: string | null;
  isOwner: boolean;
  sharePath: string;
  downloadPriceCents?: number | null;
  manageHref?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [copied, setCopied] = useState(false);
  const [promoUrl, setPromoUrl] = useState("");

  useEffect(() => {
    let alive = true;
    getMyReferralCode(getAccessToken).then((code) => {
      if (alive) setPromoUrl(shareUrl(sharePath, code));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharePath]);

  async function copyPromo() {
    const ok = await copyText(promoUrl || shareUrl(sharePath, null));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const steps = [
    {
      icon: <Tag className="h-5 w-5" />,
      title: "Price it",
      body: downloadPriceCents != null && downloadPriceCents > 0
        ? `This drop sells for $${(downloadPriceCents / 100).toFixed(2)} — every play is a potential sale.`
        : "Put a price on the download and turn listeners into customers.",
      cta: isOwner ? { href: manageHref, label: downloadPriceCents ? "Change price" : "Set a price" } : null,
    },
    {
      icon: <Megaphone className="h-5 w-5" />,
      title: "Promote it",
      body: "Your referral link rides every share — new creators who join through it earn you credits.",
      cta: null,
    },
    {
      icon: <HandCoins className="h-5 w-5" />,
      title: "Get tipped",
      body: "Fans tip creators directly. Claim your tip jar and let the love convert.",
      cta: isOwner ? { href: "/tips", label: "Claim tip jar" } : null,
    },
  ];

  return (
    <section aria-label="Get paid" className="mt-12 rounded-2xl border border-[#e8c86a]/30 bg-gradient-to-br from-[#e8c86a]/10 via-transparent to-transparent p-6 md:p-8">
      <div className="flex items-center gap-3 mb-1">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8c86a] text-black">
          <BadgeDollarSign className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-black text-white">
            {isOwner ? "Get paid from this drop" : "How this drop earns"}
          </h2>
          <p className="text-xs text-white/45">
            {isOwner
              ? "The cheat-code money path — edit it, price it, promote it."
              : `“${title}”${artistName ? ` by ${artistName}` : ""} — this is how creators turn uploads into income here.`}
          </p>
        </div>
      </div>

      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        {steps.map((s) => (
          <div key={s.title} className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex items-center gap-2 text-[#e8c86a] mb-1.5">
              {s.icon}
              <p className="text-sm font-bold">{s.title}</p>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">{s.body}</p>
            {s.cta && (
              <Link href={s.cta.href}>
                <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-[#e8c86a] hover:underline">
                  {s.cta.label} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {isOwner ? (
          <>
            <Link href={manageHref}>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-5 py-2.5 text-sm font-bold text-black hover:bg-[#f5d67e] transition-colors">
                Manage this drop <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
            <Link href="/music-sales">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] transition-colors">
                View sales
              </span>
            </Link>
          </>
        ) : (
          <>
            <button
              onClick={copyPromo}
              className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-5 py-2.5 text-sm font-bold text-black hover:bg-[#f5d67e] transition-colors"
            >
              {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copied ? "Promo link copied!" : "Copy promo link"}
            </button>
            {!user && (
              <Link href="/publish">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/50 px-5 py-2.5 text-sm font-semibold text-[#e8c86a] hover:bg-[#e8c86a]/10 transition-colors">
                  Upload your first drop — here's how it earns <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            )}
          </>
        )}
      </div>

      {!isOwner && artistSlug && (
        <p className="mt-4 text-xs text-white/35">
          Creator? <Link href={`/artist/${artistSlug}`}><span className="text-[#e8c86a] hover:underline">This is your upload — claim the money path</span></Link>
        </p>
      )}
    </section>
  );
}

/** Earning-path empty state — never "no content yet". */
export function EarnEmptyState({ what = "upload" }: { what?: string }) {
  return (
    <div className="text-center max-w-md mx-auto px-6 py-16">
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#e8c86a]/15">
        <BadgeDollarSign className="h-7 w-7 text-[#e8c86a]" />
      </span>
      <p className="text-xl font-bold text-white mb-2">Nothing here yet — that's an opportunity.</p>
      <p className="text-sm text-white/50 leading-relaxed mb-6">
        Upload your first drop, set your price, share it with your referral link —
        and earn on every sale, tip, and creator who joins through you.
        That's the cheat code.
      </p>
      <Link href="/publish">
        <span className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-6 py-3 text-sm font-bold text-black hover:bg-[#f5d67e] transition-colors">
          Upload your first {what} <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
