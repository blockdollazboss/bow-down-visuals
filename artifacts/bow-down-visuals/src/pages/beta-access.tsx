import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Zap, CheckCircle2, Music, Video, Film, Image as ImageIcon,
  Mic2, Archive, ArrowRight, Star, Users, Globe, Lock, Headphones,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── data ─── */

const CREATOR_TYPES: Array<{ value: string; labelKey: string }> = [
  { value: "Rapper", labelKey: "betaAccess.creatorRapper" },
  { value: "Singer", labelKey: "betaAccess.creatorSinger" },
  { value: "Producer", labelKey: "betaAccess.creatorProducer" },
  { value: "AI Artist", labelKey: "betaAccess.creatorAiArtist" },
  { value: "Content Creator", labelKey: "betaAccess.creatorContentCreator" },
  { value: "Label", labelKey: "betaAccess.creatorLabel" },
  { value: "Kids Music Creator", labelKey: "betaAccess.creatorKidsMusic" },
  { value: "Other", labelKey: "betaAccess.creatorOther" },
];

const WANT_TO_MAKE: Array<{ value: string; labelKey: string }> = [
  { value: "Songs", labelKey: "betaAccess.wantSongs" },
  { value: "Music Videos", labelKey: "betaAccess.wantMusicVideos" },
  { value: "Promo Clips", labelKey: "betaAccess.wantPromoClips" },
  { value: "Full Song + Video Packages", labelKey: "betaAccess.wantPackages" },
  { value: "Artist Content", labelKey: "betaAccess.wantArtistContent" },
  { value: "Music Mixing", labelKey: "betaAccess.wantMixing" },
  { value: "Thumbnails", labelKey: "betaAccess.wantThumbnails" },
  { value: "Other", labelKey: "betaAccess.wantOther" },
];

const TOOLS: Array<{ labelKey: string; icon: typeof Music; badgeKey: string | null }> = [
  { labelKey: "betaAccess.toolMakeSong",        icon: Music,      badgeKey: null },
  { labelKey: "betaAccess.toolVideoForSong", icon: Video,      badgeKey: null },
  { labelKey: "betaAccess.toolFromScratch",  icon: Mic2,       badgeKey: "betaAccess.badgeMostPopular" },
  { labelKey: "betaAccess.toolPromoClips",   icon: Film,       badgeKey: null },
  { labelKey: "betaAccess.toolThumbnails",    icon: ImageIcon,  badgeKey: null },
  { labelKey: "betaAccess.toolMixing",       icon: Headphones, badgeKey: "betaAccess.badgeBeta" },
  { labelKey: "betaAccess.toolArtistProfiles",       icon: Archive,    badgeKey: "betaAccess.badgeFree" },
];

const PERKS: Array<{ icon: typeof Zap; titleKey: string; bodyKey: string }> = [
  { icon: Zap,   titleKey: "betaAccess.perkEarlyAccessTitle",  bodyKey: "betaAccess.perkEarlyAccessBody" },
  { icon: Star,  titleKey: "betaAccess.perkFoundingRateTitle", bodyKey: "betaAccess.perkFoundingRateBody" },
  { icon: Lock,  titleKey: "betaAccess.perkBonusBucsTitle",     bodyKey: "betaAccess.perkBonusBucsBody" },
  { icon: Users, titleKey: "betaAccess.perkCommunityTitle",    bodyKey: "betaAccess.perkCommunityBody" },
  { icon: Globe, titleKey: "betaAccess.perkSupportTitle",      bodyKey: "betaAccess.perkSupportBody" },
  { icon: Music, titleKey: "betaAccess.perkVotingTitle",       bodyKey: "betaAccess.perkVotingBody" },
];

const inputClass = "h-11 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 rounded-xl text-sm";
const selectClass = "h-11 w-full bg-white/[0.05] border border-white/[0.10] text-white rounded-xl px-3 text-sm appearance-none cursor-pointer focus:outline-none focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25 transition-colors";

/* ─── types ─── */

interface FormValues {
  name: string;
  email: string;
  creatorName: string;
  artistType: string;
  wantToMake: string;
  socialHandle: string;
  message: string;
}

/* ─── page ─── */

export default function BetaAccess() {
  const { t } = useTranslation();
  usePageTitle(t("betaAccess.pageTitle"), t("betaAccess.pageSubtitle"));
  const [form, setForm] = useState<FormValues>({
    name: "", email: "", creatorName: "", artistType: "", wantToMake: "", socialHandle: "", message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("betaAccess.errorName")); return; }
    if (!form.email.trim() || !form.email.includes("@")) { setError(t("betaAccess.errorEmail")); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          creatorName: form.creatorName,
          artistType: form.artistType,
          wantToCreate: form.wantToMake,
          socialHandle: form.socialHandle,
          message: form.message,
        }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? t("betaAccess.errorSubmitFailed"));
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError(t("betaAccess.errorConnection"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* ── HERO ── */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 pt-20 pb-10 text-center">
          <MarketingBadge variant="kicker" className="mb-6 px-4 py-1.5">
            {t("betaAccess.heroBadge")}
          </MarketingBadge>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            {t("betaAccess.heroTitle1")}<br />
            <span className="text-primary">{t("betaAccess.heroTitle2")}</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            {t("betaAccess.heroSubtitle")}
          </p>

          {/* social proof */}
          <div className="flex items-center justify-center gap-2 mt-8">
            <div className="flex -space-x-2">
              {["LN", "YB", "SK", "MK", "DV"].map((initials) => (
                <div key={initials} className="h-7 w-7 rounded-full bg-primary border-2 border-black flex items-center justify-center text-[9px] font-black text-white">
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-white/40">{t("betaAccess.socialProof")}</span>
          </div>
        </section>

        {/* ── FORM ── */}
        <section className="max-w-2xl mx-auto px-5 md:px-8 pb-20">
          {submitted ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-10 text-center">
              <CheckCircle2 className="h-14 w-14 text-primary mx-auto mb-5" />
              <h3 className="text-2xl font-semibold text-white mb-3">{t("betaAccess.successTitle")}</h3>
              <p className="text-white/55 text-base mb-6 max-w-sm mx-auto leading-relaxed">
                {t("betaAccess.successBody")}
              </p>
              <div className="flex flex-col gap-2 text-sm text-white/40 mb-8">
                <p>{t("betaAccess.successPerk1")}</p>
                <p>{t("betaAccess.successPerk2")}</p>
                <p>{t("betaAccess.successPerk3")}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/">
                  <Button variant="outline" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
                    {t("betaAccess.backHome")}
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button className="gold-glow font-semibold gap-2">
                    <Zap className="h-4 w-4" /> {t("betaAccess.tryTools")}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7 md:p-9">
              <h2 className="text-xl font-semibold text-white mb-1">{t("betaAccess.formTitle")}</h2>
              <p className="text-sm text-white/35 mb-6">{t("betaAccess.formSubtitle")}</p>

              <form onSubmit={handleSubmit} className="space-y-5">

                {/* Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.nameLabel")}</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder={t("betaAccess.namePlaceholder")}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.emailLabel")}</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Artist / Creator Name */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.creatorNameLabel")}</Label>
                  <Input
                    value={form.creatorName}
                    onChange={(e) => update("creatorName", e.target.value)}
                    placeholder={t("betaAccess.creatorNamePlaceholder")}
                    className={inputClass}
                  />
                </div>

                {/* Creator Type + What to Make */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.creatorTypeLabel")}</Label>
                    <select
                      value={form.artistType}
                      onChange={(e) => update("artistType", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">{t("betaAccess.selectCreatorType")}</option>
                      {CREATOR_TYPES.map((ct) => (
                        <option key={ct.value} value={ct.value} className="bg-zinc-900">{t(ct.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.wantToMakeLabel")}</Label>
                    <select
                      value={form.wantToMake}
                      onChange={(e) => update("wantToMake", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">{t("betaAccess.selectWantToMake")}</option>
                      {WANT_TO_MAKE.map((wt) => (
                        <option key={wt.value} value={wt.value} className="bg-zinc-900">{t(wt.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Social Link */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t("betaAccess.socialLabel")}</Label>
                  <Input
                    value={form.socialHandle}
                    onChange={(e) => update("socialHandle", e.target.value)}
                    placeholder={t("betaAccess.socialPlaceholder")}
                    className={inputClass}
                  />
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">
                    {t("betaAccess.messageLabel")} <span className="text-white/30 font-normal normal-case tracking-normal">{t("betaAccess.optional")}</span>
                  </Label>
                  <Textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder={t("betaAccess.messagePlaceholder")}
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
                  {loading
                    ? t("betaAccess.submitting")
                    : <><Zap className="h-5 w-5" /> {t("betaAccess.requestAccess")} <ArrowRight className="h-4 w-4" /></>}
                </Button>

                <p className="text-white/25 text-xs text-center">{t("betaAccess.noSpam")}</p>
              </form>
            </div>
          )}
        </section>

        {/* ── TOOLS PREVIEW ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("betaAccess.toolsTitle")}</h2>
            <p className="text-white/40 text-lg">{t("betaAccess.toolsSubtitle")}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {TOOLS.map((tool) => (
              <div key={tool.labelKey} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                  <tool.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-snug">{t(tool.labelKey)}</p>
                  {tool.badgeKey === "betaAccess.badgeMostPopular" ? (
                    <MarketingBadge variant="popular" className="mt-1.5 text-[10px]">{t("betaAccess.badgeMostPopular")}</MarketingBadge>
                  ) : tool.badgeKey === "betaAccess.badgeBeta" ? (
                    <MarketingBadge variant="soon" className="mt-1.5 text-[10px]">{t("betaAccess.badgeBeta")}</MarketingBadge>
                  ) : tool.badgeKey === "betaAccess.badgeFree" ? (
                    <MarketingBadge variant="free" className="mt-1.5 text-[10px]">{t("betaAccess.badgeFree")}</MarketingBadge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PERKS ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("betaAccess.perksTitle")}</h2>
            <p className="text-white/40 text-lg">{t("betaAccess.perksSubtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {PERKS.map((p) => (
              <div key={p.titleKey} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 hover:border-primary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{t(p.titleKey)}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{t(p.bodyKey)}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
