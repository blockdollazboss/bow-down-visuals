import { Link } from "wouter";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { useTranslation } from "react-i18next";
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
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">{t("terms.contactSupport")}</Link>
      </div>
    </header>
  );
}

export default function Terms() {
  const { t } = useTranslation();
  usePageTitle(t("terms.pageTitle"), t("terms.pageDescription"));
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16"><div className="content-panel p-6 md:p-8">
        <h1 className="text-3xl font-black text-white mb-2">{t("terms.title")}</h1>
        <p className="text-white/30 text-sm mb-10">{t("terms.lastUpdated")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section1Title")}</h2>
            <p>{t("terms.section1Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section2Title")}</h2>
            <p>{t("terms.section2Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section3Title")}</h2>
            <p>{t("terms.section3Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section4Title")}</h2>
            <p>{t("terms.section4Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section5Title")}</h2>
            <p>{t("terms.section5Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section6Title")}</h2>
            <p>{t("terms.section6Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section7Title")}</h2>
            <p>{t("terms.section7Intro")}</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>{t("terms.section7Item1")}</li>
              <li>{t("terms.section7Item2")}</li>
              <li>{t("terms.section7Item3")}</li>
              <li>{t("terms.section7Item4")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section8Title")}</h2>
            <p>{t("terms.section8Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section9Title")}</h2>
            <p>{t("terms.section9Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section10Title")}</h2>
            <p>{t("terms.section10Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section11Title")}</h2>
            <p>{t("terms.section11Body")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("terms.section12Title")}</h2>
            <p>
              {t("terms.contactIntro")}{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>{" "}
              {t("terms.contactOr")} <Link href="/contact" className="text-primary hover:underline">{t("terms.contactPageLink")}</Link>
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
