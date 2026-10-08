import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2, Copy, Check, Trophy, Zap, Gift, Crown, Rocket,
  Share2, Mail, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ─── shared waitlist-invite UI: share kit + success panel ─────────────── */

export interface WaitlistMilestone {
  invites: number;
  title: string;
  reward: string;
  unlocked: boolean;
  invitesAway: number;
}

export interface WaitlistPosition {
  inviteCode: string;
  position: number;
  total: number;
  invitesCount: number;
  milestones: WaitlistMilestone[];
}

export function buildInviteUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
  return `${origin}/invite/${code}`;
}

function milestoneIcon(invites: number) {
  if (invites >= 25) return Crown;
  if (invites >= 10) return Gift;
  if (invites >= 3) return Rocket;
  return Zap;
}

/* ── One-click share kit (copy / X / WhatsApp / SMS / email / native) ────
   No email provider exists — everything is copy-link/share based. Nothing
   here sends anything; the user's own apps do the sending. */
export function InviteShareKit({ inviteUrl, position }: { inviteUrl: string; position: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const shareText = t("invite.shareText", { position });
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(inviteUrl);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input below is selectable */
    }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: t("invite.shareTitle"),
          text: shareText,
          url: inviteUrl,
        });
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      } catch { /* user dismissed */ }
    }
  }

  const channels = [
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      icon: Share2,
    },
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      icon: MessageCircle,
    },
    {
      label: t("invite.sms"),
      href: `sms:?&body=${encodedText}%20${encodedUrl}`,
      icon: MessageCircle,
    },
    {
      label: t("invite.email"),
      href: `mailto:?subject=${encodeURIComponent(t("invite.shareTitle"))}&body=${encodedText}%20${encodedUrl}`,
      icon: Mail,
    },
  ];

  return (
    <div>
      {/* copy-link bar */}
      <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-black/40 p-2 pl-4">
        <span className="flex-1 truncate text-sm font-mono text-primary">{inviteUrl}</span>
        <Button type="button" onClick={copyLink} size="sm" className="gold-glow font-bold gap-2 shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? t("invite.copied") : t("invite.copyLink")}
        </Button>
      </div>

      {/* channels */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {channels.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm font-semibold text-white/70 hover:text-white hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            <c.icon className="h-4 w-4 text-primary" />
            {c.label}
          </a>
        ))}
      </div>

      {typeof navigator !== "undefined" && "share" in navigator && (
        <Button
          type="button"
          variant="outline"
          onClick={nativeShare}
          className="mt-2 w-full border-white/10 text-white/60 hover:text-white hover:bg-white/5 gap-2"
        >
          <Share2 className="h-4 w-4" />
          {shared ? t("invite.shared") : t("invite.moreOptions")}
        </Button>
      )}
    </div>
  );
}

/* ── Post-join success panel: live rank, progress, link, milestones ────── */
export function WaitlistSuccess({ data }: { data: WaitlistPosition }) {
  const { t } = useTranslation();
  const inviteUrl = buildInviteUrl(data.inviteCode);
  const aheadPct = data.total > 1 ? Math.round(((data.total - data.position) / data.total) * 100) : 0;
  const nextMilestone = data.milestones.find((m) => !m.unlocked);

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-7 md:p-9">
      <CheckCircle2 className="h-14 w-14 text-primary mx-auto mb-5" />
      <h3 className="text-2xl font-semibold text-white mb-2 text-center">
        {t("invite.youreIn")}
      </h3>

      {/* live position */}
      <div className="text-center mb-6">
        <p className="text-6xl font-black text-primary tracking-tight">
          #{data.position.toLocaleString()}
        </p>
        <p className="text-white/50 text-sm mt-2">
          {t("invite.positionOf", { position: data.position.toLocaleString(), total: data.total.toLocaleString(), pct: aheadPct })}
        </p>
        <div className="mt-4 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-yellow-700 via-primary to-yellow-300 transition-all duration-1000"
            style={{ width: `${Math.max(2, Math.min(100, aheadPct))}%` }}
          />
        </div>
      </div>

      {/* personal invite link */}
      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-5 mb-6">
        <p className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          {t("invite.yourInviteLink")}
        </p>
        <p className="text-sm text-white/50 mb-4">
          {t("invite.invitePitch")}
        </p>
        <InviteShareKit inviteUrl={inviteUrl} position={data.position} />
      </div>

      {/* milestones */}
      <div className="mb-2">
        <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3 text-center">
          {t("invite.milestonesTitle")}
        </p>
        <div className="space-y-2">
          {data.milestones.map((m) => {
            const Icon = milestoneIcon(m.invites);
            return (
              <div
                key={m.invites}
                className={`flex items-center gap-3 rounded-xl border p-3.5 ${
                  m.unlocked
                    ? "border-primary/30 bg-primary/[0.07]"
                    : "border-white/[0.07] bg-white/[0.02]"
                }`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                  m.unlocked ? "bg-primary/20 border border-primary/30" : "bg-white/[0.04] border border-white/10"
                }`}>
                  <Icon className={`h-4 w-4 ${m.unlocked ? "text-primary" : "text-white/30"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${m.unlocked ? "text-primary" : "text-white/80"}`}>
                    {m.unlocked && <Check className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />}
                    {t(`invite.m${m.invites}Title`)} — {t(`invite.m${m.invites}Reward`)}
                  </p>
                  <p className="text-xs text-white/40">
                    {m.unlocked
                      ? t("invite.unlocked")
                      : t("invite.invitesAway", { count: m.invitesAway })}
                  </p>
                </div>
                <span className={`text-xs font-black px-2.5 py-1 rounded-full shrink-0 ${
                  m.unlocked ? "bg-primary/20 text-primary" : "bg-white/[0.05] text-white/40"
                }`}>
                  {m.invites} {t("invite.invites")}
                </span>
              </div>
            );
          })}
        </div>
        {nextMilestone && (
          <p className="text-center text-sm text-primary/90 font-semibold mt-4">
            {t("invite.nextMilestone", { count: nextMilestone.invitesAway, title: t(`invite.m${nextMilestone.invites}Title`) })}
          </p>
        )}
      </div>
    </div>
  );
}
