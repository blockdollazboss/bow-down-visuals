import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  SeoPageShell,
  SeoHero,
  SeoFaq,
  SeoSiblingNav,
  SeoCtaBanner,
  faqJsonLd,
} from "@/components/seo/seo-shell";
import {
  JsonLd,
} from "@/components/seo/json-ld";
import {
  GENRE_HUBS,
  GENRE_HUB_MAP,
  TOOL_PAGE_MAP,
  type GenreSeo,
} from "@/data/seo-pages";

/* ─── /genres/:genre — genre hub (hip-hop, pop, edm, …) ───────────────────
   Curated genre knowledge (real facts: BPM, origins, subgenres), the AI
   pipeline for the sound, and links to the LIVE discovery hub for actual
   top tracks/creators — never fabricated. WebPage + FAQPage JSON-LD. */

const SITE = "https://bowdownvisuals.com";

export function GenreHubSeo({ genre }: { genre: GenreSeo }) {
  const tools = genre.toolSlugs
    .map((s) => TOOL_PAGE_MAP[s])
    .filter(Boolean)
    .map((t) => ({
      label: t.name,
      href: t.path,
      blurb: t.metaDescription,
    }));
  const siblings = GENRE_HUBS.filter((g) => g.slug !== genre.slug).map((g) => ({
    label: `Make ${g.name} with AI`,
    href: g.path,
    blurb: g.metaDescription,
  }));

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: genre.title,
    description: genre.metaDescription,
    url: `${SITE}${genre.path}`,
    about: {
      "@type": "DefinedTerm",
      name: `${genre.name} music genre`,
      description: genre.intro[0],
    },
  };

  return (
    <SeoPageShell
      title={genre.title}
      metaDescription={genre.metaDescription}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Genres", href: "/genres" },
        { label: genre.name },
      ]}
      jsonLdBlocks={[webPageJsonLd, faqJsonLd(genre.faqs)]}
    >
      <SeoHero
        kicker={genre.kicker}
        h1Lead={genre.h1Lead}
        h1Gold={genre.h1Gold}
        intro={genre.intro}
        primaryCta={{
          label: tools[0] ? `Open the ${tools[0].label}` : "Explore AI tools",
          href: tools[0]?.href ?? "/tools",
        }}
        secondaryCta={{
          label: `Live ${genre.name} charts`,
          href: genre.discoveryHref,
        }}
      />

      {/* Genre facts — real, curated knowledge */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold sm:text-3xl mb-8 text-center">
          {genre.name} at a glance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {genre.facts.map((f) => (
            <div
              key={f.label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <p className="text-[11px] uppercase tracking-widest text-[#e8c86a]/80 mb-1.5">
                {f.label}
              </p>
              <p className="text-white/75">{f.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {genre.subgenres.map((s) => (
            <span
              key={s}
              className="rounded-full border border-white/12 px-4 py-1.5 text-sm text-white/60"
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* AI pipeline for the genre */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold sm:text-3xl mb-3 text-center">
          The AI pipeline for {genre.name.toLowerCase()}
        </h2>
        <p className="text-white/50 text-center max-w-2xl mx-auto mb-8">
          From the first idea to release day — every step tuned for this sound.
        </p>
        <div className="grid gap-5 sm:grid-cols-3">
          {tools.map((t, i) => (
            <Link
              key={t.href}
              href={t.href}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#e8c86a]/40"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8c86a]/15 text-sm font-bold text-[#e8c86a] mb-4">
                {i + 1}
              </span>
              <h3 className="font-bold mb-2 group-hover:text-[#e8c86a] transition-colors">
                {t.label}
              </h3>
              <p className="text-sm text-white/50">{t.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#e8c86a]">
                Open <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Live tracks & creators — honest link to real data */}
      <section className="mb-14 rounded-3xl border border-white/10 bg-white/[0.02] p-8 sm:p-10 text-center">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `Top ${genre.name} tracks and creators`,
            description: `Live ${genre.name.toLowerCase()} charts on Bow Down Visuals.`,
            url: `${SITE}${genre.discoveryHref}`,
          }}
        />
        <h2 className="text-2xl font-bold sm:text-3xl mb-3">
          Hear what's hot in {genre.name.toLowerCase()}
        </h2>
        <p className="text-white/50 max-w-xl mx-auto mb-6">
          Live charts of top {genre.name.toLowerCase()} tracks and the creators
          behind them — real music, updated continuously.
        </p>
        <Link
          href={genre.discoveryHref}
          className="inline-flex items-center gap-2 rounded-full border border-[#e8c86a]/40 px-7 py-3 font-semibold text-[#e8c86a] transition hover:bg-[#e8c86a]/10"
        >
          Browse the {genre.name} hub <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <SeoFaq faqs={genre.faqs} />

      <SeoSiblingNav heading="More genres" links={siblings} />

      <SeoCtaBanner
        heading={`Make your first ${genre.name.toLowerCase()} track`}
        blurb="Describe the vibe and the AI writes and produces the full song. Then cut the video, write the hooks, and ship the release — all in one pipeline."
        cta={{ label: "Open the AI Song Maker", href: "/make-song" }}
      />
    </SeoPageShell>
  );
}

export function GenreHubBySlug({ slug }: { slug: string }) {
  const genre = GENRE_HUB_MAP[slug];
  if (!genre) return null;
  return <GenreHubSeo genre={genre} />;
}
