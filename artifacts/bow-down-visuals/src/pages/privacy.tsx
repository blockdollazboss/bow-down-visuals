import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { usePageTitle } from "@/hooks/use-page-title";

function PolicyNav() {
  const { t } = useTranslation();
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg">
          <img src={`${import.meta.env.BASE_URL}logo-static.webp`} alt="Bow Down Visuals" className="h-10 w-auto" />
        </Link>
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">{t("privacy.contactSupport")}</Link>
      </div>
    </header>
  );
}

export default function Privacy() {
  const { t } = useTranslation();
  usePageTitle(t("privacy.pageTitle"), t("privacy.pageDescription"));
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16"><div className="content-panel p-6 md:p-8">
        <h1 className="text-3xl font-black text-white mb-2">{t("privacy.title")}</h1>
        <p className="text-white/30 text-sm mb-10">{t("privacy.lastUpdated")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section1Title")}</h2>
            <p>
              {t("privacy.section1Body")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section2Title")}</h2>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong className="text-white/90">{t("privacy.section2Item1Label")}</strong>{" "}{t("privacy.section2Item1Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section2Item2Label")}</strong>{" "}{t("privacy.section2Item2Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section2Item3Label")}</strong>{" "}{t("privacy.section2Item3Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section2Item4Label")}</strong>{" "}{t("privacy.section2Item4Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section2Item5Label")}</strong>{" "}{t("privacy.section2Item5Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section2Item6Label")}</strong>{" "}{t("privacy.section2Item6Body")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section3Title")}</h2>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>{t("privacy.section3Item1")}</li>
              <li>{t("privacy.section3Item2")}</li>
              <li>{t("privacy.section3Item3")}</li>
              <li>{t("privacy.section3Item4")}</li>
              <li>{t("privacy.section3Item5")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section4Title")}</h2>
            <p>{t("privacy.section4Intro")}</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong className="text-white/90">{t("privacy.section4Item1Label")}</strong>{" — "}{t("privacy.section4Item1Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section4Item2Label")}</strong>{" — "}{t("privacy.section4Item2Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section4Item3Label")}</strong>{" — "}{t("privacy.section4Item3Body")}</li>
              <li><strong className="text-white/90">{t("privacy.section4Item4Label")}</strong>{" — "}{t("privacy.section4Item4Body")}</li>
              <li>{t("privacy.section4Item5")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section5Title")}</h2>
            <p>
              {t("privacy.section5Body")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section6Title")}</h2>
            <p>
              {t("privacy.section6Body")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section7Title")}</h2>
            <p>
              {t("privacy.section7Intro")}{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section8Title")}</h2>
            <p>
              {t("privacy.section8Body")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section9Title")}</h2>
            <p>
              {t("privacy.section9Body")}
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("privacy.section10Title")}</h2>
            <p>
              {t("privacy.section10Intro")}{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>{" "}
              {t("privacy.section10Middle")} <Link href="/contact" className="text-primary hover:underline">{t("privacy.section10ContactLink")}</Link>.
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
