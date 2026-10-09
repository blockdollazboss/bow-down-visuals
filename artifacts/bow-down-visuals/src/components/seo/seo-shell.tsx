import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronRight, Check } from "lucide-react";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  THUMBNAIL_TEMPLATES,
  type ThumbnailTemplate,
} from "@/data/thumbnail-templates";
import { HOOK_TEMPLATES, type HookTemplate } from "@/data/hook-templates";
import { CAPTION_PACKS, type CaptionPack } from "@/data/caption-templates";
import { VIDEO_TEMPLATE_METAS, type VideoTemplateMeta } from "@/data/video-templates";
import type { SeoFaq, SeoFeature } from "@/data/seo-pages";

/* ─── Shared SEO page shell (Worker 9, virality wave) ──────────────────────
   Static, crawler-friendly markup: real <h1>/<h2> hierarchy, plain text
   (no scroll-reveal wrappers that hide content), wouter Links for internal
   linking, and JSON-LD via the shared JsonLd component. Safe in the
   build-time prerender (no browser-only APIs, no data fetching). */

const SITE = "https://bowdownvisuals.com";

/* ── Template resolution: real entries from the template libraries ── */

export type TemplateKind = "thumbnail" | "hook" | "caption" | "video";

interface ResolvedTemplate {
  key: string;
  title: string;
  blurb: string;
  emoji: string;
  deepLink: string;
  tag: string;
}

const THUMB_MAP = new Map<string, ThumbnailTemplate>(
  THUMBNAIL_TEMPLATES.map((t) => [t.slug, t]),
);
const HOOK_MAP = new Map<string, HookTemplate>(
  HOOK_TEMPLATES.map((t) => [t.slug, t]),
);
const CAPTION_MAP = new Map<string, CaptionPack>(
  CAPTION_PACKS.map((t) => [t.slug, t]),
);
const VIDEO_MAP = new Map<string, VideoTemplateMeta>(
  VIDEO_TEMPLATE_METAS.map((t) => [t.key, t]),
);

export function resolveTemplates(
  kind: TemplateKind,
  slugs: string[],
): ResolvedTemplate[] {
  const out: ResolvedTemplate[] = [];
  for (const slug of slugs) {
    if (kind === "thumbnail") {
      const t = THUMB_MAP.get(slug);
      if (t)
        out.push({
          key: t.slug,
          title: t.title,
          blurb: t.blurb,
          emoji: t.emoji,
          tag: t.category,
          deepLink: `/thumbnail-maker?template=${t.slug}`,
        });
    } else if (kind === "hook") {
      const t = HOOK_MAP.get(slug);
      if (t)
        out.push({
          key: t.slug,
          title: t.title,
          blurb: t.blurb,
          emoji: t.emoji,
          tag: t.category,
          deepLink: `/hooks?template=${t.slug}`,
        });
    } else if (kind === "caption") {
      const t = CAPTION_MAP.get(slug);
      if (t)
        out.push({
          key: t.slug,
          title: t.title,
          blurb: t.blurb,
          emoji: t.emoji,
          tag: t.category,
          deepLink: `/hooks?tab=captions&template=${t.slug}`,
        });
    } else {
      const t = VIDEO_MAP.get(slug);
      if (t)
        out.push({
          key: t.key,
          title: t.name,
          blurb: t.tagline,
          emoji: "🎬",
          tag: t.category,
          deepLink: `/video-editor?tab=templates&template=${t.key}`,
        });
    }
  }
  return out;
}

/* ── Breadcrumb ── */

export function SeoBreadcrumb({
  trail,
}: {
  trail: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-8">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-white/40">
        {trail.map((crumb, i) => (
          <li key={crumb.label} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-white/25" />}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-[#e8c86a] transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-white/70" aria-current="page">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ── Hero ── */

export function SeoHero({
  kicker,
  h1Lead,
  h1Gold,
  intro,
  primaryCta,
  secondaryCta,
}: {
  kicker: string;
  h1Lead: string;
  h1Gold: string;
  intro: string[];
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
}) {
  return (
    <div className="text-center mb-14">
      <MarketingBadge variant="kicker">{kicker}</MarketingBadge>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
        {h1Lead} <span className="text-[#e8c86a]">{h1Gold}</span>
      </h1>
      <div className="mt-6 mx-auto max-w-3xl space-y-4">
        {intro.map((p, i) => (
          <p key={i} className={i === 0 ? "text-lg text-white/70" : "text-white/50"}>
            {p}
          </p>
        ))}
      </div>
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href={primaryCta.href}
          className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-7 py-3 font-semibold text-black transition hover:bg-[#f5d67f]"
        >
          {primaryCta.label} <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href={secondaryCta.href}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-3 font-medium text-white/80 transition hover:border-[#e8c86a]/50 hover:text-white"
        >
          {secondaryCta.label}
        </Link>
      </div>
      <p className="mt-4 text-xs text-white/35">
        Free to browse — login and credits only apply when you generate.
      </p>
    </div>
  );
}

/* ── Feature / step grids ── */

export function SeoFeatureGrid({
  heading,
  items,
  numbered,
}: {
  heading: string;
  items: SeoFeature[];
  numbered?: boolean;
}) {
  return (
    <section className="mb-14">
      <h2 className="text-2xl font-bold sm:text-3xl mb-8 text-center">{heading}</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        {items.map((item, i) => (
          <div
            key={item.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
          >
            <div className="flex items-center gap-3 mb-3">
              {numbered ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8c86a]/15 text-sm font-bold text-[#e8c86a]">
                  {i + 1}
                </span>
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8c86a]/15">
                  <Check className="h-4 w-4 text-[#e8c86a]" />
                </span>
              )}
              <h3 className="font-bold">{item.title}</h3>
            </div>
            <p className="text-sm text-white/50">{item.blurb}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Template previews ── */

export function SeoTemplateGrid({
  heading,
  blurb,
  kind,
  slugs,
  galleryHref,
  galleryLabel,
}: {
  heading: string;
  blurb: string;
  kind: TemplateKind;
  slugs: string[];
  galleryHref: string;
  galleryLabel: string;
}) {
  const templates = resolveTemplates(kind, slugs);
  if (templates.length === 0) return null;
  return (
    <section className="mb-14">
      <h2 className="text-2xl font-bold sm:text-3xl mb-3 text-center">{heading}</h2>
      <p className="text-white/50 text-center max-w-2xl mx-auto mb-8">{blurb}</p>
      <div className="grid gap-5 sm:grid-cols-3">
        {templates.map((t) => (
          <article
            key={t.key}
            className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#e8c86a]/40"
          >
            <div className="flex items-start justify-between mb-4">
              <span className="text-4xl" aria-hidden="true">
                {t.emoji}
              </span>
              <span className="rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-3 py-1 text-xs font-medium text-[#e8c86a]">
                {t.tag}
              </span>
            </div>
            <h3 className="font-bold mb-2">{t.title}</h3>
            <p className="text-sm text-white/50 mb-5 flex-1">{t.blurb}</p>
            <Link
              href={t.deepLink}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#e8c86a] hover:text-[#f5d67f]"
            >
              Use this template <ArrowRight className="h-4 w-4" />
            </Link>
          </article>
        ))}
      </div>
      <div className="text-center mt-8">
        <Link
          href={galleryHref}
          className="inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/40 px-6 py-2.5 text-sm font-semibold text-[#e8c86a] transition hover:bg-[#e8c86a]/10"
        >
          Browse all {galleryLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/* ── FAQ ── */

export function SeoFaq({ faqs }: { faqs: SeoFaq[] }) {
  if (faqs.length === 0) return null;
  return (
    <section className="mb-14">
      <h2 className="text-2xl font-bold sm:text-3xl mb-8 text-center">
        Frequently asked questions
      </h2>
      <div className="mx-auto max-w-3xl space-y-4">
        {faqs.map((f) => (
          <div
            key={f.q}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
          >
            <h3 className="font-bold mb-2">{f.q}</h3>
            <p className="text-sm text-white/55 leading-relaxed">{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Sibling / internal linking ── */

export function SeoSiblingNav({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string; blurb: string }[];
}) {
  return (
    <section className="mb-14">
      <h2 className="text-2xl font-bold sm:text-3xl mb-8 text-center">{heading}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-[#e8c86a]/40"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold group-hover:text-[#e8c86a] transition-colors">
                {l.label}
              </h3>
              <ArrowRight className="h-4 w-4 shrink-0 text-white/30 group-hover:text-[#e8c86a] transition-colors" />
            </div>
            <p className="mt-1.5 text-sm text-white/45">{l.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── Bottom CTA banner ── */

export function SeoCtaBanner({
  heading,
  blurb,
  cta,
}: {
  heading: string;
  blurb: string;
  cta: { label: string; href: string };
}) {
  return (
    <section className="rounded-3xl border border-[#e8c86a]/25 bg-gradient-to-br from-[#e8c86a]/10 via-transparent to-transparent p-8 sm:p-12 text-center">
      <h2 className="text-2xl font-bold sm:text-3xl mb-3">{heading}</h2>
      <p className="text-white/55 max-w-xl mx-auto mb-7">{blurb}</p>
      <Link
        href={cta.href}
        className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-8 py-3.5 font-semibold text-black transition hover:bg-[#f5d67f]"
      >
        {cta.label} <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/* ── Full page shell ── */

export function SeoPageShell({
  title,
  metaDescription,
  breadcrumb,
  jsonLdBlocks,
  children,
}: {
  title: string;
  metaDescription: string;
  breadcrumb: { label: string; href?: string }[];
  jsonLdBlocks: Record<string, unknown>[];
  children: ReactNode;
}) {
  usePageTitle(title, metaDescription);
  return (
    <div className="min-h-screen bg-black text-white">
      {jsonLdBlocks.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <div className="mx-auto max-w-6xl px-5 sm:px-6 py-12 sm:py-16">
        <SeoBreadcrumb trail={breadcrumb} />
        {children}
      </div>
    </div>
  );
}

/* ── JSON-LD builders ── */

export function toolJsonLd(
  name: string,
  description: string,
  path: string,
  applicationCategory: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    description,
    url: `${SITE}${path}`,
    applicationCategory,
    operatingSystem: "Web browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description:
        "Free to browse; Visual Bucs apply when generating. New accounts start with free trial Visual Bucs.",
    },
  };
}

export function collectionJsonLd(
  name: string,
  description: string,
  path: string,
  items: { name: string; url: string; description: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: `${SITE}${path}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        url: item.url,
        description: item.description,
      })),
    },
  };
}

export function faqJsonLd(faqs: SeoFaq[]) {
  return buildFaqJsonLd(faqs);
}
