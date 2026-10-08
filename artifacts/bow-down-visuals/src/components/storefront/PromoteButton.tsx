import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Megaphone, Copy, Check, CalendarClock, Palette, Mail, Tag, Loader2, X, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  emailPromoteHook, listDiscounts,
  type StoreProductDTO, type DiscountCodeDTO,
} from "@/lib/storefront-api";

/**
 * PromoteButton — the promote chain for every storefront product.
 *
 * One button, the whole promo machine:
 *  - Copy share link with the creator's ?ref=CODE (referral system)
 *  - Scheduler prefill (/scheduler?text=…) — schedule the drop post
 *  - Social kit (/promote) — promo visuals for the product
 *  - Discount attach — pick a code, it rides along in the share text
 *  - Email-list broadcast — drafts a campaign via the EXISTING email-list
 *    API (POST /api/email-list/lists/:id/campaigns); nothing rebuilt here.
 *
 * Cheat-code voice: short, money-forward, zero fluff.
 */
export default function PromoteButton({ product }: { product: StoreProductDTO }) {
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [codes, setCodes] = useState<DiscountCodeDTO[]>([]);
  const [pickedCode, setPickedCode] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [emailState, setEmailState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [emailMsg, setEmailMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        const headers = { Authorization: `Bearer ${token}` };
        const [refRes] = await Promise.all([
          fetch("/api/referrals/me", { headers }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (!cancelled && refRes?.code) setRefCode(String(refRes.code));
        try {
          const dc = await listDiscounts(token);
          if (!cancelled) setCodes(dc.codes.filter((c) => c.isActive));
        } catch {
          /* Discounts are optional in the chain — never block promote. */
        }
      } catch {
        /* Promote still works without the ref code. */
      }
    })();
    return () => { cancelled = true; };
  }, [open, getAccessToken]);

  const shareUrl = () => {
    const base = `${window.location.origin}${product.links.productUrl}`;
    return refCode ? `${base}${base.includes("?") ? "&" : "?"}ref=${encodeURIComponent(refCode)}` : base;
  };

  const shareText = () => {
    const bits = [
      `👑 ${product.title} — ${product.price}`,
      product.description ? product.description.slice(0, 140) : "",
      pickedCode ? `Use code ${pickedCode} for a discount.` : "",
      shareUrl(),
    ].filter(Boolean);
    return bits.join("\n");
  };

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setEmailMsg("Copy blocked by the browser — long-press the link instead.");
    }
  };

  const sendEmailBroadcast = async (listId: string, listName: string) => {
    setEmailState("loading");
    setEmailMsg("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to send to your list.");
      const hook = await emailPromoteHook(token, product.id);
      if (!hook.prefill) throw new Error("Couldn't build the draft.");
      const res = await fetch(`/api/email-list/lists/${listId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subject: hook.prefill.subject,
          body: pickedCode
            ? `${hook.prefill.body}\n\nPsst — use code ${pickedCode} at checkout.`
            : hook.prefill.body,
          status: "draft",
        }),
      });
      if (!res.ok) throw new Error("The email list API said no.");
      setEmailState("done");
      setEmailMsg(`Draft saved to "${listName}" — queue it from your email list when ready.`);
    } catch (e) {
      setEmailState("error");
      setEmailMsg(e instanceof Error ? e.message : "Couldn't draft that email.");
    }
  };

  const [emailLists, setEmailLists] = useState<{ id: string; name: string; subscribers: number }[]>([]);
  const [showEmail, setShowEmail] = useState(false);

  const openEmail = async () => {
    setShowEmail(true);
    setEmailState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in first.");
      const hook = await emailPromoteHook(token, product.id);
      setEmailLists(hook.lists);
      setEmailState("idle");
      if (hook.lists.length === 0) setEmailMsg("No email lists yet — build one at /email-list, then blast this drop.");
    } catch {
      setEmailState("error");
      setEmailMsg("Couldn't load your lists.");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
        title="Promote this product"
      >
        <Megaphone className="h-3.5 w-3.5" /> Promote
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-bold text-black"
      >
        <X className="h-3.5 w-3.5" /> Close
      </button>
      <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-primary/30 bg-[#14100a] p-4 shadow-[0_0_40px_rgba(201,162,39,0.25)]">
        <p className="mb-1 text-sm font-bold text-white">Run it up 👑</p>
        <p className="mb-3 text-xs text-white/50">Every promo lane for “{product.title}”, one tap each.</p>

        {/* Discount attach */}
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/40">
          Attach a discount code
        </label>
        <div className="mb-3 flex gap-2">
          <select
            value={pickedCode}
            onChange={(e) => setPickedCode(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white"
          >
            <option value="">No code</option>
            {codes.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.percentOff}% off
              </option>
            ))}
          </select>
          <Link href="/store/dashboard?tab=discounts">
            <span className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/70 hover:text-white">
              <Tag className="h-3 w-3" /> New
            </span>
          </Link>
        </div>

        <div className="space-y-2">
          <button
            onClick={copyShare}
            className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-semibold text-white transition hover:border-primary/40"
          >
            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-primary" />}
            {copied ? "Copied — go get that money." : `Copy share link${refCode ? " (with your ?ref= code)" : ""}`}
          </button>

          <a
            href={`/scheduler?text=${encodeURIComponent(shareText())}`}
            className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-semibold text-white transition hover:border-primary/40"
          >
            <CalendarClock className="h-4 w-4 text-primary" />
            Schedule the drop post
            <ExternalLink className="ml-auto h-3 w-3 text-white/30" />
          </a>

          <Link href={`/promote?product=${product.id}`}>
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-semibold text-white transition hover:border-primary/40">
              <Palette className="h-4 w-4 text-primary" />
              Make promo visuals
              <ExternalLink className="ml-auto h-3 w-3 text-white/30" />
            </span>
          </Link>

          {!showEmail ? (
            <button
              onClick={openEmail}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-semibold text-white transition hover:border-primary/40"
            >
              <Mail className="h-4 w-4 text-primary" />
              Email your list
              <ExternalLink className="ml-auto h-3 w-3 text-white/30" />
            </button>
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/30 p-2">
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-white/40">
                Draft a broadcast (uses your email list)
              </p>
              {emailState === "loading" && (
                <p className="flex items-center gap-2 px-1 py-2 text-xs text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lists…
                </p>
              )}
              {emailLists.map((l) => (
                <button
                  key={l.id}
                  disabled={emailState === "loading"}
                  onClick={() => sendEmailBroadcast(l.id, l.name)}
                  className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-white hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <span className="font-semibold">{l.name}</span>
                  <span className="text-white/40">{l.subscribers} subs → Draft</span>
                </button>
              ))}
              {emailMsg && (
                <p className={`px-1 py-1 text-[11px] ${emailState === "error" ? "text-red-400" : "text-white/60"}`}>
                  {emailMsg}
                </p>
              )}
              {emailState === "done" && (
                <Link href="/email-list">
                  <span className="mt-1 inline-block cursor-pointer px-1 text-[11px] font-bold text-primary">
                    Open your email list →
                  </span>
                </Link>
              )}
            </div>
          )}
        </div>

        {emailMsg && !showEmail && <p className="mt-2 text-[11px] text-white/50">{emailMsg}</p>}
        <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/30">
          Share links carry your referral code — every buyer through your link can earn you referral credit on top of the sale.
        </p>
      </div>
    </div>
  );
}
