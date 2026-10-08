import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  SeoPageShell,
  SeoHero,
  SeoFeatureGrid,
  SeoTemplateGrid,
  SeoFaq,
  SeoSiblingNav,
  SeoCtaBanner,
  collectionJsonLd,
  faqJsonLd,
} from "@/components/seo/seo-shell";
import {
  VERTICAL_HUBS,
  VERTICAL_HUB_MAP,
  TOOL_PAGE_MAP,
  type VerticalSeo,
} from "@/data/seo-pages";

/* ─── /for/:vertical — creator vertical hub ("AI video tools for YouTubers")
   Relevant tools + real template previews + link to the live discovery hub
   for actual top creators. CollectionPage + FAQPage JSON-LD. */

const SITE = "https://bowdownvisuals.com";

export function VerticalHubSeo({ vertical }: { vertical: VerticalSeo }) {
  const tools = vertical.toolSlugs
    .map((s) => TOOL_PAGE_MAP[s])
    .filter(Boolean)
    .map((t) => ({
      label: t.name,
      href: t.path,
      blurb: t.metaDescription,
    }));
  const siblings = VERTICAL_HUBS.filter((v) => v.slug !== vertical.slug).map((v) => ({
    label: `AI Tools for ${v.audience}`,
    href: v.path,
    blurb: v.metaDescription,
  }));

  return (
    <SeoPageShell
      title={vertical.title}
      metaDescription={vertical.metaDescription}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "For Creators", href: "/for" },
        { label: vertical.audience },
      ]}
      jsonLdBlocks={[
        collectionJsonLd(
          vertical.title,
          vertical.metaDescription,
          vertical.path,
          tools.map((t) => ({
            name: t.label,
            url: `${SITE}${t.href}`,
            description: t.blurb,
          })),
        ),
        faqJsonLd(vertical.faqs),
      ]}
    >
      <SeoHero
        kicker={vertical.kicker}
        h1Lead={vertical.h1Lead}
        h1Gold={vertical.h1Gold}
        intro={vertical.intro}
        primaryCta={{
          label: tools[0] ? `Open the ${tools[0].label}` : "Explore AI tools",
          href: tools[0]?.href ?? "/tools",
        }}
        secondaryCta={{
          label: vertical.discoveryLabel,
          href: vertical.discoveryHref,
        }}
      />

      <SeoFeatureGrid
        heading={`The ${vertical.audience.toLowerCase()} problems we solve`}
        items={vertical.pains}
      />

      {/* Tool stack for this vertical */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold sm:text-3xl mb-3 text-center">
          Your AI stack as a {vertical.audience.replace(/s$/, "")}
        </h2>
        <p className="text-white/50 text-center max-w-2xl mx-auto mb-8">
          The tools {vertical.audience.toLowerCase()} reach for most — each one
          hands off to the next.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#e8c86a]/40"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="font-bold group-hover:text-[#e8c86a] transition-colors">
                  {t.label}
                </h3>
                <ArrowRight className="h-4 w-4 shrink-0 text-white/30 group-hover:text-[#e8c86a] transition-colors" />
              </div>
              <p className="text-sm text-white/50">{t.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <SeoFeatureGrid
        heading={`The ${vertical.audience.toLowerCase()} workflow`}
        items={vertical.workflow}
        numbered
      />

      <SeoTemplateGrid
        heading="Templates that fit your niche"
        blurb={`Real ${vertical.templateGalleryLabel} picked for ${vertical.audience.toLowerCase()} — click any card to preload it and make it yours.`}
        kind={vertical.templateKind}
        slugs={vertical.templateSlugs}
        galleryHref={vertical.templateGalleryHref}
        galleryLabel={vertical.templateGalleryLabel}
      />

      {/* Live creators — honest link to real data, never fabricated */}
      <section className="mb-14 rounded-3xl border border-white/10 bg-white/[0.02] p-8 sm:p-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl mb-3">
          See who's creating now
        </h2>
        <p className="text-white/50 max-w-xl mx-auto mb-6">
          Live charts of top {vertical.audience.toLowerCase()}, trending tracks,
          and fresh drops — real creators, updated continuously.
        </p>
        <Link
          href={vertical.discoveryHref}
          className="inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/40 px-7 py-3 font-semibold text-[#e8c86a] transition hover:bg-[#e8c86a]/10"
        >
          {vertical.discoveryLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <SeoFaq faqs={vertical.faqs} />

      <SeoSiblingNav heading="More creator hubs" links={siblings} />

      <SeoCtaBanner
        heading={`${vertical.audience} — start free`}
        blurb="Browse every template free, no account needed. Open a tool when you're ready — credits only apply when you generate."
        cta={{
          label: tools[0] ? `Open the ${tools[0].label}` : "Explore AI tools",
          href: tools[0]?.href ?? "/tools",
        }}
      />
    </SeoPageShell>
  );
}

export function VerticalHubBySlug({ slug }: { slug: string }) {
  const vertical = VERTICAL_HUB_MAP[slug];
  if (!vertical) return null;
  return <VerticalHubSeo vertical={vertical} />;
}
