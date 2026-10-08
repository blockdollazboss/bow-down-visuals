import { Link } from "wouter";
import { ArrowRight, Users } from "lucide-react";
import {
  SeoPageShell,
  SeoHero,
  SeoSiblingNav,
  SeoCtaBanner,
  collectionJsonLd,
} from "@/components/seo/seo-shell";
import { VERTICAL_HUBS, TOOL_PAGES, GENRE_HUBS } from "@/data/seo-pages";

const SITE = "https://bowdownvisuals.com";
const TITLE = "AI Tools by Creator Type — YouTubers, Podcasters, Streamers & More";
const DESCRIPTION =
  "AI toolkits tuned for your kind of creator: YouTubers, podcasters, streamers, musicians, TikTokers, and educators. Tools, templates, and workflows per lane.";

/* ─── /for — directory of creator vertical hubs (SEO index page) ───────── */

export default function ForIndex() {
  return (
    <SeoPageShell
      title={TITLE}
      metaDescription={DESCRIPTION}
      breadcrumb={[{ label: "Home", href: "/" }, { label: "For Creators" }]}
      jsonLdBlocks={[
        collectionJsonLd(
          TITLE,
          DESCRIPTION,
          "/for",
          VERTICAL_HUBS.map((v) => ({
            name: `AI Tools for ${v.audience}`,
            url: `${SITE}${v.path}`,
            description: v.metaDescription,
          })),
        ),
      ]}
    >
      <SeoHero
        kicker="Pick your lane"
        h1Lead="Built for Your Kind"
        h1Gold="of Creator"
        intro={[
          "Generic tools make generic content. Each hub below is a toolkit tuned for one kind of creator — the tools that matter, the templates that fit, and the workflow that actually ships.",
          "Find your lane, steal the workflow, and start posting.",
        ]}
        primaryCta={{ label: "Browse all AI tools", href: "/tools" }}
        secondaryCta={{ label: "See live creator charts", href: "/browse" }}
      />

      <section className="mb-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {VERTICAL_HUBS.map((v) => (
            <Link
              key={v.slug}
              href={v.path}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#e8c86a]/40"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8c86a]/12">
                <Users className="h-5 w-5 text-[#e8c86a]" />
              </div>
              <h2 className="text-lg font-bold mb-2 group-hover:text-[#e8c86a] transition-colors">
                AI Tools for {v.audience}
              </h2>
              <p className="text-sm text-white/50 mb-5 flex-1">{v.metaDescription}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#e8c86a]">
                Explore the hub <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <SeoSiblingNav
        heading="Every AI tool"
        links={TOOL_PAGES.map((t) => ({
          label: t.name,
          href: t.path,
          blurb: t.metaDescription,
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
        heading="Find your unfair advantage"
        blurb="Pick your lane, grab the workflow, and ship your next post today. Free to browse — credits only when you generate."
        cta={{ label: "Get started", href: "/signup" }}
      />
    </SeoPageShell>
  );
}
