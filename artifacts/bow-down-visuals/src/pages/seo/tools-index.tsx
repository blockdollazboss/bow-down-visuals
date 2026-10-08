import { Link } from "wouter";
import { ArrowRight, Wrench } from "lucide-react";
import {
  SeoPageShell,
  SeoHero,
  SeoSiblingNav,
  SeoCtaBanner,
  collectionJsonLd,
} from "@/components/seo/seo-shell";
import { TOOL_PAGES, VERTICAL_HUBS, GENRE_HUBS } from "@/data/seo-pages";

const SITE = "https://bowdownvisuals.com";
const TITLE = "AI Tools for Creators — Thumbnails, Hooks, Videos, Songs & More";
const DESCRIPTION =
  "Every AI tool on Bow Down Visuals: thumbnail maker, hook generator, caption writer, music video maker, clip cutter, and song maker. Free to browse.";

/* ─── /tools — directory of every AI tool (SEO index page) ─────────────── */

export default function ToolsIndex() {
  return (
    <SeoPageShell
      title={TITLE}
      metaDescription={DESCRIPTION}
      breadcrumb={[{ label: "Home", href: "/" }, { label: "AI Tools" }]}
      jsonLdBlocks={[
        collectionJsonLd(
          TITLE,
          DESCRIPTION,
          "/tools",
          TOOL_PAGES.map((t) => ({
            name: t.name,
            url: `${SITE}${t.path}`,
            description: t.metaDescription,
          })),
        ),
      ]}
    >
      <SeoHero
        kicker="The toolkit"
        h1Lead="AI Tools for"
        h1Gold="Creators"
        intro={[
          "One connected toolkit for the entire creator workflow — from the first idea to the posted release. Every tool hands off to the next, so a song becomes a video, a video becomes clips, and clips become posts.",
          "Browse everything free. Credits only apply when you generate.",
        ]}
        primaryCta={{ label: "Open the Thumbnail Maker", href: "/thumbnail-maker" }}
        secondaryCta={{ label: "See pricing", href: "/pricing" }}
      />

      <section className="mb-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_PAGES.map((t) => (
            <Link
              key={t.slug}
              href={t.path}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#e8c86a]/40"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8c86a]/12">
                <Wrench className="h-5 w-5 text-[#e8c86a]" />
              </div>
              <h2 className="text-lg font-bold mb-2 group-hover:text-[#e8c86a] transition-colors">
                {t.name}
              </h2>
              <p className="text-sm text-white/50 mb-5 flex-1">{t.metaDescription}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#e8c86a]">
                Learn more <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <SeoSiblingNav
        heading="Who are you creating as?"
        links={VERTICAL_HUBS.map((v) => ({
          label: `AI Tools for ${v.audience}`,
          href: v.path,
          blurb: v.metaDescription,
        }))}
      />

      <SeoSiblingNav
        heading="Make music by genre"
        links={GENRE_HUBS.map((g) => ({
          label: `Make ${g.name} with AI`,
          href: g.path,
          blurb: g.metaDescription,
        }))}
      />

      <SeoCtaBanner
        heading="Start creating free"
        blurb="Pick a tool, browse its templates, and generate your first asset. New accounts start with free trial credits."
        cta={{ label: "Get started", href: "/signup" }}
      />
    </SeoPageShell>
  );
}
