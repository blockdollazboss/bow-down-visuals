/**
 * Renders a `<script type="application/ld+json">` block for structured data.
 *
 * Works identically during the build-time SSR prerender (entry-server.tsx +
 * scripts/prerender.mjs) and after client hydration, so crawlers see the
 * schema.org markup directly in the HTML response.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

const SITE_URL = "https://www.bowdownvisuals.com";

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Bow Down Visuals",
  url: SITE_URL,
  logo: `${SITE_URL}/logo-static.png`,
  email: "support@bowdownvisuals.com",
  description:
    "Bow Down Visuals is an AI-powered creative studio for music creators, generating song lyrics, music video treatments, promo content, and thumbnails.",
  sameAs: [],
};

export const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Bow Down Visuals",
  url: SITE_URL,
};

export function buildFaqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
