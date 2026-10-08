import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { ArrowRight, Check, Lock, Zap, Rocket, Gift, Crown, ListOrdered, Users } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import type { WaitlistMilestone } from "@/components/WaitlistInvite";

/* ── Public shareable waitlist position page: /invite/:code ───────────────
   Crawlers get real OG tags from the Express bot route in api-server
   (app.ts); humans get this interactive page. */

interface InvitePublic {
  code: string;
  position: number;
  total: number;
  invitesCount: number;
  milestones: WaitlistMilestone[];
  nextMilestone: { invites: number; title: string; reward: string } | null;
}

function milestoneIcon(invites: number) {
  if (invites >= 25) return Crown;
  if (invites >= 10) return Gift;
  if (invites >= 3) return Rocket;
  return Zap;
}

export default function InvitePage() {
  const { t } = useTranslation();
  const params = useParams<{ code?: string }>();
  const code = (params.code ?? "").toUpperCase();
  usePageTitle(t("invite.pageTitle"), t("invite.pageSubtitle"));

  const [data, setData] = useState<InvitePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/waitlist/invite/${encodeURIComponent(code)}`);
        if (!res.ok) { if (!cancelled) setNotFound(true); return; }
        const json = (await res.json()) as InvitePublic;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (code) load();
    else { setNotFound(true); setLoading(false); }
    return () => { cancelled = true; };
  }, [code]);

  const aheadPct = data && data.total > 1
    ? Math.round(((data.total - data.position) / data.total) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">
        <section className="max-w-3xl mx-auto px-5 md:px-8 pt-20 pb-10 text-center">
          <MarketingBadge variant="kicker" className="mb-6 px-4 py-1.5">
            {t("invite.pageKicker")}
          </MarketingBadge>
          <h1 className="text-5xl sm:text-6xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            {t("invite.pageTitle")}<br />
            <span className="text-primary">Bow Down Visuals</span>
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto leading-relaxed">
            {t("invite.pageSubtitle")}
          </p>
        </section>

        <section className="max-w-2xl mx-auto px-5 md:px-8 pb-20">
          {loading ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-10 text-center">
              <p className="text-white/40">{t("invite.loading")}</p>
            </div>
          ) : notFound || !data ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-10 text-center">
              <p className="text-white/60 mb-6">{t("invite.invalidCode")}</p>
              <Link href="/beta-access">
                <Button className="gold-glow font-bold gap-2">
                  {t("invite.claimSpot")} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {/* inviter's live position */}
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-8 text-center mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center justify-center gap-2">
                  <ListOrdered className="h-4 w-4 text-primary" /> {t("invite.positionLabel")}
                </p>
                <p className="text-7xl font-black text-primary tracking-tight">
                  #{data.position.toLocaleString()}
                </p>
                <p className="text-white/50 text-sm mt-2 flex items-center justify-center gap-2">
                  <Users className="h-4 w-4" />
                  {t("invite.positionOf", {
                    position: data.position.toLocaleString(),
                    total: data.total.toLocaleString(),
                    pct: aheadPct,
                  })}
                </p>
                <div className="mt-5 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-700 via-primary to-yellow-300"
                    style={{ width: `${Math.max(2, Math.min(100, aheadPct))}%` }}
                  />
                </div>
                <p className="text-xs text-white/35 mt-3">
                  {t("invite.invitesLabel")}: <span className="text-primary font-bold">{data.invitesCount}</span>
                </p>
              </div>

              {/* milestone ladder */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4 text-center">
                  {t("invite.milestonesTitle")}
                </p>
                <div className="space-y-2">
                  {data.milestones.map((m) => {
                    const Icon = milestoneIcon(m.invites);
                    return (
                      <div
                        key={m.invites}
                        className={`flex items-center gap-3 rounded-xl border p-3 ${
                          m.unlocked ? "border-primary/30 bg-primary/[0.07]" : "border-white/[0.07] bg-white/[0.02]"
                        }`}
                      >
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                          m.unlocked ? "bg-primary/20 border border-primary/30" : "bg-white/[0.04] border border-white/10"
                        }`}>
                          {m.unlocked
                            ? <Check className="h-4 w-4 text-primary" />
                            : <Lock className="h-4 w-4 text-white/30" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold ${m.unlocked ? "text-primary" : "text-white/80"}`}>
                            <Icon className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                            {t(`invite.m${m.invites}Title`)} — {t(`invite.m${m.invites}Reward`)}
                          </p>
                          {!m.unlocked && (
                            <p className="text-xs text-white/40">{t("invite.invitesAway", { count: m.invitesAway })}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* how it works */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4 text-center">
                  {t("invite.howItWorks")}
                </p>
                <ol className="space-y-3">
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n} className="flex items-start gap-3">
                      <span className="h-6 w-6 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-black flex items-center justify-center shrink-0">
                        {n}
                      </span>
                      <p className="text-sm text-white/60 pt-0.5">{t(`invite.howItWorks${n}`)}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* CTA */}
              <div className="text-center">
                <Link href={`/beta-access?invite=${data.code}`}>
                  <Button size="lg" className="gold-glow font-bold text-base gap-3 px-10" style={{ height: "56px" }}>
                    {t("invite.claimSpot")} <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
                <p className="text-white/30 text-xs mt-4">
                  {t("invite.alreadyJoined")}{" "}
                  <Link href="/beta-access" className="text-primary hover:underline font-semibold">
                    {t("invite.checkPosition")}
                  </Link>
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
