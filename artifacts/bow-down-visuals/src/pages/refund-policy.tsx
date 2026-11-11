import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Link } from "wouter";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { mediaBaseUrl } from "@/lib/media-cdn";

function PolicyNav() {
  const isLight = useIsLightTheme();
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });
  const { t } = useTranslation();
  const base = mediaBaseUrl();

  return (
    <header className={`${isLight ? "sticky top-0 z-40 border-b border-[#C9A84C]/20 bg-[#FCF7EA]/90 backdrop-blur-xl" : "sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl"}`}>
      <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg">
          <img src={`${base}logo-static.webp`} alt="Bow Down Visuals" className="h-10 w-auto" />
        </Link>
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">{t("refundPolicy.nav.contactSupport")}</Link>
      </div>
    </header>
  );
}

export default function RefundPolicy() {
  const { t } = useTranslation();
  usePageTitle(t("refundPolicy.pageTitle"), t("refundPolicy.pageDescription"));
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16"><div className="content-panel p-6 md:p-8">
        <h1 className="text-3xl font-black text-white mb-2">{t("refundPolicy.title")}</h1>
        <p className="text-white/30 text-sm mb-10">{t("refundPolicy.lastUpdated")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.promise.title")}</h2>
            <p>{t("refundPolicy.promise.body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.howTo.title")}</h2>
            <p>{t("refundPolicy.howTo.body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.creditPacks.title")}</h2>
            <p>{t("refundPolicy.creditPacks.delivered")}</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("refundPolicy.creditPacks.unusedTitle")}</strong>
                {t("refundPolicy.creditPacks.unusedDesc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.creditPacks.spentTitle")}</strong>
                {t("refundPolicy.creditPacks.spentDesc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.creditPacks.partSpentTitle")}</strong>
                {t("refundPolicy.creditPacks.partSpentDesc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.creditPacks.ourFaultTitle")}</strong>
                {t("refundPolicy.creditPacks.ourFaultDesc")}
              </li>
            </ul>
            <p className="mt-3">{t("refundPolicy.creditPacks.earned")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.subscriptions.title")}</h2>
            <p>{t("refundPolicy.subscriptions.cancel")}</p>
            <p className="mt-3">{t("refundPolicy.subscriptions.keepMonth")}</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("refundPolicy.subscriptions.firstMonthTitle")}</strong>
                {t("refundPolicy.subscriptions.firstMonthDesc")}
              </li>
            </ul>
            <p className="mt-3">{t("refundPolicy.subscriptions.renewals")}</p>
            <p className="mt-3">{t("refundPolicy.subscriptions.priceChanges")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.marketplace.title")}</h2>
            <p>{t("refundPolicy.marketplace.intro")}</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("refundPolicy.marketplace.digitalTitle")}</strong>
                {t("refundPolicy.marketplace.digitalDesc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.marketplace.asDescribedTitle")}</strong>
                {t("refundPolicy.marketplace.asDescribedDesc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.marketplace.neverDeliversTitle")}</strong>
                {t("refundPolicy.marketplace.neverDeliversDesc")}
              </li>
            </ul>
            <p className="mt-3">{t("refundPolicy.marketplace.originalMethod")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.questions.title")}</h2>
            <p>
              {t("refundPolicy.questions.p1")}{" "}
              <Link href="/contact" className="text-primary hover:underline">{t("refundPolicy.questions.contactLink")}</Link>{" "}
              {t("refundPolicy.questions.p2")}{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">{t("refundPolicy.questions.email")}</a>
              .
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
