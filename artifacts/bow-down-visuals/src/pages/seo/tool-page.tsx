import { Link } from "wouter";
import {
  SeoPageShell,
  SeoHero,
  SeoFeatureGrid,
  SeoTemplateGrid,
  SeoFaq,
  SeoSiblingNav,
  SeoCtaBanner,
  toolJsonLd,
  faqJsonLd,
} from "@/components/seo/seo-shell";
import { TOOL_PAGES, TOOL_PAGE_MAP, VERTICAL_HUBS, type ToolSeo } from "@/data/seo-pages";

/* ─── /tools/:tool — tool-category SEO page ("AI thumbnail maker", …) ─────
   Money pages: tool description, real template previews with deep-link CTAs,
   FAQ schema, sibling links to every other tool page. No login required. */

export function ToolSeoPage({ tool }: { tool: ToolSeo }) {
  const siblings = TOOL_PAGES.filter((t) => t.slug !== tool.slug).map((t) => ({
    label: t.name,
    href: t.path,
    blurb: t.metaDescription,
  }));
  const relatedVerticals = VERTICAL_HUBS.filter((v) =>
    v.toolSlugs.includes(tool.slug),
  ).map((v) => ({
    label: `For ${v.audience}`,
    href: v.path,
    blurb: v.metaDescription,
  }));

  return (
    <SeoPageShell
      title={tool.title}
      metaDescription={tool.metaDescription}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "AI Tools", href: "/tools" },
        { label: tool.name },
      ]}
      jsonLdBlocks={[
        toolJsonLd(tool.name, tool.metaDescription, tool.path, tool.applicationCategory),
        faqJsonLd(tool.faqs),
      ]}
    >
      <SeoHero
        kicker={tool.kicker}
        h1Lead={tool.h1Lead}
        h1Gold={tool.h1Gold}
        intro={tool.intro}
        primaryCta={{ label: tool.toolCtaLabel, href: tool.toolHref }}
        secondaryCta={{
          label: `Browse ${tool.templateGalleryLabel}`,
          href: tool.templateGalleryHref,
        }}
      />

      <SeoFeatureGrid heading={`Why creators use the ${tool.name}`} items={tool.features} />

      <SeoFeatureGrid heading="How it works" items={tool.howItWorks} numbered />

      <SeoTemplateGrid
        heading="Start from a proven template"
        blurb={`Real ${tool.templateGalleryLabel} — click any card to preload it into the ${tool.name}, then make it yours.`}
        kind={tool.templateKind}
        slugs={tool.templateSlugs}
        galleryHref={tool.templateGalleryHref}
        galleryLabel={tool.templateGalleryLabel}
      />

      <SeoFaq faqs={tool.faqs} />

      <SeoSiblingNav heading="More AI tools" links={siblings} />

      {relatedVerticals.length > 0 && (
        <SeoSiblingNav heading="Built for your kind of creator" links={relatedVerticals} />
      )}

      <SeoCtaBanner
        heading={`Ready to try the ${tool.name}?`}
        blurb="Browsing is free and takes seconds. Open the tool, pick a template, and generate — credits only apply when you create."
        cta={{ label: tool.toolCtaLabel, href: tool.toolHref }}
      />

      <p className="mt-10 text-center text-sm text-white/35">
        <Link href="/tools" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">
          View all AI tools
        </Link>
        {" · "}
        <Link href="/pricing" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">
          Pricing
        </Link>
      </p>
    </SeoPageShell>
  );
}

/* Route-bound wrappers — one per tool path (keeps routes static for SSR). */
export function ToolPageBySlug({ slug }: { slug: string }) {
  const tool = TOOL_PAGE_MAP[slug];
  if (!tool) return null;
  return <ToolSeoPage tool={tool} />;
}
