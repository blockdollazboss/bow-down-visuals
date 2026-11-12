import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Link } from "wouter";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { mediaBaseUrl } from "@/lib/media-cdn";

/* ─── Moderation and Takedown Rules — the public policy page ─────────
   Carries the owner-approved Moderation and Takedown Rules (approved
   Nov 11, 2026) verbatim in structure and terms: the banned-content
   list, how reporting works (anyone, guests included — the Report
   button on posts, profiles, and comments files into the review
   queue), the review steps (24-hour target, unclear cases hidden up
   to 3 days), the repeat-offender ladder, the DMCA takedown +
   counter-notice flow (10–14 business days before restore), and the
   one-appeal rule (support@bowdownvisuals.com, within 30 days).
   Copy lives in the moderationPolicy locale namespace; the non-en
   catalogs carry the English source verbatim (UNREVIEWED) per the
   locale honesty law. Same shell as the sibling policy pages
   (terms / privacy / refund-policy): public route, PolicyNav header,
   content panel. */

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
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">{t("moderationPolicy.nav.contactSupport")}</Link>
      </div>
    </header>
  );
}

export default function ModerationPolicy() {
  const { t } = useTranslation();
  usePageTitle(t("moderationPolicy.pageTitle"), t("moderationPolicy.pageDescription"));
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16"><div className="content-panel p-6 md:p-8">
        <h1 className="text-3xl font-black text-white mb-2">{t("moderationPolicy.title")}</h1>
        <p className="text-white/30 text-sm mb-10">{t("moderationPolicy.lastUpdated")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <p>{t("moderationPolicy.intro")}</p>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.notAllowed.title")}</h2>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>{t("moderationPolicy.notAllowed.item1")}</li>
              <li>{t("moderationPolicy.notAllowed.item2")}</li>
              <li>{t("moderationPolicy.notAllowed.item3")}</li>
              <li>{t("moderationPolicy.notAllowed.item4")}</li>
              <li>{t("moderationPolicy.notAllowed.item5")}</li>
              <li>{t("moderationPolicy.notAllowed.item6")}</li>
              <li>{t("moderationPolicy.notAllowed.item7")}</li>
              <li>{t("moderationPolicy.notAllowed.item8")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.reporting.title")}</h2>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>{t("moderationPolicy.reporting.item1")}</li>
              <li>{t("moderationPolicy.reporting.item2")}</li>
              <li>{t("moderationPolicy.reporting.item3")}</li>
              <li>{t("moderationPolicy.reporting.item4")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.review.title")}</h2>
            <ol className="list-decimal pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("moderationPolicy.review.step1Lead")}</strong>{" "}
                {t("moderationPolicy.review.step1Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.review.step2Lead")}</strong>{" "}
                {t("moderationPolicy.review.step2Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.review.step3Lead")}</strong>{" "}
                {t("moderationPolicy.review.step3Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.review.step4Lead")}</strong>{" "}
                {t("moderationPolicy.review.step4Body")}
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.ladder.title")}</h2>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">{t("moderationPolicy.ladder.rung1Lead")}</strong>{" "}
                {t("moderationPolicy.ladder.rung1Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.ladder.rung2Lead")}</strong>{" "}
                {t("moderationPolicy.ladder.rung2Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.ladder.rung3Lead")}</strong>{" "}
                {t("moderationPolicy.ladder.rung3Body")}
              </li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.ladder.rung4Lead")}</strong>{" "}
                {t("moderationPolicy.ladder.rung4Body")}
              </li>
            </ul>
            <p className="mt-3">{t("moderationPolicy.ladder.severe")}</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.dmca.title")}</h2>
            <p>{t("moderationPolicy.dmca.intro")}</p>
            <ol className="list-decimal pl-5 space-y-2 mt-3">
              <li>{t("moderationPolicy.dmca.step1")}</li>
              <li>{t("moderationPolicy.dmca.step2")}</li>
              <li>
                <strong className="text-white/90">{t("moderationPolicy.dmca.step3Lead")}</strong>{" "}
                {t("moderationPolicy.dmca.step3Body")}
              </li>
              <li>{t("moderationPolicy.dmca.step4")}</li>
              <li>{t("moderationPolicy.dmca.step5")}</li>
            </ol>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">{t("moderationPolicy.appeals.title")}</h2>
            <p>{t("moderationPolicy.appeals.p1")}</p>
            <p className="mt-3">{t("moderationPolicy.appeals.p2")}</p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
