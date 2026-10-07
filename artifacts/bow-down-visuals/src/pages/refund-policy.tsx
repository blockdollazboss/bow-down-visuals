import { Link } from "wouter";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

function PolicyNav() {
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg">
          <img src={`${import.meta.env.BASE_URL}logo-static.webp`} alt="Bow Down Visuals" className="h-10 w-auto" />
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
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.whatWeSell.title")}</h2>
            <p>
              {t("refundPolicy.whatWeSell.p1")}
              <strong className="text-white/90">{t("refundPolicy.whatWeSell.strong")}</strong>
              {t("refundPolicy.whatWeSell.p2")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.generalPolicy.title")}</h2>
            <p>
              {t("refundPolicy.generalPolicy.p1")}
              <strong className="text-white/90">{t("refundPolicy.generalPolicy.strong")}</strong>
              {t("refundPolicy.generalPolicy.p2")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.whenWeRefund.title")}</h2>
            <p>{t("refundPolicy.whenWeRefund.intro")}</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("refundPolicy.whenWeRefund.technical.title")}</strong>
                {t("refundPolicy.whenWeRefund.technical.desc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.whenWeRefund.duplicate.title")}</strong>
                {t("refundPolicy.whenWeRefund.duplicate.desc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.whenWeRefund.unauthorized.title")}</strong>
                {t("refundPolicy.whenWeRefund.unauthorized.desc")}
              </li>
              <li>
                <strong className="text-white/90">{t("refundPolicy.whenWeRefund.firstSub.title")}</strong>
                {t("refundPolicy.whenWeRefund.firstSub.desc")}
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.cancellations.title")}</h2>
            <p>
              {t("refundPolicy.cancellations.p1")}
              <strong className="text-white/90">{t("refundPolicy.cancellations.strong")}</strong>
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.howTo.title")}</h2>
            <p>
              {t("refundPolicy.howTo.intro1")}
              <strong className="text-white/90">{t("refundPolicy.howTo.strong")}</strong>
              {t("refundPolicy.howTo.intro2")}
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                {t("refundPolicy.howTo.email")}{" "}
                <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                  support@bowdownvisuals.com
                </a>
              </li>
              <li>{t("refundPolicy.howTo.subject1")}<em>{t("refundPolicy.howTo.subject2")}</em></li>
              <li>{t("refundPolicy.howTo.include")}</li>
            </ul>
            <p className="mt-3">
              {t("refundPolicy.howTo.response")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("refundPolicy.questions.title")}</h2>
            <p>
              {t("refundPolicy.questions.p1")}{" "}
              <Link href="/contact" className="text-primary hover:underline">{t("refundPolicy.questions.contactLink")}</Link>{" "}
              {t("refundPolicy.questions.p2")}{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>.
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
