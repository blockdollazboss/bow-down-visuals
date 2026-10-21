import { useState } from "react";
import {
  Check, Circle, Gift, Disc3, ShoppingBag, Megaphone, Share2, Copy, PartyPopper,
} from "lucide-react";
import type { CreatorProfile } from "@/lib/artist-profiles";
import { profileUrl } from "@/lib/artist-profiles";

/* ─── Get Paid finale ─────────────────────────────────────────────────────
   Standing: every flow guides the creator toward monetization and ends in a
   Get Paid finale. After the AI designs their page, this money checklist
   walks them through pricing their content, opening the tip jar, and
   sharing — with a progress bar. Empty states everywhere say "add your
   first drop — here's how it earns." */

export interface ChecklistItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  done: boolean;
  cta: string;
  action: () => void;
}

export function GetPaidChecklist({
  profile,
  patch,
  onGoTab,
}: {
  profile: CreatorProfile;
  patch: (p: Partial<CreatorProfile>) => void;
  onGoTab: (tab: "content" | "publish" | "basics") => void;
}) {
  const [shared, setShared] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(`ap-shared-${profile.slug}`) === "1"
  );
  const [copied, setCopied] = useState(false);

  const markShared = () => {
    setShared(true);
    try { localStorage.setItem(`ap-shared-${profile.slug}`, "1"); } catch { /* noop */ }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl(profile));
      setCopied(true); markShared();
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  };

  const shareNative = async () => {
    const url = profileUrl(profile);
    try {
      if (navigator.share) { await navigator.share({ title: `${profile.display_name} — Bow Down Visuals`, url }); markShared(); }
      else await copyLink();
    } catch { /* user cancelled */ }
  };

  const items: ChecklistItem[] = [
    {
      id: "tipjar",
      icon: <Gift className="h-5 w-5" />,
      title: "Open the tip jar",
      blurb: "Fans tip creators they love. It takes one tap and it never closes.",
      done: profile.tip_jar_enabled,
      cta: profile.tip_jar_enabled ? "Open ✓" : "Open it",
      action: () => patch({ tip_jar_enabled: true }),
    },
    {
      id: "drop",
      icon: <Disc3 className="h-5 w-5" />,
      title: "Add your first drop",
      blurb: "Nothing earns on an empty page. Feature the thing people will pay for — here's how it earns: plays → fans → tips, merch, collabs.",
      done: !!profile.featured_media?.url,
      cta: "Add my drop",
      action: () => onGoTab("content"),
    },
    {
      id: "merch",
      icon: <ShoppingBag className="h-5 w-5" />,
      title: "Price your merch",
      blurb: "Your shelf is a store. Put a price on it — every profile visitor is a customer who hasn't bought yet.",
      done: (profile.merch_items?.length ?? 0) > 0,
      cta: "Price it",
      action: () => onGoTab("content"),
    },
    {
      id: "collab",
      icon: <Megaphone className="h-5 w-5" />,
      title: "Get collab-ready",
      blurb: "Brands pay creators with media kits. Add your stats and rates once — the collab CTA does the rest.",
      done: !!((profile.media_kit?.rates?.length ?? 0) > 0 || profile.media_kit?.contactEmail),
      cta: "Build my kit",
      action: () => onGoTab("content"),
    },
    {
      id: "share",
      icon: <Share2 className="h-5 w-5" />,
      title: "Share your page",
      blurb: "Nobody can pay you if nobody sees you. Shares carry your ?ref= code — new fans earn you referral credit.",
      done: shared,
      cta: "Share it",
      action: () => void shareNative(),
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <PartyPopper className="h-5 w-5 text-amber-400" />
        <h3 className="text-lg font-black text-white" style={{ fontFamily: "'Cinzel', serif" }}>
          The Get Paid Finale
        </h3>
      </div>
      <p className="mb-4 text-sm text-white/60">
        Beautiful page? Done. Now make it pay. Five moves — this is the guide to the money.
      </p>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs font-bold">
          <span className="text-white/60">{doneCount} of {items.length} money moves</span>
          <span className="text-amber-300">{pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 rounded-xl border p-3 transition ${
              item.done ? "border-emerald-400/30 bg-emerald-400/5" : "border-white/10 bg-black/30"
            }`}
          >
            <span className={item.done ? "text-emerald-400" : "text-amber-400"}>
              {item.done ? <Check className="h-5 w-5" /> : item.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{item.title}</span>
                {item.done && <Check className="h-3.5 w-3.5 text-emerald-400" />}
              </div>
              {!item.done && <p className="text-xs text-white/50">{item.blurb}</p>}
            </div>
            {!item.done && (
              <button
                onClick={item.action}
                className="shrink-0 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                {item.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      {pct === 100 && (
        <p className="mt-4 text-center text-sm font-bold text-amber-300">
          All five. Your page isn't a brochure — it's a business. 🦈
        </p>
      )}

      <div className="mt-3 flex justify-center gap-2">
        <button
          onClick={() => void copyLink()}
          className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Link copied" : "Copy my link"}
        </button>
        <button
          onClick={() => onGoTab("publish")}
          className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
        >
          Go to Publish →
        </button>
      </div>
    </div>
  );
}
