import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import { WaitlistSuccess, type WaitlistPosition } from "@/components/WaitlistInvite";
import {
  Zap, CheckCircle2, Music, Video, Film, Image as ImageIcon,
  Mic2, Archive, ArrowRight, Star, Users, Globe, Lock, Mail, Gift,
} from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

/* ─── data ─── */

const ARTIST_TYPES = [
  { value: "Rapper", labelKey: "waitlist.artistTypeRapper" },
  { value: "Singer", labelKey: "waitlist.artistTypeSinger" },
  { value: "Producer", labelKey: "waitlist.artistTypeProducer" },
  { value: "AI Artist", labelKey: "waitlist.artistTypeAiArtist" },
  { value: "Content Creator", labelKey: "waitlist.artistTypeContentCreator" },
  { value: "Label", labelKey: "waitlist.artistTypeLabel" },
  { value: "Kids Music Creator", labelKey: "waitlist.artistTypeKidsMusicCreator" },
  { value: "Other", labelKey: "waitlist.artistTypeOther" },
];
const WANT_TO_CREATE = [
  { value: "Songs", labelKey: "waitlist.wantSongs" },
  { value: "Music Videos", labelKey: "waitlist.wantMusicVideos" },
  { value: "Promo Clips", labelKey: "waitlist.wantPromoClips" },
  { value: "Thumbnails", labelKey: "waitlist.wantThumbnails" },
  { value: "Full Song + Video Packages", labelKey: "waitlist.wantSongVideoPackages" },
  { value: "AI Artist Content", labelKey: "waitlist.wantAiArtistContent" },
  { value: "Other", labelKey: "waitlist.wantOther" },
];

const BENEFITS = [
  { icon: Zap,   titleKey: "waitlist.benefitFirstAccess",       bodyKey: "waitlist.benefitFirstAccessBody" },
  { icon: Star,  titleKey: "waitlist.benefitFoundingRate",      bodyKey: "waitlist.benefitFoundingRateBody" },
  { icon: Lock,  titleKey: "waitlist.benefitBonusBucs",         bodyKey: "waitlist.benefitBonusBucsBody" },
  { icon: Users, titleKey: "waitlist.benefitCommunity",         bodyKey: "waitlist.benefitCommunityBody" },
  { icon: Globe, titleKey: "waitlist.benefitPrioritySupport",   bodyKey: "waitlist.benefitPrioritySupportBody" },
  { icon: Music, titleKey: "waitlist.benefitFeatureVoting",     bodyKey: "waitlist.benefitFeatureVotingBody" },
];

const TOOLS = [
  { labelKey: "waitlist.toolMakeSong",        icon: Music,     badge: null },
  { labelKey: "waitlist.toolVideoForSong",    icon: Video,     badge: null },
  { labelKey: "waitlist.toolStartFromScratch", icon: Mic2,     badge: "Most Popular" },
  { labelKey: "waitlist.toolPromoClips",      icon: Film,      badge: null },
  { labelKey: "waitlist.toolThumbnails",      icon: ImageIcon, badge: null },
  { labelKey: "waitlist.toolArtistProfiles",  icon: Archive,   badge: "Free" },
];

const WAITLIST_CONTACT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Bow Down Visuals",
  url: "https://bowdownvisuals.com",
  email: "support@bowdownvisuals.com",
  contactPoint: {
    "@type": "ContactPoint",
    email: "support@bowdownvisuals.com",
    contactType: "customer support",
  },
};

const inputClass = "h-11 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 rounded-xl text-sm";
const selectClass = "h-11 w-full bg-white/[0.05] border border-white/[0.10] text-white rounded-xl px-3 text-sm appearance-none cursor-pointer focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 transition-colors";

/* ─── form state ─── */

interface FormValues {
  name: string;
  email: string;
  artistType: string;
  wantToCreate: string;
  socialHandle: string;
  message: string;
}

/* ─── page ─── */

export default function Waitlist() {
  const { t } = useTranslation();
  usePageTitle(t("waitlist.pageTitle"), t("waitlist.pageDescription"));
  const [form, setForm] = useState<FormValues>({
    name: "", email: "", artistType: "", wantToCreate: "", socialHandle: "", message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviterCode, setInviterCode] = useState("");
  const [positionData, setPositionData] = useState<WaitlistPosition | null>(null);

  /* Capture an invite code from ?invite= (shared invite links) */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("invite");
      if (code && /^[A-Za-z0-9]{4,16}$/.test(code)) {
        setInviterCode(code.toUpperCase());
      }
    } catch { /* noop */ }
  }, []);

  function update(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("waitlist.nameError")); return; }
    if (!form.email.trim() || !form.email.includes("@")) { setError(t("waitlist.emailError")); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          artistType: form.artistType,
          wantToCreate: form.wantToCreate,
          socialHandle: form.socialHandle,
          message: form.message,
          inviteCode: inviterCode || undefined,
        }),
      });
      const data = await res.json() as {
        error?: string; message?: string;
        inviteCode?: string; position?: number; total?: number;
        invitesCount?: number; milestones?: WaitlistPosition["milestones"];
      };
      if (!res.ok) {
        setError(data.message ?? data.error ?? t("waitlist.submitError"));
        setLoading(false);
        return;
      }
      if (data.inviteCode && typeof data.position === "number") {
        setPositionData({
          inviteCode: data.inviteCode,
          position: data.position,
          total: data.total ?? data.position,
          invitesCount: data.invitesCount ?? 0,
          milestones: data.milestones ?? [],
        });
      }
      setSubmitted(true);
    } catch {
      setError(t("waitlist.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={WAITLIST_CONTACT_JSON_LD} />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* ── HERO ── */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 pt-20 pb-10 text-center">
          <MarketingBadge variant="kicker" className="mb-6 px-4 py-1.5">
            {t("waitlist.kicker")}
          </MarketingBadge>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            Join the Bow Down<br />
            <span className="text-primary">Visuals Waitlist</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            {t("waitlist.heroSub")}
          </p>

          {/* social proof counter */}
          <div className="flex items-center justify-center gap-2 mt-8">
            <div className="flex -space-x-2">
              {["LN", "YB", "SK", "MK", "DV"].map((initials) => (
                <div key={initials} className="h-7 w-7 rounded-full bg-primary border-2 border-black flex items-center justify-center text-[9px] font-black text-white">
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-white/40">{t("waitlist.socialProof")}</span>
          </div>
        </section>

        {/* ── FORM ── */}
        <section className="max-w-2xl mx-auto px-5 md:px-8 pb-20">
          {submitted ? (
            positionData ? (
              <>
                <WaitlistSuccess data={positionData} />
                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                  <Link href="/">
                    <Button variant="outline" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
                      {t("waitlist.backHome")}
                    </Button>
                  </Link>
                  <Link href="/dashboard">
                    <Button className="gold-glow font-semibold gap-2">
                      <Zap className="h-4 w-4" /> {t("waitlist.tryTools")}
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-10 text-center">
              <CheckCircle2 className="h-14 w-14 text-primary mx-auto mb-5" />
              <h3 className="text-2xl font-semibold text-white mb-3">{t("waitlist.successTitle")}</h3>
              <p className="text-white/55 text-base mb-6 max-w-sm mx-auto leading-relaxed">
                {t("waitlist.successDesc")}
              </p>
              <div className="flex flex-col gap-2 text-sm text-white/40 mb-8">
                <p>{t("waitlist.successPerk1")}</p>
                <p>{t("waitlist.successPerk2")}</p>
                <p>{t("waitlist.successPerk3")}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/">
                  <Button variant="outline" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
                    {t("waitlist.backHome")}
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button className="gold-glow font-semibold gap-2">
                    <Zap className="h-4 w-4" /> {t("waitlist.tryTools")}
                  </Button>
                </Link>
              </div>
            </div>
            )
          ) : (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7 md:p-9">
              {inviterCode && (
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-3">
                  <Gift className="h-5 w-5 text-primary shrink-0" />
                  <p className="text-sm text-white/70">{t("invite.invitedBanner")}</p>
                </div>
              )}
              <h2 className="text-xl font-semibold text-white mb-6">{t("waitlist.formTitle")}</h2>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.nameLabel")}</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder={t("waitlist.namePlaceholder")}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.emailLabel")}</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Artist Type + What to Create */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.artistTypeLabel")}</Label>
                    <select
                      value={form.artistType}
                      onChange={(e) => update("artistType", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">{t("waitlist.selectArtistType")}</option>
                      {ARTIST_TYPES.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-zinc-900">{t(opt.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.wantToCreateLabel")}</Label>
                    <select
                      value={form.wantToCreate}
                      onChange={(e) => update("wantToCreate", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">{t("waitlist.selectFocusArea")}</option>
                      {WANT_TO_CREATE.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-zinc-900">{t(opt.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Social Handle */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.socialHandleLabel")}</Label>
                  <Input
                    value={form.socialHandle}
                    onChange={(e) => update("socialHandle", e.target.value)}
                    placeholder="@yourhandle"
                    className={inputClass}
                  />
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("waitlist.messageLabel")} <span className="text-white/30 font-normal normal-case tracking-normal">({t("waitlist.optional")})</span></Label>
                  <Textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder={t("waitlist.messagePlaceholder")}
                    rows={3}
                    className="bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 rounded-xl text-sm resize-none"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  className="w-full gold-glow font-bold text-base rounded-xl gap-3"
                  style={{ height: "52px" }}
                >
                  {loading ? t("waitlist.joining") : <><Zap className="h-5 w-5" /> {t("waitlist.joinButton")} <ArrowRight className="h-4 w-4" /></>}
                </Button>

                <p className="text-white/25 text-xs text-center">{t("waitlist.noSpamNote")}</p>
              </form>
            </div>
          )}
        </section>

        {/* ── TOOLS PREVIEW ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("waitlist.toolsTitle")}</h2>
            <p className="text-white/40 text-lg">{t("waitlist.toolsSub")}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TOOLS.map((tool) => (
              <div key={tool.labelKey} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                  <tool.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-snug">{t(tool.labelKey)}</p>
                  {tool.badge === "Most Popular" ? (
                    <MarketingBadge variant="popular" className="mt-1.5 text-[10px]">{t("waitlist.badgeMostPopular")}</MarketingBadge>
                  ) : tool.badge === "Beta" ? (
                    <MarketingBadge variant="soon" className="mt-1.5 text-[10px]">{t("waitlist.badgeBeta")}</MarketingBadge>
                  ) : tool.badge === "Free" ? (
                    <MarketingBadge variant="free" className="mt-1.5 text-[10px]">{t("waitlist.badgeFree")}</MarketingBadge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── BENEFITS ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("waitlist.benefitsTitle")}</h2>
            <p className="text-white/40 text-lg">{t("waitlist.benefitsSub")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {BENEFITS.map((b) => (
              <div key={b.titleKey} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 hover:border-primary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{t(b.titleKey)}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{t(b.bodyKey)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CONTACT ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-8 md:p-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-widest text-primary/70 uppercase mb-0.5">{t("waitlist.contactKicker")}</p>
                <h2 className="text-xl font-semibold text-white">{t("waitlist.contactTitle")}</h2>
              </div>
            </div>
            <p className="text-white/50 text-base leading-relaxed mb-5">
              {t("waitlist.contactDesc")}
            </p>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary/25 bg-primary/5 text-primary font-semibold text-sm hover:bg-primary/10 transition-colors"
            >
              <Mail className="h-4 w-4" />
              support@bowdownvisuals.com
            </a>
          </div>
        </section>


      </div>
    </div>
  );
}
